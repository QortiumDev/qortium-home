#!/usr/bin/env node

// Desktop acceptance for the GAME service: Home must host a browser-deliverable
// GAME archive the same way it hosts an APP, and the game inside it must
// actually boot and animate.
//
// GAME reaches Home through the archive/iframe path added in #212. Unit tests
// cover the routing decision; this covers the part they cannot — that a real
// published GAME archive loads in the real app and runs.
//
// Requires a local Core with the fixture published:
//   qdn://GAME/QortiumHomeTest/shell-game
//
// Usage:
//   npm run smoke:desktop:qdn-game
//   npm run smoke:desktop:qdn-game -- --packaged

import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createManagedProcess as createManagedProcessBase } from './lib/managed-process.mjs';
import { resolveWebSocket } from './lib/cdp-websocket.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const nodeApiUrl = (process.env.QORTIUM_HOME_NODE_API_URL ?? 'http://127.0.0.1:24891').replace(/\/+$/, '');
const fixtureName = process.env.QORTIUM_HOME_QDN_GAME_FIXTURE_NAME ?? 'QortiumHomeTest';
const fixtureIdentifier = process.env.QORTIUM_HOME_QDN_GAME_IDENTIFIER ?? 'shell-game';
const fixtureAddress =
  process.env.QORTIUM_HOME_QDN_GAME_FIXTURE ?? `qdn://GAME/${fixtureName}/${fixtureIdentifier}`;
// Home's local mode still needs the running node's API key; without it every
// QDN read is rejected and the viewer reports Core as offline.
const nodeApiKeyPath =
  process.env.QORTIUM_HOME_NODE_API_KEY_PATH ??
  path.join(os.homedir(), '.config', 'qortium-core', 'runtime', 'apikey.txt');
const commandTimeoutMs = 120_000;
const appTimeoutMs = 90_000;
const cdpTimeoutMs = 90_000;
const interactionTimeoutMs = 15_000;

function log(message) {
  console.log(`[desktop-qdn-game-smoke] ${message}`);
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
  if (hasArgument('--packaged') || process.env.QORTIUM_HOME_DESKTOP_QDN_GAME_PACKAGED === '1') {
    return 'packaged';
  }

  return 'dev';
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
    getArgumentValue('--appimage') || process.env.QORTIUM_HOME_APPIMAGE_PATH || '';

  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  const packageMetadata = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

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

// Spawns detached and kills the whole process group, so tearing down an
// xvfb-run-wrapped Electron does not orphan Xvfb and the browser.
function createManagedProcess(command, args, options = {}) {
  return createManagedProcessBase(command, args, { cwd: repoRoot, ...options });
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

  fail(`Timed out waiting for ${label}.${lastError ? ` Last error: ${lastError.message}` : ''}`);
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    fail(`${url} responded with HTTP ${response.status}.`);
  }

  return response.json();
}

async function assertFixtureReady() {
  const status = await fetchJson(
    `${nodeApiUrl}/arbitrary/resource/status/GAME/${encodeURIComponent(fixtureName)}/${encodeURIComponent(
      fixtureIdentifier,
    )}`,
  ).catch(() => null);

  // DOWNLOADED means every chunk is local but the unpacked cache has expired;
  // the renderer rebuilds it on demand, so it is just as usable as READY here.
  assert(
    status?.status === 'READY' || status?.status === 'DOWNLOADED',
    `GAME fixture is not available locally at ${fixtureAddress} (status ${status?.status ?? 'unknown'}). Publish it before running this smoke.`,
  );
  log(`GAME fixture is ${status.status} (${status.totalChunkCount} chunk(s)).`);

  assert(
    existsSync(nodeApiKeyPath),
    `No node API key at ${nodeApiKeyPath}. Set QORTIUM_HOME_NODE_API_KEY_PATH to the running node's key.`,
  );
}

function getDisplayLaunch(command, args) {
  if (!process.env.DISPLAY && process.platform === 'linux' && existsSync('/usr/bin/xvfb-run')) {
    return {
      args: ['-a', command, ...args],
      command: '/usr/bin/xvfb-run',
    };
  }

  return { args, command };
}

// Assigned once at startup, so a missing WebSocket fails before the app is built.
let WebSocketImpl = null;

