#!/usr/bin/env node

// Android half of the app-update-state check: proves that a downloaded update
// stops being reported as pending once it has been installed, on the platform
// where the stale state offered to re-install an APK the user already had.
//
// See scripts/lib/app-update-scenarios.mjs for the scenarios and the
// regression they guard. Two Android-specific details drive the shape of this
// script:
//   - the preferences blob lives in Capacitor Preferences (SharedPreferences),
//     not localStorage, so it is seeded through the plugin rather than the DOM;
//   - CapacitorHttp replaces window.fetch during startup, so the GitHub stub
//     has to be installed after load or Capacitor's patch would replace it.
//
// Requires a debuggable build: a release APK exposes neither run-as nor a
// WebView devtools socket. Run npm run dist:android:debug first.

import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFetchStubSource,
  buildScenarioFixture,
  parseScenarioArgument,
} from './lib/app-update-scenarios.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(os.homedir(), 'Android', 'Sdk');
const adbPath = process.env.ADB ?? path.join(androidHome, 'platform-tools', 'adb');
const emulatorPath = process.env.ANDROID_EMULATOR ?? path.join(androidHome, 'emulator', 'emulator');
const avdHome = process.env.ANDROID_AVD_HOME ?? path.join(os.homedir(), '.config', '.android', 'avd');
const avdName = process.env.QORTIUM_HOME_ANDROID_AVD ?? 'qortium_home_api36';
const packageName = 'org.qortium.home';
const activityName = `${packageName}/.MainActivity`;
const commandTimeoutMs = 30_000;
const appTimeoutMs = 120_000;
const cdpTimeoutMs = 90_000;
const updateStatusTimeoutMs = 60_000;
const forceReinstall =
  process.argv.slice(2).includes('--reinstall') || process.env.QORTIUM_HOME_ANDROID_FORCE_REINSTALL === '1';
const preferEmulator =
  process.argv.slice(2).includes('--emulator') || process.env.QORTIUM_HOME_ANDROID_USE_EMULATOR === '1';

