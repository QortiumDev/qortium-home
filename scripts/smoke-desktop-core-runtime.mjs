#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { createManagedProcess as createManagedProcessBase } from './lib/managed-process.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const commandTimeoutMs = 120_000;
const appTimeoutMs = 90_000;
const cdpTimeoutMs = 90_000;
const chainConfigHashExcludedFields = new Set([
  'checkpoints',
  'featureTriggers',
  'featureTriggerScheduleEnforcementHeight',
  'onlineAccountsSignatureV2Height',
  'assetOrderBoundsHeight',
]);

function log(message) {
  console.log(`[desktop-core-runtime-smoke] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getBin(name) {
  const extension = process.platform === 'win32' ? '.cmd' : '';

  return path.join(repoRoot, 'node_modules', '.bin', `${name}${extension}`);
}

function assertTool(toolPath, label) {
  if (!existsSync(toolPath)) {
    fail(`${label} was not found at ${toolPath}. Run npm install first.`);
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd ?? repoRoot,
        env: options.env ?? process.env,
        timeout: options.timeout ?? commandTimeoutMs,
      },
      (error, stdout, stderr) => {
        if (error) {
          const output = `${stdout}${stderr}`.trim();
          reject(new Error(`${command} ${args.join(' ')} failed${output ? `:\n${output}` : ''}`));
          return;
        }

        resolve({ stderr, stdout });
      },
    );
  });
}

// Wraps the shared helper to preserve this script's repoRoot cwd default.
// The helper spawns detached and kills the whole process group, so tearing down
// an xvfb-run-wrapped Electron no longer orphans Xvfb and the browser.
function createManagedProcess(command, args, options = {}) {
  return createManagedProcessBase(command, args, { cwd: repoRoot, ...options });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      server.close(() => resolve(port));
    });
  });
}

async function waitUntil(label, timeoutMs, action) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await action();

      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(500);
  }

  if (lastError instanceof Error) {
    fail(`${label} timed out: ${lastError.message}`);
  }

  fail(`${label} timed out.`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }

  return JSON.parse(body);
}

function getDisplayLaunch(command, args) {
  if (!process.env.DISPLAY && process.platform === 'linux' && existsSync('/usr/bin/xvfb-run')) {
    return {
      args: ['-a', command, ...args],
      command: '/usr/bin/xvfb-run',
    };
  }

  return {
    args,
    command,
  };
}

class CdpClient {
  constructor(webSocketUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.webSocket = new WebSocket(webSocketUrl);
    this.ready = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('CDP WebSocket connection timed out.')), 15_000);

      this.webSocket.addEventListener(
        'open',
        () => {
          clearTimeout(timeoutId);
          resolve();
        },
        { once: true },
      );
      this.webSocket.addEventListener(
        'error',
        () => {
          clearTimeout(timeoutId);
          reject(new Error('CDP WebSocket connection failed.'));
        },
        { once: true },
      );
    });
    this.webSocket.addEventListener('message', (event) => this.handleMessage(event.data));
  }

  handleMessage(rawMessage) {
    const message = JSON.parse(rawMessage);

    if (!message.id) {
      return;
    }

    const pending = this.pending.get(message.id);

    if (!pending) {
      return;
    }

    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message || 'CDP command failed.'));
    } else {
      pending.resolve(message.result);
    }
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { reject, resolve });
      this.webSocket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.webSocket.close();
  }
}

async function evaluate(client, expression) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await client.send('Runtime.evaluate', {
        awaitPromise: true,
        expression,
        returnByValue: true,
      });

      if (result.exceptionDetails) {
        fail(result.exceptionDetails.text || 'CDP evaluation failed.');
      }

      return result.result?.value;
    } catch (error) {
      if (attempt < 3 && error instanceof Error && error.message.includes('Execution context was destroyed')) {
        await delay(500);
        continue;
      }

      throw error;
    }
  }

  return undefined;
}

async function closeBrowser(client) {
  client.close();
  await delay(250);
}

async function getPageTarget(cdpPort, predicate, label) {
  return waitUntil(label, cdpTimeoutMs, async () => {
    const targets = await fetchJson(`http://127.0.0.1:${cdpPort}/json/list`);

    return targets.find(
      (target) =>
        target.type === 'page' &&
        target.webSocketDebuggerUrl &&
        typeof target.url === 'string' &&
        predicate(target.url),
    ) ?? null;
  });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, 'utf8');
}

