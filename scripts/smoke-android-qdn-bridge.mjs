#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { existsSync, openSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
const accountRole = process.env.QORTIUM_HOME_SMOKE_ACCOUNT_ROLE ?? 'local';
const previewAccountsPath = expandHomePath(
  process.env.QORTIUM_HOME_PREVIEW_ACCOUNTS_PATH ??
    '~/git/qortium/preview/secrets/initial-minting-accounts.json',
);
const walletStoreKey = 'qortium-home-wallet-store';
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

function expandHomePath(filePath) {
  if (filePath === '~') {
    return os.homedir();
  }

  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function getWalletId(address) {
  return `wallet:${address}`;
}

function getPreviewAccount() {
  const previewAccounts = readJson(previewAccountsPath);
  const account = previewAccounts.accounts?.find((item) => item.role === accountRole);

  if (!account?.accountAddress) {
    fail(`Preview account role ${accountRole} was not found in ${previewAccountsPath}.`);
  }

  return account;
}

function createAndroidWalletStore(account) {
  const now = new Date().toISOString();
  const walletId = getWalletId(account.accountAddress);

  return {
    activeAccountId: walletId,
    version: 1,
    wallets: [
      {
        address: account.accountAddress,
        createdAt: now,
        encryptedWallet: {
          address0: account.accountAddress,
          encryptedSeed: '1',
          iv: '1',
          kdfThreads: 1,
          mac: '1',
          salt: '1',
          version: 2,
        },
        id: walletId,
        label: 'Android Smoke Account',
        sourceFilename: 'android-smoke.json',
        updatedAt: now,
      },
    ],
  };
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

async function getOwnedNames(address) {
  const names = await fetchJson(`${nodeApiUrl}/names/address/${encodeURIComponent(address)}?limit=0`);

  if (!Array.isArray(names)) {
    fail(`Unexpected names response for ${address}.`);
  }

  return names.map((item) => item?.name).filter((name) => typeof name === 'string' && name);
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

async function navigateToFixture(client, address = fixtureAddress) {
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
      setter.call(input, ${JSON.stringify(address)});
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

async function waitForCapacitorPreferences(client) {
  await waitUntil('Capacitor Preferences bridge', appTimeoutMs, async () => {
    const result = await client.send('Runtime.evaluate', {
      expression: "typeof window.Capacitor?.Plugins?.Preferences?.set === 'function'",
      returnByValue: true,
    });

    return result.result?.value === true;
  });
}

async function seedAndroidAccount(client, account) {
  const walletStore = createAndroidWalletStore(account);
  const walletId = walletStore.activeAccountId;

  await waitForCapacitorPreferences(client);

  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression: `
      window.Capacitor.Plugins.Preferences.set({
        key: ${JSON.stringify(walletStoreKey)},
        value: ${JSON.stringify(JSON.stringify(walletStore))}
      }).then(() => ({ ok: true }), (error) => ({
        ok: false,
        message: String(error && error.message || error)
      }))
    `,
    returnByValue: true,
  });
  const value = result.result?.value;

  if (!value?.ok) {
    fail(value?.message || 'Unable to seed Android wallet store.');
  }

  await client.send('Runtime.evaluate', {
    expression: 'window.location.reload()',
    returnByValue: true,
  });

  await waitUntil('seeded Android account', appTimeoutMs, async () => {
    const probe = await client.send('Runtime.evaluate', {
      expression: `
        (() => {
          const select = document.querySelector('#selected-wallet');
          const address = document.querySelector('.account-selector__address')?.textContent?.trim() || '';
          return {
            address,
            ok: select?.value === ${JSON.stringify(walletId)} && address === ${JSON.stringify(account.accountAddress)},
            selectValue: select?.value || ''
          };
        })()
      `,
      returnByValue: true,
    });

    return probe.result?.value?.ok === true;
  });
}

async function clearAndroidAccount(client) {
  await waitForCapacitorPreferences(client);

  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression: `
      window.Capacitor.Plugins.Preferences.remove({
        key: ${JSON.stringify(walletStoreKey)}
      }).then(() => ({ ok: true }), (error) => ({
        ok: false,
        message: String(error && error.message || error)
      }))
    `,
    returnByValue: true,
  });
  const value = result.result?.value;

  if (!value?.ok) {
    fail(value?.message || 'Unable to clear Android wallet store.');
  }

  await client.send('Runtime.evaluate', {
    expression: 'window.location.reload()',
    returnByValue: true,
  });

  await waitUntil('cleared Android account', appTimeoutMs, async () => {
    const probe = await client.send('Runtime.evaluate', {
      expression: `
        (() => ({
          hasAddressBar: !!document.querySelector('#browser-address'),
          hasWalletSelector: !!document.querySelector('#selected-wallet')
        }))()
      `,
      returnByValue: true,
    });
    const value = probe.result?.value;

    return value?.hasAddressBar === true && value?.hasWalletSelector === false;
  });
}

