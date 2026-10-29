import assert from 'node:assert/strict';
import { spawnSync, type StdioOptions } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdtempSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RELAUNCH_TRAMPOLINE, RELAUNCH_TRAMPOLINE_SHELL } from './app-update-install-kind.js';

// /proc descriptor enumeration and AppImage relaunch are Linux-only.
if (process.platform !== 'linux') {
  console.log('AppImage relaunch tests skipped outside Linux.');
} else {
  const root = mkdtempSync(path.join(os.tmpdir(), 'home-update-relaunch-'));
  const directory = path.join(root, 'updates with spaces "quotes" and $symbols');
  mkdirSync(directory);
  const descriptorFile = path.join(root, 'inherited-descriptor');
  const descriptor = openSync(descriptorFile, 'w+');
  const markers = ['SEMICOLON_MARKER', 'SUBSTITUTION_MARKER', 'BACKTICK_MARKER', 'ARG_MARKER'];
  const filenames = [
    'Home.AppImage',
    'Home with spaces.AppImage',
    'Home "double" and \'single\'.AppImage',
    'Home; touch SEMICOLON_MARKER; #.AppImage',
    'Home$(touch SUBSTITUTION_MARKER).AppImage',
    'Home`touch BACKTICK_MARKER`.AppImage',
    'Home\nsecond line * ? [abc] $HOME.AppImage',
  ];
  const args = [
    '--no-sandbox', '', 'two words', '"double" and \'single\'',
    '$(touch ARG_MARKER)', '`touch ARG_MARKER`', '; touch ARG_MARKER',
    'line\nbreak', '*', '$HOME',
  ];
  // A harmless executable records exactly what exec received. A high inherited
  // fd catches replacing Bash with dash (which cannot close descriptors > 9),
  // or accidentally deleting the cleanup and pinning the old AppImage mount.
  const executableSource = `#!${process.execPath}
const fs = require('node:fs');
let descriptorTarget = null;
try { descriptorTarget = fs.readlinkSync('/proc/self/fd/40'); } catch {}
process.stdout.write(JSON.stringify({ file: process.argv[1], args: process.argv.slice(2), descriptorTarget }));
`;
  let launches = 0;
  try {
    for (const filename of filenames) {
      const executable = path.join(directory, filename);
      writeFileSync(executable, executableSource);
      chmodSync(executable, 0o700);
      // Match the updater's two launch forms. The Bash branch uses the exact
      // production script; the direct branch is the no-Bash fallback/control.
      for (const mode of ['trampoline', 'direct'] as const) {
        if (mode === 'trampoline' && !existsSync(RELAUNCH_TRAMPOLINE_SHELL)) continue;
        const stdio: StdioOptions = Array(41).fill('ignore');
        stdio[1] = 'pipe';
        stdio[2] = 'pipe';
        stdio[40] = descriptor;
        const child = spawnSync(
          mode === 'trampoline' ? RELAUNCH_TRAMPOLINE_SHELL : executable,
          mode === 'trampoline' ? ['-c', RELAUNCH_TRAMPOLINE, executable, ...args] : args,
          { cwd: root, stdio, timeout: 10_000, encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } },
        );
        assert.ifError(child.error);
        assert.equal(child.status, 0, `${mode}: ${filename}: ${child.stderr}`);
        const actual = JSON.parse(String(child.stdout));
        assert.equal(actual.file, executable, `${mode}: executable path must remain literal`);
        assert.deepEqual(actual.args, args, `${mode}: argument boundaries must survive unchanged`);
        assert.equal(actual.descriptorTarget, mode === 'direct' ? descriptorFile : null);
        for (const marker of markers) {
          assert.equal(existsSync(path.join(root, marker)), false, `${mode}: executed ${marker}`);
        }
        launches++;
      }
    }
    console.log(`AppImage relaunch regression tests passed (${launches} launches).`);
  } finally {
    closeSync(descriptor);
    rmSync(root, { recursive: true, force: true });
  }
}
