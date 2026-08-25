import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertHomeV2ShellClipboardText,
  HOME_V2_SHELL_CLIPBOARD_MAX_LENGTH,
} from './home-v2-shell-clipboard.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), 'utf8');

// --- the rule main enforces --------------------------------------------------

assert.equal(assertHomeV2ShellClipboardText('QORTIUM-address'), 'QORTIUM-address');
assert.equal(
  assertHomeV2ShellClipboardText('x'.repeat(HOME_V2_SHELL_CLIPBOARD_MAX_LENGTH)),
  'x'.repeat(HOME_V2_SHELL_CLIPBOARD_MAX_LENGTH),
);

// An empty write is not a copy, and the cap keeps a renderer from pushing a
// document-sized string through a channel meant for an address or a name.
for (const rejected of [
  '',
  'x'.repeat(HOME_V2_SHELL_CLIPBOARD_MAX_LENGTH + 1),
  null,
  undefined,
  42,
  { toString: () => 'address' },
  ['address'],
]) {
  assert.throws(
    () => assertHomeV2ShellClipboardText(rejected),
    /Clipboard text must be a short string\./,
    `${String(rejected)} must not reach the system clipboard`,
  );
}

// --- source pins -------------------------------------------------------------

const mainSource = read('electron/main.ts');

// The shell session denies every permission, so this channel is the only way
// the shell can copy. It must stay narrow: authorized senders only, validated
// text only, and write-only.
const handlerStart = mainSource.indexOf("ipcMain.handle('home-v2-shell:copy-text'");
assert.notEqual(handlerStart, -1, "main.ts must register 'home-v2-shell:copy-text'");
const handlerBody = mainSource.slice(handlerStart, mainSource.indexOf('});', handlerStart));
assert.match(
  handlerBody,
  /assertAuthorizedHomeV2Sender\(event\)/,
  'the clipboard channel must reject senders that are not the trusted Home shell',
);
assert.match(
  handlerBody,
  /assertHomeV2ShellClipboardText\(value\)/,
  'the clipboard channel must validate the text through the shared rule (type, non-empty, length cap)',
);
assert.match(
  handlerBody,
  /clipboard\.writeText\(/,
  'the clipboard channel must write through Electron clipboard.writeText',
);
assert.ok(
  !/clipboard\.readText\(/.test(handlerBody),
  'the shell clipboard bridge is write-only; reading the clipboard is not exposed',
);

// The session denial this whole fix exists for. If it were ever relaxed the
// bridge would be redundant, so pin that it is still in place.
assert.match(
  mainSource,
  /homeV2Session\.setPermissionRequestHandler\(\(_webContents, _permission, callback\) => callback\(false\)\)/,
  'the Home shell session must keep denying every permission request',
);

const preloadSource = read('electron/home-v2-live-preload.cts');
assert.match(
  preloadSource,
  /exposeInMainWorld\('homeV2Clipboard'/,
  'the shell preload must expose the clipboard bridge',
);
assert.match(
  preloadSource,
  /ipcRenderer\.invoke\('home-v2-shell:copy-text'/,
  'the clipboard bridge must invoke the main handler',
);

// The renderer helper is the single call site for all three shell copy menus,
// so the order it tries things in is what makes the desktop copy work at all.
const helperSource = read('src/contextMenuClipboard.ts');
const bridgeAt = helperSource.indexOf('homeV2Clipboard');
const navigatorAt = helperSource.indexOf('navigator.clipboard');
const fallbackAt = helperSource.indexOf("createElement('textarea')");
assert.notEqual(bridgeAt, -1, 'the copy helper must prefer the main-process bridge');
assert.notEqual(navigatorAt, -1, 'the copy helper must keep the navigator path for Android');
assert.notEqual(fallbackAt, -1, 'the copy helper must keep the execCommand fallback');
assert.ok(
  bridgeAt < navigatorAt && navigatorAt < fallbackAt,
  'bridge first, then navigator.clipboard, then the selection fallback',
);
// Without the catch, a rejected navigator.clipboard.writeText escapes the
// function and the fallback below it is dead code.
assert.match(
  helperSource,
  /await navigator\.clipboard\.writeText\(value\)[\s\S]{0,80}\} catch \{/,
  'the navigator.clipboard attempt must be wrapped so the fallback stays reachable',
);

console.log('home-v2-shell-clipboard tests passed');
