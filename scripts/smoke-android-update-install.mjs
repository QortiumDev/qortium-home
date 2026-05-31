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
const tempDeviceApkPath = '/data/local/tmp/qortium-home-update-install-smoke.apk';
const updateApkFilename = 'qortium-home-update-install-smoke.apk';
const nonApkFilename = 'qortium-home-update-install-smoke.txt';
const commandTimeoutMs = 30_000;
const bootTimeoutMs = 180_000;
const appTimeoutMs = 90_000;
const cdpTimeoutMs = 90_000;
const activityTimeoutMs = 30_000;

function log(message) {
  console.log(`[android-update-install-smoke] ${message}`);
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

  const logDir = path.join(os.tmpdir(), 'qortium-home-android-update-install-smoke');
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

async function waitForPlatformBridge(client) {
  await waitUntil('Qortium Home update platform bridge', appTimeoutMs, async () => {
    const bridgeReady = await evaluate(
      client,
      "typeof window.qortiumHome?.updates?.openDownloadedFile === 'function'",
      'update bridge check',
    );

    return bridgeReady === true;
  });
}

async function getAppDataDir(serial) {
  const { stdout } = await adb(['-s', serial, 'shell', 'run-as', packageName, 'pwd'], {
    timeout: 10_000,
  });
  const dataDir = stdout.trim().replace(/\r/g, '');

  if (!dataDir.startsWith('/data/')) {
    fail(`Unable to resolve app data directory, found ${JSON.stringify(dataDir)}.`);
  }

  return dataDir;
}

async function prepareUpdateFiles(serial, apkPath) {
  const dataDir = await getAppDataDir(serial);
  const appUpdateDir = `${dataDir}/files/app-updates`;
  const validApkPath = `${appUpdateDir}/${updateApkFilename}`;
  const nonApkPath = `${appUpdateDir}/${nonApkFilename}`;

  await adb(['-s', serial, 'push', apkPath, tempDeviceApkPath], { timeout: 120_000 });
  await adb(['-s', serial, 'shell', 'chmod', '644', tempDeviceApkPath], { timeout: 10_000 });
  await adb(['-s', serial, 'shell', 'run-as', packageName, 'mkdir', '-p', 'files/app-updates'], {
    timeout: 10_000,
  });
  await adb(['-s', serial, 'shell', 'run-as', packageName, 'cp', tempDeviceApkPath, `files/app-updates/${updateApkFilename}`], {
    timeout: 30_000,
  });
  await adb(['-s', serial, 'shell', 'run-as', packageName, 'cp', tempDeviceApkPath, `files/app-updates/${nonApkFilename}`], {
    timeout: 30_000,
  });

  return {
    appUpdateDir,
    dataDir,
    nonApkPath,
    validApkPath,
  };
}

async function callOpenDownloadedFile(client, filePath) {
  return evaluate(
    client,
    `
      window.qortiumHome.updates.openDownloadedFile(${JSON.stringify(filePath)})
        .then((result) => ({ ok: true, result: result ?? null }))
        .catch((error) => ({ ok: false, message: String(error && error.message || error) }))
    `,
    `open downloaded file ${filePath}`,
  );
}

async function expectOpenDownloadedFileRejected(client, filePath, expectedMessage) {
  const result = await callOpenDownloadedFile(client, filePath);

  if (result?.ok) {
    fail(`Opening ${filePath} unexpectedly succeeded.`);
  }

  if (!String(result?.message ?? '').includes(expectedMessage)) {
    fail(`Opening ${filePath} failed with unexpected message: ${result?.message ?? 'unknown error'}`);
  }

  return result;
}

async function getTopActivity(serial) {
  const { stdout } = await adb(['-s', serial, 'shell', 'dumpsys', 'activity', 'activities'], {
    timeout: 10_000,
  });
  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => /mResumedActivity|topResumedActivity|ResumedActivity/i.test(item));

  return line ?? '';
}

