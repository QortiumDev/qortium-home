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
const version = rootPackage.version;
const artifactPath = path.join(
  repoRoot,
  'dist-release-v2-fixture',
  `Qortium-Home-2-Preview-${version}-x86_64.AppImage`,
);
const asarPath = path.join(
  repoRoot,
  'dist-release-v2-fixture',
  'linux-unpacked',
  'resources',
  'app.asar',
);
const executablePath = path.join(
  repoRoot,
  'dist-release-v2-fixture',
  'linux-unpacked',
  'qortium-home-2-preview',
);

await access(artifactPath);
const artifactStat = await stat(artifactPath);
if ((artifactStat.mode & 0o111) === 0) {
  throw new Error('Home v2 fixture AppImage is not executable.');
}

const fuseWire = await getCurrentFuseWire(executablePath);
if (fuseWire[FuseV1Options.RunAsNode] !== 48) {
  throw new Error('Fixture binary unexpectedly permits ELECTRON_RUN_AS_NODE.');
}
if (fuseWire[FuseV1Options.OnlyLoadAppFromAsar] !== 49) {
  throw new Error('Fixture binary is not restricted to app.asar.');
}
if (fuseWire[FuseV1Options.GrantFileProtocolExtraPrivileges] !== 49) {
  throw new Error('Fixture binary cannot load its packaged file assets.');
}

const entries = listPackage(asarPath);
const allowedEntry = /^\/(?:LICENSE|package\.json|dist|dist\/v2-fixture\.html|dist\/assets|dist\/assets\/v2-fixture-[A-Za-z0-9_-]+\.(?:css|js)|dist-electron|dist-electron\/v2-fixture-main\.js)$/;
const unexpectedEntry = entries.find((entry) => !allowedEntry.test(entry));
if (unexpectedEntry) {
  throw new Error(`Fixture archive contains unexpected content: ${unexpectedEntry}`);
}
const forbiddenEntry = entries.find((entry) =>
  entry === '/node_modules' ||
  entry.startsWith('/node_modules/') ||
  entry.startsWith('/electron/') ||
  entry === '/dist-electron/main.js' ||
  entry === '/dist/index.html',
);
if (forbiddenEntry) {
  throw new Error(`Fixture archive contains forbidden production content: ${forbiddenEntry}`);
}

const requiredEntries = [
  '/dist/v2-fixture.html',
  '/dist-electron/v2-fixture-main.js',
  '/LICENSE',
  '/package.json',
];
for (const requiredEntry of requiredEntries) {
  if (!entries.includes(requiredEntry)) {
    throw new Error(`Fixture archive is missing ${requiredEntry}.`);
  }
}

const packagedManifest = JSON.parse(
  extractFile(asarPath, 'package.json').toString('utf8'),
);
if (packagedManifest.type !== 'module') {
  throw new Error('Fixture package must run its Electron entry as an ES module.');
}
if (packagedManifest.dependencies || packagedManifest.devDependencies) {
  throw new Error('Fixture package unexpectedly declares dependencies.');
}
if (packagedManifest.main !== 'dist-electron/v2-fixture-main.js') {
  throw new Error('Fixture package points to the wrong Electron main entry.');
}

const fixtureHtml = extractFile(asarPath, 'dist/v2-fixture.html').toString('utf8');
if (!fixtureHtml.includes("connect-src 'none'")) {
  throw new Error('Fixture renderer does not deny outbound connections in CSP.');
}
if (!fixtureHtml.includes('renderer loading failure')) {
  throw new Error('Fixture renderer boot fallback is missing.');
}
const rendererScriptEntry = entries.find((entry) =>
  /^\/dist\/assets\/v2-fixture-[A-Za-z0-9_-]+\.js$/.test(entry),
);
if (!rendererScriptEntry) {
  throw new Error('Fixture renderer script is missing.');
}
const rendererScript = extractFile(
  asarPath,
  rendererScriptEntry.slice(1),
).toString('utf8');
for (const networkPrimitive of ['fetch(', 'XMLHttpRequest', 'WebSocket']) {
  if (rendererScript.includes(networkPrimitive)) {
    throw new Error(`Fixture renderer contains network primitive ${networkPrimitive}.`);
  }
}

console.log(
  `Verified isolated Home v2 fixture artifact (${entries.length} archive entries, no production modules).`,
);