async function runWalletBackupAssertions(client) {
  await waitUntil('Qortium Home accounts API', appTimeoutMs, async () => {
    const result = await client.send('Runtime.evaluate', {
      expression: "typeof window.qortiumHome?.accounts?.createWallet === 'function'",
      returnByValue: true,
    });

    return result.result?.value === true;
  });
  await waitForCapacitorPreferences(client);

  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression: `
      (async () => {
        const originalNativePromise = window.Capacitor.nativePromise.bind(window.Capacitor);
        const backupCalls = [];
        window.Capacitor.nativePromise = (pluginName, methodName, options) => {
          if (pluginName === 'WalletBackup' && methodName === 'saveWallet') {
            backupCalls.push(options);
            return Promise.resolve({
              canceled: false,
              fileName: options.fileName,
              uri: 'smoke://wallet-backup/' + backupCalls.length
            });
          }

          return originalNativePromise(pluginName, methodName, options);
        };

        try {
          await window.Capacitor.Plugins.Preferences.remove({ key: ${JSON.stringify(walletStoreKey)} });
          const created = await window.qortiumHome.accounts.createWallet(
            'Android Smoke Created',
            'android-smoke-password'
          );

          if (created.canceled) {
            return { ok: false, message: 'Android wallet creation was canceled.' };
          }

          const account = created.accounts.find((item) => item.id === created.activeAccountId);

          if (!account) {
            return { ok: false, message: 'Created wallet was not active.' };
          }

          if (!account.isUnlocked) {
            return { ok: false, message: 'Created wallet was not unlocked.' };
          }

          if (backupCalls.length !== 1) {
            return { ok: false, message: 'Wallet creation did not save exactly one backup.' };
          }

          const createBackup = JSON.parse(backupCalls[0].content);

          if (createBackup.address0 !== account.address) {
            return { ok: false, message: 'Created backup address did not match the account.' };
          }

          for (const field of ['address0', 'encryptedSeed', 'iv', 'kdfThreads', 'mac', 'salt', 'version']) {
            if (!createBackup[field]) {
              return { ok: false, message: 'Created backup is missing ' + field + '.' };
            }
          }

          const exported = await window.qortiumHome.accounts.exportWallet(account.id);

          if (exported.canceled) {
            return { ok: false, message: 'Android wallet export was canceled.' };
          }

          if (backupCalls.length !== 2) {
            return { ok: false, message: 'Wallet export did not save exactly one backup.' };
          }

          const exportBackup = JSON.parse(backupCalls[1].content);

          if (exportBackup.address0 !== account.address) {
            return { ok: false, message: 'Exported backup address did not match the account.' };
          }

          if (exportBackup.encryptedSeed !== createBackup.encryptedSeed) {
            return { ok: false, message: 'Exported backup did not match the saved wallet.' };
          }

          return {
            ok: true,
            address: account.address,
            createFileName: backupCalls[0].fileName,
            exportFileName: exported.fileName
          };
        } catch (error) {
          return { ok: false, message: String(error && error.message || error) };
        } finally {
          window.Capacitor.nativePromise = originalNativePromise;
          await window.Capacitor.Plugins.Preferences.remove({ key: ${JSON.stringify(walletStoreKey)} });
        }
      })()
    `,
    returnByValue: true,
  });
  const value = result.result?.value;

  if (!value?.ok) {
    fail(value?.message || 'Android wallet backup smoke assertions failed.');
  }

  await client.send('Runtime.evaluate', {
    expression: 'window.location.reload()',
    returnByValue: true,
  });

  await waitUntil('wallet backup smoke reload', appTimeoutMs, async () => {
    const probe = await client.send('Runtime.evaluate', {
      expression: "typeof window.qortiumHome?.accounts?.createWallet === 'function'",
      returnByValue: true,
    });

    return probe.result?.value === true;
  });
}

