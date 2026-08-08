#!/usr/bin/env node

import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedPaths = [
  path.join(repoRoot, 'dist-v2-fixture'),
  path.join(repoRoot, 'dist-electron-v2'),
  path.join(repoRoot, 'dist-release-v2-fixture'),
  path.join(repoRoot, '.v2-fixture-package'),
];

for (const generatedPath of generatedPaths) {
  await rm(generatedPath, { force: true, recursive: true });
}
