#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const nodeApiUrl = (process.env.QORTIUM_HOME_NODE_API_URL ?? 'http://127.0.0.1:24891').replace(
  /\/+$/,
  '',
);
const fixtureName = process.env.QORTIUM_HOME_QDN_API_FIXTURE_NAME ?? 'QortiumHomeTest';
const appIdentifier = process.env.QORTIUM_HOME_QDN_API_APP_IDENTIFIER ?? 'home-test';
const jsonIdentifier = process.env.QORTIUM_HOME_QDN_API_JSON_IDENTIFIER ?? 'home-json';
const fixtureAddress =
  process.env.QORTIUM_HOME_QDN_API_FIXTURE ?? `qdn://APP/${fixtureName}/${appIdentifier}`;
const commandTimeoutMs = 120_000;
const packageBuildTimeoutMs = 600_000;
const appTimeoutMs = 90_000;
const cdpTimeoutMs = 90_000;

function log(message) {
  console.log(`[desktop-qdn-api-smoke] ${message}`);
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

function getArgumentValue(name) {
  const prefix = `${name}=`;
  const argument = process.argv.slice(2).find((item) => item.startsWith(prefix));

  return argument ? argument.slice(prefix.length).trim() : '';
}

function hasArgument(name) {
  return process.argv.slice(2).includes(name);
}

function getSmokeMode() {
  if (hasArgument('--packaged') || process.env.QORTIUM_HOME_DESKTOP_QDN_API_PACKAGED === '1') {
    return 'packaged';
  }

  return 'dev';
}

function readPackageMetadata() {
  return JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
}

function getAppImageArch() {
  if (process.arch === 'x64') {
    return 'x86_64';
  }

  if (process.arch === 'arm64') {
    return 'arm64';
  }

  fail(`Unsupported AppImage smoke architecture: ${process.arch}.`);
}

function getAppImagePath() {
  const explicitPath =
    getArgumentValue('--appimage') ||
    process.env.QORTIUM_HOME_DESKTOP_QDN_API_APPIMAGE ||
    process.env.QORTIUM_HOME_APPIMAGE_PATH ||
    '';

  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  const packageMetadata = readPackageMetadata();

  return path.join(
    repoRoot,
    'dist-release',
    `Qortium-Home-${packageMetadata.version}-${getAppImageArch()}.AppImage`,
  );
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

function createManagedProcess(command, args, options = {}) {
  const output = [];
  let stopped = false;
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk) => output.push(String(chunk)));
  child.stderr?.on('data', (chunk) => output.push(String(chunk)));

  child.once('exit', (code, signal) => {
    if (!options.allowExit && !stopped) {
      output.push(`\nProcess exited with code=${code} signal=${signal}\n`);
    }
  });

  return {
    child,
    output,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      stopped = true;
      child.kill('SIGTERM');
      await delay(500);

      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    },
    wasStopped: () => stopped,
  };
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

    await delay(1_000);
  }

  if (lastError instanceof Error) {
    fail(`${label} timed out: ${lastError.message}`);
  }

  fail(`${label} timed out.`);
}

async function fetchText(url, options = {}) {
  let response;

  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(`${url} was unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }

  return body;
}

async function fetchJson(url, options = {}) {
  const body = await fetchText(url, options);

  return JSON.parse(body);
}

async function assertLocalCoreReady() {
  const status = await fetchJson(`${nodeApiUrl}/admin/status`);

  if (status?.isSynchronizing === true) {
    fail(`Local Core is still synchronizing at ${nodeApiUrl}.`);
  }

  return status;
}

async function getResourceStatus(service, name, identifier, options = {}) {
  const identifierPath = identifier ? `/${encodeURIComponent(identifier)}` : '';
  const queryParams = new URLSearchParams();

  if (options.build) {
    queryParams.set('build', 'true');
  }

  const queryString = queryParams.toString();
  return fetchJson(
    `${nodeApiUrl}/arbitrary/resource/status/${service}/${encodeURIComponent(name)}${identifierPath}${
      queryString ? `?${queryString}` : ''
    }`,
  );
}

async function assertFixtureReady() {
  const appStatus = await getResourceStatus('APP', fixtureName, appIdentifier, { build: true });
  const jsonStatus = await getResourceStatus('JSON', fixtureName, jsonIdentifier, { build: true });

  if (appStatus?.status !== 'READY') {
    fail(
      `QDN APP fixture is not READY at ${fixtureAddress}. Run npm run qdn:bootstrap-test-data first.`,
    );
  }

  if (jsonStatus?.status !== 'READY') {
    fail(
      `QDN JSON fixture is not READY at qdn://JSON/${fixtureName}/${jsonIdentifier}. Run npm run qdn:bootstrap-test-data first.`,
    );
  }
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
  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    fail(result.exceptionDetails.text || 'CDP evaluation failed.');
  }

  return result.result?.value;
}

