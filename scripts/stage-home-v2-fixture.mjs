#!/usr/bin/env node

import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rendererSource = path.join(repoRoot, 'dist-v2-fixture');
const electronSource = path.join(
  repoRoot,
  'dist-electron-v2',
  'v2-fixture-main.js',
);
const stageRoot = path.join(repoRoot, '.v2-fixture-package');

async function requirePath(targetPath, label) {
  try {
    await stat(targetPath);
  } catch {
    throw new Error(`${label} is missing. Run the complete v2 fixture build.`);
  }
}

await requirePath(
  path.join(rendererSource, 'v2-fixture.html'),
  'Home v2 renderer output',
);
await requirePath(electronSource, 'Home v2 Electron output');

const rootPackage = JSON.parse(
  await readFile(path.join(repoRoot, 'package.json'), 'utf8'),
);
const fixturePackage = {
  name: 'qortium-home-v2-preview',
  version: rootPackage.version,
  private: true,
  type: 'module',
  license: '0BSD',
  author: rootPackage.author,
  desktopName: 'Qortium Home 2 Preview',
  description: 'Disconnected Qortium Home 2 interface preview',
  main: 'dist-electron/v2-fixture-main.js',
};

await rm(stageRoot, { force: true, recursive: true });
await mkdir(path.join(stageRoot, 'dist-electron'), { recursive: true });
await cp(rendererSource, path.join(stageRoot, 'dist'), { recursive: true });
await cp(electronSource, path.join(stageRoot, fixturePackage.main));
await cp(path.join(repoRoot, 'LICENSE'), path.join(stageRoot, 'LICENSE'));
const builderConfig = JSON.parse(
  await readFile(path.join(repoRoot, 'electron-builder.v2-fixture.json'), 'utf8'),
);
const installedElectron = JSON.parse(
  await readFile(path.join(repoRoot, 'node_modules/electron/package.json'), 'utf8'),
);
builderConfig.electronVersion = installedElectron.version;
await writeFile(
  path.join(stageRoot, 'electron-builder.json'),
  `${JSON.stringify(builderConfig, null, 2)}\n`,
  'utf8',
);
await writeFile(
  path.join(stageRoot, 'package.json'),
  `${JSON.stringify(fixturePackage, null, 2)}\n`,
  'utf8',
);

console.log('Staged isolated Home v2 fixture package with no production dependencies.');