function isPackageInstallerActivity(activity) {
  return /packageinstaller|PackageInstaller|InstallStart|InstallInstalling|PackageInstallerActivity/i.test(activity);
}

function isUnknownAppsSettingsActivity(activity) {
  return /settings|ManageExternalSources|SecuritySettings|permissioncontroller/i.test(activity);
}

async function assertInstallHandoff(serial, result) {
  const topActivity = await waitUntil('Android update install handoff', activityTimeoutMs, async () => {
    const activity = await getTopActivity(serial);

    return isPackageInstallerActivity(activity) || isUnknownAppsSettingsActivity(activity) ? activity : null;
  });

  if (result?.ok && !isPackageInstallerActivity(topActivity)) {
    fail(`Update installer resolved but top activity was not a package installer: ${topActivity}`);
  }

  if (
    !result?.ok &&
    String(result?.message ?? '').includes('Allow Qortium Home to install unknown apps') &&
    !isUnknownAppsSettingsActivity(topActivity)
  ) {
    fail(`Unknown-app-source handoff did not open Android settings. Top activity: ${topActivity}`);
  }

  if (!result?.ok && !String(result?.message ?? '').includes('Allow Qortium Home to install unknown apps')) {
    fail(`Valid update APK failed unexpectedly: ${result?.message ?? 'unknown error'}`);
  }

  log(`Valid update APK handoff reached ${topActivity}.`);
}

async function runUpdateInstallAssertions(client, serial, updateFiles) {
  await expectOpenDownloadedFileRejected(
    client,
    '/data/local/tmp/qortium-home-update-install-smoke.apk',
    'inside Qortium Home app data',
  );
  await expectOpenDownloadedFileRejected(client, updateFiles.nonApkPath, 'must be an APK file');

  const result = await callOpenDownloadedFile(client, updateFiles.validApkPath);

  if (result?.ok) {
    log('Valid update APK opened Android package installer.');
  } else if (String(result?.message ?? '').includes('Allow Qortium Home to install unknown apps')) {
    log('Valid update APK opened Android unknown-app-source settings.');
  }

  await assertInstallHandoff(serial, result);
}

async function main() {
  assertTool(adbPath, 'adb');

  const apkPath = getDebugApkPath();
  const { serial, startedEmulator } = await launchEmulatorIfNeeded();

  try {
    log(`Installing ${path.relative(repoRoot, apkPath)}.`);
    await adb(['-s', serial, 'install', '-r', apkPath], { timeout: 120_000 });
    await adb(['-s', serial, 'shell', 'am', 'start', '-n', activityName], { timeout: 20_000 });

    const updateFiles = await prepareUpdateFiles(serial, apkPath);
    log(`Prepared update fixtures under ${updateFiles.appUpdateDir}.`);

    const { port, socket } = await forwardWebView(serial);

    try {
      log(`Attached to WebView socket ${socket} on localhost:${port}.`);
      const target = await getMainPageTarget(port);
      const client = new CdpClient(target.webSocketDebuggerUrl);

      try {
        await client.send('Runtime.enable');
        await waitForPlatformBridge(client);
        await runUpdateInstallAssertions(client, serial, updateFiles);
      } finally {
        client.close();
      }
    } finally {
      await adb(['-s', serial, 'forward', '--remove', `tcp:${port}`]).catch(() => undefined);
      await adb(['-s', serial, 'shell', 'rm', '-f', tempDeviceApkPath]).catch(() => undefined);
    }

    log('Android update install smoke test passed.');
  } finally {
    if (startedEmulator && process.env.QORTIUM_HOME_KEEP_ANDROID_EMULATOR !== '1') {
      log('Stopping emulator started by smoke test.');
      await adb(['-s', serial, 'emu', 'kill']).catch(() => undefined);
      await rm(path.join(os.tmpdir(), 'qortium-home-android-update-install-smoke'), {
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