function log(message) {
  console.log(`[android-app-update-state-smoke] ${message}`);
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

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd ?? repoRoot,
        env: options.env ?? process.env,
        maxBuffer: 32 * 1024 * 1024,
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

function adb(args, options = {}) {
  return run(adbPath, args, options);
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

async function fetchJson(url) {
  const response = await fetch(url);
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }

  return JSON.parse(body);
}

function getDebugApkPath() {
  const debugDir = path.join(repoRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug');

  if (!existsSync(debugDir)) {
    fail('Android debug APK was not found. Run npm run dist:android:debug first.');
  }

  const apk = readdirSync(debugDir).find((name) => name.endsWith('.apk'));

  if (!apk) {
    fail(`No APK in ${debugDir}. Run npm run dist:android:debug first.`);
  }

  return path.join(debugDir, apk);
}

async function getAttachedDevice(emulatorOnly = false) {
  const { stdout } = await adb(['devices']);
  const serials = stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[1] === 'device')
    .map((parts) => parts[0])
    .filter((serial) => !emulatorOnly || serial.startsWith('emulator-'));

  if (process.env.QORTIUM_HOME_ANDROID_SERIAL) {
    return serials.includes(process.env.QORTIUM_HOME_ANDROID_SERIAL)
      ? process.env.QORTIUM_HOME_ANDROID_SERIAL
      : null;
  }

  return serials[0] ?? null;
}

async function launchEmulatorIfNeeded() {
  const attached = preferEmulator ? null : await getAttachedDevice();

  if (attached) {
    log(`Using attached device ${attached}.`);
    return { serial: attached, startedEmulator: false, tempDir: null };
  }

  if (!existsSync(emulatorPath)) {
    fail(`No device attached and the emulator was not found at ${emulatorPath}.`);
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-android-update-state-'));

  log(`Booting emulator ${avdName}.`);
  const emulator = spawn(
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
      detached: true,
      env: { ...process.env, ANDROID_AVD_HOME: avdHome },
      stdio: 'ignore',
    },
  );

  emulator.unref();

  const serial = await waitUntil('emulator to attach', appTimeoutMs, () => getAttachedDevice(true));

  await waitUntil('emulator boot', appTimeoutMs, async () => {
    const { stdout } = await adb(['-s', serial, 'shell', 'getprop', 'sys.boot_completed']);

    return stdout.trim() === '1';
  });

  return { serial, startedEmulator: true, tempDir };
}

async function isDebuggable(serial) {
  const { stdout } = await adb(['-s', serial, 'shell', 'run-as', packageName, 'pwd']).catch((error) => ({
    stdout: error instanceof Error ? error.message : '',
  }));

  return stdout.includes('/data/');
}

async function installDebugBuild(serial, apkPath) {
  try {
    await adb(['-s', serial, 'install', '-r', apkPath], { timeout: 300_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const isSignatureConflict =
      message.includes('INSTALL_FAILED_UPDATE_INCOMPATIBLE') ||
      message.includes('signatures do not match') ||
      message.includes('INSTALL_FAILED_VERSION_DOWNGRADE');

    if (!isSignatureConflict) {
      throw error;
    }

    if (!forceReinstall) {
      fail(
        `${packageName} is installed with a different signing key (most likely a release build). ` +
          'Re-run with --reinstall to uninstall it first. That erases the app data on the device.',
      );
    }

    log(`Uninstalling the existing ${packageName} to replace it with the debug build.`);
    await adb(['-s', serial, 'uninstall', packageName], { timeout: 120_000 });
    await adb(['-s', serial, 'install', '-r', apkPath], { timeout: 300_000 });
  }
}

async function getAppPid(serial) {
  const { stdout } = await adb(['-s', serial, 'shell', 'pidof', packageName], { timeout: 10_000 }).catch(() => ({
    stdout: '',
  }));
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
  const socket = await waitUntil('Android WebView debugging socket', cdpTimeoutMs, () =>
    getWebViewSocket(serial, pid),
  );
  const { stdout } = await adb(['-s', serial, 'forward', 'tcp:0', `localabstract:${socket}`]);
  const port = stdout.trim();

  if (!/^\d+$/.test(port)) {
    fail(`Unable to forward WebView debugging socket ${socket}.`);
  }

  return { port, socket };
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

// A fresh install lands on the onboarding flow, which renders instead of the
// dashboard. Skipping is idempotent: once the flag is stored, later launches
// go straight to the dashboard and this is a no-op.
async function openHomeUpdateSettings(client) {
  await waitUntil('Home 2 settings control', appTimeoutMs, () =>
    evaluate(client, `Boolean(document.querySelector('button[aria-label="Settings"]'))`),
  );
  await evaluate(client, `document.querySelector('button[aria-label="Settings"]').click()`);
  await waitUntil('Runtime settings navigation', appTimeoutMs, () =>
    evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.home-v2-settings-nav button')]
          .find((candidate) => candidate.textContent?.trim() === 'Runtime');
        if (!button) return false;
        button.click();
        return true;
      })()`,
    ),
  );
  await waitUntil('Home 2 Android update settings', appTimeoutMs, () =>
    evaluate(client, `Boolean(document.querySelector('[data-home-v2-app-updates="android"]'))`),
  );
}

async function waitForSettledStatus(client, label) {
  // 'Checking' is the pre-result state; settling on it would assert nothing.
  return waitUntil(label, updateStatusTimeoutMs, async () => {
    const state = await evaluate(client, `(() => {
      const panel = document.querySelector('[data-home-v2-app-updates="android"]');
      if (!panel) return null;
      return {
        actions: [...panel.querySelectorAll('[data-home-v2-update-action]')]
          .map((button) => button.textContent?.trim() ?? ''),
        latest: [...panel.querySelectorAll('.home-v2-update-details > div')]
          .find((row) => row.querySelector('dt')?.textContent?.trim() === 'Latest')
          ?.querySelector('dd')?.textContent?.trim() ?? null,
        status: panel.querySelector('.home-v2-settings-panel__heading p')?.textContent?.trim() ?? '',
      };
    })()`);

    return state && state.status && state.status !== 'Checking' ? state : null;
  });
}

async function runScenario({ client, environment, scenario, selectAsset }) {
  const currentVersion = environment.currentVersion;
  const probe = buildScenarioFixture({ currentVersion, fail, scenario });
  const asset = selectAsset(probe.release.assets, environment.platform);

  assert(!!asset, `No stubbed asset matches ${environment.platform.os}; the harness cannot seed a download.`);

  const { release } = buildScenarioFixture({
    asset,
    currentVersion,
    fail,
    homeUpdatePolicy: 'off',
    scenario,
  });

  log(`Scenario ${scenario}: installed ${currentVersion}, stubbed release ${release.tag_name}.`);

  await client.send('Page.reload', { ignoreCache: true });
  await openHomeUpdateSettings(client);

  // Applied after load because CapacitorHttp replaces window.fetch during
  // startup; a pre-load bootstrap would be silently overwritten.
  await evaluate(client, buildFetchStubSource(release));
  await waitUntil('enabled Home 2 update check', updateStatusTimeoutMs, () =>
    evaluate(
      client,
      `Boolean(document.querySelector('[data-home-v2-update-action="check"]:not(:disabled)'))`,
    ),
  );
  await evaluate(client, `document.querySelector('[data-home-v2-update-action="check"]').click()`);

  const state = await waitForSettledStatus(client, `Home update status (${scenario})`);

  log(`Scenario ${scenario}: status "${state.status}", actions [${state.actions.join(', ')}].`);
  assert(
    state.latest === release.tag_name,
    `Scenario ${scenario}: expected fixture tag ${release.tag_name}, found ${state.latest}.`,
  );

  if (scenario === 'installed') {
    assert(state.status.includes('up to date'), `Scenario ${scenario}: unexpected status ${state.status}.`);
    assert(!state.actions.includes('Download update'), `Scenario ${scenario}: Download update was offered.`);
  } else {
    assert(state.status.includes('available'), `Scenario ${scenario}: unexpected status ${state.status}.`);
    assert(state.actions.includes('Download update'), `Scenario ${scenario}: Download update was not offered.`);
  }

  log(`Scenario ${scenario} passed.`);
}

// Bundles the shipped asset selector so the harness picks the same asset the
// app will, instead of reimplementing the priority rules and drifting from them.
async function loadAssetSelector(tempRoot) {
  const outFile = path.join(tempRoot, 'app-update-assets.mjs');
  const esbuild = path.join(repoRoot, 'node_modules', '.bin', 'esbuild');

  await run(esbuild, [
    path.join(repoRoot, 'src', 'app-update-assets.ts'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    `--outfile=${outFile}`,
  ]);

  return import(`file://${outFile}`);
}

async function main() {
  const scenarios = parseScenarioArgument(
    process.argv.slice(2),
    process.env.QORTIUM_HOME_ANDROID_APP_UPDATE_SCENARIO,
    fail,
  );
  const apkPath = getDebugApkPath();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-android-update-assets-'));
  const { serial, startedEmulator, tempDir } = await launchEmulatorIfNeeded();
  let forwardedPort = null;

  try {
    const { selectCompatibleUpdateAsset } = await loadAssetSelector(tempRoot);

    log(`Installing ${path.basename(apkPath)}.`);
    await installDebugBuild(serial, apkPath);

    assert(
      await isDebuggable(serial),
      `${packageName} is not debuggable on ${serial}; the WebView cannot be inspected. Install the debug build.`,
    );

    await adb(['-s', serial, 'shell', 'am', 'start', '-n', activityName], { timeout: 20_000 });

    const { port } = await forwardWebView(serial);

    forwardedPort = port;

    const target = await getMainPageTarget(port);
    const client = new CdpClient(target.webSocketDebuggerUrl);

    try {
      await client.send('Runtime.enable');
      await client.send('Page.enable');
      await openHomeUpdateSettings(client);

      const environment = await waitUntil('Home update environment', cdpTimeoutMs, async () => {
        const value = await evaluate(
          client,
          `window.qortiumHome?.updates?.getEnvironment ? window.qortiumHome.updates.getEnvironment() : null`,
        );

        return value?.currentVersion ? value : null;
      });

      assert(
        environment.platform.os === 'android',
        `Expected an Android platform, found ${JSON.stringify(environment.platform.os)}.`,
      );

      for (const scenario of scenarios) {
        await runScenario({ client, environment, scenario, selectAsset: selectCompatibleUpdateAsset });
      }
    } finally {
      client.close();
    }
  } finally {
    if (forwardedPort) {
      await adb(['-s', serial, 'forward', '--remove', `tcp:${forwardedPort}`]).catch(() => undefined);
    }

    rmSync(tempRoot, { force: true, recursive: true });

    if (startedEmulator && process.env.QORTIUM_HOME_KEEP_ANDROID_EMULATOR !== '1') {
      await adb(['-s', serial, 'emu', 'kill']).catch(() => undefined);

      if (tempDir) {
        rmSync(tempDir, { force: true, recursive: true });
      }
    }
  }

  log('Android app update state smoke test passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
