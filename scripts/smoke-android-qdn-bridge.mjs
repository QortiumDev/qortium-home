#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { existsSync, openSync, readdirSync, statSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const androidSdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), 'Android', 'Sdk');
const adbPath = process.env.ADB || path.join(androidSdkRoot, 'platform-tools', 'adb');
const emulatorPath = process.env.ANDROID_EMULATOR || path.join(androidSdkRoot, 'emulator', 'emulator');
const avdHome = process.env.ANDROID_AVD_HOME || path.join(os.homedir(), '.config', '.android', 'avd');
const avdName = process.env.QORTIUM_HOME_ANDROID_AVD || 'qortium_home_api36';
const packageName = 'org.qortium.home';
const activityName = `${packageName}/.MainActivity`;
const nodeApiUrl = (process.env.QORTIUM_HOME_NODE_API_URL ?? 'http://127.0.0.1:24891').replace(
  /\/+$/,
  '',
);
const androidNodeApiUrl = (
  process.env.QORTIUM_HOME_ANDROID_NODE_API_URL ?? 'http://10.0.2.2:24891'
).replace(/\/+$/, '');
const fixtureName = process.env.QORTIUM_HOME_QDN_BRIDGE_FIXTURE_NAME ?? 'QortiumHomeTest';
const appIdentifier = process.env.QORTIUM_HOME_QDN_BRIDGE_APP_IDENTIFIER ?? 'home-test';
const jsonIdentifier = process.env.QORTIUM_HOME_QDN_BRIDGE_JSON_IDENTIFIER ?? 'home-json';
const fixtureAddress =
  process.env.QORTIUM_HOME_QDN_BRIDGE_FIXTURE ?? `qdn://APP/${fixtureName}/${appIdentifier}`;
const commandTimeoutMs = 30_000;
const bootTimeoutMs = 180_000;
const appTimeoutMs = 90_000;
const cdpTimeoutMs = 90_000;

function log(message) {
  console.log(`[android-qdn-smoke] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: repoRoot,
        env: process.env,
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

async function adb(args, options = {}) {
  return run(adbPath, args, options);
}

function assertTool(toolPath, label) {
  if (!existsSync(toolPath)) {
    fail(`${label} was not found at ${toolPath}. Set ANDROID_HOME or ${label.toUpperCase()} explicitly.`);
  }
}

function getDebugApkPath() {
  const apkDir = path.join(repoRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug');

  if (!existsSync(apkDir)) {
    fail('Android debug APK was not found. Run npm run dist:android:debug first.');
  }

  const apks = readdirSync(apkDir)
    .filter((filename) => filename.endsWith('.apk'))
    .map((filename) => path.join(apkDir, filename))
    .sort((first, second) => statSync(second).mtimeMs - statSync(first).mtimeMs);

  if (!apks[0]) {
    fail('Android debug APK was not found. Run npm run dist:android:debug first.');
  }

  return apks[0];
}

async function getAttachedDevice() {
  const { stdout } = await adb(['devices']);
  const devices = stdout
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial);

  return devices[0] ?? null;
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

async function launchEmulatorIfNeeded() {
  const existingDevice = await getAttachedDevice();

  if (existingDevice) {
    log(`Using attached Android device ${existingDevice}.`);
    return {
      serial: existingDevice,
      startedEmulator: false,
    };
  }

  assertTool(emulatorPath, 'emulator');
  log(`Starting emulator ${avdName}.`);

  const logDir = path.join(os.tmpdir(), 'qortium-home-android-smoke');
  await mkdir(logDir, { recursive: true });
  const emulatorLog = path.join(logDir, `${Date.now()}-${avdName}.log`);
  const logFd = openSync(emulatorLog, 'a');
  const child = spawn(
    emulatorPath,
    [
      '-avd',
      avdName,
      '-no-window',
      '-no-snapshot',
      '-no-boot-anim',
      '-gpu',
      'swiftshader_indirect',
      '-no-audio',
      '-accel',
      'on',
    ],
    {
      cwd: repoRoot,
      detached: true,
      env: {
        ...process.env,
        ANDROID_AVD_HOME: avdHome,
      },
      stdio: ['ignore', logFd, logFd],
    },
  );

  child.unref();

  const serial = await waitUntil('Android emulator attachment', bootTimeoutMs, getAttachedDevice);

  await waitUntil('Android boot completion', bootTimeoutMs, async () => {
    const { stdout } = await adb(['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], { timeout: 10_000 });

    return stdout.trim().replace(/\r/g, '') === '1';
  });

  log(`Started ${serial}. Emulator log: ${emulatorLog}`);

  return {
    serial,
    startedEmulator: true,
  };
}

async function getAppPid(serial) {
  const { stdout } = await adb(['-s', serial, 'shell', 'pidof', packageName], { timeout: 10_000 });
  const pid = stdout.trim().split(/\s+/)[0];

  return /^\d+$/.test(pid) ? pid : null;
}

async function getWebViewSocket(serial, pid) {
  const { stdout } = await adb(['-s', serial, 'shell', 'cat', '/proc/net/unix'], { timeout: 10_000 });
  const sockets = stdout
    .split(/\r?\n/)
    .map((line) => line.match(/@?(webview_devtools_remote[^\s]*)/)?.[1])
    .filter(Boolean);
  const preferred = sockets.find((socket) => socket === `webview_devtools_remote_${pid}`);

  return preferred ?? sockets[0] ?? null;
}

async function forwardWebView(serial) {
  const pid = await waitUntil('Qortium Home process', appTimeoutMs, () => getAppPid(serial));
  const socket = await waitUntil('Android WebView debugging socket', cdpTimeoutMs, () => getWebViewSocket(serial, pid));
  const { stdout } = await adb(['-s', serial, 'forward', 'tcp:0', `localabstract:${socket}`]);
  const port = stdout.trim();

  if (!/^\d+$/.test(port)) {
    fail(`Unable to forward WebView debugging socket ${socket}.`);
  }

  return { port, socket };
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    fail(`${url} returned HTTP ${response.status}.`);
  }

  return response.json();
}

async function assertLocalCoreReady() {
  const status = await fetchJson(`${nodeApiUrl}/admin/status`);

  if (status?.isSynchronizing === true) {
    fail(`Local Core is still synchronizing at ${nodeApiUrl}.`);
  }
}

async function getResourceStatus(service, name, identifier) {
  const identifierPath = identifier ? `/${encodeURIComponent(identifier)}` : '';

  return fetchJson(
    `${nodeApiUrl}/arbitrary/resource/status/${service}/${encodeURIComponent(name)}${identifierPath}`,
  );
}

async function assertFixtureReady() {
  const appStatus = await getResourceStatus('APP', fixtureName, appIdentifier);
  const jsonStatus = await getResourceStatus('JSON', fixtureName, jsonIdentifier);

  if (appStatus?.status !== 'READY') {
    fail(`QDN APP fixture is not READY at ${fixtureAddress}. Run npm run qdn:bootstrap-test-data first.`);
  }

  if (jsonStatus?.status !== 'READY') {
    fail(
      `QDN JSON fixture is not READY at qdn://JSON/${fixtureName}/${jsonIdentifier}. Run npm run qdn:bootstrap-test-data first.`,
    );
  }
}