function writeRewardIdentity(filePath, value) {
  const identity = Buffer.alloc(32, value);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, identity, { mode: 0o600 });

  if (process.platform !== 'win32') {
    chmodSync(filePath, 0o600);
  }

  return identity;
}

function writeSmokeCoreJar(filePath, { buildTimestamp, buildVersion, commit }) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    zipSync({
      'build.properties': strToU8(
        `build.version=${buildVersion}\nbuild.timestamp=${buildTimestamp}\n`,
      ),
      'git.properties': strToU8(`git.commit.id.full=${commit}\n`),
    }),
  );
}

function sha256File(filePath) {
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}

function canonicalJsonStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJsonStringify(entry)).join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(value[key])}`)
    .join(',')}}`;
}

function coreCompatiblePreviewChainSha256File(filePath) {
  const previewChain = readJson(filePath);
  const compatibleChain = {};

  for (const [key, value] of Object.entries(previewChain)) {
    if (!chainConfigHashExcludedFields.has(key)) {
      compatibleChain[key] = value;
    }
  }

  return `sha256:${createHash('sha256').update(canonicalJsonStringify(compatibleChain)).digest('hex')}`;
}

function getPaths(tempRoot) {
  const userDataDir = path.join(tempRoot, 'user-data');
  const configDir = path.join(tempRoot, 'config');

  return {
    configDir,
    coreBase: path.join(configDir, 'qortium-core'),
    coreInstall: path.join(configDir, 'qortium-core', 'install'),
    coreRuntime: path.join(configDir, 'qortium-core', 'runtime'),
    legacyBase: path.join(userDataDir, 'managed-core'),
    userDataDir,
  };
}

function createPreviewInstall({
  installPath,
  jarIdentity = null,
  networkId = 'qortium-preview',
  previewChainOverrides = {},
  runtimePath,
  tagName = 'vsmoke-preview.1',
}) {
  const previewPath = path.join(installPath, 'preview');
  const jarPath = path.join(installPath, 'qortium.jar');

  if (jarIdentity) {
    writeSmokeCoreJar(jarPath, jarIdentity);
  } else {
    writeText(jarPath, 'smoke jar placeholder\n');
  }
  writeJson(path.join(previewPath, 'previewchain.json'), {
    blockTimestampMargin: 2000,
    networkId,
    ...previewChainOverrides,
  });
  writeText(path.join(previewPath, process.platform === 'win32' ? 'start.bat' : 'start.sh'), 'echo start\n');
  writeText(path.join(previewPath, process.platform === 'win32' ? 'stop.bat' : 'stop.sh'), 'echo stop\n');

  return {
    assetName: 'qortium-preview.zip',
    assetSize: 1,
    channel: 'prerelease',
    digest: null,
    downloadUrl: 'https://example.invalid/qortium-preview.zip',
    htmlUrl: `https://github.com/QortiumDev/qortium-core/releases/tag/${encodeURIComponent(tagName)}`,
    installPath,
    installedAt: new Date().toISOString(),
    ...(jarIdentity
      ? {
          jarBuildTimestamp: jarIdentity.buildTimestamp,
          jarBuildVersion: jarIdentity.buildVersion,
          jarCommit: jarIdentity.commit,
          jarSemver: jarIdentity.buildVersion.replace(/-.+$/, ''),
          originJarBuildVersion: jarIdentity.buildVersion,
          originJarCommit: jarIdentity.commit,
        }
      : {}),
    jarPath,
    logPaths: {
      appLogPath: path.join(runtimePath, 'qortium.log'),
      launcherLogPath: path.join(runtimePath, 'run.log'),
    },
    name: tagName,
    previewPath,
    runtimePath,
    tagName,
  };
}

function createRuntimeEntries(runtimePath, label) {
  writeText(path.join(runtimePath, 'apikey.txt'), `${label}-api-key\n`);
  writeText(path.join(runtimePath, 'db-preview', 'marker.txt'), `${label} db marker\n`);
  writeText(path.join(runtimePath, 'data-preview', 'marker.txt'), `${label} data marker\n`);
  writeJson(path.join(runtimePath, 'lists', 'followedQdn.json'), [`APP/${label}/followed`]);
  writeJson(path.join(runtimePath, 'settings-preview-local.json'), {
    apiDocumentationEnabled: true,
    smokeMarker: label,
  });
  writeText(path.join(runtimePath, 'run.log'), `${label} launcher log\n`);
}

