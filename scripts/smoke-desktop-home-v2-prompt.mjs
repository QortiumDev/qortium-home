#!/usr/bin/env node

// Desktop acceptance for Home 2.0's tab-bound permission-prompt behavior.
//
// A real QDN app view (a native WebContentsView, not an iframe) calls
// GET_SELECTED_ACCOUNT through the production window.qdnRequest bridge. Home
// must: force-activate the requesting tab, snapshot+hide the native view,
// show the trusted PermissionDialog, and — on decision — restore the live
// view without a reload. This drives the packaged AppImage end to end
// (electron/home-v2-app-bridge.js -> requireAccountReadPermission ->
// electron/home-v2-live-preload -> src/v2/shell/PermissionDialog.tsx)
// against a local Qortium Core, the same way scripts/smoke-desktop-home-v2-nodes.mjs
// and scripts/smoke-desktop-qdn-write.mjs already drive this app.
//
// Requires a local Core at 127.0.0.1:24891 with qdn://APP/QortiumHomeTest/home-test
// published (run npm run qdn:bootstrap-test-data first if it is missing).
//
// Usage:
//   npm run smoke:desktop:home-v2-prompt

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createManagedProcess } from './lib/managed-process.mjs';
import { resolveWebSocket } from './lib/cdp-websocket.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const defaultAppImage = path.join(
  repoRoot,
  'dist-release',
  `Qortium-Home-${packageJson.version}-x86_64.AppImage`,
);
const appImage = path.resolve(process.env.QORTIUM_HOME_APPIMAGE?.trim() || defaultAppImage);
// Optional pin: when set, the binary on disk must be exactly the build the
// caller intends to accept — a mismatch fails instead of triggering a rebuild.
const expectedAppImageSha256 =
  process.env.QORTIUM_HOME_APPIMAGE_SHA256?.trim().toLowerCase() || null;

const nodeApiUrl = (process.env.QORTIUM_HOME_NODE_API_URL ?? 'http://127.0.0.1:24891').replace(
  /\/+$/,
  '',
);
const fixtureName = process.env.QORTIUM_HOME_V2_PROMPT_FIXTURE_NAME ?? 'QortiumHomeTest';
const fixtureIdentifier = process.env.QORTIUM_HOME_V2_PROMPT_FIXTURE_IDENTIFIER ?? 'home-test';
const fixtureAddress = `qdn://APP/${fixtureName}/${fixtureIdentifier}`;

const appTimeoutMs = 90_000;
const cdpTimeoutMs = 90_000;
// requireAccountReadPermission auto-denies an unanswered prompt after 60s;
// give the blocking evaluate a little more room than that.
const permissionRequestTimeoutMs = 70_000;
const smokeAddress = 'QSmokeHomeV2PermissionPromptAcct1';
// electron/accounts.ts's getWalletId() derives the wallet id from the
// encrypted wallet's address0 as `wallet:${address0}` and rejects any
// wallets.json entry whose id does not match; it is not an arbitrary id.
const smokeWalletId = `wallet:${smokeAddress}`;
const smokeAccountLabel = 'Home v2 permission prompt smoke';

let WebSocketImpl = null;

function log(message) {
  console.log(`[home-v2-prompt-smoke] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  fail(`Timed out waiting for ${label}.${lastError ? ` Last error: ${lastError.message}` : ''}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) fail(`${url} responded with HTTP ${response.status}.`);
  return response.json();
}

function verifyAppImageChecksum() {
  const bytes = readFileSync(appImage);
  const actual = createHash('sha256').update(bytes).digest('hex');
  log(`AppImage sha256: ${actual}`);
  if (expectedAppImageSha256 && actual !== expectedAppImageSha256) {
    fail(
      `AppImage checksum mismatch at ${appImage}.\n` +
        `Expected ${expectedAppImageSha256}\nFound    ${actual}\n` +
        'This smoke targets a specific already-built binary and must not trigger a rebuild.',
    );
  }
}

