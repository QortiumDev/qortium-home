#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const nodeApiUrl = (process.env.QORTIUM_HOME_NODE_API_URL ?? 'http://127.0.0.1:24891').replace(
  /\/+$/,
  '',
);

function expandHome(value) {
  return value.startsWith('~') ? path.join(os.homedir(), value.slice(1)) : value;
}

const fixtureName = process.env.QORTIUM_HOME_QDN_MEDIA_SEEK_FIXTURE_NAME ?? 'QortiumHomeTest';
const videoIdentifier =
  process.env.QORTIUM_HOME_QDN_MEDIA_SEEK_VIDEO_IDENTIFIER ?? 'matroska-test-8';
const audioIdentifier = process.env.QORTIUM_HOME_QDN_MEDIA_SEEK_AUDIO_IDENTIFIER ?? 'home-audio';
const videoAddress =
  process.env.QORTIUM_HOME_QDN_MEDIA_SEEK_VIDEO_FIXTURE ??
  `qdn://VIDEO/${fixtureName}/${videoIdentifier}`;
const audioAddress =
  process.env.QORTIUM_HOME_QDN_MEDIA_SEEK_AUDIO_FIXTURE ??
  `qdn://AUDIO/${fixtureName}/${audioIdentifier}`;
const skipAudioCheck = process.env.QORTIUM_HOME_QDN_MEDIA_SEEK_SKIP_AUDIO === '1';
// Home resolves QDN resource details through the local node's API key. The
// smoke run uses a throwaway profile, so the key path has to be handed in
// explicitly or Home reports the Core as offline.
const nodeApiKeyPath = expandHome(
  process.env.QORTIUM_HOME_NODE_API_KEY_PATH ?? '~/.config/qortium-core/runtime/apikey.txt',
);
const videoSelector = 'video.qdn-viewer__media-player--video';
const audioSelector = 'audio.qdn-viewer__media-player--audio';
const commandTimeoutMs = 120_000;
const appTimeoutMs = 90_000;
const cdpTimeoutMs = 90_000;
const mediaTimeoutMs = 90_000;
const seekTimeoutMs = 45_000;
const playbackTimeoutMs = 30_000;
// Container seeking snaps to the nearest keyframe, so the landed position is
// allowed to differ from the requested one by this much.
const seekToleranceSeconds = 5;
// The seek target must clear the buffered region by at least this much so a
// pass cannot be explained by data the element already held.
const unbufferedMarginSeconds = 5;
const minimumSeekFraction = 0.7;

function log(message) {
  console.log(`[desktop-qdn-media-seek-smoke] ${message}`);
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

function formatSeconds(value) {
  return Number.isFinite(value) ? Number(value).toFixed(3) : String(value);
}

function formatBufferedRanges(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return 'none';
  }

  return ranges.map((range) => `[${formatSeconds(range.start)}s..${formatSeconds(range.end)}s]`).join(' ');
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

    await delay(1_000);
  }

  if (lastError instanceof Error) {
    fail(`${label} timed out: ${lastError.message}`);
  }

  fail(`${label} timed out.`);
}