function assertRuntimeEntriesPreserved(runtimePath, label, context) {
  assert(existsSync(path.join(runtimePath, 'apikey.txt')), `${context} API key was not found.`);
  assert(existsSync(path.join(runtimePath, 'db-preview', 'marker.txt')), `${context} db-preview marker was not found.`);
  assert(existsSync(path.join(runtimePath, 'data-preview', 'marker.txt')), `${context} data-preview marker was not found.`);
  assert(existsSync(path.join(runtimePath, 'lists', 'followedQdn.json')), `${context} followedQdn list was not found.`);

  const followedQdn = readJson(path.join(runtimePath, 'lists', 'followedQdn.json'));
  assert(
    Array.isArray(followedQdn) && followedQdn.includes(`APP/${label}/followed`),
    `${context} followedQdn list content was not preserved.`,
  );

  const settings = readJson(path.join(runtimePath, 'settings-preview-local.json'));
  assert(settings.smokeMarker === label, `${context} runtime settings marker was not preserved.`);
}

async function withHomeClient(tempRoot, callback) {
  const electronBin = getBin('electron');
  const viteBin = getBin('vite');
  const { configDir, userDataDir } = getPaths(tempRoot);
  const cdpPort = await getFreePort();
  const vitePort = await getFreePort();
  const devServerUrl = `http://127.0.0.1:${vitePort}`;
  const smokeEnv = {
    ...process.env,
    QORTIUM_HOME_NODE_API_URL: 'http://127.0.0.1:24891',
    QORTIUM_HOME_USER_DATA_DIR: userDataDir,
    VITE_DEV_SERVER_URL: devServerUrl,
    XDG_CONFIG_HOME: configDir,
  };
  let viteProcess = null;
  let electronProcess = null;

  try {
    viteProcess = createManagedProcess(
      viteBin,
      ['--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
      { env: smokeEnv },
    );

    await waitUntil('Vite dev server', appTimeoutMs, async () => {
      const response = await fetch(devServerUrl).catch(() => null);

      return response?.ok === true;
    });

    // package.json now boots Home v2, whose shell intentionally has no classic
    // core-manager preload. Launch the compiled classic main entry directly so
    // this focused manager smoke still exercises window.qortiumHome.core.
    const electronLaunch = getDisplayLaunch(electronBin, [
      `--remote-debugging-port=${cdpPort}`,
      path.join(repoRoot, 'dist-electron', 'main.js'),
    ]);
    electronProcess = createManagedProcess(electronLaunch.command, electronLaunch.args, { env: smokeEnv });

    const mainTarget = await getPageTarget(
      cdpPort,
      (url) => url.startsWith(devServerUrl),
      'Electron main page target',
    );
    const mainClient = new CdpClient(mainTarget.webSocketDebuggerUrl);

    try {
      await mainClient.send('Runtime.enable');
      await waitUntil('Qortium Home API preload', appTimeoutMs, async () => {
        const found = await evaluate(mainClient, '!!window.qortiumHome?.core');

        return found === true;
      });
      await callback(mainClient);
      await closeBrowser(mainClient);
    } finally {
      mainClient.close();
    }
  } catch (error) {
    const processOutput = [
      ...(viteProcess?.output ?? []),
      ...(electronProcess?.output ?? []),
    ].join('').trim();

    throw new Error(
      `${error instanceof Error ? error.message : String(error)}` +
        (processOutput ? `\nChild process output:\n${processOutput.slice(-8_000)}` : ''),
    );
  } finally {
    await electronProcess?.stop();
    await viteProcess?.stop();
  }
}

async function runLegacyInstallListsCopyScenario() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-core-legacy-lists-'));
  const legacyPreviewPath = path.join(tempRoot, 'install', 'preview');
  const runtimePath = path.join(tempRoot, 'runtime');

  writeJson(path.join(legacyPreviewPath, 'lists', 'legacyOnly.json'), ['legacy-only']);
  writeJson(path.join(legacyPreviewPath, 'lists', 'followedQdn.json'), ['legacy-followed']);
  writeJson(path.join(runtimePath, 'lists', 'followedQdn.json'), ['runtime-followed']);

  try {
    const { copyLegacyInstallListsToRuntime } = await import(
      pathToFileURL(path.join(repoRoot, 'dist-electron', 'core-runtime-files.js')).href
    );

    await copyLegacyInstallListsToRuntime(legacyPreviewPath, runtimePath);

    const legacyOnly = readJson(path.join(runtimePath, 'lists', 'legacyOnly.json'));
    const followedQdn = readJson(path.join(runtimePath, 'lists', 'followedQdn.json'));

    assert(
      Array.isArray(legacyOnly) && legacyOnly.includes('legacy-only'),
      'Legacy install-only list was not copied into the runtime lists directory.',
    );
    assert(
      Array.isArray(followedQdn) &&
        followedQdn.includes('runtime-followed') &&
        !followedQdn.includes('legacy-followed'),
      'Existing runtime list was overwritten by a legacy install-folder list.',
    );
    assert(
      existsSync(path.join(legacyPreviewPath, 'lists', 'legacyOnly.json')),
      'Legacy install-folder list was moved instead of copied.',
    );

    log('Legacy install-folder Core lists copied without overwriting runtime lists.');
  } finally {
    if (process.env.QORTIUM_HOME_KEEP_DESKTOP_SMOKE_DATA !== '1') {
      rmSync(tempRoot, { force: true, recursive: true });
    } else {
      log(`Kept legacy lists copy smoke data at ${tempRoot}.`);
    }
  }
}