async function assertFixtureReady() {
  const status = await fetchJson(
    `${nodeApiUrl}/arbitrary/resource/status/APP/${encodeURIComponent(fixtureName)}/${encodeURIComponent(fixtureIdentifier)}`,
  ).catch(() => null);
  assert.equal(
    status?.status,
    'READY',
    `APP fixture is not READY at ${fixtureAddress} (status ${status?.status ?? 'unknown'}). ` +
      'Run npm run qdn:bootstrap-test-data first.',
  );
  log(`APP fixture ${fixtureAddress} is READY.`);
}

// Seeds a wallet directly into the profile's wallets.json before Electron
// starts, the same way scripts/smoke-desktop-qdn-write.mjs's
// writeLockedWalletStore does for its locked-account scenario. This drives
// the real production account-selection path (Home restores this as the
// active account on a cold profile) without going through the native
// dialog.showSaveDialog() that the in-app "Create account" flow requires,
// which cannot be automated headlessly.
function seedWalletStore(profileDirectory) {
  const now = new Date().toISOString();
  writeFileSync(
    path.join(profileDirectory, 'wallets.json'),
    `${JSON.stringify(
      {
        activeAccountId: smokeWalletId,
        version: 1,
        wallets: [
          {
            address: smokeAddress,
            createdAt: now,
            derivedAddresses: [],
            encryptedWallet: {
              address0: smokeAddress,
              encryptedSeed: '1',
              iv: '1',
              kdfThreads: 1,
              mac: '1',
              salt: '1',
              version: 2,
            },
            id: smokeWalletId,
            label: smokeAccountLabel,
            sourceFilename: 'home-v2-prompt-smoke.json',
            updatedAt: now,
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function getDisplayLaunch(command, args) {
  if (!process.env.DISPLAY && process.platform === 'linux' && existsSync('/usr/bin/xvfb-run')) {
    return { args: ['-a', command, ...args], command: '/usr/bin/xvfb-run' };
  }
  return { args, command };
}

class CdpClient {
  constructor(webSocketUrl, label) {
    this.label = label;
    this.nextId = 1;
    this.pending = new Map();
    this.eventListeners = new Set();
    this.webSocket = new WebSocketImpl(webSocketUrl);
    this.ready = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(
        () => reject(new Error(`CDP WebSocket connection to ${label} timed out.`)),
        15_000,
      );
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
          reject(new Error(`CDP WebSocket connection to ${label} failed.`));
        },
        { once: true },
      );
    });
    this.webSocket.addEventListener('message', (event) => this.handleMessage(event.data));
  }

  handleMessage(rawMessage) {
    const message = JSON.parse(rawMessage);
    if (!message.id) {
      if (message.method) {
        for (const listener of this.eventListeners) listener(message.method, message.params);
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message || 'CDP command failed.'));
    } else {
      pending.resolve(message.result);
    }
  }

  onEvent(listener) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  // Every call gets its own timeout: a destroyed execution context or a
  // request that never resolves must fail the smoke instead of hanging it.
  async send(method, params = {}, timeoutMs = 20_000) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} on ${this.label} timed out after ${timeoutMs}ms.`));
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

async function evaluate(client, expression, timeoutMs = 20_000) {
  const result = await client.send(
    'Runtime.evaluate',
    { awaitPromise: true, expression, returnByValue: true },
    timeoutMs,
  );
  if (result.exceptionDetails) {
    fail(
      `${client.label} evaluation failed: ${result.exceptionDetails.text || 'unknown error'}` +
        (result.exceptionDetails.exception?.description
          ? `\n${result.exceptionDetails.exception.description}`
          : ''),
    );
  }
  return result.result?.value;
}