async function closeBrowser(client) {
  await Promise.race([
    client.send('Browser.close').catch(() => undefined),
    delay(1_000),
  ]);
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

async function navigateToFixture(client) {
  await waitUntil('Qortium Home address bar', appTimeoutMs, async () => {
    const found = await evaluate(client, "!!document.querySelector('#browser-address')");

    return found === true;
  });

  const result = await evaluate(
    client,
    `
      (async () => {
        const input = document.querySelector('#browser-address');
        const form = input && input.closest('form');
        if (!input || !form) return { ok: false, message: 'Address bar was not found.' };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        input.focus();
        setter.call(input, ${JSON.stringify(fixtureAddress)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return { ok: true, value: input.value };
      })()
    `,
  );

  if (!result?.ok) {
    fail(result?.message || 'Unable to navigate Qortium Home to the QDN fixture.');
  }
}

async function runQdnRequest(qdnClient, request) {
  const result = await evaluate(
    qdnClient,
    `
      window.qdnRequest(${JSON.stringify(request)})
        .then((result) => ({ ok: true, result }))
        .catch((error) => ({ ok: false, message: String(error && error.message || error) }))
    `,
  );

  if (!result?.ok) {
    fail(result?.message || `${request.action} failed.`);
  }

  return result.result;
}

async function expectQdnRequestRejected(qdnClient, request, expectedMessage) {
  const result = await evaluate(
    qdnClient,
    `
      window.qdnRequest(${JSON.stringify(request)})
        .then((result) => ({ ok: true, result }))
        .catch((error) => ({ ok: false, message: String(error && error.message || error) }))
    `,
  );

  if (result?.ok) {
    fail(`${request.action ?? 'qdnRequest'} unexpectedly succeeded.`);
  }

  if (expectedMessage && !String(result?.message ?? '').includes(expectedMessage)) {
    fail(
      `${request.action ?? 'qdnRequest'} failed with unexpected message: ${
        result?.message ?? 'unknown error'
      }`,
    );
  }
}

async function expectExpressionRejected(qdnClient, expression, label) {
  const result = await evaluate(qdnClient, expression);

  if (result?.rejected !== true) {
    fail(`${label} unexpectedly succeeded.`);
  }
}

function assertFixtureResource(resources, service, identifier, label) {
  assert(Array.isArray(resources), `${label} did not return an array.`);
  assert(
    resources.some(
      (item) => item?.service === service && item?.name === fixtureName && item?.identifier === identifier,
    ),
    `${label} did not include ${service}/${fixtureName}/${identifier}.`,
  );
}

async function runBridgeAssertions(qdnClient) {
  const bridgeState = await evaluate(qdnClient, 'typeof window.qdnRequest');
  assert(bridgeState === 'function', `Expected qdnRequest to be injected, found ${bridgeState}.`);

  const whichUi = await runQdnRequest(qdnClient, { action: 'WHICH_UI' });
  assert(whichUi === 'QORTIUM_HOME_ELECTRON', `Expected QORTIUM_HOME_ELECTRON, found ${JSON.stringify(whichUi)}.`);

  const actions = await runQdnRequest(qdnClient, { action: 'SHOW_ACTIONS' });
  for (const action of [
    'FETCH_NODE_API',
    'GET_NODE_INFO',
    'GET_NODE_STATUS',
    'GET_ACCOUNT_DATA',
    'GET_ACCOUNT_GROUPS',
    'GET_ACCOUNT_GROUP_JOIN_REQUESTS',
    'GET_ACCOUNT_NAMES',
    'GET_ACTIVE_CHATS',
    'GET_ADMIN_GROUP_JOIN_REQUESTS',
    'GET_BALANCE',
    'GET_GROUP',
    'GET_GROUP_JOIN_REQUESTS',
    'GET_GROUP_MEMBERS',
    'GET_NAME_DATA',
    'GET_QDN_RESOURCE_METADATA',
    'GET_QDN_RESOURCE_PROPERTIES',
    'GET_QDN_RESOURCE_STATUS',
    'GET_QDN_RESOURCE_URL',
    'GET_SELECTED_ACCOUNT',
    'GET_PRIVATE_DIRECT_ACTIVE_CHATS',
    'GET_PRIVATE_GROUP_ACTIVE_CHATS',
    'FETCH_QDN_RESOURCE',
    'LIST_GROUPS',
    'LIST_QDN_RESOURCES',
    'PUBLISH_MULTIPLE_QDN_RESOURCES',
    'PUBLISH_QDN_RESOURCE',
    'DELETE_QDN_RESOURCE',
    'APPROVE_GROUP_JOIN_REQUEST',
    'INVITE_TO_GROUP',
    'JOIN_GROUP',
    'LEAVE_GROUP',
    'UPDATE_GROUP',
    'BUY_NAME',
    'CANCEL_SELL_NAME',
    'REGISTER_NAME',
    'SELL_NAME',
    'UPDATE_NAME',
    'SEND_CHAT_MESSAGE',
    'UNLOCK_SELECTED_ACCOUNT',
    'SEARCH_CHAT_MESSAGES',
    'SEARCH_GROUPS',
    'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
    'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES',
    'SEARCH_QDN_RESOURCES',
    'IS_USING_PUBLIC_NODE',
    'WHICH_UI',
    'SHOW_ACTIONS',
  ]) {
    assert(Array.isArray(actions) && actions.includes(action), `SHOW_ACTIONS did not include ${action}.`);
  }

  const statusResponse = await runQdnRequest(qdnClient, {
    action: 'FETCH_NODE_API',
    path: '/admin/status',
  });
  assert(
    statusResponse?.status === 200 && statusResponse?.ok === true,
    'FETCH_NODE_API /admin/status did not return HTTP 200.',
  );
  assert(
    typeof statusResponse?.data?.height === 'number' || typeof statusResponse?.data?.syncPercent === 'number',
    'FETCH_NODE_API /admin/status returned an unexpected payload.',
  );

  const headResponse = await runQdnRequest(qdnClient, {
    action: 'FETCH_NODE_API',
    method: 'HEAD',
    path: '/admin/status',
  });
  assert(
    headResponse?.status === 200 && headResponse?.ok === true && headResponse?.body === '',
    'FETCH_NODE_API HEAD /admin/status did not return an empty HTTP 200 response.',
  );

  const nodeStatus = await runQdnRequest(qdnClient, { action: 'GET_NODE_STATUS' });
  assert(
    typeof nodeStatus?.height === 'number' || typeof nodeStatus?.syncPercent === 'number',
    'GET_NODE_STATUS returned an unexpected payload.',
  );

  const nodeInfo = await runQdnRequest(qdnClient, { action: 'GET_NODE_INFO' });
  assert(typeof nodeInfo?.buildVersion === 'string', 'GET_NODE_INFO returned an unexpected payload.');

  const appStatus = await runQdnRequest(qdnClient, {
    action: 'GET_QDN_RESOURCE_STATUS',
    identifier: appIdentifier,
    name: fixtureName,
    service: 'APP',
  });
  assert(appStatus?.status === 'READY', 'GET_QDN_RESOURCE_STATUS did not return READY for the APP fixture.');

  const appProperties = await runQdnRequest(qdnClient, {
    action: 'GET_QDN_RESOURCE_PROPERTIES',
    identifier: appIdentifier,
    name: fixtureName,
    service: 'APP',
  });
  assert(appProperties?.filename === 'index.html', 'GET_QDN_RESOURCE_PROPERTIES returned unexpected APP properties.');

  const appMetadata = await runQdnRequest(qdnClient, {
    action: 'GET_QDN_RESOURCE_METADATA',
    identifier: appIdentifier,
    name: fixtureName,
    service: 'APP',
  });
  assert(typeof appMetadata?.title === 'string', 'GET_QDN_RESOURCE_METADATA returned unexpected APP metadata.');

  const appUrl = await runQdnRequest(qdnClient, {
    action: 'GET_QDN_RESOURCE_URL',
    identifier: appIdentifier,
    name: fixtureName,
    service: 'APP',
  });
  assert(
    typeof appUrl === 'string' &&
      appUrl.includes(`/render/APP/${fixtureName}`) &&
      appUrl.includes(`identifier=${appIdentifier}`),
    'GET_QDN_RESOURCE_URL returned an unexpected APP render URL.',
  );

  const jsonResource = await runQdnRequest(qdnClient, {
    action: 'FETCH_QDN_RESOURCE',
    identifier: jsonIdentifier,
    name: fixtureName,
    service: 'JSON',
  });
  assert(
    jsonResource?.fixture === 'JSON' && jsonResource?.resource === `qdn://JSON/${fixtureName}/${jsonIdentifier}`,
    'FETCH_QDN_RESOURCE returned an unexpected JSON fixture payload.',
  );

  const listedResources = await runQdnRequest(qdnClient, {
    action: 'LIST_QDN_RESOURCES',
    identifier: appIdentifier,
    includeMetadata: true,
    includeStatus: true,
    limit: 1,
    name: fixtureName,
    service: 'APP',
  });
  assertFixtureResource(listedResources, 'APP', appIdentifier, 'LIST_QDN_RESOURCES');

  const searchedResources = await runQdnRequest(qdnClient, {
    action: 'SEARCH_QDN_RESOURCES',
    identifier: appIdentifier,
    includeMetadata: true,
    includeStatus: true,
    limit: 1,
    name: fixtureName,
    service: 'APP',
  });
  assertFixtureResource(searchedResources, 'APP', appIdentifier, 'SEARCH_QDN_RESOURCES');

  const groups = await runQdnRequest(qdnClient, {
    action: 'LIST_GROUPS',
    limit: 1,
  });
  assert(Array.isArray(groups) && groups.length > 0, 'LIST_GROUPS did not return a group.');

  const groupId = groups[0]?.groupId;
  assert(Number.isInteger(groupId) && groupId > 0, 'LIST_GROUPS returned a group without a valid groupId.');

  const group = await runQdnRequest(qdnClient, {
    action: 'GET_GROUP',
    groupId,
  });
  assert(group?.groupId === groupId, 'GET_GROUP returned an unexpected group.');

  const members = await runQdnRequest(qdnClient, {
    action: 'GET_GROUP_MEMBERS',
    groupId,
    limit: 1,
  });
  assert(typeof members?.memberCount === 'number', 'GET_GROUP_MEMBERS returned an unexpected payload.');

  const groupSearch = await runQdnRequest(qdnClient, {
    action: 'SEARCH_GROUPS',
    limit: 1,
  });
  assert(Array.isArray(groupSearch), 'SEARCH_GROUPS did not return an array.');

  const chatMessages = await runQdnRequest(qdnClient, {
    action: 'SEARCH_CHAT_MESSAGES',
    groupId,
    limit: 1,
  });
  assert(Array.isArray(chatMessages), 'SEARCH_CHAT_MESSAGES did not return an array.');

  const isUsingPublicNode = await runQdnRequest(qdnClient, { action: 'IS_USING_PUBLIC_NODE' });
  assert(isUsingPublicNode === false, 'IS_USING_PUBLIC_NODE should be false for the local desktop smoke node.');

  await expectExpressionRejected(
    qdnClient,
    "window.qdnRequest('GET_NODE_INFO').then(() => ({ rejected: false }), (error) => ({ rejected: true, message: String(error && error.message || error) }))",
    'String-form qdnRequest',
  );
  await expectQdnRequestRejected(
    qdnClient,
    { action: 'GET_NODE_API', path: '/admin/status' },
    'not supported',
  );
  await expectQdnRequestRejected(
    qdnClient,
    { action: 'FETCH_NODE_API', method: 'POST', path: '/admin/status' },
    'GET and HEAD',
  );
  await expectQdnRequestRejected(
    qdnClient,
    { action: 'FETCH_NODE_API', path: '//example.com/admin/status' },
    'start with /',
  );
  await expectQdnRequestRejected(
    qdnClient,
    { action: 'FETCH_NODE_API', maxBytes: 1, path: '/admin/status' },
    'byte limit',
  );
}

async function runSmoke({ appImagePath, electronBin, mode, viteBin }) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-desktop-qdn-api-'));
  const userDataDir = path.join(tempRoot, 'user-data');
  let viteProcess = null;
  let electronProcess = null;

  const cdpPort = await getFreePort();
  const smokeEnv = {
    ...process.env,
    QORTIUM_HOME_NODE_API_URL: nodeApiUrl,
    QORTIUM_HOME_USER_DATA_DIR: userDataDir,
    XDG_CONFIG_HOME: path.join(tempRoot, 'config'),
  };
  let mainPagePredicate;
  let appCommand;
  let appArgs;

  delete smokeEnv.VITE_DEV_SERVER_URL;

  try {
    if (mode === 'dev') {
      const vitePort = await getFreePort();
      const devServerUrl = `http://127.0.0.1:${vitePort}`;

      smokeEnv.VITE_DEV_SERVER_URL = devServerUrl;
      mainPagePredicate = (url) => url.startsWith(devServerUrl);

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

      appCommand = electronBin;
      appArgs = [`--remote-debugging-port=${cdpPort}`, '.'];
    } else {
      smokeEnv.APPIMAGE_EXTRACT_AND_RUN = smokeEnv.APPIMAGE_EXTRACT_AND_RUN || '1';
      mainPagePredicate = (url) =>
        !url.includes('/render/') &&
        (url === 'about:blank' || url.startsWith('file://') || url.includes('/dist/index.html'));
      appCommand = appImagePath;
      appArgs = [`--remote-debugging-port=${cdpPort}`];
    }

    const electronLaunch = getDisplayLaunch(appCommand, appArgs);

    log(
      `Starting ${mode === 'packaged' ? path.relative(repoRoot, appImagePath) : 'Electron'} with CDP on 127.0.0.1:${cdpPort}.`,
    );
    electronProcess = createManagedProcess(electronLaunch.command, electronLaunch.args, { env: smokeEnv });

    const mainTarget = await getPageTarget(
      cdpPort,
      mainPagePredicate,
      'Electron main page target',
    );
    const mainClient = new CdpClient(mainTarget.webSocketDebuggerUrl);

    try {
      await mainClient.send('Runtime.enable');
      await navigateToFixture(mainClient);

      const qdnTarget = await getPageTarget(
        cdpPort,
        (url) => url.includes(`/render/APP/${fixtureName}`),
        'QDN APP target',
      );
      const qdnClient = new CdpClient(qdnTarget.webSocketDebuggerUrl);

      try {
        await qdnClient.send('Runtime.enable');
        log(`Running bridge API assertions in ${qdnTarget.url}.`);
        await runBridgeAssertions(qdnClient);
      } finally {
        qdnClient.close();
      }
    } finally {
      await closeBrowser(mainClient);
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
  const mode = getSmokeMode();
  const electronBin = getBin('electron');
  const viteBin = getBin('vite');
  const skipPackageBuild =
    hasArgument('--skip-package-build') || process.env.QORTIUM_HOME_SKIP_PACKAGE_BUILD === '1';
  let appImagePath = '';

  if (mode === 'dev') {
    assertTool(electronBin, 'electron');
    assertTool(viteBin, 'vite');
  } else if (process.platform !== 'linux') {
    fail('Packaged desktop QDN API smoke currently supports Linux AppImage builds only.');
  }

  await assertLocalCoreReady();
  await assertFixtureReady();

  if (mode === 'packaged') {
    if (!skipPackageBuild) {
      log('Building Linux x64 AppImage.');
      await run(npm, ['run', 'dist:linux:x64'], { timeout: packageBuildTimeoutMs });
    }

    appImagePath = getAppImagePath();
    assertTool(appImagePath, 'Qortium Home AppImage');
  } else {
    log('Building Electron main process.');
    await run(npm, ['run', 'build:electron']);
  }

  await runSmoke({ appImagePath, electronBin, mode, viteBin });
  log(`Desktop QDN API ${mode === 'packaged' ? 'packaged ' : ''}smoke test passed.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