async function getCoreStatus(client) {
  const result = await evaluate(
    client,
    `
      window.qortiumHome.core.getStatus()
        .then((status) => ({ ok: true, status }))
        .catch((error) => ({ ok: false, message: String(error && error.message || error) }))
    `,
  );

  if (!result?.ok) {
    fail(result?.message || 'core.getStatus failed.');
  }

  return result.status;
}

async function expectCurrentHomeDownloadRejected(client) {
  const currentTag = `v${packageJson.version}`;
  const result = await evaluate(
    client,
    `
      window.qortiumHome.updates.downloadAsset({
        asset: {
          digest: null,
          downloadUrl: 'https://example.invalid/Qortium-Home-current.AppImage',
          name: 'Qortium-Home-current.AppImage',
          size: 1
        },
        platform: { arch: 'x64', label: 'Linux x64', os: 'linux', supported: true },
        releaseTag: ${JSON.stringify(currentTag)}
      })
        .then((status) => ({ ok: true, status }))
        .catch((error) => ({ ok: false, message: String(error && error.message || error) }))
    `,
  );

  assert(result?.ok === false, 'Current Home update download unexpectedly succeeded.');
  assert(
    String(result?.message ?? '').includes('already current'),
    `Current Home update guard returned an unexpected message: ${result?.message ?? 'unknown'}.`,
  );
}

async function runLegacyMigrationScenario() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-core-migration-'));
  const paths = getPaths(tempRoot);
  const legacyRuntime = path.join(paths.legacyBase, 'runtime');
  const legacyInstall = path.join(paths.legacyBase, 'versions', 'vsmoke-preview.1');
  const legacyCore = createPreviewInstall({
    installPath: legacyInstall,
    runtimePath: legacyRuntime,
  });
  const legacyRewardIdentityPath = path.join(legacyCore.previewPath, 'reward-node', 'identity.key');
  const legacyRewardIdentity = writeRewardIdentity(legacyRewardIdentityPath, 0x5a);

  createRuntimeEntries(legacyRuntime, 'legacy');
  writeJson(path.join(paths.legacyBase, 'current.json'), legacyCore);

  try {
    await withHomeClient(tempRoot, async (client) => {
      const status = await getCoreStatus(client);

      assert(status?.installed?.installPath === paths.coreInstall, 'Legacy Core install was not moved to qortium-core/install.');
      assert(status?.installed?.runtimePath === paths.coreRuntime, 'Legacy runtime did not resolve to qortium-core/runtime.');
      await expectCurrentHomeDownloadRejected(client);
    });

    const runtimeChain = readJson(path.join(paths.coreRuntime, 'runtime-chain.json'));
    const previewChainPath = path.join(paths.coreInstall, 'preview', 'previewchain.json');

    assert(!existsSync(paths.legacyBase), 'Legacy managed-core folder was not cleaned after migration.');
    assert(existsSync(path.join(paths.coreInstall, 'qortium.jar')), 'Migrated Core jar was not found.');
    assert(
      readFileSync(path.join(paths.coreRuntime, 'reward-node', 'identity.key')).equals(legacyRewardIdentity),
      'Legacy reward-node identity was not preserved in the persistent runtime.',
    );
    assert(
      readFileSync(path.join(paths.coreInstall, 'preview', 'reward-node', 'identity.key')).equals(
        legacyRewardIdentity,
      ),
      'Migrated install did not retain its rollback-compatible reward-node identity.',
    );
    assertRuntimeEntriesPreserved(paths.coreRuntime, 'legacy', 'Migrated runtime');
    assert(runtimeChain.networkId === 'qortium-preview', 'Runtime chain metadata did not record the Previewnet network id.');
    assert(
      runtimeChain.previewChainSha256 === coreCompatiblePreviewChainSha256File(previewChainPath),
      'Runtime chain metadata hash does not match the Core-compatible previewchain.json identity.',
    );
    assert(runtimeChain.rawPreviewChainSha256 === sha256File(previewChainPath), 'Runtime chain metadata did not record the raw previewchain.json hash.');

    log('Legacy managed-core migration preserved runtime data.');
  } finally {
    if (process.env.QORTIUM_HOME_KEEP_DESKTOP_SMOKE_DATA !== '1') {
      rmSync(tempRoot, { force: true, recursive: true });
    } else {
      log(`Kept legacy migration smoke data at ${tempRoot}.`);
    }
  }
}