class CdpClient {
  constructor(webSocketUrl) {
    this.contextsByFrame = new Map();
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

    if (message.id) {
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

      return;
    }

    if (message.method === 'Runtime.executionContextCreated') {
      const context = message.params?.context;
      const frameId = context?.auxData?.frameId;

      if (typeof context?.id === 'number' && typeof frameId === 'string') {
        this.contextsByFrame.set(frameId, context.id);
      }
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

function flattenFrames(frameTree) {
  const frames = [frameTree.frame];

  for (const child of frameTree.childFrames ?? []) {
    frames.push(...flattenFrames(child));
  }

  return frames;
}

async function getMainPageTarget(port) {
  return waitUntil('WebView CDP page target', cdpTimeoutMs, async () => {
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);

    return (
      targets.find(
        (target) =>
          target.type === 'page' &&
          target.webSocketDebuggerUrl &&
          typeof target.url === 'string' &&
          target.url.startsWith('https://localhost'),
      ) ?? null
    );
  });
}

async function navigateToFixture(client) {
  await waitUntil('Qortium Home address bar', appTimeoutMs, async () => {
    const result = await client.send('Runtime.evaluate', {
      expression: "!!document.querySelector('#browser-address')",
      returnByValue: true,
    });

    return result.result?.value === true;
  });

  const expression = `
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
  `;
  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  const value = result.result?.value;

  if (!value?.ok) {
    fail(value?.message || 'Unable to navigate Qortium Home to the QDN fixture.');
  }
}

async function configureSmokeNode(client) {
  await waitUntil('Qortium Home platform bridge', appTimeoutMs, async () => {
    const result = await client.send('Runtime.evaluate', {
      expression: "typeof window.qortiumHome?.node?.saveSettings === 'function'",
      returnByValue: true,
    });

    return result.result?.value === true;
  });

  const expression = `
    window.qortiumHome.node.saveSettings({
      customUrl: ${JSON.stringify(androidNodeApiUrl)},
      mode: 'custom'
    }).then((settings) => ({ ok: true, settings }), (error) => ({
      ok: false,
      message: String(error && error.message || error)
    }))
  `;
  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  const value = result.result?.value;

  if (!value?.ok) {
    fail(value?.message || `Unable to point Android smoke test at ${androidNodeApiUrl}.`);
  }
}

async function getFixtureFrameContext(client) {
  return waitUntil('QDN fixture iframe', cdpTimeoutMs, async () => {
    const frameTree = await client.send('Page.getFrameTree');
    const frames = flattenFrames(frameTree.frameTree);
    const frame = frames.find(
      (candidate) =>
        candidate.url.includes(`/render/APP/${fixtureName}`) &&
        candidate.url.includes(`identifier=${appIdentifier}`),
    );

    if (!frame) {
      return null;
    }

    const contextId = client.contextsByFrame.get(frame.id);

    return contextId ? { contextId, frame } : null;
  });
}

async function evaluateInFrame(client, contextId, expression) {
  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    contextId,
    expression,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    fail(result.exceptionDetails.text || 'QDN fixture evaluation failed.');
  }

  return result.result?.value;
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

async function runQdnRequest(client, contextId, request) {
  const result = await evaluateInFrame(
    client,
    contextId,
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

async function expectQdnRequestRejected(client, contextId, request, expectedMessage) {
  const result = await evaluateInFrame(
    client,
    contextId,
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

async function expectExpressionRejected(client, contextId, expression, label) {
  const result = await evaluateInFrame(client, contextId, expression);

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

async function runBridgeAssertions(client, contextId) {
  const bridgeState = await evaluateInFrame(client, contextId, 'typeof window.qdnRequest');

  assert(bridgeState === 'function', `Expected qdnRequest to be injected, found ${bridgeState}.`);

  const whichUi = await runQdnRequest(client, contextId, { action: 'WHICH_UI' });

  assert(whichUi === 'QORTIUM_HOME_ANDROID', `Expected QORTIUM_HOME_ANDROID, found ${JSON.stringify(whichUi)}.`);

  const actions = await runQdnRequest(client, contextId, { action: 'SHOW_ACTIONS' });
  for (const action of [
    'FETCH_NODE_API',
    'GET_NODE_INFO',
    'GET_NODE_STATUS',
    'GET_QDN_RESOURCE_METADATA',
    'GET_QDN_RESOURCE_PROPERTIES',
    'GET_QDN_RESOURCE_STATUS',
    'GET_QDN_RESOURCE_URL',
    'FETCH_QDN_RESOURCE',
    'LIST_QDN_RESOURCES',
    'SEARCH_QDN_RESOURCES',
    'IS_USING_PUBLIC_NODE',
    'WHICH_UI',
    'SHOW_ACTIONS',
  ]) {
    assert(Array.isArray(actions) && actions.includes(action), `SHOW_ACTIONS did not include ${action}.`);
  }

  const statusResult = await runQdnRequest(client, contextId, {
    action: 'FETCH_NODE_API',
    path: '/admin/status',
  });

  assert(statusResult?.status === 200 && statusResult?.ok === true, 'FETCH_NODE_API /admin/status did not return HTTP 200.');
  assert(
    typeof statusResult?.data?.height === 'number' || typeof statusResult?.data?.syncPercent === 'number',
    'FETCH_NODE_API /admin/status returned an unexpected payload.',
  );

  const headResponse = await runQdnRequest(client, contextId, {
    action: 'FETCH_NODE_API',
    method: 'HEAD',
    path: '/admin/status',
  });
  assert(
    headResponse?.status === 200 && headResponse?.ok === true && headResponse?.body === '',
    'FETCH_NODE_API HEAD /admin/status did not return an empty HTTP 200 response.',
  );

  const nodeStatus = await runQdnRequest(client, contextId, { action: 'GET_NODE_STATUS' });
  assert(
    typeof nodeStatus?.height === 'number' || typeof nodeStatus?.syncPercent === 'number',
    'GET_NODE_STATUS returned an unexpected payload.',
  );

  const nodeInfo = await runQdnRequest(client, contextId, { action: 'GET_NODE_INFO' });
  assert(typeof nodeInfo?.buildVersion === 'string', 'GET_NODE_INFO returned an unexpected payload.');

  const appStatus = await runQdnRequest(client, contextId, {
    action: 'GET_QDN_RESOURCE_STATUS',
    identifier: appIdentifier,
    name: fixtureName,
    service: 'APP',
  });
  assert(appStatus?.status === 'READY', 'GET_QDN_RESOURCE_STATUS did not return READY for the APP fixture.');

  const appProperties = await runQdnRequest(client, contextId, {
    action: 'GET_QDN_RESOURCE_PROPERTIES',
    identifier: appIdentifier,
    name: fixtureName,
    service: 'APP',
  });
  assert(appProperties?.filename === 'index.html', 'GET_QDN_RESOURCE_PROPERTIES returned unexpected APP properties.');

  const appMetadata = await runQdnRequest(client, contextId, {
    action: 'GET_QDN_RESOURCE_METADATA',
    identifier: appIdentifier,
    name: fixtureName,
    service: 'APP',
  });
  assert(typeof appMetadata?.title === 'string', 'GET_QDN_RESOURCE_METADATA returned unexpected APP metadata.');

  const appUrl = await runQdnRequest(client, contextId, {
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

  const jsonResource = await runQdnRequest(client, contextId, {
    action: 'FETCH_QDN_RESOURCE',
    identifier: jsonIdentifier,
    name: fixtureName,
    service: 'JSON',
  });
  assert(
    jsonResource?.fixture === 'JSON' && jsonResource?.resource === `qdn://JSON/${fixtureName}/${jsonIdentifier}`,
    'FETCH_QDN_RESOURCE returned an unexpected JSON fixture payload.',
  );

  const listedResources = await runQdnRequest(client, contextId, {
    action: 'LIST_QDN_RESOURCES',
    identifier: appIdentifier,
    includeMetadata: true,
    includeStatus: true,
    limit: 1,
    name: fixtureName,
    service: 'APP',
  });
  assertFixtureResource(listedResources, 'APP', appIdentifier, 'LIST_QDN_RESOURCES');

  const searchedResources = await runQdnRequest(client, contextId, {
    action: 'SEARCH_QDN_RESOURCES',
    identifier: appIdentifier,
    includeMetadata: true,
    includeStatus: true,
    limit: 1,
    name: fixtureName,
    service: 'APP',
  });
  assertFixtureResource(searchedResources, 'APP', appIdentifier, 'SEARCH_QDN_RESOURCES');

  const isUsingPublicNode = await runQdnRequest(client, contextId, { action: 'IS_USING_PUBLIC_NODE' });
  assert(isUsingPublicNode === false, 'IS_USING_PUBLIC_NODE should be false for the Android smoke custom node.');

  await expectExpressionRejected(
    client,
    contextId,
    "window.qdnRequest('GET_NODE_INFO').then(() => ({ rejected: false }), (error) => ({ rejected: true, message: String(error && error.message || error) }))",
    'String-form qdnRequest',
  );
  await expectQdnRequestRejected(
    client,
    contextId,
    { action: 'GET_NODE_API', path: '/admin/status' },
    'not supported',
  );
  await expectQdnRequestRejected(
    client,
    contextId,
    { action: 'FETCH_NODE_API', method: 'POST', path: '/admin/status' },
    'GET and HEAD',
  );
  await expectQdnRequestRejected(
    client,
    contextId,
    { action: 'FETCH_NODE_API', path: '//example.com/admin/status' },
    'start with /',
  );
  await expectQdnRequestRejected(
    client,
    contextId,
    { action: 'FETCH_NODE_API', maxBytes: 1, path: '/admin/status' },
    'byte limit',
  );
}

async function main() {
  assertTool(adbPath, 'adb');

  await assertLocalCoreReady();
  await assertFixtureReady();

  const apkPath = getDebugApkPath();
  const { serial, startedEmulator } = await launchEmulatorIfNeeded();

  try {
    log(`Installing ${path.relative(repoRoot, apkPath)}.`);
    await adb(['-s', serial, 'install', '-r', apkPath], { timeout: 120_000 });
    await adb(['-s', serial, 'shell', 'am', 'start', '-n', activityName], { timeout: 20_000 });

    const { port, socket } = await forwardWebView(serial);

    try {
      log(`Attached to WebView socket ${socket} on localhost:${port}.`);
      const target = await getMainPageTarget(port);
      const client = new CdpClient(target.webSocketDebuggerUrl);

      try {
        await client.send('Page.enable');
        await client.send('Runtime.enable');
        await configureSmokeNode(client);
        await navigateToFixture(client);
        const { contextId, frame } = await getFixtureFrameContext(client);

        log(`Running bridge assertions in ${frame.url}.`);
        await runBridgeAssertions(client, contextId);
      } finally {
        client.close();
      }
    } finally {
      await adb(['-s', serial, 'forward', '--remove', `tcp:${port}`]).catch(() => undefined);
    }

    log('Android QDN bridge smoke test passed.');
  } finally {
    if (startedEmulator && process.env.QORTIUM_HOME_KEEP_ANDROID_EMULATOR !== '1') {
      log('Stopping emulator started by smoke test.');
      await adb(['-s', serial, 'emu', 'kill']).catch(() => undefined);
      await rm(path.join(os.tmpdir(), 'qortium-home-android-smoke'), { force: true, recursive: true }).catch(() => undefined);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