async function fetchText(url, options = {}) {
  let response;

  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(
      `${url} was unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }

  return body;
}

async function fetchJson(url, options = {}) {
  return JSON.parse(await fetchText(url, options));
}

async function assertLocalCoreReady() {
  const status = await fetchJson(`${nodeApiUrl}/admin/status`);

  if (status?.isSynchronizing === true) {
    fail(`Local Core is still synchronizing at ${nodeApiUrl}.`);
  }

  const info = await fetchJson(`${nodeApiUrl}/admin/info`);
  log(`Local Core at ${nodeApiUrl} reports build ${info?.buildVersion ?? 'unknown'}.`);

  return status;
}

async function getResourceStatus(service, name, identifier) {
  return fetchJson(
    `${nodeApiUrl}/arbitrary/resource/status/${service}/${encodeURIComponent(
      name,
    )}/${encodeURIComponent(identifier)}`,
  );
}

async function assertFixturesReady() {
  const videoStatus = await getResourceStatus('VIDEO', fixtureName, videoIdentifier);

  if (videoStatus?.status !== 'READY') {
    fail(
      `QDN VIDEO fixture is not READY at ${videoAddress} (status ${videoStatus?.status ?? 'unknown'}).`,
    );
  }

  if (!skipAudioCheck) {
    const audioStatus = await getResourceStatus('AUDIO', fixtureName, audioIdentifier);

    if (audioStatus?.status !== 'READY') {
      fail(
        `QDN AUDIO fixture is not READY at ${audioAddress} (status ${audioStatus?.status ?? 'unknown'}).`,
      );
    }
  }
}

// The seek proof needs a resource long enough that a target past the buffered
// region still exists. A tiny file can never demonstrate that, so state the
// size up front rather than letting a short fixture produce a hollow pass.
async function reportVideoFixtureSize() {
  const url = `${nodeApiUrl}/render/VIDEO/${encodeURIComponent(fixtureName)}/${encodeURIComponent(
    videoIdentifier,
  )}`;
  const response = await fetch(url, { headers: { Range: 'bytes=0-0' } });

  await response.arrayBuffer();

  const acceptRanges = response.headers.get('accept-ranges') ?? '';
  const contentRange = response.headers.get('content-range') ?? '';
  const totalBytes = Number(contentRange.split('/')[1] ?? 0);

  assert(
    response.status === 206,
    `Core /render did not honour a byte range for the VIDEO fixture (HTTP ${response.status}). ` +
      'The node under test does not have the Range support this smoke test exists to verify.',
  );
  assert(
    acceptRanges.toLowerCase().includes('bytes'),
    `Core /render did not advertise Accept-Ranges: bytes for the VIDEO fixture (got "${acceptRanges}").`,
  );

  log(
    `VIDEO fixture ${videoIdentifier} is ${totalBytes || 'unknown'} bytes; ` +
      `Core answered a range request with HTTP 206 and Accept-Ranges: ${acceptRanges}.`,
  );

  return totalBytes;
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
      const timeoutId = setTimeout(
        () => reject(new Error('CDP WebSocket connection timed out.')),
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
          reject(new Error('CDP WebSocket connection failed.'));
        },
        { once: true },
      );
    });
    this.webSocket.addEventListener('message', (event) => this.handleMessage(event.data));
    this.webSocket.addEventListener('close', () => this.rejectPending('CDP WebSocket closed.'));
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

async function closeBrowser(client) {
  await Promise.race([client.send('Browser.close').catch(() => undefined), delay(1_000)]);
}

async function getPageTarget(cdpPort, predicate, label) {
  return waitUntil(label, cdpTimeoutMs, async () => {
    const targets = await fetchJson(`http://127.0.0.1:${cdpPort}/json/list`);

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
}

async function navigateToAddress(client, address) {
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

function getMediaProbeExpression(selector) {
  return `
    (() => {
      const errorMessage = document.querySelector('.qdn-viewer__message--error')?.textContent?.trim() || '';
      const loadingMessage = document
        .querySelector('.qdn-viewer__empty--loading .qdn-viewer__message')
        ?.textContent?.trim() || '';
      const element = document.querySelector(${JSON.stringify(selector)});

      if (!element) {
        return { ready: false, errorMessage, loadingMessage, reason: 'missing-element' };
      }

      const buffered = [];
      for (let index = 0; index < element.buffered.length; index += 1) {
        buffered.push({ end: element.buffered.end(index), start: element.buffered.start(index) });
      }

      const mediaError = element.error
        ? { code: element.error.code, message: element.error.message || '' }
        : null;
      const hasMetadata = element.readyState >= HTMLMediaElement.HAVE_METADATA;
      const hasDuration = Number.isFinite(element.duration) && element.duration > 0;

      return {
        buffered,
        currentTime: element.currentTime,
        duration: Number.isFinite(element.duration) ? element.duration : null,
        errorMessage,
        hasDuration,
        hasMetadata,
        height: element.videoHeight || 0,
        loadingMessage,
        mediaError,
        ready: hasMetadata && hasDuration && !mediaError,
        readyState: element.readyState,
        src: element.src || '',
        width: element.videoWidth || 0
      };
    })()
  `;
}

async function waitForMediaReady(client, label, selector) {
  let lastProbe = null;

  try {
    return await waitUntil(`${label} media element`, mediaTimeoutMs, async () => {
      const probe = await evaluate(client, getMediaProbeExpression(selector), `${label} media probe`);
      lastProbe = probe;

      if (probe?.errorMessage) {
        fail(`${label} viewer showed an error: ${probe.errorMessage}`);
      }

      if (probe?.mediaError) {
        fail(`${label} media element failed: ${JSON.stringify(probe.mediaError)}`);
      }

      return probe?.ready ? probe : null;
    });
  } catch (error) {
    const dom = await evaluate(client, getViewerDiagnosticExpression(), 'viewer diagnostic').catch(
      () => null,
    );

    throw new Error(
      `${error instanceof Error ? error.message : String(error)} Last ${label} probe: ${JSON.stringify(
        lastProbe,
      )}. Viewer state: ${JSON.stringify(dom)}.`,
    );
  }
}

function getViewerDiagnosticExpression() {
  return `
    (() => {
      const classes = new Set();
      for (const node of document.querySelectorAll('[class*="qdn-viewer"]')) {
        for (const name of node.classList) {
          if (name.startsWith('qdn-viewer')) classes.add(name);
        }
      }

      return {
        address: document.querySelector('#browser-address')?.value || '',
        mediaTags: Array.from(document.querySelectorAll('audio, video')).map((node) => ({
          className: node.className,
          src: (node.src || '').slice(0, 120)
        })),
        text: (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 600),
        viewerClasses: Array.from(classes)
      };
    })()
  `;
}

// Assertion 1: the element must stream from Core over HTTP. A blob:/data: src
// means the whole resource was pulled into memory first, which can never
// exercise byte ranges and so can never prove seeking.
function assertRenderUrlSource(label, src, service) {
  assert(src, `${label} media element had no src.`);
  assert(
    !src.startsWith('blob:') && !src.startsWith('data:'),
    `${label} media element used an in-memory source (${src.slice(0, 32)}...), which cannot exercise byte ranges.`,
  );
  assert(
    src.startsWith(`${nodeApiUrl}/`),
    `${label} media element did not stream from the configured node ${nodeApiUrl}: ${src}`,
  );
  assert(
    src.includes(`/render/${service}/${encodeURIComponent(fixtureName)}`),
    `${label} media element did not use a Core /render/${service} URL: ${src}`,
  );
}

// Assertion 7 support: record every error event from the moment the element is
// found, so an error fired mid-seek cannot be missed by point-in-time probes.
async function installErrorRecorder(client, selector) {
  await evaluate(
    client,
    `
      (() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return false;
        window.__qdnMediaSeekSmoke = { errors: [] };
        element.addEventListener('error', () => {
          window.__qdnMediaSeekSmoke.errors.push(
            element.error ? { code: element.error.code, message: element.error.message || '' } : { code: null, message: 'error event' }
          );
        });
        return true;
      })()
    `,
    'error recorder installation',
  );
}

async function assertNoMediaErrors(client, selector, stage) {
  const state = await evaluate(
    client,
    `
      (() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        return {
          elementError: element && element.error ? { code: element.error.code, message: element.error.message || '' } : null,
          recorded: (window.__qdnMediaSeekSmoke && window.__qdnMediaSeekSmoke.errors) || []
        };
      })()
    `,
    'media error check',
  );

  assert(
    state?.elementError === null,
    `Media element reported an error ${stage}: ${JSON.stringify(state?.elementError)}`,
  );
  assert(
    Array.isArray(state?.recorded) && state.recorded.length === 0,
    `Media element fired error events ${stage}: ${JSON.stringify(state?.recorded)}`,
  );
}

// Assertion 3: pick a target that is provably outside every buffered range and
// far into the file. Returns null when the file is already fully buffered, so
// the caller can report that instead of passing on a meaningless seek.
function chooseSeekTarget(buffered, duration) {
  const bufferedEnd = buffered.reduce((highest, range) => Math.max(highest, range.end), 0);
  const target = Math.max(duration * minimumSeekFraction, bufferedEnd + unbufferedMarginSeconds);

  if (target >= duration - 1) {
    return { bufferedEnd, reason: 'no-unbuffered-region', target: null };
  }

  const overlapping = buffered.find((range) => target >= range.start && target <= range.end);

  if (overlapping) {
    return { bufferedEnd, reason: 'target-inside-buffered', target: null };
  }

  return { bufferedEnd, reason: '', target };
}

// Assertions 4 and 5: request the seek, then wait for the browser's own
// `seeked` event. Polling currentTime once would pass even when the element
// silently snaps back, which is exactly the old broken-Core behaviour.
async function seekAndAwaitSeeked(client, selector, target) {
  const result = await evaluate(
    client,
    `
      (async () => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return { ok: false, message: 'Media element disappeared before seeking.' };

        const target = ${JSON.stringify(target)};
        const seeked = new Promise((resolve) => {
          const onSeeked = () => {
            element.removeEventListener('seeked', onSeeked);
            resolve({ timedOut: false });
          };
          element.addEventListener('seeked', onSeeked);
          setTimeout(() => {
            element.removeEventListener('seeked', onSeeked);
            resolve({ timedOut: true });
          }, ${JSON.stringify(seekTimeoutMs)});
        });

        element.currentTime = target;
        const outcome = await seeked;

        const buffered = [];
        for (let index = 0; index < element.buffered.length; index += 1) {
          buffered.push({ end: element.buffered.end(index), start: element.buffered.start(index) });
        }

        return {
          ok: true,
          buffered,
          currentTime: element.currentTime,
          mediaError: element.error ? { code: element.error.code, message: element.error.message || '' } : null,
          readyState: element.readyState,
          seeking: element.seeking,
          timedOut: outcome.timedOut
        };
      })()
    `,
    'seek request',
  );

  if (!result?.ok) {
    fail(result?.message || 'Unable to seek the media element.');
  }

  return result;
}

// Assertion 6: the position must keep advancing from the seek target. This is
// the check that fails against a Core that ignores Range headers, because
// playback there cannot continue from an unbuffered offset.
async function playAndAwaitAdvance(client, selector, fromTime) {
  const result = await evaluate(
    client,
    `
      (async () => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return { ok: false, message: 'Media element disappeared before playback.' };

        element.muted = true;

        try {
          await element.play();
        } catch (error) {
          return { ok: false, message: 'play() was rejected: ' + String(error && error.message || error) };
        }

        const startedAt = Date.now();
        const from = ${JSON.stringify(fromTime)};
        let observed = element.currentTime;

        while (Date.now() - startedAt < ${JSON.stringify(playbackTimeoutMs)}) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          observed = element.currentTime;
          if (element.error) break;
          if (observed > from + 0.25) break;
        }

        element.pause();

        return {
          ok: true,
          currentTime: observed,
          mediaError: element.error ? { code: element.error.code, message: element.error.message || '' } : null,
          paused: element.paused,
          readyState: element.readyState
        };
      })()
    `,
    'playback advance',
  );

  if (!result?.ok) {
    fail(result?.message || 'Unable to resume playback after seeking.');
  }

  return result;
}

async function runVideoSeekAssertions(client) {
  log(`Opening ${videoAddress}.`);
  await navigateToAddress(client, videoAddress);

  const probe = await waitForMediaReady(client, 'VIDEO', videoSelector);

  assertRenderUrlSource('VIDEO', probe.src, 'VIDEO');
  log(`VIDEO streams directly from ${probe.src}.`);

  assert(
    probe.hasMetadata && probe.readyState >= 1,
    `VIDEO metadata did not load (readyState ${probe.readyState}).`,
  );
  assert(
    probe.hasDuration && Number.isFinite(probe.duration) && probe.duration > 0,
    `VIDEO duration was not a finite positive number: ${probe.duration}`,
  );
  log(
    `VIDEO metadata loaded: readyState ${probe.readyState}, duration ${formatSeconds(
      probe.duration,
    )}s, ${probe.width}x${probe.height}.`,
  );

  await installErrorRecorder(client, videoSelector);
  await assertNoMediaErrors(client, videoSelector, 'before seeking');

  const beforeSeek = await evaluate(
    client,
    getMediaProbeExpression(videoSelector),
    'pre-seek buffered probe',
  );

  log(`Buffered before seeking: ${formatBufferedRanges(beforeSeek.buffered)}.`);

  const choice = chooseSeekTarget(beforeSeek.buffered, beforeSeek.duration);

  if (choice.target === null) {
    fail(
      `Could not prove an unbuffered seek: the file is buffered to ${formatSeconds(
        choice.bufferedEnd,
      )}s of ${formatSeconds(beforeSeek.duration)}s (${choice.reason}), so no target outside the ` +
        'buffered region exists. Re-run with a longer VIDEO fixture; this run proves nothing about seeking.',
    );
  }

  const target = choice.target;

  log(
    `Seeking to ${formatSeconds(target)}s ` +
      `(${((target / beforeSeek.duration) * 100).toFixed(1)}% of duration, ` +
      `${formatSeconds(target - choice.bufferedEnd)}s past the buffered end of ${formatSeconds(
        choice.bufferedEnd,
      )}s).`,
  );

  const seekResult = await seekAndAwaitSeeked(client, videoSelector, target);

  assert(
    !seekResult.timedOut,
    `VIDEO never fired a seeked event within ${seekTimeoutMs}ms (currentTime ${formatSeconds(
      seekResult.currentTime,
    )}s, readyState ${seekResult.readyState}).`,
  );
  assert(
    seekResult.mediaError === null,
    `VIDEO reported a media error while seeking: ${JSON.stringify(seekResult.mediaError)}`,
  );
  assert(
    Math.abs(seekResult.currentTime - target) <= seekToleranceSeconds,
    `VIDEO landed at ${formatSeconds(seekResult.currentTime)}s instead of the requested ${formatSeconds(
      target,
    )}s (tolerance ${seekToleranceSeconds}s).`,
  );
  assert(
    seekResult.currentTime > choice.bufferedEnd,
    `VIDEO snapped back to ${formatSeconds(seekResult.currentTime)}s, at or before the pre-seek buffered end of ${formatSeconds(
      choice.bufferedEnd,
    )}s.`,
  );

  log(
    `seeked fired at ${formatSeconds(seekResult.currentTime)}s; buffered after seeking: ${formatBufferedRanges(
      seekResult.buffered,
    )}.`,
  );

  const playback = await playAndAwaitAdvance(client, videoSelector, seekResult.currentTime);

  assert(
    playback.mediaError === null,
    `VIDEO reported a media error during playback: ${JSON.stringify(playback.mediaError)}`,
  );
  assert(
    playback.currentTime > seekResult.currentTime + 0.25,
    `VIDEO did not advance from ${formatSeconds(seekResult.currentTime)}s after play() (reached ${formatSeconds(
      playback.currentTime,
    )}s within ${playbackTimeoutMs}ms).`,
  );

  log(
    `Playback advanced from ${formatSeconds(seekResult.currentTime)}s to ${formatSeconds(
      playback.currentTime,
    )}s after the seek.`,
  );

  await assertNoMediaErrors(client, videoSelector, 'after seeking and playback');

  // The playback assertion deliberately leaves the video running. Navigating away
  // from a still-playing element raced the next page's CDP evaluation and showed up
  // as an intermittent "Promise was collected" failure, so stop it before moving on.
  await evaluate(
    client,
    `(() => {
      const element = document.querySelector(${JSON.stringify(videoSelector)});
      if (element) {
        element.pause();
      }
      return true;
    })()`,
    'pause VIDEO before navigating away',
  );
}

// Secondary check only. The AUDIO fixture is a few kilobytes, so it can be
// fully buffered on the first request; it can show that Core advertises ranges
// and that metadata loads, but it does NOT prove seeking.
async function runAudioMetadataCheck(client) {
  log(`Opening ${audioAddress} (secondary metadata/Accept-Ranges check; does not prove seeking).`);
  await navigateToAddress(client, audioAddress);

  const probe = await waitForMediaReady(client, 'AUDIO', audioSelector);

  assertRenderUrlSource('AUDIO', probe.src, 'AUDIO');
  assert(
    probe.hasMetadata && probe.hasDuration,
    `AUDIO metadata did not load (readyState ${probe.readyState}, duration ${probe.duration}).`,
  );

  const response = await fetch(probe.src, { headers: { Range: 'bytes=0-127' } });
  await response.arrayBuffer();
  const acceptRanges = response.headers.get('accept-ranges') ?? '';

  assert(
    response.status === 206,
    `AUDIO render URL did not answer a byte range with HTTP 206 (got ${response.status}).`,
  );
  assert(
    acceptRanges.toLowerCase().includes('bytes'),
    `AUDIO render URL did not advertise Accept-Ranges: bytes (got "${acceptRanges}").`,
  );

  log(
    `AUDIO loaded from ${probe.src} (duration ${formatSeconds(
      probe.duration,
    )}s) and Core answered a range request with HTTP 206.`,
  );
}

async function runSmoke({ electronBin, viteBin }) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-desktop-qdn-media-seek-'));
  const userDataDir = path.join(tempRoot, 'user-data');
  let viteProcess = null;
  let electronProcess = null;

  const cdpPort = await getFreePort();
  const vitePort = await getFreePort();
  const devServerUrl = `http://127.0.0.1:${vitePort}`;
  const smokeEnv = {
    ...process.env,
    QORTIUM_HOME_NODE_API_KEY_PATH: nodeApiKeyPath,
    QORTIUM_HOME_NODE_API_URL: nodeApiUrl,
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

    const electronLaunch = getDisplayLaunch(electronBin, [
      `--remote-debugging-port=${cdpPort}`,
      '--autoplay-policy=no-user-gesture-required',
      '.',
    ]);

    log(`Starting Electron with CDP on 127.0.0.1:${cdpPort}.`);
    electronProcess = createManagedProcess(electronLaunch.command, electronLaunch.args, {
      env: smokeEnv,
    });

    const mainTarget = await getPageTarget(
      cdpPort,
      (url) => url.startsWith(devServerUrl),
      'Electron main page target',
    );
    const mainClient = new CdpClient(mainTarget.webSocketDebuggerUrl);

    try {
      await mainClient.send('Runtime.enable');
      await runVideoSeekAssertions(mainClient);

      if (skipAudioCheck) {
        log('Skipping the secondary AUDIO check.');
      } else {
        await runAudioMetadataCheck(mainClient);
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
  const electronBin = getBin('electron');
  const viteBin = getBin('vite');

  assertTool(electronBin, 'electron');
  assertTool(viteBin, 'vite');
  assertTool(nodeApiKeyPath, 'local node API key (set QORTIUM_HOME_NODE_API_KEY_PATH)');

  await assertLocalCoreReady();
  await assertFixturesReady();
  await reportVideoFixtureSize();

  log('Building Electron main process.');
  await run(npm, ['run', 'build:electron']);

  await runSmoke({ electronBin, viteBin });
  log('Desktop QDN media seek smoke test passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