async function runRuntimeMismatchScenario() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-core-mismatch-'));
  const paths = getPaths(tempRoot);
  const legacyRuntime = path.join(paths.legacyBase, 'runtime');
  const legacyInstall = path.join(paths.legacyBase, 'versions', 'vsmoke-preview.2');
  const legacyCore = createPreviewInstall({
    installPath: legacyInstall,
    runtimePath: legacyRuntime,
    tagName: 'vsmoke-preview.2',
  });
  const blockedRuntimeChain = {
    coreTagName: 'vold-chain',
    // A DIFFERENT network is the only thing Home blocks on now: a same-network
    // fingerprint change is Core's business, not Home's.
    networkId: 'old-preview',
    previewChainSha256: `sha256:${'0'.repeat(64)}`,
    recordedAt: new Date().toISOString(),
    version: 1,
  };

  createRuntimeEntries(legacyRuntime, 'blocked-legacy');
  writeJson(path.join(paths.legacyBase, 'current.json'), legacyCore);
  writeJson(path.join(paths.coreRuntime, 'runtime-chain.json'), blockedRuntimeChain);
  writeText(path.join(paths.coreRuntime, 'db-preview', 'existing.txt'), 'existing db marker\n');

  try {
    await withHomeClient(tempRoot, async (client) => {
      const status = await getCoreStatus(client);

      assert(status?.runtime?.blocked, 'Mismatched runtime did not surface runtime.blocked status.');
      assert(
        String(status.runtime.blocked.message).includes('different network'),
        'Blocked runtime status did not include the network mismatch message.',
      );
      assert(status.runtime.blocked.markerPath === path.join(paths.coreRuntime, 'runtime-migration-blocked.json'), 'Blocked marker path was unexpected.');
    });

    assert(existsSync(path.join(paths.coreRuntime, 'runtime-migration-blocked.json')), 'Blocked migration marker was not written.');
    assert(existsSync(path.join(paths.coreRuntime, 'db-preview', 'existing.txt')), 'Existing runtime DB marker was removed.');
    assert(existsSync(path.join(legacyRuntime, 'apikey.txt')), 'Legacy runtime API key was moved despite mismatch.');
    assert(existsSync(path.join(legacyInstall, 'qortium.jar')), 'Legacy install was moved despite mismatch.');
    assert(!existsSync(paths.coreInstall), 'Stable Core install was created despite runtime mismatch.');

    log('Cross-network runtime mismatch blocked migration without deleting data.');
  } finally {
    if (process.env.QORTIUM_HOME_KEEP_DESKTOP_SMOKE_DATA !== '1') {
      rmSync(tempRoot, { force: true, recursive: true });
    } else {
      log(`Kept mismatch smoke data at ${tempRoot}.`);
    }
  }
}

