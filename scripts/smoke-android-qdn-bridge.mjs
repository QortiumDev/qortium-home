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
const fixtureAddress = process.env.QORTIUM_HOME_QDN_BRIDGE_FIXTURE || 'qdn://APP/QortiumHomeTest/home-test';
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

async function getFixtureFrameContext(client) {
  return waitUntil('QDN fixture iframe', cdpTimeoutMs, async () => {
    const frameTree = await client.send('Page.getFrameTree');
    const frames = flattenFrames(frameTree.frameTree);
    const frame = frames.find(
      (candidate) =>
        candidate.url.includes('/render/APP/QortiumHomeTest') ||
        candidate.url.includes('/render/APP/QortiumHomeTest?identifier=home-test'),
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

async function runBridgeAssertions(client, contextId) {
  const bridgeState = await evaluateInFrame(client, contextId, 'typeof window.qdnRequest');

  assert(bridgeState === 'function', `Expected qdnRequest to be injected, found ${bridgeState}.`);

  const whichUi = await evaluateInFrame(client, contextId, "window.qdnRequest({ action: 'WHICH_UI' })");

  assert(whichUi === 'QORTIUM_HOME_ANDROID', `Expected QORTIUM_HOME_ANDROID, found ${JSON.stringify(whichUi)}.`);

  const statusResult = await evaluateInFrame(
    client,
    contextId,
    "window.qdnRequest({ action: 'FETCH_NODE_API', path: '/admin/status' })",
  );

  assert(statusResult?.status === 200 && statusResult?.ok === true, 'FETCH_NODE_API /admin/status did not return HTTP 200.');

  const rejectedString = await evaluateInFrame(
    client,
    contextId,
    "window.qdnRequest('GET_NODE_INFO').then(() => ({ rejected: false }), (error) => ({ rejected: true, message: String(error && error.message || error) }))",
  );

  assert(rejectedString?.rejected === true, 'String-form qdnRequest unexpectedly succeeded.');

  const rejectedAlias = await evaluateInFrame(
    client,
    contextId,
    "window.qdnRequest({ action: 'GET_NODE_API', path: '/admin/status' }).then(() => ({ rejected: false }), (error) => ({ rejected: true, message: String(error && error.message || error) }))",
  );

  assert(rejectedAlias?.rejected === true, 'Legacy GET_NODE_API alias unexpectedly succeeded.');

  const rejectedPost = await evaluateInFrame(
    client,
    contextId,
    "window.qdnRequest({ action: 'FETCH_NODE_API', path: '/admin/status', method: 'POST' }).then(() => ({ rejected: false }), (error) => ({ rejected: true, message: String(error && error.message || error) }))",
  );

  assert(rejectedPost?.rejected === true, 'POST FETCH_NODE_API unexpectedly succeeded.');
}

async function main() {
  assertTool(adbPath, 'adb');

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
