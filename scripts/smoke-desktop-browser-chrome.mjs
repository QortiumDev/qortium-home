#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const commandTimeoutMs = 120_000;
const appTimeoutMs = 90_000;
const cdpTimeoutMs = 90_000;
const keyCodes = {
  '1': { code: 'Digit1', key: '1', windowsVirtualKeyCode: 49 },
  '9': { code: 'Digit9', key: '9', windowsVirtualKeyCode: 57 },
  ArrowDown: { code: 'ArrowDown', key: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', key: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  ArrowRight: { code: 'ArrowRight', key: 'ArrowRight', windowsVirtualKeyCode: 39 },
  Escape: { code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 },
  F5: { code: 'F5', key: 'F5', windowsVirtualKeyCode: 116 },
  KeyL: { code: 'KeyL', key: 'l', windowsVirtualKeyCode: 76 },
  KeyT: { code: 'KeyT', key: 't', windowsVirtualKeyCode: 84 },
  KeyW: { code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 },
  PageDown: { code: 'PageDown', key: 'PageDown', windowsVirtualKeyCode: 34 },
  PageUp: { code: 'PageUp', key: 'PageUp', windowsVirtualKeyCode: 33 },
  Tab: { code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9 },
};

function log(message) {
  console.log(`[desktop-browser-chrome-smoke] ${message}`);
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

function getModifiers({ alt = false, ctrl = false, meta = false, shift = false } = {}) {
  return (alt ? 1 : 0) | (ctrl ? 2 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0);
}

async function pressKey(client, keyName, options = {}) {
  const key = keyCodes[keyName];

  if (!key) {
    fail(`Unknown smoke key: ${keyName}`);
  }

  const modifiers = getModifiers(options);
  const params = {
    code: key.code,
    key: key.key,
    modifiers,
    nativeVirtualKeyCode: key.windowsVirtualKeyCode,
    windowsVirtualKeyCode: key.windowsVirtualKeyCode,
  };

  await client.send('Input.dispatchKeyEvent', { ...params, type: 'keyDown' });
  await client.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' });
  await delay(80);
}

async function dispatchDomKey(client, keyName, options = {}) {
  const key = keyCodes[keyName];

  if (!key) {
    fail(`Unknown smoke key: ${keyName}`);
  }

  const result = await evaluate(
    client,
    `
      (() => {
        const target = document.activeElement || document.body;
        const event = new KeyboardEvent('keydown', {
          altKey: ${Boolean(options.alt)},
          bubbles: true,
          cancelable: true,
          code: ${JSON.stringify(key.code)},
          ctrlKey: ${Boolean(options.ctrl)},
          key: ${JSON.stringify(key.key)},
          metaKey: ${Boolean(options.meta)},
          shiftKey: ${Boolean(options.shift)}
        });
        target.dispatchEvent(event);
        return { ok: true, defaultPrevented: event.defaultPrevented };
      })()
    `,
  );

  if (!result?.ok) {
    fail(`Unable to dispatch DOM key ${keyName}.`);
  }

  await delay(80);
}

async function waitForAddressBar(client) {
  await waitUntil('Qortium Home address bar', appTimeoutMs, async () => {
    const found = await evaluate(client, "!!document.querySelector('#browser-address')");

    return found === true;
  });
}

async function setAddressValue(client, value) {
  const result = await evaluate(
    client,
    `
      (() => {
        const input = document.querySelector('#browser-address');
        if (!input) return { ok: false, message: 'Address bar was not found.' };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        input.focus();
        setter.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true, value: input.value };
      })()
    `,
  );

  if (!result?.ok) {
    fail(result?.message || `Unable to set address to ${value}.`);
  }
}

async function submitAddress(client, value) {
  const result = await evaluate(
    client,
    `
      (() => {
        const input = document.querySelector('#browser-address');
        const form = input && input.closest('form');
        if (!input || !form) return { ok: false, message: 'Address form was not found.' };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        input.focus();
        setter.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return { ok: true, value: input.value };
      })()
    `,
  );

  if (!result?.ok) {
    fail(result?.message || `Unable to submit address ${value}.`);
  }
}

async function getChromeState(client) {
  return evaluate(
    client,
    `
      (() => {
        const input = document.querySelector('#browser-address');
        const activeSuggestion = document.querySelector('.top-bar__address-suggestion--active');
        const suggestions = [...document.querySelectorAll('.top-bar__address-suggestion')].map((button) => ({
          active: button.classList.contains('top-bar__address-suggestion--active'),
          ariaSelected: button.getAttribute('aria-selected'),
          id: button.id,
          value: button.querySelector('.top-bar__address-suggestion-value')?.textContent?.trim() ?? '',
        }));
        const tabs = [...document.querySelectorAll('[role="tab"]')].map((tab, index) => ({
          index,
          label: tab.textContent?.trim() ?? '',
          selected: tab.getAttribute('aria-selected') === 'true',
        }));
        const selectedTabIndex = tabs.find((tab) => tab.selected)?.index ?? -1;

        return {
          activeElementId: document.activeElement?.id ?? '',
          activeElementRole: document.activeElement?.getAttribute('role') ?? '',
          activeSuggestionId: activeSuggestion?.id ?? '',
          addressValue: input?.value ?? '',
          selectedTabIndex,
          suggestions,
          suggestionsOpen: !!document.querySelector('#browser-address-suggestions'),
          tabCount: tabs.length,
          tabs,
        };
      })()
    `,
  );
}

async function expectAddressValue(client, expectedValue) {
  await waitUntil(`address value ${expectedValue}`, appTimeoutMs, async () => {
    const state = await getChromeState(client);

    return state.addressValue === expectedValue ? state : null;
  });
}

async function runAddressSuggestionAssertions(client) {
  log('Checking address suggestion keyboard behavior.');
  await setAddressValue(client, 'qdn');
  await waitUntil('qdn address suggestion', appTimeoutMs, async () => {
    const state = await getChromeState(client);

    return state.suggestions.some((suggestion) => suggestion.value === 'qdn://') ? state : null;
  });

  await pressKey(client, 'ArrowDown');

  await waitUntil('highlighted qdn address suggestion', appTimeoutMs, async () => {
    const state = await getChromeState(client);
    const activeSuggestion = state.suggestions.find((suggestion) => suggestion.value === 'qdn://');

    return activeSuggestion?.active && activeSuggestion?.ariaSelected === 'true' ? state : null;
  });

  // Focus moves in a requestAnimationFrame after the active state commits,
  // so poll for it instead of asserting against the highlighted snapshot.
  await waitUntil('focus on the active suggestion', appTimeoutMs, async () => {
    const state = await getChromeState(client);

    return state.activeElementId === 'browser-address-suggestion-0' ||
      state.activeElementRole === 'option'
      ? state
      : null;
  });

  await dispatchDomKey(client, 'Escape');
  await waitUntil('address suggestions closed by Escape', appTimeoutMs, async () => {
    const state = await getChromeState(client);

    return state.suggestionsOpen === false && state.activeElementId === 'browser-address' ? state : null;
  });

  await setAddressValue(client, '');
  await setAddressValue(client, 'qdn');
  await waitUntil('qdn address suggestion reopened', appTimeoutMs, async () => {
    const state = await getChromeState(client);

    return state.suggestionsOpen ? state : null;
  });
  await pressKey(client, 'ArrowDown');
  await dispatchDomKey(client, 'Tab');

  // Tab fills the scheme and hands focus back to the input; live autocomplete
  // then continues the flow by suggesting the next segment (QDN services).
  await waitUntil('Tab completion with follow-up service suggestions', appTimeoutMs, async () => {
    const state = await getChromeState(client);

    return state.addressValue === 'qdn://' &&
      state.activeElementId === 'browser-address' &&
      state.suggestionsOpen &&
      state.suggestions.some((suggestion) => /^qdn:\/\/[A-Z_]+$/.test(suggestion.value))
      ? state
      : null;
  });

  await dispatchDomKey(client, 'Escape');
  await waitUntil('follow-up suggestions closed by Escape', appTimeoutMs, async () => {
    const state = await getChromeState(client);

    return state.suggestionsOpen === false ? state : null;
  });
}

async function runShortcutAssertions(client) {
  log('Checking browser shortcut behavior.');
  await pressKey(client, 'KeyL', { ctrl: true });
  let state = await getChromeState(client);

  assert(state.activeElementId === 'browser-address', 'Ctrl+L did not focus the address bar.');

  await pressKey(client, 'KeyT', { ctrl: true });
  state = await waitUntil('new tab after Ctrl+T', appTimeoutMs, async () => {
    const nextState = await getChromeState(client);

    return nextState.tabCount === 2 ? nextState : null;
  });
  assert(state.selectedTabIndex === 1, 'Ctrl+T did not select the new tab.');

  await pressKey(client, 'KeyW', { ctrl: true });
  await waitUntil('tab close after Ctrl+W', appTimeoutMs, async () => {
    const nextState = await getChromeState(client);

    return nextState.tabCount === 1 ? nextState : null;
  });

  await pressKey(client, 'KeyT', { ctrl: true, shift: true });
  state = await waitUntil('reopened tab after Ctrl+Shift+T', appTimeoutMs, async () => {
    const nextState = await getChromeState(client);

    return nextState.tabCount === 2 ? nextState : null;
  });
  assert(state.selectedTabIndex === 1, 'Ctrl+Shift+T did not select the reopened tab.');

  await pressKey(client, 'PageUp', { ctrl: true });
  state = await waitUntil('previous tab after Ctrl+PageUp', appTimeoutMs, async () => {
    const nextState = await getChromeState(client);

    return nextState.selectedTabIndex === 0 ? nextState : null;
  });

  await pressKey(client, 'PageDown', { ctrl: true });
  state = await waitUntil('next tab after Ctrl+PageDown', appTimeoutMs, async () => {
    const nextState = await getChromeState(client);

    return nextState.selectedTabIndex === 1 ? nextState : null;
  });

  await pressKey(client, '1', { ctrl: true });
  state = await waitUntil('first tab after Ctrl+1', appTimeoutMs, async () => {
    const nextState = await getChromeState(client);

    return nextState.selectedTabIndex === 0 ? nextState : null;
  });

  await pressKey(client, '9', { ctrl: true });
  state = await waitUntil('last tab after Ctrl+9', appTimeoutMs, async () => {
    const nextState = await getChromeState(client);

    return nextState.selectedTabIndex === 1 ? nextState : null;
  });

  await pressKey(client, 'F5');
  await waitForAddressBar(client);
}

async function runHistoryShortcutAssertions(client) {
  log('Checking history shortcut behavior.');
  await submitAddress(client, 'home://settings');
  await expectAddressValue(client, 'home://settings');
  await submitAddress(client, 'home://dashboard');
  await expectAddressValue(client, 'home://dashboard');

  await pressKey(client, 'ArrowLeft', { alt: true });
  await expectAddressValue(client, 'home://settings');

  await pressKey(client, 'ArrowRight', { alt: true });
  await expectAddressValue(client, 'home://dashboard');
}

async function runSmoke({ electronBin, viteBin }) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-browser-chrome-'));
  const userDataDir = path.join(tempRoot, 'user-data');
  const cdpPort = await getFreePort();
  const vitePort = await getFreePort();
  const devServerUrl = `http://127.0.0.1:${vitePort}`;
  let viteProcess = null;
  let electronProcess = null;
  const smokeEnv = {
    ...process.env,
    QORTIUM_HOME_NODE_API_URL: 'http://127.0.0.1:24891',
    QORTIUM_HOME_USER_DATA_DIR: userDataDir,
    VITE_DEV_SERVER_URL: devServerUrl,
    XDG_CONFIG_HOME: path.join(tempRoot, 'config'),
  };

  try {
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
      await waitForAddressBar(mainClient);
      await runAddressSuggestionAssertions(mainClient);
      await runShortcutAssertions(mainClient);
      await runHistoryShortcutAssertions(mainClient);
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

  assertTool(electronBin, 'electron');
  assertTool(viteBin, 'vite');

  log('Building Electron main process.');
  await run(npm, ['run', 'build:electron']);
  await runSmoke({ electronBin, viteBin });
  log('Desktop browser chrome smoke test passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
