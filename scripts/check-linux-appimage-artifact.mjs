#!/usr/bin/env node

import { extractFile, listPackage } from '@electron/asar';
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootPackage = JSON.parse(
  await readFile(path.join(repoRoot, 'package.json'), 'utf8'),
);
const archArgument = process.argv.find((argument) => argument.startsWith('--arch='));
const arch = archArgument?.slice('--arch='.length) ?? process.arch;

if (!['x64', 'arm64'].includes(arch)) {
  throw new Error(`Unsupported Linux AppImage architecture: ${arch}`);
}

const unpackedDirectory = arch === 'x64' ? 'linux-unpacked' : 'linux-arm64-unpacked';
const artifactArchitecture = arch === 'x64' ? 'x86_64' : 'arm64';
const artifactPath = path.join(
  repoRoot,
  'dist-release',
  `Qortium-Home-${rootPackage.version}-${artifactArchitecture}.AppImage`,
);
const executablePath = path.join(
  repoRoot,
  'dist-release',
  unpackedDirectory,
  'qortium-home',
);
const asarPath = path.join(
  repoRoot,
  'dist-release',
  unpackedDirectory,
  'resources',
  'app.asar',
);

await access(artifactPath);
await access(executablePath);
await access(asarPath);

const artifactStat = await stat(artifactPath);
if ((artifactStat.mode & 0o111) === 0) {
  throw new Error('Production AppImage is not executable.');
}

const fuseWire = await getCurrentFuseWire(executablePath);
for (const [name, expected] of [
  [FuseV1Options.RunAsNode, 48],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, 48],
  [FuseV1Options.EnableNodeCliInspectArguments, 48],
  [FuseV1Options.OnlyLoadAppFromAsar, 49],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, 49],
]) {
  if (fuseWire[name] !== expected) {
    throw new Error(`Production Electron fuse ${name} has unsafe value ${fuseWire[name]}.`);
  }
}

const entries = listPackage(asarPath);
const packagedManifest = JSON.parse(
  extractFile(asarPath, 'package.json').toString('utf8'),
);

if (packagedManifest.name !== rootPackage.name) {
  throw new Error('Production archive contains the wrong package name.');
}
if (packagedManifest.version !== rootPackage.version) {
  throw new Error('Production archive contains the wrong package version.');
}
if (packagedManifest.type !== 'module') {
  throw new Error('Production package must run its Electron entry as an ES module.');
}
if (packagedManifest.main !== 'dist-electron/home-v2-main.js') {
  throw new Error('Production package points to the wrong Electron main entry.');
}

for (const requiredEntry of [
  '/dist/v2-live.html',
  '/dist-electron/home-v2-main.js',
  '/dist-electron/home-v2-live-preload.cjs',
  '/dist-electron/home-v2-qdn-app-preload.cjs',
  '/package.json',
]) {
  if (!entries.includes(requiredEntry)) {
    throw new Error(`Production archive is missing ${requiredEntry}.`);
  }
}

const forbiddenEntry = entries.find((entry) =>
  entry === '/dist/index.html' ||
  entry === '/dist-electron/v2-fixture-main.js' ||
  entry === '/dist-electron/.tsbuildinfo' ||
  /^\/dist-electron\/.*\.test\.js$/.test(entry),
);
if (forbiddenEntry) {
  throw new Error(`Production archive contains forbidden content: ${forbiddenEntry}`);
}

console.log(
  `Verified hardened Home ${rootPackage.version} ${arch} AppImage (${entries.length} ASAR entries).`,
);