async function runStaleSameNetworkMetadataRepairScenario() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-core-stale-same-network-'));
  const paths = getPaths(tempRoot);
  const installedCore = createPreviewInstall({
    installPath: paths.coreInstall,
    runtimePath: paths.coreRuntime,
    tagName: 'v1.7.3',
  });
  const previewChainPath = path.join(paths.coreInstall, 'preview', 'previewchain.json');
  const staleRuntimeChain = {
    coreTagName: 'v1.7.2',
    networkId: 'qortium-preview',
    // Home 1.6.x recorded this fingerprint for the Core 1.7.x config;
    // Home 1.7.0 changed the formula and previously rejected this value.
    previewChainSha256: 'sha256:3108af2769d1de362173e68dc316b886dc2f43423fb1ba39ee600ed4e467a79b',
    rawPreviewChainSha256: 'sha256:986865ddd00b3b28b7fa8d90478380e2400b60309b9f3cb973f675520d25d7dc',
    recordedAt: new Date().toISOString(),
    version: 1,
  };

  try {
    createRuntimeEntries(paths.coreRuntime, 'stale-same-network');
    writeJson(path.join(paths.coreBase, 'current.json'), installedCore);
    writeJson(path.join(paths.coreRuntime, 'runtime-chain.json'), staleRuntimeChain);
    writeJson(path.join(paths.coreRuntime, 'runtime-migration-blocked.json'), {
      blockedAt: new Date().toISOString(),
      current: {
        coreTagName: installedCore.tagName,
        networkId: 'qortium-preview',
        previewChainSha256: coreCompatiblePreviewChainSha256File(previewChainPath),
      },
      existing: staleRuntimeChain,
      message: 'stale same-network block from Home 1.7.0',
      version: 1,
    });

    await withHomeClient(tempRoot, async (client) => {
      const status = await getCoreStatus(client);

      assert(!status?.runtime?.blocked, 'Stale same-network metadata still blocked the installed Core.');
    });

    const repairedRuntimeChain = readJson(path.join(paths.coreRuntime, 'runtime-chain.json'));

    assert(
      !existsSync(path.join(paths.coreRuntime, 'runtime-migration-blocked.json')),
      'Same-network metadata repair did not clear the stale blocked marker.',
    );
    assertRuntimeEntriesPreserved(paths.coreRuntime, 'stale-same-network', 'Same-network metadata repair runtime');
    assert(
      repairedRuntimeChain.previewChainSha256 === coreCompatiblePreviewChainSha256File(previewChainPath),
      'Same-network metadata repair did not record the current compatible identity.',
    );
    assert(
      repairedRuntimeChain.rawPreviewChainSha256 === sha256File(previewChainPath),
      'Same-network metadata repair did not record the current raw identity.',
    );
    assert(
      repairedRuntimeChain.coreTagName === installedCore.tagName,
      'Same-network metadata repair did not record the installed Core release.',
    );

    log('Stale same-network runtime metadata self-repaired without deleting data.');
  } finally {
    if (process.env.QORTIUM_HOME_KEEP_DESKTOP_SMOKE_DATA !== '1') {
      rmSync(tempRoot, { force: true, recursive: true });
    } else {
      log(`Kept same-network metadata repair smoke data at ${tempRoot}.`);
    }
  }
}