async function getPageTarget(cdpPort, predicate, label) {
  const seen = new Set();
  try {
    return await waitUntil(label, cdpTimeoutMs, async () => {
      const targets = await fetchJson(`http://127.0.0.1:${cdpPort}/json/list`);
      for (const target of targets) {
        if (typeof target.url === 'string') seen.add(`${target.type}: ${target.url}`);
      }
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
  } catch (error) {
    const observed = seen.size ? `\nTargets seen:\n  ${[...seen].join('\n  ')}` : '\nNo CDP targets were seen.';
    fail(`${error.message}${observed}`);
  }
}

async function navigateToFixture(mainClient) {
  await waitUntil('Home v2 address bar', appTimeoutMs, async () => {
    const found = await evaluate(mainClient, "!!document.querySelector('input[aria-label=\"Address and search\"]')");
    return found === true;
  });
  const result = await evaluate(
    mainClient,
    `
      (async () => {
        const input = document.querySelector('input[aria-label="Address and search"]');
        const form = input && input.closest('form');
        if (!input || !form) return { ok: false, message: 'Address bar was not found.' };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        input.focus();
        setter.call(input, ${JSON.stringify(fixtureAddress)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return { ok: true };
      })()
    `,
  );
  if (!result?.ok) fail(result?.message || 'Unable to navigate Qortium Home to the APP fixture.');
  log(`Navigated Home to ${fixtureAddress}.`);
}

async function waitForAccountSelected(mainClient) {
  await waitUntil('seeded account to become selected', appTimeoutMs, async () => {
    const state = await evaluate(mainClient, 'window.homeV2Vault.getState()');
    return state?.selectedAccountId === smokeWalletId ? state : null;
  });
  log('Seeded smoke wallet is the selected account.');
}

async function getActiveTabId(mainClient) {
  return waitUntil('active app tab id', appTimeoutMs, async () => {
    const tabId = await evaluate(
      mainClient,
      "document.querySelector('.home-v2-tabs .home-v2-tab:not(.home-v2-tab--dashboard)')?.getAttribute('data-tab-id') ?? null",
    );
    return typeof tabId === 'string' && tabId ? tabId : null;
  });
}

function isDialogVisible(mainClient) {
  return evaluate(mainClient, "!!document.querySelector('[role=\"dialog\"].home-v2-permission-dialog')");
}

async function waitForDialog(mainClient, expectedAction) {
  await waitUntil(`permission dialog for ${expectedAction}`, appTimeoutMs, async () => {
    const state = await evaluate(
      mainClient,
      `
        (() => {
          const dialog = document.querySelector('[role="dialog"].home-v2-permission-dialog');
          if (!dialog) return null;
          return {
            action: dialog.getAttribute('data-bridge-action'),
            protocol: dialog.getAttribute('data-bridge-protocol'),
          };
        })()
      `,
    );
    return state?.action === expectedAction ? state : null;
  });
}

async function resolvePermission(mainClient, kind) {
  const selector =
    kind === 'deny'
      ? '.home-v2-permission-dialog .home-v2-permission-deny'
      : '.home-v2-permission-dialog .home-v2-permission-allow[data-permission-scope="single-request"]';
  const result = await evaluate(
    mainClient,
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

async function runQdnRequestGetSelectedAccount(appClient) {
  // awaitPromise holds this CDP response until the in-page qdnRequest promise
  // settles, which only happens once the shell resolves the permission. The
  // caller does not await this — it drives the dialog on a separate
  // connection while this stays pending, matching the pattern already
  // established in scripts/smoke-desktop-qdn-write.mjs.
  return evaluate(
    appClient,
    `
      window.qdnRequest({ action: 'GET_SELECTED_ACCOUNT' })
        .then((result) => ({ ok: true, result }))
        .catch((error) => ({ ok: false, message: String(error && error.message || error) }))
    `,
    permissionRequestTimeoutMs,
  );
}

async function main() {
  verifyAppImageChecksum();
  await assertFixtureReady();
  WebSocketImpl = await resolveWebSocket();

  const profileDirectory = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-v2-prompt-smoke-'));
  seedWalletStore(profileDirectory);

  const cdpPort = await getFreePort();
  const smokeEnv = {
    ...process.env,
    APPIMAGE_EXTRACT_AND_RUN: process.env.APPIMAGE_EXTRACT_AND_RUN || '1',
    QORTIUM_HOME_USER_DATA_DIR: profileDirectory,
  };
  const appArguments = [`--remote-debugging-port=${cdpPort}`];
  const launch = getDisplayLaunch(appImage, appArguments);

  let appProcess = null;
  let mainClient = null;
  let appClient = null;
  const frameStartedLoadingEvents = [];

  try {
    log(`Starting ${path.relative(repoRoot, appImage)} with CDP on 127.0.0.1:${cdpPort}.`);
    appProcess = createManagedProcess(launch.command, launch.args, { cwd: repoRoot, env: smokeEnv });

    const mainTarget = await getPageTarget(cdpPort, (url) => url.includes('/v2-live.html'), 'Home v2 shell target');
    mainClient = new CdpClient(mainTarget.webSocketDebuggerUrl, 'shell');
    await mainClient.send('Runtime.enable');

    await waitUntil('Home v2 shell to be ready', appTimeoutMs, async () => {
      const ready = await evaluate(
        mainClient,
        'document.readyState === "complete" && typeof window.homeV2Apps?.capture === "function" && typeof window.homeV2Vault?.getState === "function"',
      );
      return ready === true;
    });

    await waitForAccountSelected(mainClient);
    await navigateToFixture(mainClient);

    const appTarget = await getPageTarget(
      cdpPort,
      (url) => url.includes(`/render/APP/${fixtureName}`) && url.includes(fixtureIdentifier),
      'QDN APP render target',
    );
    appClient = new CdpClient(appTarget.webSocketDebuggerUrl, 'app-view');
    await appClient.send('Runtime.enable');
    await appClient.send('Page.enable');
    appClient.onEvent((method) => {
      if (method === 'Page.frameStartedLoading') frameStartedLoadingEvents.push(method);
    });

    const bridgeType = await evaluate(appClient, 'typeof window.qdnRequest');
    assert.equal(bridgeType, 'function', `Expected window.qdnRequest to be injected, found ${bridgeType}.`);

    const tabId = await getActiveTabId(mainClient);
    log(`App is bound to tab ${tabId}.`);

    // A marker on the app view's own window survives only if the view is
    // truly restored live afterwards rather than reloaded.
    await evaluate(appClient, "window.__homeV2PromptSmokeMarker = 'alive'; true");

    // --- Scenario 1: Deny -----------------------------------------------
    log('Triggering GET_SELECTED_ACCOUNT and denying it.');
    const denyPromise = runQdnRequestGetSelectedAccount(appClient);

    await waitForDialog(mainClient, 'GET_SELECTED_ACCOUNT');
    const dialogState = await evaluate(
      mainClient,
      `
        (() => {
          const dialog = document.querySelector('[role="dialog"].home-v2-permission-dialog');
          const viewport = document.querySelector('.home-v2-page-viewport');
          const snapshot = document.querySelector('.home-v2-app-stage__snapshot');
          return {
            dialogRole: dialog?.getAttribute('role'),
            overlayActive: viewport?.getAttribute('data-app-overlay-active'),
            snapshotSrc: snapshot?.getAttribute('src') ?? null,
          };
        })()
      `,
    );

    // Assertion 1: dialog present, viewport marked with the overlay, and the
    // captured snapshot painted over the (now hidden) native view.
    assert.equal(dialogState.dialogRole, 'dialog', 'Permission dialog should render with role="dialog".');
    assert.equal(dialogState.overlayActive, 'true', 'The main viewport should carry data-app-overlay-active="true".');
    assert.match(
      dialogState.snapshotSrc ?? '',
      /^data:image\/jpeg;base64,/,
      'A captured snapshot image should be painted over the app stage while the dialog is open.',
    );

    // Same-channel proof that the native view is genuinely hidden: the
    // capture handler itself refuses to capture a hidden view.
    const captureWhileHidden = await evaluate(
      mainClient,
      `window.homeV2Apps.capture({ tabId: ${JSON.stringify(tabId)} })`,
    );
    assert.equal(captureWhileHidden, null, 'Capturing the app view while the prompt is open should yield null (view is hidden).');

    // Force-activation guard: trying to background the requesting tab while
    // a decision is pending should snap straight back to it.
    log('Attempting to navigate to Dashboard while the prompt is pending.');
    await evaluate(mainClient, "document.querySelector('.home-v2-tab--dashboard button')?.click(); true");
    await waitUntil('forced reactivation of the requesting tab', 5_000, async () => {
      const state = await evaluate(
        mainClient,
        "document.querySelector('.home-v2-tab--dashboard button')?.getAttribute('aria-selected')",
      );
      return state === 'false' ? true : null;
    });
    assert.equal(
      await isDialogVisible(mainClient),
      true,
      'The permission dialog should still be visible after the forced tab reactivation.',
    );
    log('Dashboard navigation was overridden; the requesting tab stayed active.');

    await resolvePermission(mainClient, 'deny');
    const denyResult = await denyPromise;

    // Assertion 3: deny resolves the prompt, restores the view live, and the
    // app receives a rejected response.
    assert.equal(denyResult?.ok, false, `GET_SELECTED_ACCOUNT should have been denied, got: ${JSON.stringify(denyResult)}`);
    assert.match(String(denyResult?.message ?? ''), /denied/i, `Unexpected denial message: ${denyResult?.message}`);

    await waitUntil('dialog to close after deny', appTimeoutMs, async () => (await isDialogVisible(mainClient)) === false);
    await waitUntil('snapshot image to be removed after deny', appTimeoutMs, async () => {
      const present = await evaluate(mainClient, "!!document.querySelector('.home-v2-app-stage__snapshot')");
      return present === false ? true : null;
    });
    const overlayAfterDeny = await evaluate(
      mainClient,
      "document.querySelector('.home-v2-page-viewport')?.getAttribute('data-app-overlay-active')",
    );
    assert.equal(overlayAfterDeny, 'false', 'The overlay flag should clear once the prompt is resolved.');

    const markerAfterDeny = await evaluate(appClient, 'window.__homeV2PromptSmokeMarker');
    assert.equal(markerAfterDeny, 'alive', 'The app view should not have reloaded after Deny (marker variable should survive).');
    assert.equal(
      frameStartedLoadingEvents.length,
      0,
      'The app view should not have started a new frame load after Deny.',
    );
    log('Deny resolved cleanly: dialog closed, snapshot removed, live view restored without reload.');

    // --- Scenario 2: Approve once -----------------------------------------
    log('Triggering GET_SELECTED_ACCOUNT again and approving it once.');
    const approvePromise = runQdnRequestGetSelectedAccount(appClient);
    await waitForDialog(mainClient, 'GET_SELECTED_ACCOUNT');
    await resolvePermission(mainClient, 'allow');
    const approveResult = await approvePromise;

    // Assertion 4: approve resolves the prompt and the app receives the
    // account payload back through the real bridge.
    assert.equal(approveResult?.ok, true, `GET_SELECTED_ACCOUNT should have succeeded, got: ${JSON.stringify(approveResult)}`);
    assert.equal(approveResult.result?.address, smokeAddress, 'The approved response should carry the seeded account address.');
    assert.equal(approveResult.result?.isUnlocked, false, 'The seeded smoke wallet was never unlocked.');

    await waitUntil('dialog to close after approve', appTimeoutMs, async () => (await isDialogVisible(mainClient)) === false);
    const markerAfterApprove = await evaluate(appClient, 'window.__homeV2PromptSmokeMarker');
    assert.equal(markerAfterApprove, 'alive', 'The app view should not have reloaded after Approve either.');
    assert.equal(frameStartedLoadingEvents.length, 0, 'The app view should never have reloaded during this smoke.');
    log('Approve once resolved cleanly and the app received its account payload.');

    // --- Assertion 2: no dialog on a different, unforced tab --------------
    log('Navigating to Dashboard now that no permission request is pending.');
    await evaluate(mainClient, "document.querySelector('.home-v2-tab--dashboard button')?.click(); true");
    await waitUntil('Dashboard tab to become active', appTimeoutMs, async () => {
      const state = await evaluate(
        mainClient,
        "document.querySelector('.home-v2-tab--dashboard button')?.getAttribute('aria-selected')",
      );
      return state === 'true' ? true : null;
    });
    assert.equal(
      await isDialogVisible(mainClient),
      false,
      'No permission dialog should render on Dashboard once the request is resolved.',
    );
    log('Dashboard is active with no dialog present.');

    log('Home 2.0 tab-bound permission-prompt smoke passed.');
  } catch (error) {
    const output = appProcess?.output.join('').trim();
    if (output) console.error(output);
    throw error;
  } finally {
    appClient?.close();
    mainClient?.close();
    await appProcess?.stop();
    rmSync(profileDirectory, { force: true, recursive: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`[home-v2-prompt-smoke] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