function getFixtureAddressWithQuery(label) {
  return `${fixtureAddress}/?identity=${encodeURIComponent(label)}`;
}

async function getFixtureFrameContext(client) {
  return waitUntil('QDN fixture iframe', cdpTimeoutMs, async () => {
    const frameTree = await client.send('Page.getFrameTree');
    const frames = flattenFrames(frameTree.frameTree);
    const frame = frames.find(
      (candidate) =>
        candidate.url.includes(`/render/APP/${fixtureName}`) &&
        candidate.url.includes(`identifier=${appIdentifier}`) &&
        candidate.url.includes('qdnHomeBridge='),
    );

    if (!frame) {
      return null;
    }

    const contextId = client.contextsByFrame.get(frame.id);

    return contextId ? { contextId, frame } : null;
  });
}

function getUntaggedAppRenderUrl() {
  const url = new URL(`/render/APP/${encodeURIComponent(fixtureName)}`, androidNodeApiUrl);

  url.searchParams.set('identifier', appIdentifier);

  return url.toString();
}

async function getUntaggedFrameContext(client, renderUrl) {
  return waitUntil('untagged QDN render iframe', cdpTimeoutMs, async () => {
    const frameTree = await client.send('Page.getFrameTree');
    const frames = flattenFrames(frameTree.frameTree);
    const frame = frames.find((candidate) => candidate.url === renderUrl);

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
    fail(formatExceptionDetails(result.exceptionDetails, 'QDN fixture evaluation failed.'));
  }

  return result.result?.value;
}

async function evaluateInMain(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    fail(formatExceptionDetails(result.exceptionDetails, 'Qortium Home evaluation failed.'));
  }

  return result.result?.value;
}

