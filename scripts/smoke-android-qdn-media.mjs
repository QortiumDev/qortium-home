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
const fixtureName = process.env.QORTIUM_HOME_QDN_MEDIA_FIXTURE_NAME ?? 'QortiumHomeTest';
const mediaFixtures = [
  {
    address: `qdn://IMAGE/${fixtureName}/${process.env.QORTIUM_HOME_QDN_MEDIA_IMAGE_IDENTIFIER ?? 'home-image'}`,
    identifier: process.env.QORTIUM_HOME_QDN_MEDIA_IMAGE_IDENTIFIER ?? 'home-image',
    label: 'IMAGE',
    service: 'IMAGE',
    selector: '.qdn-viewer__image',
  },
  {
    address: `qdn://AUDIO/${fixtureName}/${process.env.QORTIUM_HOME_QDN_MEDIA_AUDIO_IDENTIFIER ?? 'home-audio'}`,
    identifier: process.env.QORTIUM_HOME_QDN_MEDIA_AUDIO_IDENTIFIER ?? 'home-audio',
    label: 'AUDIO',
    service: 'AUDIO',
    selector: 'audio.qdn-viewer__media-player--audio',
  },
  {
    address: `qdn://VIDEO/${fixtureName}/${process.env.QORTIUM_HOME_QDN_MEDIA_VIDEO_IDENTIFIER ?? 'home-video'}`,
    identifier: process.env.QORTIUM_HOME_QDN_MEDIA_VIDEO_IDENTIFIER ?? 'home-video',
    label: 'VIDEO',
    service: 'VIDEO',
    selector: 'video.qdn-viewer__media-player--video',
  },
];
const commandTimeoutMs = 30_000;
const bootTimeoutMs = 180_000;
const appTimeoutMs = 90_000;
const cdpTimeoutMs = 90_000;
const mediaTimeoutMs = 90_000;

function log(message) {
  console.log(`[android-qdn-media-smoke] ${message}`);
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

  const logDir = path.join(os.tmpdir(), 'qortium-home-android-media-smoke');
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
  return fetchJson(
    `${nodeApiUrl}/arbitrary/resource/status/${service}/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`,
  );
}

