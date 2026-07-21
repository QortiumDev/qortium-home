#!/usr/bin/env node

// Drives the real Home renderer to prove that a downloaded update stops being
// reported as pending once it has been installed.
//
// The regression this guards (fixed in #179): an 'up-to-date' check result
// still carries the compatible asset for the installed release, so a stored
// downloadedUpdate kept matching on release tag and digest forever. The
// dashboard reported "Downloaded" and offered "Show file" / "Install APK"
// instead of "Up to date", on every launch, permanently.
//
// GitHub is stubbed rather than queried so the scenarios stay deterministic:
// asserting the real 'up-to-date' path against live releases would only hold
// while the installed version happens to be the newest published one.

import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createManagedProcess as createManagedProcessBase } from './lib/managed-process.mjs';
import {
  assertScenarioState,
  buildFetchStubSource,
  buildScenarioFixture,
  buildUpdateCardStateSource,
  getScenarioExpectations,
  parseScenarioArgument,
} from './lib/app-update-scenarios.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const commandTimeoutMs = 120_000;
const appTimeoutMs = 90_000;
const cdpTimeoutMs = 90_000;
const updateStatusTimeoutMs = 60_000;


function log(message) {
  console.log(`[desktop-app-update-state-smoke] ${message}`);
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

  handleMessage(data) {
    let message = null;

    try {
      message = JSON.parse(typeof data === 'string' ? data : String(data));
    } catch {
      return;
    }

    const entry = message?.id ? this.pending.get(message.id) : null;

    if (!entry) {
      return;
    }

    this.pending.delete(message.id);

    if (message.error) {
      entry.reject(new Error(message.error.message ?? 'CDP call failed.'));
      return;
    }

    entry.resolve(message.result ?? {});
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
      // A reload tears the execution context down mid-flight; retrying is the
      // difference between a flaky harness and a real signal.
      if (attempt < 3 && error instanceof Error && error.message.includes('Execution context was destroyed')) {
        await delay(500);
        continue;
      }

      throw error;
    }
  }

  return undefined;
}

async function getPageTarget(cdpPort, predicate, label) {
  return waitUntil(label, cdpTimeoutMs, async () => {
    const targets = await fetchJson(`http://127.0.0.1:${cdpPort}/json/list`);

    return (
      targets.find(
        (target) =>
          target.type === 'page' &&
          target.webSocketDebuggerUrl &&
          typeof target.url === 'string' &&
          predicate(target.url),
      ) ?? null
    );
  });
}

async function closeBrowser(client) {
  await Promise.race([client.send('Browser.close').catch(() => undefined), delay(1_000)]);
}

