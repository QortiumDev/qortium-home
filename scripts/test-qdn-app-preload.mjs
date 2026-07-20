#!/usr/bin/env node

// Verifies the built QDN app preload actually works inside a sandboxed
// BrowserWindow (see scripts/test-qdn-app-preload-main.cjs for what runs).
// Requires dist-electron to be built first (npm run test:qdn-app-preload
// wires that up).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const timeoutMs = 120_000;

function log(message) {
  console.log(`[qdn-app-preload-test] ${message}`);
}

function getBin(name) {
  const extension = process.platform === 'win32' ? '.cmd' : '';

  return path.join(repoRoot, 'node_modules', '.bin', `${name}${extension}`);
}

const electronBin = process.env.QORTIUM_HOME_ELECTRON_BIN?.trim() || getBin('electron');

if (!existsSync(electronBin)) {
  console.error(`[qdn-app-preload-test] electron was not found at ${electronBin}. Run npm install first.`);
  process.exit(1);
}

for (const artifact of ['qdn-app-preload.cjs', 'qdn-bridge-error.js']) {
  if (!existsSync(path.join(repoRoot, 'dist-electron', artifact))) {
    console.error(`[qdn-app-preload-test] dist-electron/${artifact} is missing. Run npm run build:electron first.`);
    process.exit(1);
  }
}

const mainScript = path.join(__dirname, 'test-qdn-app-preload-main.cjs');
const useXvfb = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
const command = useXvfb ? 'xvfb-run' : electronBin;
const args = useXvfb ? ['-a', electronBin, mainScript] : [mainScript];

log(`launching electron${useXvfb ? ' under xvfb-run' : ''}`);

const child = spawn(command, args, { cwd: repoRoot, stdio: 'inherit' });
const timer = setTimeout(() => {
  console.error(`[qdn-app-preload-test] timed out after ${timeoutMs}ms`);
  child.kill('SIGKILL');
}, timeoutMs);

child.on('exit', (code, signal) => {
  clearTimeout(timer);

  if (code === 0) {
    log('PASS');
    process.exit(0);
  }

  console.error(`[qdn-app-preload-test] FAIL (exit ${code ?? `signal ${signal}`})`);
  process.exit(code ?? 1);
});