async function assertFixturesReady() {
  for (const fixture of mediaFixtures) {
    const status = await getResourceStatus(fixture.service, fixtureName, fixture.identifier);

    if (status?.status !== 'READY') {
      fail(`${fixture.label} fixture is not READY at ${fixture.address}. Run npm run qdn:bootstrap-test-data first.`);
    }
  }
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
    this.webSocket.addEventListener('close', () => this.rejectPending('CDP WebSocket closed.'));
    this.webSocket.addEventListener('error', () => this.rejectPending('CDP WebSocket failed.'));
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

  rejectPending(message) {
    for (const pending of this.pending.values()) {
      pending.reject(new Error(message));
    }

    this.pending.clear();
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

async function evaluate(client, expression, label = 'CDP evaluation') {
  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    fail(result.exceptionDetails.text || `${label} failed.`);
  }

  return result.result?.value;
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

async function configureSmokeNode(client) {
  await waitUntil('Qortium Home platform bridge', appTimeoutMs, async () => {
    const bridgeReady = await evaluate(
      client,
      "typeof window.qortiumHome?.node?.saveSettings === 'function'",
      'platform bridge check',
    );

    return bridgeReady === true;
  });

  const result = await evaluate(
    client,
    `
      window.qortiumHome.node.saveSettings({
        customUrl: ${JSON.stringify(androidNodeApiUrl)},
        mode: 'custom'
      }).then((settings) => ({ ok: true, settings }), (error) => ({
        ok: false,
        message: String(error && error.message || error)
      }))
    `,
    'node settings update',
  );

  if (!result?.ok) {
    fail(result?.message || `Unable to point Android media smoke test at ${androidNodeApiUrl}.`);
  }
}

async function navigateToAddress(client, address) {
  await waitUntil('Qortium Home address bar', appTimeoutMs, async () => {
    const found = await evaluate(client, "!!document.querySelector('#browser-address')", 'address bar check');

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
        setter.call(input, ${JSON.stringify(address)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return { ok: true, value: input.value };
      })()
    `,
    `navigate to ${address}`,
  );

  if (!result?.ok) {
    fail(result?.message || `Unable to navigate Qortium Home to ${address}.`);
  }
}

function getMediaProbeExpression(fixture) {
  return `
    (async () => {
      const errorMessage = document.querySelector('.qdn-viewer__message--error')?.textContent?.trim() || '';
      const loadingMessage = document.querySelector('.qdn-viewer__empty--loading .qdn-viewer__message')?.textContent?.trim() || '';
      const element = document.querySelector(${JSON.stringify(fixture.selector)});

      if (!element) {
        return { ready: false, errorMessage, loadingMessage, reason: 'missing-element' };
      }

      if (!element.src || !element.src.startsWith('blob:')) {
        return {
          ready: false,
          errorMessage,
          loadingMessage,
          reason: 'non-blob-src',
          src: element.src || ''
        };
      }

      if (${JSON.stringify(fixture.service)} === 'IMAGE') {
        if (element.complete && element.naturalWidth > 0 && element.naturalHeight > 0) {
          return {
            height: element.naturalHeight,
            ready: true,
            src: element.src,
            width: element.naturalWidth
          };
        }

        return {
          ready: false,
          errorMessage,
          loadingMessage,
          reason: 'image-not-loaded',
          src: element.src || ''
        };
      }

      element.load();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const hasMetadata = element.readyState >= HTMLMediaElement.HAVE_METADATA;
      const hasDuration = Number.isFinite(element.duration) && element.duration > 0;
      const hasVideoDimensions =
        element.tagName !== 'VIDEO' || (element.videoWidth > 0 && element.videoHeight > 0);
      const mediaError = element.error
        ? { code: element.error.code, message: element.error.message || '' }
        : null;

      return {
        duration: Number.isFinite(element.duration) ? element.duration : null,
        errorMessage,
        hasDuration,
        hasMetadata,
        height: element.videoHeight || 0,
        mediaError,
        ready: hasMetadata && hasDuration && hasVideoDimensions && !mediaError,
        readyState: element.readyState,
        src: element.src,
        width: element.videoWidth || 0
      };
    })()
  `;
}

async function waitForMediaReady(client, fixture) {
  let lastProbe = null;

  try {
    return await waitUntil(`${fixture.label} media viewer`, mediaTimeoutMs, async () => {
      const probe = await evaluate(client, getMediaProbeExpression(fixture), `${fixture.label} media probe`);
      lastProbe = probe;

      if (probe?.errorMessage) {
        fail(`${fixture.label} viewer showed an error: ${probe.errorMessage}`);
      }

      if (probe?.mediaError) {
        fail(`${fixture.label} media element failed: ${JSON.stringify(probe.mediaError)}`);
      }

      return probe?.ready ? probe : null;
    });
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} Last ${fixture.label} probe: ${JSON.stringify(
        lastProbe,
      )}.`,
    );
  }
}

async function runMediaAssertions(client) {
  for (const fixture of mediaFixtures) {
    log(`Opening ${fixture.address}.`);
    await navigateToAddress(client, fixture.address);
    const probe = await waitForMediaReady(client, fixture);

    if (!probe.src?.startsWith('blob:')) {
      fail(`${fixture.label} did not use an Android blob URL.`);
    }

    const summary =
      fixture.service === 'AUDIO'
        ? `duration ${Number(probe.duration).toFixed(2)}s`
        : `${probe.width}x${probe.height}`;

    log(`${fixture.label} loaded from ${probe.src} (${summary}).`);
  }
}

async function main() {
  assertTool(adbPath, 'adb');

  await assertLocalCoreReady();
  await assertFixturesReady();

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
        await client.send('Runtime.enable');
        await configureSmokeNode(client);
        await runMediaAssertions(client);
      } finally {
        client.close();
      }
    } finally {
      await adb(['-s', serial, 'forward', '--remove', `tcp:${port}`]).catch(() => undefined);
    }

    log('Android QDN media smoke test passed.');
  } finally {
    if (startedEmulator && process.env.QORTIUM_HOME_KEEP_ANDROID_EMULATOR !== '1') {
      log('Stopping emulator started by smoke test.');
      await adb(['-s', serial, 'emu', 'kill']).catch(() => undefined);
      await rm(path.join(os.tmpdir(), 'qortium-home-android-media-smoke'), {
        force: true,
        recursive: true,
      }).catch(() => undefined);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