// Bundles the shipped asset selector so the harness picks the same asset the
// app will, instead of reimplementing the priority rules and drifting from them.
async function loadAssetSelector(tempRoot) {
  const outFile = path.join(tempRoot, 'app-update-assets.mjs');

  await run(getBin('esbuild'), [
    path.join(repoRoot, 'src', 'app-update-assets.ts'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    `--outfile=${outFile}`,
  ]);

  return import(pathToFileUrl(outFile));
}

function pathToFileUrl(filePath) {
  return `file://${filePath}`;
}

// Desktop stores the preferences blob in localStorage, since the renderer is
// not a Capacitor native platform.
const storedDownloadTagExpression = `
  (() => {
    try {
      return JSON.parse(window.localStorage.getItem('qortium-home-app-update-preferences') || '{}')
        .downloadedUpdate?.releaseTag ?? null;
    } catch {
      return null;
    }
  })()
`;

async function waitForSettledStatus(client, label) {
  // 'Checking' is the pre-result state; settling on it would assert nothing.
  return waitUntil(label, updateStatusTimeoutMs, async () => {
    const state = await evaluate(client, buildUpdateCardStateSource(storedDownloadTagExpression));

    return state && state.status && state.status !== 'Checking' ? state : null;
  });
}

async function runScenario({ client, environment, scenario, selectAsset }) {
  const currentVersion = environment.currentVersion;
  const probe = buildScenarioFixture({ currentVersion, fail, scenario });
  const asset = selectAsset(probe.release.assets, environment.platform);

  assert(
    !!asset,
    `No stubbed asset matches ${environment.platform.os}/${environment.platform.arch}; the harness cannot seed a download.`,
  );

  // 'off' suppresses the automatic check on mount, so the seeded state cannot
  // be consumed (and cleared) by a real GitHub check before the stub is in place.
  const { preferences, release } = buildScenarioFixture({
    asset,
    currentVersion,
    fail,
    homeUpdatePolicy: 'off',
    scenario,
  });

  log(
    `Scenario ${scenario}: installed ${currentVersion}, stubbed release ${release.tag_name}, seeded download ${asset.name}.`,
  );

  await evaluate(
    client,
    `window.localStorage.setItem('qortium-home-app-update-preferences', ${JSON.stringify(JSON.stringify(preferences))})`,
  );
  await client.send('Page.reload', { ignoreCache: true });
  await waitUntil('Home update card', updateStatusTimeoutMs, () =>
    evaluate(client, `!!document.querySelector('.dashboard-card--updates')`),
  );

  // Applied after load so it behaves identically to the Android harness, where
  // CapacitorHttp replaces window.fetch during startup.
  await evaluate(client, buildFetchStubSource(release));
  await evaluate(client, `document.querySelector('.dashboard-card--updates .dashboard-card__header-button').click()`);

  const state = await waitForSettledStatus(client, `Home update status (${scenario})`);

  log(`Scenario ${scenario}: status "${state.status}", actions [${state.actions.join(', ')}].`);

  assertScenarioState({
    assert,
    expectations: getScenarioExpectations({ platformOs: environment.platform.os, release, scenario }),
    scenario,
    state,
  });

  log(`Scenario ${scenario} passed.`);
}

async function runSmoke({ electronBin, scenarios, viteBin }) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-app-update-state-'));
  const userDataDir = path.join(tempRoot, 'user-data');
  const cdpPort = await getFreePort();
  const vitePort = await getFreePort();
  const devServerUrl = `http://127.0.0.1:${vitePort}`;
  let viteProcess = null;
  let electronProcess = null;
  const smokeEnv = {
    ...process.env,
    QORTIUM_HOME_USER_DATA_DIR: userDataDir,
    VITE_DEV_SERVER_URL: devServerUrl,
    XDG_CONFIG_HOME: path.join(tempRoot, 'config'),
  };

  try {
    const { selectCompatibleUpdateAsset } = await loadAssetSelector(tempRoot);

    log(`Starting Vite on ${devServerUrl}.`);
    viteProcess = createManagedProcess(
      viteBin,
      ['--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
      { env: smokeEnv },
    );

    await waitUntil('Vite dev server', appTimeoutMs, async () => {
      const response = await fetch(devServerUrl).catch(() => null);

      return response?.ok === true;
    });

    const electronLaunch = getDisplayLaunch(electronBin, [`--remote-debugging-port=${cdpPort}`, '.']);

    log(`Starting Electron with CDP on 127.0.0.1:${cdpPort}.`);
    electronProcess = createManagedProcess(electronLaunch.command, electronLaunch.args, { env: smokeEnv });

    const mainTarget = await getPageTarget(
      cdpPort,
      (url) => url.startsWith(devServerUrl),
      'Electron main page target',
    );
    const mainClient = new CdpClient(mainTarget.webSocketDebuggerUrl);

    try {
      await mainClient.send('Runtime.enable');
      await mainClient.send('Page.enable');

      const environment = await waitUntil('Home update environment', cdpTimeoutMs, async () => {
        const value = await evaluate(
          mainClient,
          `window.qortiumHome?.updates?.getEnvironment ? window.qortiumHome.updates.getEnvironment() : null`,
        );

        return value?.currentVersion ? value : null;
      });

      const packageVersion = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;

      // If these ever disagree the scenarios would stub the wrong release and
      // pass without exercising anything.
      assert(
        environment.currentVersion === packageVersion,
        `App reported version ${environment.currentVersion} but package.json says ${packageVersion}.`,
      );

      for (const scenario of scenarios) {
        await runScenario({
          client: mainClient,
          environment,
          scenario,
          selectAsset: selectCompatibleUpdateAsset,
        });
      }

      await closeBrowser(mainClient);
    } finally {
      mainClient.close();
    }
  } finally {
    await electronProcess?.stop();
    await viteProcess?.stop();

    if (process.env.QORTIUM_HOME_KEEP_DESKTOP_SMOKE_DATA !== '1') {
      rmSync(tempRoot, { force: true, recursive: true });
    } else {
      log(`Kept smoke data at ${tempRoot}.`);
    }

    if (!viteProcess?.wasStopped() && viteProcess?.child.exitCode && viteProcess.child.exitCode !== 0) {
      log(`Vite output:\n${viteProcess.output.join('')}`);
    }

    if (
      !electronProcess?.wasStopped() &&
      electronProcess?.child.exitCode &&
      electronProcess.child.exitCode !== 0
    ) {
      log(`Electron output:\n${electronProcess.output.join('')}`);
    }
  }
}

async function main() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const electronBin = getBin('electron');
  const viteBin = getBin('vite');
  const scenarios = parseScenarioArgument(
    process.argv.slice(2),
    process.env.QORTIUM_HOME_DESKTOP_APP_UPDATE_SCENARIO,
    fail,
  );

  assertTool(electronBin, 'electron');
  assertTool(viteBin, 'vite');
  assertTool(getBin('esbuild'), 'esbuild');

  log('Building Electron main process.');
  await run(npm, ['run', 'build:electron']);
  await runSmoke({ electronBin, scenarios, viteBin });
  log('Desktop app update state smoke test passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
