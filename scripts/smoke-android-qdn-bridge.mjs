#!/usr/bin/env node

// Real-device acceptance for Home 2.0's Android QDN bridge and its tab-bound
// permission-prompt behavior.
//
// This drives the app that is ALREADY INSTALLED on a physical Android device
// (org.qortium.home) over adb + Chrome DevTools Protocol. It never installs,
// uninstalls, or reboots anything, and it never touches any other package on
// the device (in particular org.qortium.home.v2live). It targets the same
// tab-bound PermissionDialog behavior that scripts/smoke-desktop-home-v2-prompt.mjs
// proves on desktop (electron/home-v2-live-preload.cts -> src/v2/shell/PermissionDialog.tsx),
// but Android has no window.homeV2Vault/window.homeV2Apps bridge (those are
// Electron-preload-only -- see src/home-v2-live/vault-client.ts and
// src/v2/shell/AppTabStage.tsx's `window.homeV2Apps ? DesktopAppStage : AndroidAppStage`
// switch). On Android, accounts live entirely in Capacitor Preferences
// (qortium-home-wallet-store / home-v2-live-shell-state, read by
// src/home-v2-live/node-client.ts) and QDN apps render as a plain iframe with
// no snapshot/capture step, so this smoke seeds/detects accounts by reading
// and writing those Preferences keys directly instead of calling a vault
// bridge, and it only asserts the overlay flag (not a captured snapshot).
//
// Requires: adb on PATH (or $ADB), exactly one attached/authorized device (or
// $QORTIUM_HOME_ANDROID_SERIAL), and org.qortium.home already installed with
// USB debugging enabled for the WebView.
//
// Usage:
//   npm run smoke:android:qdn-bridge

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { resolveWebSocket } from './lib/cdp-websocket.mjs';

const packageName = 'org.qortium.home';
const activityName = `${packageName}/.MainActivity`;
const adbPath = process.env.ADB?.trim() || 'adb';
const requestedSerial = process.env.QORTIUM_HOME_ANDROID_SERIAL?.trim() || '';
const allowSeed = process.env.QORTIUM_HOME_ANDROID_ALLOW_SEED === '1';

const fixtureName = process.env.QORTIUM_HOME_QDN_BRIDGE_FIXTURE_NAME ?? 'QortiumHomeTest';
const appIdentifier = process.env.QORTIUM_HOME_QDN_BRIDGE_APP_IDENTIFIER ?? 'home-test';
const fixtureAddress =
  process.env.QORTIUM_HOME_QDN_BRIDGE_FIXTURE ?? `qdn://APP/${fixtureName}/${appIdentifier}`;
const secondTabIdentity =
  process.env.QORTIUM_HOME_ANDROID_QDN_BRIDGE_SECOND_IDENTITY ?? 'android-bridge-smoke-tab2';
const secondTabAddress = `${fixtureAddress}?identity=${encodeURIComponent(secondTabIdentity)}`;
const fixtureAccountAddress =
  process.env.QORTIUM_HOME_ANDROID_ACCOUNT_ADDRESS ?? 'QAndroidHomeV2BridgeSmokeAcct1';
const fixtureWalletId = `wallet:${fixtureAccountAddress}`;

const WALLET_STORE_KEY = 'qortium-home-wallet-store';
const SHELL_STATE_KEY = 'home-v2-live-shell-state';

const adbCommandTimeoutMs = 20_000;
const appLaunchTimeoutMs = 20_000;
const cdpConnectTimeoutMs = 20_000;
const cdpDefaultTimeoutMs = 20_000;
const shellReadyTimeoutMs = 30_000;
const tabTimeoutMs = 20_000;
const dialogTimeoutMs = 20_000;
const permissionRequestTimeoutMs = 70_000;
const blockedSwitchGuardMs = 6_000;

let WebSocketImpl = null;