async function runManualCoreReplacementScenario({ replacePreviewFiles }) {
  const suffix = replacePreviewFiles ? 'direct-release' : 'test-jar';
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), `qortium-home-core-${suffix}-`));
  const paths = getPaths(tempRoot);
  const originJarIdentity = {
    buildTimestamp: '2026-08-01T00:00:00Z',
    buildVersion: '1.6.3-a1b2c3d',
    commit: 'a1b2c3d4e5f6789012345678901234567890abcd',
  };
  const replacementJarIdentity = {
    buildTimestamp: '2026-08-16T12:00:00Z',
    buildVersion: '1.7.0-e56ce8b',
    commit: 'e56ce8b249566280ba97412dec781f0c726f19d5',
  };
  const installedCore = createPreviewInstall({
    installPath: paths.coreInstall,
    jarIdentity: originJarIdentity,
    runtimePath: paths.coreRuntime,
    tagName: 'v1.6.3',
  });
  const previewChainPath = path.join(paths.coreInstall, 'preview', 'previewchain.json');
  const originalRawHash = sha256File(previewChainPath);
  const originalCompatibleHash = coreCompatiblePreviewChainSha256File(previewChainPath);

  try {
    createRuntimeEntries(paths.coreRuntime, suffix);
    writeJson(path.join(paths.coreBase, 'current.json'), installedCore);
    writeJson(path.join(paths.coreRuntime, 'runtime-chain.json'), {
      coreTagName: installedCore.tagName,
      networkId: 'qortium-preview',
      previewChainSha256: originalCompatibleHash,
      rawPreviewChainSha256: originalRawHash,
      recordedAt: new Date().toISOString(),
      version: 1,
    });

    if (replacePreviewFiles) {
      writeSmokeCoreJar(installedCore.jarPath, replacementJarIdentity);
      const replacementPreviewChain = readJson(previewChainPath);

      replacementPreviewChain.featureTriggerScheduleEnforcementHeight = 99990;
      replacementPreviewChain.featureTriggers = {
        onlineNodeRewardBundlesPayoutHeight: 100000,
      };
      writeJson(previewChainPath, replacementPreviewChain);
    }

    await withHomeClient(tempRoot, async (client) => {
      if (!replacePreviewFiles) {
        const initialStatus = await getCoreStatus(client);

        assert(
          initialStatus?.installed?.modifiedSinceInstall !== true,
          'Managed release was marked modified before the test jar replacement.',
        );
        writeSmokeCoreJar(installedCore.jarPath, replacementJarIdentity);
      }

      const status = await getCoreStatus(client);

      assert(!status?.runtime?.blocked, `${suffix} replacement was incorrectly blocked.`);
      assert(status?.installed?.tagName === 'v1.6.3', `${suffix} replacement lost its release provenance.`);
      assert(status?.installed?.modifiedSinceInstall === true, `${suffix} replacement was not detected.`);
      assert(
        status?.installed?.jarBuildVersion === replacementJarIdentity.buildVersion,
        `${suffix} replacement did not report the installed jar build.`,
      );
    });

    const reconciledInstall = readJson(path.join(paths.coreBase, 'current.json'));
    const reconciledRuntime = readJson(path.join(paths.coreRuntime, 'runtime-chain.json'));

    assert(reconciledInstall.tagName === 'v1.6.3', `${suffix} reconciliation rewrote release provenance.`);
    assert(
      reconciledInstall.jarBuildVersion === replacementJarIdentity.buildVersion,
      `${suffix} reconciliation did not persist the actual jar identity.`,
    );
    assert(
      reconciledRuntime.coreTagName === `v${replacementJarIdentity.buildVersion}`,
      `${suffix} runtime metadata retained the stale release label.`,
    );
    assert(
      reconciledRuntime.previewChainSha256 === originalCompatibleHash,
      `${suffix} replacement changed the compatible runtime identity.`,
    );
    assert(
      reconciledRuntime.rawPreviewChainSha256 === sha256File(previewChainPath),
      `${suffix} replacement did not record the installed previewchain bytes.`,
    );
    assertRuntimeEntriesPreserved(paths.coreRuntime, suffix, `${suffix} replacement runtime`);

    log(
      replacePreviewFiles
        ? 'Direct Core release replacement self-reconciled compatible Previewnet files.'
        : 'Test jar replacement self-reconciled without losing release provenance.',
    );
  } finally {
    if (process.env.QORTIUM_HOME_KEEP_DESKTOP_SMOKE_DATA !== '1') {
      rmSync(tempRoot, { force: true, recursive: true });
    } else {
      log(`Kept ${suffix} replacement smoke data at ${tempRoot}.`);
    }
  }
}