class CdpClient {
  constructor(webSocketUrl) {
    this.nextId = 1;
    this.pending = new Map();
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
  await Promise.race([client.send('Browser.close').catch(() => undefined), delay(1_000)]);
}

async function getPageTarget(cdpPort, predicate, label) {
  const seen = new Set();

  try {
    return await waitUntil(label, cdpTimeoutMs, async () => {
      const targets = await fetchJson(`http://127.0.0.1:${cdpPort}/json/list`);

      for (const target of targets) {
        if (typeof target.url === 'string') {
          seen.add(`${target.type}: ${target.url}`);
        }
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
    // Without this, a routing regression reads as a bare timeout and says
    // nothing about what the app actually opened.
    const observed = seen.size ? `\nTargets seen:\n  ${[...seen].join('\n  ')}` : '\nNo CDP targets were seen.';

    fail(`${error.message}${observed}`);
  }
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
    fail(result?.message || 'Unable to navigate Qortium Home to the GAME fixture.');
  }

  log(`Navigated Qortium Home to ${fixtureAddress}.`);
}

// Reports what Home itself is showing, so a routing failure names the viewer
// state instead of only saying no render target appeared.
async function describeViewerState(mainClient) {
  const state = await evaluate(
    mainClient,
    `
      (() => {
        const frames = Array.from(document.querySelectorAll('iframe, webview')).map(
          (frame) => frame.getAttribute('src') || '(no src)',
        );
        const text = (document.querySelector('.qdn-viewer') || document.body).innerText || '';
        return { frames, text: text.replace(/\\s+/g, ' ').trim().slice(0, 400) };
      })()
    `,
  ).catch((error) => ({ error: error.message }));

  if (state?.error) {
    return `Could not read Home's viewer state: ${state.error}`;
  }

  const frames = state.frames?.length ? state.frames.join(', ') : 'none';

  return `Home viewer frames: ${frames}\nHome viewer text: ${state.text || '(empty)'}`;
}

async function assertGameRendered(gameClient) {
  const booted = await waitUntil('GAME archive to boot', appTimeoutMs, async () => {
    const state = await evaluate(
      gameClient,
      `
        (() => {
          const text = (id) => {
            const element = document.getElementById(id);
            return element ? element.textContent.trim() : null;
          };
          return {
            hasShell: !!document.getElementById('game-shell'),
            cash: text('cash'),
            inventory: text('inventory'),
            hasCollect: !!document.getElementById('collect-button'),
            images: Array.from(document.images).length,
            brokenImages: Array.from(document.images).filter(
              (image) => image.complete && image.naturalWidth === 0,
            ).length,
          };
        })()
      `,
    );

    return state?.hasShell && state.cash && state.hasCollect ? state : null;
  });

  log(`GAME booted: cash ${booted.cash}, stock ${booted.inventory}.`);
  assert(booted.images > 0, 'The GAME archive rendered no images, so its bundled art did not load.');
  assert(
    booted.brokenImages === 0,
    `${booted.brokenImages} image(s) in the GAME archive failed to load, so relative asset paths are broken.`,
  );
  log(`All ${booted.images} bundled image(s) loaded.`);

  // Rendering a static first frame would satisfy everything above. Drive the
  // game's own control and require its state to move.
  const before = booted.inventory;

  await evaluate(gameClient, "document.getElementById('collect-button').click(); true");

  const after = await waitUntil('the GAME to react to a collect click', interactionTimeoutMs, async () => {
    const inventory = await evaluate(
      gameClient,
      "document.getElementById('inventory') ? document.getElementById('inventory').textContent.trim() : null",
    );

    return inventory && inventory !== before ? inventory : null;
  });

  log(`GAME responded to input: stock ${before} -> ${after}.`);
}

async function runSmoke({ appImagePath, electronBin, mode, viteBin }) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-desktop-qdn-game-'));
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

  if (existsSync(nodeApiKeyPath)) {
    smokeEnv.QORTIUM_HOME_NODE_API_KEY_PATH = nodeApiKeyPath;
  }
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

    log(`Starting ${mode === 'packaged' ? path.relative(repoRoot, appImagePath) : 'Electron'} with CDP on 127.0.0.1:${cdpPort}.`);
    electronProcess = createManagedProcess(electronLaunch.command, electronLaunch.args, { env: smokeEnv });

    const mainTarget = await getPageTarget(cdpPort, mainPagePredicate, 'Electron main page target');
    const mainClient = new CdpClient(mainTarget.webSocketDebuggerUrl);

    try {
      await mainClient.send('Runtime.enable');
      await navigateToFixture(mainClient);

      // Finding this target at all is the routing assertion: Home only creates a
      // render view for services it treats as browser-deliverable archives.
      let gameTarget;

      try {
        gameTarget = await getPageTarget(
          cdpPort,
          (url) => url.includes('/render/GAME/') && url.includes(fixtureIdentifier),
          'QDN GAME render target',
        );
      } catch (error) {
        fail(`${error.message}\n${await describeViewerState(mainClient)}`);
      }
      const gameClient = new CdpClient(gameTarget.webSocketDebuggerUrl);

      try {
        await gameClient.send('Runtime.enable');
        log(`Asserting the GAME archive in ${gameTarget.url}.`);
        await assertGameRendered(gameClient);
      } finally {
        gameClient.close();
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

  WebSocketImpl = await resolveWebSocket();

  const electronBin = getBin('electron');
  const viteBin = getBin('vite');
  let appImagePath = '';

  await assertFixtureReady();

  if (mode === 'dev') {
    assertTool(electronBin, 'Electron');
    assertTool(viteBin, 'Vite');
    log('Building the Electron main process.');
    await run(npm, ['run', 'build:electron'], { timeout: commandTimeoutMs });
  } else {
    appImagePath = getAppImagePath();

    if (!existsSync(appImagePath)) {
      fail(`AppImage was not found at ${appImagePath}. Build it first, or pass --appimage=<path>.`);
    }
  }

  await runSmoke({ appImagePath, electronBin, mode, viteBin });
  log('Desktop GAME acceptance passed.');
}

main().catch((error) => {
  console.error(`[desktop-qdn-game-smoke] ${error.message}`);
  process.exitCode = 1;
});
