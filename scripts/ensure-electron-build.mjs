// Builds dist-electron only when the Electron sources have changed.
//
// Fourteen test scripts need the compiled Electron output, and each used to run
// build:electron itself, so a full suite invoked tsc fourteen times. This keeps
// every script independently runnable — it just skips the compile when the
// existing output is already current.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = path.join(repoRoot, 'electron');
const buildInfo = path.join(repoRoot, 'dist-electron', '.tsbuildinfo');
const SOURCE_FILE = /\.(ts|cts|json)$/;

function newestSourceTime() {
  let newest = 0;

  for (const entry of readdirSync(sourceDirectory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !SOURCE_FILE.test(entry.name)) {
      continue;
    }

    const modified = statSync(path.join(entry.parentPath ?? sourceDirectory, entry.name)).mtimeMs;
    if (modified > newest) {
      newest = modified;
    }
  }

  return newest;
}

function builtAt() {
  try {
    return statSync(buildInfo).mtimeMs;
  } catch {
    return 0;
  }
}

if (builtAt() >= newestSourceTime() && builtAt() > 0) {
  process.exit(0);
}

const result = spawnSync('npm', ['run', '--silent', 'build:electron'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