async function runCompatibleChainUpdateScenario() {
  const legacyTempRoot = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-core-compatible-chain-legacy-'));
  const paths = getPaths(legacyTempRoot);
  const oldCore = createPreviewInstall({
    installPath: paths.coreInstall,
    runtimePath: paths.coreRuntime,
    tagName: 'vsmoke-preview.14',
  });
  const oldPreviewChainPath = path.join(paths.coreInstall, 'preview', 'previewchain.json');
  const oldRawPreviewChainSha256 = sha256File(oldPreviewChainPath);
  const oldCompatiblePreviewChainSha256 = coreCompatiblePreviewChainSha256File(oldPreviewChainPath);
  const legacyRuntimeChain = {
    coreTagName: oldCore.tagName,
    networkId: 'qortium-preview',
    previewChainSha256: oldRawPreviewChainSha256,
    recordedAt: new Date().toISOString(),
    version: 1,
  };

  try {
    createRuntimeEntries(paths.coreRuntime, 'compatible-chain');
    writeJson(path.join(paths.coreBase, 'current.json'), oldCore);
    writeJson(path.join(paths.coreRuntime, 'runtime-chain.json'), legacyRuntimeChain);
    writeJson(path.join(paths.coreRuntime, 'runtime-migration-blocked.json'), {
      blockedAt: new Date().toISOString(),
      current: {
        coreTagName: 'vsmoke-preview.16',
        networkId: 'qortium-preview',
        previewChainSha256: `sha256:${'1'.repeat(64)}`,
      },
      existing: legacyRuntimeChain,
      message: 'stale blocked marker from a previous raw previewchain hash comparison',
      version: 1,
    });

    await withHomeClient(legacyTempRoot, async (client) => {
      const status = await getCoreStatus(client);

      assert(!status?.runtime?.blocked, 'Legacy raw runtime-chain metadata still blocked the current installed Core.');
    });

    const migratedRuntimeChain = readJson(path.join(paths.coreRuntime, 'runtime-chain.json'));

    assert(!existsSync(path.join(paths.coreRuntime, 'runtime-migration-blocked.json')), 'Compatible legacy raw hash did not clear the blocked marker.');
    assert(
      migratedRuntimeChain.previewChainSha256 === oldCompatiblePreviewChainSha256,
      'Legacy raw runtime-chain metadata was not rewritten to the Core-compatible hash.',
    );
    assert(
      migratedRuntimeChain.rawPreviewChainSha256 === oldRawPreviewChainSha256,
      'Legacy raw runtime-chain migration did not retain the raw previewchain hash.',
    );
  } finally {
    if (process.env.QORTIUM_HOME_KEEP_DESKTOP_SMOKE_DATA !== '1') {
      rmSync(legacyTempRoot, { force: true, recursive: true });
    } else {
      log(`Kept compatible chain legacy smoke data at ${legacyTempRoot}.`);
    }
  }

  const updateTempRoot = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-core-compatible-chain-update-'));
  const updatePaths = getPaths(updateTempRoot);

  try {
    createRuntimeEntries(updatePaths.coreRuntime, 'compatible-update');
    writeJson(path.join(updatePaths.coreRuntime, 'runtime-chain.json'), {
      coreTagName: oldCore.tagName,
      networkId: 'qortium-preview',
      previewChainSha256: oldCompatiblePreviewChainSha256,
      rawPreviewChainSha256: oldRawPreviewChainSha256,
      recordedAt: new Date().toISOString(),
      version: 1,
    });
    const updatedCore = createPreviewInstall({
      installPath: updatePaths.coreInstall,
      previewChainOverrides: {
        assetOrderBoundsHeight: 27000,
        checkpoints: [
          {
            height: 24000,
            signature: 'smoke-checkpoint-signature',
          },
        ],
        featureTriggerScheduleEnforcementHeight: 99990,
        onlineAccountsSignatureV2Height: 27000,
      },
      runtimePath: updatePaths.coreRuntime,
      tagName: 'vsmoke-preview.16',
    });
    const updatedPreviewChainPath = path.join(updatePaths.coreInstall, 'preview', 'previewchain.json');

    writeJson(path.join(updatePaths.coreBase, 'current.json'), updatedCore);

    await withHomeClient(updateTempRoot, async (client) => {
      const status = await getCoreStatus(client);

      assert(!status?.runtime?.blocked, 'Compatible excluded previewchain fields blocked the Core update.');
    });

    const updatedRuntimeChain = readJson(path.join(updatePaths.coreRuntime, 'runtime-chain.json'));

    assert(existsSync(path.join(updatePaths.coreRuntime, 'db-preview', 'marker.txt')), 'Compatible Core update removed existing runtime DB data.');
    assertRuntimeEntriesPreserved(updatePaths.coreRuntime, 'compatible-update', 'Compatible Core update runtime');
    assert(
      updatedRuntimeChain.previewChainSha256 === oldCompatiblePreviewChainSha256,
      'Compatible Core update changed the effective runtime chain hash.',
    );
    assert(
      updatedRuntimeChain.previewChainSha256 === coreCompatiblePreviewChainSha256File(updatedPreviewChainPath),
      'Updated Core previewchain did not match the stored Core-compatible hash.',
    );
    assert(
      updatedRuntimeChain.rawPreviewChainSha256 === sha256File(updatedPreviewChainPath),
      'Updated Core runtime metadata did not record the new raw previewchain hash.',
    );

    log('Compatible Previewnet chain update preserved runtime data and cleared stale blocks.');
  } finally {
    if (process.env.QORTIUM_HOME_KEEP_DESKTOP_SMOKE_DATA !== '1') {
      rmSync(updateTempRoot, { force: true, recursive: true });
    } else {
      log(`Kept compatible chain update smoke data at ${updateTempRoot}.`);
    }
  }
}

async function main() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const electronBin = getBin('electron');
  const viteBin = getBin('vite');

  assertTool(electronBin, 'electron');
  assertTool(viteBin, 'vite');

  log('Building Electron main process.');
  await run(npm, ['run', 'build:electron']);
  await runLegacyInstallListsCopyScenario();
  await runLegacyMigrationScenario();
  await runRuntimeMismatchScenario();
  await runStaleSameNetworkMetadataRepairScenario();
  await runCompatibleChainUpdateScenario();
  await runManualCoreReplacementScenario({ replacePreviewFiles: false });
  await runManualCoreReplacementScenario({ replacePreviewFiles: true });
  log('Desktop Core runtime smoke test passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