function formatExceptionDetails(exceptionDetails, fallback) {
  const parts = [
    exceptionDetails.exception?.description,
    exceptionDetails.exception?.value,
    exceptionDetails.text,
  ].filter((part) => typeof part === 'string' && part.trim());

  return parts[0] || fallback;
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
      Promise.resolve()
        .then(() => {
          if (typeof window.qdnRequest !== 'function') {
            throw new Error('qdnRequest is ' + typeof window.qdnRequest);
          }

          return window.qdnRequest(${JSON.stringify(request)});
        })
        .then((result) => ({ ok: true, result }))
        .catch((error) => ({ ok: false, message: String(error && error.message || error) }))
    `,
  );

  if (!result?.ok) {
    fail(result?.message || `${request.action} failed.`);
  }

  return result.result;
}

async function resolveNextAccountRead(client, buttonLabel = 'Allow') {
  await waitUntil('QDN account approval dialog', appTimeoutMs, async () => {
    const result = await evaluateInMain(
      client,
      `
        (() => {
          const dialog = document.querySelector('[aria-label="QDN account request"]');
          if (!dialog) return null;
          const target = [...dialog.querySelectorAll('button')]
            .find((button) => button.textContent && button.textContent.trim() === ${JSON.stringify(buttonLabel)});
          if (!target) return { ok: false, message: ${JSON.stringify(`${buttonLabel} button was not found.`)} };
          target.click();
          return { ok: true };
        })()
      `,
    );

    if (result?.ok) {
      return true;
    }

    if (result?.message) {
      fail(result.message);
    }

    return null;
  });
}

async function isAccountReadDialogVisible(client) {
  return evaluateInMain(client, "!!document.querySelector('[aria-label=\"QDN account request\"]')");
}

async function runQdnRequestWithAccountDialog(
  mainClient,
  contextId,
  request,
  buttonLabel = 'Allow',
) {
  const requestPromise = evaluateInFrame(
    mainClient,
    contextId,
    `
      Promise.resolve()
        .then(() => {
          if (typeof window.qdnRequest !== 'function') {
            throw new Error('qdnRequest is ' + typeof window.qdnRequest);
          }

          return window.qdnRequest(${JSON.stringify(request)});
        })
        .then((result) => ({ ok: true, result }))
        .catch((error) => ({ ok: false, message: String(error && error.message || error) }))
    `,
  );

  const firstResult = await Promise.race([
    requestPromise.then((result) => ({ kind: 'request', result })),
    resolveNextAccountRead(mainClient, buttonLabel).then(() => ({ kind: 'dialog' })),
  ]);

  if (firstResult.kind === 'request') {
    fail(
      `${request.action} settled before the ${buttonLabel} dialog was resolved: ${JSON.stringify(
        firstResult.result,
      )}`,
    );
  }

  const result = await requestPromise;

  if (buttonLabel === 'Allow' && !result?.ok) {
    fail(result?.message || `${request.action} failed.`);
  }

  if (buttonLabel !== 'Allow' && result?.ok) {
    fail(`${request.action} unexpectedly succeeded after ${buttonLabel}.`);
  }

  return result;
}

async function expectQdnRequestRejected(client, contextId, request, expectedMessage) {
  const result = await evaluateInFrame(
    client,
    contextId,
    `
      Promise.resolve()
        .then(() => {
          if (typeof window.qdnRequest !== 'function') {
            throw new Error('qdnRequest is ' + typeof window.qdnRequest);
          }

          return window.qdnRequest(${JSON.stringify(request)});
        })
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

async function runBridgeContainmentAssertions(client, fixtureFrame) {
  const fixtureUrl = new URL(fixtureFrame.url);
  const bridgeToken = fixtureUrl.searchParams.get('qdnHomeBridge');

  assert(
    !!bridgeToken && /^[A-Za-z0-9._-]{16,128}$/.test(bridgeToken),
    `Android QDN fixture frame did not include a valid bridge token: ${fixtureFrame.url}`,
  );

  const untaggedRenderUrl = getUntaggedAppRenderUrl();
  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression: `
      (() => {
        const existing = document.querySelector('#qdn-untagged-bridge-probe');
        existing?.remove();
        const frame = document.createElement('iframe');
        frame.id = 'qdn-untagged-bridge-probe';
        frame.src = ${JSON.stringify(untaggedRenderUrl)};
        frame.style.position = 'fixed';
        frame.style.left = '-10px';
        frame.style.top = '-10px';
        frame.style.width = '1px';
        frame.style.height = '1px';
        frame.style.opacity = '0';
        document.body.append(frame);
        return { ok: true };
      })()
    `,
    returnByValue: true,
  });

  if (!result.result?.value?.ok) {
    fail('Unable to create untagged QDN render probe iframe.');
  }

  const { contextId, frame } = await getUntaggedFrameContext(client, untaggedRenderUrl);
  const bridgeState = await evaluateInFrame(client, contextId, 'typeof window.qdnRequest');

  assert(
    bridgeState === 'undefined',
    `Untagged Android QDN render frame unexpectedly received qdnRequest (${bridgeState}) at ${frame.url}.`,
  );
}

async function waitForQdnRequestBridge(client, contextId) {
  await waitUntil('QDN app bridge injection', cdpTimeoutMs, async () => {
    const bridgeState = await evaluateInFrame(client, contextId, 'typeof window.qdnRequest');

    return bridgeState === 'function';
  });
}