function log(message) {
  console.log(`[android-qdn-bridge-smoke] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(label, timeoutMs, action) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await action();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  fail(`Timed out waiting for ${label}.${lastError ? ` Last error: ${lastError.message}` : ''}`);
}

function run(command, args, timeoutMs = adbCommandTimeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        const output = `${stdout}${stderr}`.trim();
        reject(new Error(`${command} ${args.join(' ')} failed${output ? `:\n${output}` : ''}`));
        return;
      }
      resolve({ stderr, stdout });
    });
  });
}

function adbFor(serial, args, timeoutMs) {
  return run(adbPath, ['-s', serial, ...args], timeoutMs);
}

async function assertAdbAvailable() {
  try {
    await run(adbPath, ['version'], 10_000);
  } catch (error) {
    fail(
      `adb was not usable at "${adbPath}" (set $ADB to override): ${error.message}`,
    );
  }
}

async function resolveSerial() {
  const { stdout } = await run(adbPath, ['devices'], 10_000);
  const devices = stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial);

  if (requestedSerial) {
    if (!devices.includes(requestedSerial)) {
      fail(
        `Requested device ${requestedSerial} (QORTIUM_HOME_ANDROID_SERIAL) is not attached and authorized. ` +
          `Attached+authorized devices: ${devices.join(', ') || '(none)'}.`,
      );
    }
    return requestedSerial;
  }

  if (devices.length === 0) {
    fail('No attached and authorized Android device was found. Connect one device or set $QORTIUM_HOME_ANDROID_SERIAL.');
  }
  if (devices.length > 1) {
    fail(
      `Multiple attached devices were found (${devices.join(', ')}). ` +
        'Set $QORTIUM_HOME_ANDROID_SERIAL to pick one.',
    );
  }
  return devices[0];
}

async function assertAppInstalled(serial) {
  const { stdout } = await adbFor(serial, ['shell', 'dumpsys', 'package', packageName], 15_000).catch(() =>
    fail(`Unable to query package state for ${packageName} on ${serial}.`),
  );
  const versionName = stdout.match(/versionName=(\S+)/)?.[1];
  const versionCode = stdout.match(/versionCode=(\d+)/)?.[1];
  if (!versionName) {
    fail(
      `${packageName} does not appear to be installed on ${serial}. This smoke never installs the app -- ` +
        'install the accepted build manually first.',
    );
  }
  log(`${packageName} is installed on ${serial}: versionName=${versionName} versionCode=${versionCode ?? '?'}.`);
  return versionName;
}

async function getAppPid(serial) {
  const { stdout } = await adbFor(serial, ['shell', 'pidof', packageName], 10_000).catch(() => ({ stdout: '' }));
  const pid = stdout.trim().split(/\s+/)[0];
  return /^\d+$/.test(pid) ? pid : null;
}

async function launchApp(serial) {
  log(`Force-stopping ${packageName} to start from a clean process.`);
  await adbFor(serial, ['shell', 'am', 'force-stop', packageName], 10_000);
  await delay(500);
  log(`Launching ${activityName}.`);
  await adbFor(serial, ['shell', 'am', 'start', '-n', activityName], 15_000);
  const pid = await waitUntil(`${packageName} process`, appLaunchTimeoutMs, () => getAppPid(serial));
  log(`${packageName} is running as pid ${pid}.`);
  return pid;
}

async function getWebViewSocket(serial, pid) {
  const { stdout } = await adbFor(serial, ['shell', 'cat', '/proc/net/unix'], 10_000);
  const sockets = stdout
    .split(/\r?\n/)
    .map((line) => line.match(/@?(webview_devtools_remote[^\s]*)/)?.[1])
    .filter(Boolean);
  return sockets.find((socket) => socket === `webview_devtools_remote_${pid}`) ?? null;
}

async function forwardWebView(serial, pid) {
  const socket = await waitUntil('Android WebView debugging socket', cdpConnectTimeoutMs, () =>
    getWebViewSocket(serial, pid),
  );
  const { stdout } = await adbFor(serial, ['forward', 'tcp:0', `localabstract:${socket}`], 10_000);
  const port = stdout.trim();
  if (!/^\d+$/.test(port)) {
    fail(`Unable to forward WebView debugging socket ${socket}.`);
  }
  log(`Forwarded ${socket} to 127.0.0.1:${port}.`);
  return { port, socket };
}

async function removeForward(serial, port) {
  if (!port) return;
  await adbFor(serial, ['forward', '--remove', `tcp:${port}`], 10_000).catch(() => undefined);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) fail(`${url} responded with HTTP ${response.status}.`);
  return response.json();
}

async function getMainPageTarget(port) {
  return waitUntil('WebView CDP page target', cdpConnectTimeoutMs, async () => {
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

class CdpClient {
  constructor(webSocketUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.contextsByFrame = new Map();
    this.eventListeners = new Set();
    this.webSocket = new WebSocketImpl(webSocketUrl);
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
      if (message.method === 'Runtime.executionContextCreated') {
        const context = message.params?.context;
        const frameId = context?.auxData?.frameId;
        if (typeof context?.id === 'number' && typeof frameId === 'string') {
          this.contextsByFrame.set(frameId, context.id);
        }
      }
      if (message.method) {
        for (const listener of this.eventListeners) listener(message.method, message.params);
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message || 'CDP command failed.'));
    else pending.resolve(message.result);
  }

  onEvent(listener) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  // Every call gets its own timeout: a destroyed execution context or a
  // request that never resolves must fail the smoke instead of hanging it.
  async send(method, params = {}, timeoutMs = cdpDefaultTimeoutMs) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeoutId);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
      });
      this.webSocket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.webSocket.close();
  }
}

function formatExceptionDetails(exceptionDetails, fallback) {
  const parts = [
    exceptionDetails.exception?.description,
    exceptionDetails.exception?.value,
    exceptionDetails.text,
  ].filter((part) => typeof part === 'string' && part.trim());
  return parts[0] || fallback;
}

async function evalMain(client, expression, timeoutMs = cdpDefaultTimeoutMs) {
  const result = await client.send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true }, timeoutMs);
  if (result.exceptionDetails) fail(formatExceptionDetails(result.exceptionDetails, 'Home shell evaluation failed.'));
  return result.result?.value;
}

async function evalFrame(client, contextId, expression, timeoutMs = cdpDefaultTimeoutMs) {
  const result = await client.send(
    'Runtime.evaluate',
    { awaitPromise: true, contextId, expression, returnByValue: true },
    timeoutMs,
  );
  if (result.exceptionDetails) fail(formatExceptionDetails(result.exceptionDetails, 'QDN app frame evaluation failed.'));
  return result.result?.value;
}

function flattenFrames(frameTree) {
  const frames = [frameTree.frame];
  for (const child of frameTree.childFrames ?? []) frames.push(...flattenFrames(child));
  return frames;
}

async function waitForCapacitorPreferences(client) {
  await waitUntil('Capacitor Preferences bridge', shellReadyTimeoutMs, async () => {
    const ready = await evalMain(client, "typeof window.Capacitor?.Plugins?.Preferences?.get === 'function'");
    return ready === true;
  });
}

async function getPreference(client, key) {
  return evalMain(
    client,
    `window.Capacitor.Plugins.Preferences.get({ key: ${JSON.stringify(key)} }).then((r) => r.value)`,
  );
}

async function setPreference(client, key, value) {
  const result = await evalMain(
    client,
    `
      window.Capacitor.Plugins.Preferences.set({
        key: ${JSON.stringify(key)},
        value: ${JSON.stringify(value)}
      }).then(() => ({ ok: true }), (error) => ({ ok: false, message: String(error && error.message || error) }))
    `,
  );
  if (!result?.ok) fail(result?.message || `Unable to write Preferences key ${key}.`);
}

async function removePreference(client, key) {
  const result = await evalMain(
    client,
    `
      window.Capacitor.Plugins.Preferences.remove({ key: ${JSON.stringify(key)} })
        .then(() => ({ ok: true }), (error) => ({ ok: false, message: String(error && error.message || error) }))
    `,
  );
  if (!result?.ok) fail(result?.message || `Unable to remove Preferences key ${key}.`);
}

// Mirrors the selection logic in src/home-v2-live/HomeV2LiveApp.tsx: once a
// home-v2-live-shell-state Preferences entry exists (even from an unrelated
// prior session), its own selectedAddressId wins over the wallet store's
// activeAccountId. Only fall back to the wallet store when no shell-state
// entry has ever been saved.
function computeSelectedAccount(walletStoreRaw, shellStateRaw) {
  let walletStore = null;
  let shellState = null;
  try {
    walletStore = walletStoreRaw ? JSON.parse(walletStoreRaw) : null;
  } catch {
    walletStore = null;
  }
  try {
    shellState = shellStateRaw ? JSON.parse(shellStateRaw) : null;
  } catch {
    shellState = null;
  }
  const wallets = Array.isArray(walletStore?.wallets) ? walletStore.wallets : [];
  const useCatalogueActiveAccount = shellStateRaw === null || shellStateRaw === undefined;
  const effectiveWalletId = useCatalogueActiveAccount
    ? (walletStore?.activeAccountId ?? null)
    : (shellState?.selectedAddressId ?? null);
  const wallet = effectiveWalletId ? wallets.find((candidate) => candidate?.id === effectiveWalletId) : null;
  return wallet ? { address: wallet.address, usable: true, walletId: wallet.id } : { usable: false };
}

async function readSelectedAccount(client) {
  await waitForCapacitorPreferences(client);
  const walletStoreRaw = await getPreference(client, WALLET_STORE_KEY);
  const shellStateRaw = await getPreference(client, SHELL_STATE_KEY);
  return computeSelectedAccount(walletStoreRaw, shellStateRaw);
}

async function seedFixtureAccount(client) {
  const now = new Date().toISOString();
  const walletStore = {
    activeAccountId: fixtureWalletId,
    version: 1,
    wallets: [
      {
        address: fixtureAccountAddress,
        createdAt: now,
        derivedAddresses: [],
        encryptedWallet: {
          address0: fixtureAccountAddress,
          encryptedSeed: '1',
          iv: '1',
          kdfThreads: 1,
          mac: '1',
          salt: '1',
          version: 2,
        },
        id: fixtureWalletId,
        label: 'Android QDN bridge smoke fixture account',
        sourceFilename: 'android-qdn-bridge-smoke.json',
        updatedAt: now,
      },
    ],
  };
  await waitForCapacitorPreferences(client);
  log(`Seeding disposable fixture account ${fixtureAccountAddress} into ${WALLET_STORE_KEY}.`);
  await setPreference(client, WALLET_STORE_KEY, JSON.stringify(walletStore));
  // Drop any leftover shell-state so the wallet store's activeAccountId
  // governs selection instead of a stale selectedAddressId from an
  // unrelated earlier session (see computeSelectedAccount above). This also
  // resets the persisted tab list to empty, giving a clean starting state.
  await removePreference(client, SHELL_STATE_KEY);
}

async function connectShell(port) {
  const target = await getMainPageTarget(port);
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await waitUntil('Home 2.0 shell to be ready', shellReadyTimeoutMs, async () => {
    const ready = await evalMain(
      client,
      "document.readyState === 'complete' && !!document.querySelector('.home-v2-tabs')",
    );
    return ready === true;
  });
  return client;
}

async function closeAllAppTabs(client) {
  let guard = 0;
  while (guard++ < 20) {
    const closed = await evalMain(
      client,
      `
        (() => {
          const button = document.querySelector('.home-v2-tabs .home-v2-tab:not(.home-v2-tab--dashboard) .home-v2-tab__close');
          if (!button) return false;
          button.click();
          return true;
        })()
      `,
    );
    if (!closed) break;
    await delay(300);
  }
  const remaining = await evalMain(
    client,
    "document.querySelectorAll('.home-v2-tabs .home-v2-tab:not(.home-v2-tab--dashboard)').length",
  );
  assert.equal(remaining, 0, 'Unable to reset the Home 2.0 tab strip to a clean (Dashboard-only) state.');
}

async function navigateToAddress(client, address, label) {
  await waitUntil('Home 2.0 address bar', tabTimeoutMs, async () => {
    const found = await evalMain(client, "!!document.querySelector('input[aria-label=\"Address and search\"]')");
    return found === true;
  });
  const result = await evalMain(
    client,
    `
      (async () => {
        const input = document.querySelector('input[aria-label="Address and search"]');
        const form = input && input.closest('form');
        if (!input || !form) return { ok: false, message: 'Address bar was not found.' };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        input.focus();
        setter.call(input, ${JSON.stringify(address)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return { ok: true };
      })()
    `,
  );
  if (!result?.ok) fail(result?.message || `Unable to navigate Home 2.0 to ${label}.`);
}

async function getActiveTabId(client) {
  return waitUntil('an active app tab', tabTimeoutMs, async () => {
    const tabId = await evalMain(
      client,
      "document.querySelector('.home-v2-tabs .home-v2-tab:not(.home-v2-tab--dashboard).is-active')?.getAttribute('data-tab-id') ?? null",
    );
    return typeof tabId === 'string' && tabId ? tabId : null;
  });
}

function tabButtonSelector(tabId) {
  return `.home-v2-tabs [data-tab-id=${JSON.stringify(tabId)}] button`;
}

async function activateTab(client, tabId) {
  await evalMain(client, `document.querySelector(${JSON.stringify(tabButtonSelector(tabId))})?.click(); true`);
  await waitUntil(`tab ${tabId} to become active`, tabTimeoutMs, async () => {
    const selected = await evalMain(client, `document.querySelector(${JSON.stringify(tabButtonSelector(tabId))})?.getAttribute('aria-selected')`);
    return selected === 'true' ? true : null;
  });
}

// Android renders the active QDN app tab as a plain iframe (AndroidAppStage
// in src/v2/shell/AppTabStage.tsx); only the active tab has one mounted.
async function getActiveAppFrameContext(client) {
  return waitUntil('active QDN app iframe', tabTimeoutMs, async () => {
    const frameTree = await client.send('Page.getFrameTree');
    const frames = flattenFrames(frameTree.frameTree);
    const frame = frames.find((candidate) => {
      try {
        const url = new URL(candidate.url);
        return url.searchParams.has('qdnHomeBridge') && url.pathname.includes(`/render/APP/${encodeURIComponent(fixtureName)}`);
      } catch {
        return false;
      }
    });
    if (!frame) return null;
    const contextId = client.contextsByFrame.get(frame.id);
    return contextId ? { contextId, frame } : null;
  });
}

async function waitForQdnRequestBridge(client, contextId) {
  await waitUntil('window.qdnRequest injection', tabTimeoutMs, async () => {
    const bridgeType = await evalFrame(client, contextId, 'typeof window.qdnRequest');
    return bridgeType === 'function';
  });
}

function isDialogVisible(client) {
  return evalMain(client, "!!document.querySelector('[role=\"dialog\"].home-v2-permission-dialog')");
}

async function waitForDialog(client, expectedAction) {
  return waitUntil(`permission dialog for ${expectedAction}`, dialogTimeoutMs, async () => {
    const state = await evalMain(
      client,
      `
        (() => {
          const dialog = document.querySelector('[role="dialog"].home-v2-permission-dialog');
          if (!dialog) return null;
          const viewport = document.querySelector('.home-v2-page-viewport');
          return {
            action: dialog.getAttribute('data-bridge-action'),
            ariaModal: dialog.getAttribute('aria-modal'),
            overlayActive: viewport?.getAttribute('data-app-overlay-active'),
            protocol: dialog.getAttribute('data-bridge-protocol'),
            role: dialog.getAttribute('role'),
          };
        })()
      `,
    );
    return state?.action === expectedAction ? state : null;
  });
}

async function resolvePermission(client, kind) {
  const selector =
    kind === 'deny'
      ? '.home-v2-permission-dialog .home-v2-permission-deny'
      : '.home-v2-permission-dialog .home-v2-permission-allow[data-permission-scope="single-request"]';
  const result = await evalMain(
    client,
    `
      (() => {
        const button = document.querySelector(${JSON.stringify(selector)});
        if (!button) return { ok: false };
        button.click();
        return { ok: true };
      })()
    `,
  );
  if (!result?.ok) fail(`Unable to find the ${kind} button on the permission dialog.`);
}

async function denyIfDialogPending(client) {
  const visible = await isDialogVisible(client).catch(() => false);
  if (!visible) return;
  log('Cleanup: a permission dialog was still pending, denying it.');
  await resolvePermission(client, 'deny').catch(() => undefined);
}

async function main() {
  await assertAdbAvailable();
  const serial = await resolveSerial();
  log(`Using Android device ${serial}.`);
  await assertAppInstalled(serial);

  let port = null;
  let client = null;

  const cleanup = async () => {
    if (client) {
      await denyIfDialogPending(client).catch(() => undefined);
      client.close();
    }
    await removeForward(serial, port).catch(() => undefined);
    await adbFor(serial, ['shell', 'am', 'force-stop', packageName], 10_000).catch(() => undefined);
  };

  try {
    WebSocketImpl = await resolveWebSocket();

    const pid = await launchApp(serial);
    const forwarded = await forwardWebView(serial, pid);
    port = forwarded.port;
    client = await connectShell(port);

    log('Resetting the tab strip to a clean (Dashboard-only) state.');
    await closeAllAppTabs(client);

    log('Checking for a usable selected account.');
    let account = await readSelectedAccount(client);
    if (!account.usable) {
      if (!allowSeed) {
        fail(
          'No usable selected account was found on-device (checked qortium-home-wallet-store / ' +
            'home-v2-live-shell-state via Capacitor Preferences). This smoke never seeds a wallet unless ' +
            'explicitly told to: set QORTIUM_HOME_ANDROID_ALLOW_SEED=1 to seed a disposable fixture account, ' +
            'or select a test account in the app by hand before re-running.',
        );
      }
      await seedFixtureAccount(client);
      log('Restarting the app so the seeded account state is picked up from a cold start.');
      client.close();
      client = null;
      await removeForward(serial, port);
      port = null;
      const seededPid = await launchApp(serial);
      const seededForward = await forwardWebView(serial, seededPid);
      port = seededForward.port;
      client = await connectShell(port);
      await closeAllAppTabs(client);
      account = await readSelectedAccount(client);
      if (!account.usable) {
        fail('Seeded a fixture account but it still did not resolve as the selected account after restart.');
      }
    }
    log(`Selected account for this run: ${account.address}${account.walletId === fixtureWalletId ? ' (seeded fixture)' : ' (pre-existing on device)'}.`);

    log(`Opening fixture tab 1: ${fixtureAddress}`);
    await navigateToAddress(client, fixtureAddress, 'the fixture APP tab');
    const tab1Id = await getActiveTabId(client);

    log(`Opening fixture tab 2: ${secondTabAddress}`);
    await navigateToAddress(client, secondTabAddress, 'the second fixture APP tab');
    const tab2Id = await getActiveTabId(client);
    assert.notEqual(tab2Id, tab1Id, 'Opening a second fixture address should have created a distinct tab.');

    log(`Reactivating tab 1 (${tab1Id}) before driving the bridge from it.`);
    await activateTab(client, tab1Id);
    let { contextId, frame } = await getActiveAppFrameContext(client);
    await waitForQdnRequestBridge(client, contextId);
    const bridgeType = await evalFrame(client, contextId, 'typeof window.qdnRequest');
    assert.equal(bridgeType, 'function', `Expected window.qdnRequest to be injected, found ${bridgeType}.`);

    const tabToken = frame.url.match(/[?&]qdnHomeBridge=([^&]+)/)?.[1];
    assert.ok(tabToken, `Requesting tab frame did not carry a qdnHomeBridge token: ${frame.url}`);

    const frameStartedLoadingEvents = [];
    await client.send('Page.enable');
    const unsubscribe = client.onEvent((method, params) => {
      if (method === 'Page.frameStartedLoading' && params?.frameId === frame.id) {
        frameStartedLoadingEvents.push(method);
      }
    });

    await evalFrame(client, contextId, "window.__androidQdnBridgeSmokeMarker = 'alive'; true");

    function runGetSelectedAccount() {
      return evalFrame(
        client,
        contextId,
        `
          window.qdnRequest({ action: 'GET_SELECTED_ACCOUNT' })
            .then((result) => ({ ok: true, result }))
            .catch((error) => ({ ok: false, message: String(error && error.message || error) }))
        `,
        permissionRequestTimeoutMs,
      );
    }

    // --- Scenario 1: dialog binding + blocked Dashboard switch + blocked
    // other-app-tab switch + deny ------------------------------------------
    log('Triggering GET_SELECTED_ACCOUNT and denying it, after probing that tab switches are blocked.');
    const denyPromise = runGetSelectedAccount();

    const dialogState = await waitForDialog(client, 'GET_SELECTED_ACCOUNT');
    assert.equal(dialogState.role, 'dialog', 'Permission dialog should render with role="dialog".');
    assert.equal(dialogState.protocol, 'qdnRequest', 'Dialog should be bound to the qdnRequest protocol.');
    assert.equal(dialogState.overlayActive, 'true', 'The main viewport should carry data-app-overlay-active="true".');
    const requestingTabSelectedBefore = await evalMain(
      client,
      `document.querySelector(${JSON.stringify(tabButtonSelector(tab1Id))})?.getAttribute('aria-selected')`,
    );
    assert.equal(requestingTabSelectedBefore, 'true', 'The requesting tab should be active while the dialog is open.');

    log('Attempting to navigate to Dashboard while the prompt is pending (should be blocked).');
    await evalMain(client, "document.querySelector('.home-v2-tab--dashboard button')?.click(); true");
    await waitUntil('the requesting tab to stay/return active after the blocked Dashboard click', blockedSwitchGuardMs, async () => {
      const dashboardSelected = await evalMain(client, "document.querySelector('.home-v2-tab--dashboard button')?.getAttribute('aria-selected')");
      return dashboardSelected === 'false' ? true : null;
    });
    assert.equal(await isDialogVisible(client), true, 'The permission dialog should still be visible after the blocked Dashboard click.');

    log('Attempting to activate the other fixture tab while the prompt is pending (should be blocked).');
    await evalMain(client, `document.querySelector(${JSON.stringify(tabButtonSelector(tab2Id))})?.click(); true`);
    await delay(blockedSwitchGuardMs);
    const tab1SelectedAfter = await evalMain(client, `document.querySelector(${JSON.stringify(tabButtonSelector(tab1Id))})?.getAttribute('aria-selected')`);
    const tab2SelectedAfter = await evalMain(client, `document.querySelector(${JSON.stringify(tabButtonSelector(tab2Id))})?.getAttribute('aria-selected')`);
    assert.equal(tab1SelectedAfter, 'true', 'The requesting tab should still be active after the blocked other-tab click.');
    assert.equal(tab2SelectedAfter, 'false', 'The other fixture tab should not have become active while the prompt is pending.');
    assert.equal(await isDialogVisible(client), true, 'The permission dialog should still be visible after the blocked other-tab click.');

    const frameTreeAfterBlocks = await client.send('Page.getFrameTree');
    const frameAfterBlocks = flattenFrames(frameTreeAfterBlocks.frameTree).find((candidate) => candidate.id === frame.id);
    assert.ok(frameAfterBlocks, 'The requesting tab frame should still exist (same frame id) after both blocked switch attempts.');
    const tokenAfterBlocks = frameAfterBlocks.url.match(/[?&]qdnHomeBridge=([^&]+)/)?.[1];
    assert.equal(tokenAfterBlocks, tabToken, 'The bridge token should be unchanged (no reload) after the blocked switch attempts.');
    assert.equal(frameStartedLoadingEvents.length, 0, 'The requesting tab should not have started a new frame load during the blocked switch attempts.');
    const markerAfterBlocks = await evalFrame(client, contextId, 'window.__androidQdnBridgeSmokeMarker');
    assert.equal(markerAfterBlocks, 'alive', 'The requesting tab iframe should not have reloaded (marker should survive the blocked switch attempts).');
    log('Both blocked switch attempts left the requesting tab active, its frame unreloaded, and the dialog open.');

    await resolvePermission(client, 'deny');
    const denyResult = await denyPromise;
    assert.equal(denyResult?.ok, false, `GET_SELECTED_ACCOUNT should have been denied, got: ${JSON.stringify(denyResult)}`);
    assert.match(String(denyResult?.message ?? ''), /denied/i, `Unexpected denial message: ${denyResult?.message}`);

    await waitUntil('dialog to close after deny', dialogTimeoutMs, async () => (await isDialogVisible(client)) === false);
    const overlayAfterDeny = await evalMain(client, "document.querySelector('.home-v2-page-viewport')?.getAttribute('data-app-overlay-active')");
    assert.equal(overlayAfterDeny, 'false', 'The overlay flag should clear once the prompt is resolved.');
    assert.equal(frameStartedLoadingEvents.length, 0, 'The requesting tab should not have reloaded for a deny either.');
    const markerAfterDeny = await evalFrame(client, contextId, 'window.__androidQdnBridgeSmokeMarker');
    assert.equal(markerAfterDeny, 'alive', 'The requesting tab iframe should not have reloaded after Deny.');
    log('Deny resolved cleanly: rejected with a denial message, dialog closed, overlay cleared, no reload.');

    // --- Scenario 2: approve once -----------------------------------------
    log('Triggering GET_SELECTED_ACCOUNT again and approving it once.');
    const approvePromise = runGetSelectedAccount();
    await waitForDialog(client, 'GET_SELECTED_ACCOUNT');
    await resolvePermission(client, 'allow');
    const approveResult = await approvePromise;
    assert.equal(approveResult?.ok, true, `GET_SELECTED_ACCOUNT should have succeeded, got: ${JSON.stringify(approveResult)}`);
    assert.equal(
      approveResult.result?.address,
      account.address,
      'The approved response should carry the selected account address.',
    );
    log(`Approve-once returned the account payload: address=${approveResult.result?.address}, isUnlocked=${approveResult.result?.isUnlocked}.`);

    await waitUntil('dialog to close after approve', dialogTimeoutMs, async () => (await isDialogVisible(client)) === false);
    assert.equal(frameStartedLoadingEvents.length, 0, 'The requesting tab should never have reloaded during this smoke.');
    const markerAfterApprove = await evalFrame(client, contextId, 'window.__androidQdnBridgeSmokeMarker');
    assert.equal(markerAfterApprove, 'alive', 'The requesting tab iframe should not have reloaded after Approve either.');
    unsubscribe();
    log('Approve-once resolved cleanly and the app received its account payload.');

    // --- Scenario 3: no dialog once resolved --------------------------------
    log('Navigating to Dashboard now that no permission request is pending.');
    await evalMain(client, "document.querySelector('.home-v2-tab--dashboard button')?.click(); true");
    await waitUntil('Dashboard tab to become active', tabTimeoutMs, async () => {
      const state = await evalMain(client, "document.querySelector('.home-v2-tab--dashboard button')?.getAttribute('aria-selected')");
      return state === 'true' ? true : null;
    });
    assert.equal(await isDialogVisible(client), false, 'No permission dialog should render on Dashboard once the request is resolved.');
    log('Dashboard is active with no dialog present.');

    log('Cleaning up the fixture tabs this smoke opened.');
    await closeAllAppTabs(client);

    log('Android QDN bridge smoke test passed.');
  } finally {
    await cleanup();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`[android-qdn-bridge-smoke] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
