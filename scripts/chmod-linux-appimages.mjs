#!/usr/bin/env node

import { chmod, readdir, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const distReleasePath = path.join(repoRoot, 'dist-release');
const expectedPrefix = `Qortium-Home-${packageJson.version}-`;

function formatMode(mode) {
  return (mode & 0o777).toString(8).padStart(3, '0');
}

async function main() {
  const entries = await readdir(distReleasePath, { withFileTypes: true });
  const appImages = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(expectedPrefix) && entry.name.endsWith('.AppImage'))
    .map((entry) => path.join(distReleasePath, entry.name))
    .sort();

  if (appImages.length === 0) {
    throw new Error(`No current AppImage artifacts found in ${path.relative(repoRoot, distReleasePath)}.`);
  }

  for (const appImagePath of appImages) {
    await chmod(appImagePath, 0o755);
    const fileStat = await stat(appImagePath);
    console.log(`Set executable mode ${formatMode(fileStat.mode)} on ${path.relative(repoRoot, appImagePath)}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