async function runBridgeAssertions(client, contextId) {
  await waitForQdnRequestBridge(client, contextId);

  const whichUi = await runQdnRequest(client, contextId, { action: 'WHICH_UI' });

  assert(whichUi === 'QORTIUM_HOME_ANDROID', `Expected QORTIUM_HOME_ANDROID, found ${JSON.stringify(whichUi)}.`);

  const actions = await runQdnRequest(client, contextId, { action: 'SHOW_ACTIONS' });
  for (const action of [
    'FETCH_NODE_API',
    'GET_NODE_INFO',
    'GET_NODE_STATUS',
    'GET_SELECTED_ACCOUNT',
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

async function runSelectedAccountAssertions(client, contextId, account, ownedNames) {
  const selectedAccountRequest = { action: 'GET_SELECTED_ACCOUNT' };
  const approved = await runQdnRequestWithAccountDialog(
    client,
    contextId,
    selectedAccountRequest,
    'Allow',
  );

  assert(
    approved?.result?.address === account.accountAddress,
    `GET_SELECTED_ACCOUNT returned ${JSON.stringify(approved?.result?.address)} instead of the seeded account.`,
  );
  assert(
    approved.result.avatarUrl === null || typeof approved.result.avatarUrl === 'string',
    'GET_SELECTED_ACCOUNT returned an invalid avatarUrl.',
  );

  if (ownedNames.length > 0) {
    assert(
      ownedNames.includes(approved.result.name),
      `GET_SELECTED_ACCOUNT returned unexpected name ${JSON.stringify(approved.result.name)}.`,
    );
  } else {
    assert(approved.result.name === null, 'GET_SELECTED_ACCOUNT returned a name for an account with no names.');
  }

  const cached = await runQdnRequest(client, contextId, selectedAccountRequest);

  assert(
    cached?.address === account.accountAddress,
    'GET_SELECTED_ACCOUNT cached approval did not return the seeded account.',
  );
  assert(
    (await isAccountReadDialogVisible(client)) === false,
    'GET_SELECTED_ACCOUNT cached approval opened another account dialog.',
  );
}

async function runSelectedAccountDenyAssertion(client, account) {
  await navigateToFixture(client, getFixtureAddressWithQuery('deny'));
  const { contextId } = await getFixtureFrameContext(client);
  await waitForQdnRequestBridge(client, contextId);
  const denied = await runQdnRequestWithAccountDialog(
    client,
    contextId,
    { action: 'GET_SELECTED_ACCOUNT' },
    'Deny',
  );

  assert(
    denied?.ok === false && String(denied.message ?? '').includes('denied'),
    `GET_SELECTED_ACCOUNT deny failed with unexpected result: ${JSON.stringify(denied)}.`,
  );
  assert(account.accountAddress, 'Seeded account address disappeared during deny assertion.');
}

async function runSelectedAccountNoAccountAssertion(client) {
  await clearAndroidAccount(client);
  await navigateToFixture(client, getFixtureAddressWithQuery('no-account'));
  const { contextId } = await getFixtureFrameContext(client);
  await waitForQdnRequestBridge(client, contextId);

  await expectQdnRequestRejected(
    client,
    contextId,
    { action: 'GET_SELECTED_ACCOUNT' },
    'No account is selected',
  );
  assert(
    (await isAccountReadDialogVisible(client)) === false,
    'GET_SELECTED_ACCOUNT opened an account dialog with no selected account.',
  );
}

async function main() {
  assertTool(adbPath, 'adb');

  await assertLocalCoreReady();
  await assertFixtureReady();
  const account = getPreviewAccount();
  const ownedNames = await getOwnedNames(account.accountAddress);

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
        await runWalletBackupAssertions(client);
        await configureSmokeNode(client);
        await seedAndroidAccount(client, account);
        await navigateToFixture(client);
        const { contextId, frame } = await getFixtureFrameContext(client);

        log(`Running bridge assertions in ${frame.url}.`);
        await runBridgeContainmentAssertions(client, frame);
        await runBridgeAssertions(client, contextId);
        await runSelectedAccountAssertions(client, contextId, account, ownedNames);
        await runSelectedAccountDenyAssertion(client, account);
        await runSelectedAccountNoAccountAssertion(client);
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
