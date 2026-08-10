#!/usr/bin/env node

import { extractFile, listPackage } from '@electron/asar';
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootPackage = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const outputDir = path.join(repoRoot, 'dist-release-v2-live');
const artifactPath = path.join(
  outputDir,
  `Qortium-Home-2-Live-Preview-${rootPackage.version}-x86_64.AppImage`,
);
const asarPath = path.join(outputDir, 'linux-unpacked', 'resources', 'app.asar');
const executablePath = path.join(
  outputDir,
  'linux-unpacked',
  'qortium-home-2-live-preview',
);

if (!process.argv.includes('--dir')) {
  await access(artifactPath);
  const artifactStat = await stat(artifactPath);
  if ((artifactStat.mode & 0o111) === 0) {
    throw new Error('Home v2 live AppImage is not executable.');
  }
}

const fuseWire = await getCurrentFuseWire(executablePath);
if (fuseWire[FuseV1Options.RunAsNode] !== 48) {
  throw new Error('Home v2 live binary unexpectedly permits ELECTRON_RUN_AS_NODE.');
}
if (fuseWire[FuseV1Options.OnlyLoadAppFromAsar] !== 49) {
  throw new Error('Home v2 live binary is not restricted to app.asar.');
}

const entries = listPackage(asarPath);
for (const requiredEntry of [
  '/dist/v2-live.html',
  '/dist-electron/home-v2-live-preload.cjs',
  '/dist-electron/home-v2-node-bridge.js',
  '/dist-electron/home-v2-app-bridge.js',
  '/dist-electron/home-v2-qdn-app-preload.cjs',
  '/dist-electron/v2-live-main.js',
  '/package.json',
]) {
  if (!entries.includes(requiredEntry)) {
    throw new Error(`Home v2 live archive is missing ${requiredEntry}.`);
  }
}
if (entries.includes('/dist/index.html')) {
  throw new Error('Home v2 live archive unexpectedly contains the Home 1.x renderer.');
}

const packagedManifest = JSON.parse(
  extractFile(asarPath, 'package.json').toString('utf8'),
);
if (packagedManifest.main !== 'dist-electron/v2-live-main.js') {
  throw new Error('Home v2 live package points to the wrong Electron main entry.');
}

const liveHtml = extractFile(asarPath, 'dist/v2-live.html').toString('utf8');
if (!liveHtml.includes("connect-src 'none'")) {
  throw new Error('Home v2 live renderer does not deny direct outbound connections.');
}
if (!liveHtml.includes('renderer loading failure')) {
  throw new Error('Home v2 live renderer boot fallback is missing.');
}

const rendererEntry = entries.find((entry) =>
  /^\/dist\/assets\/v2-live-[A-Za-z0-9_-]+\.js$/.test(entry),
);
if (!rendererEntry) throw new Error('Home v2 live renderer script is missing.');
const rendererSource = extractFile(asarPath, rendererEntry.slice(1)).toString('utf8');
for (const forbidden of [
  'window.qortiumHome',
  'XMLHttpRequest',
  'WebSocket',
  'privateKey',
  'seedPhrase',
]) {
  if (rendererSource.includes(forbidden)) {
    throw new Error(`Home v2 live renderer contains forbidden capability ${forbidden}.`);
  }
}

const preloadSource = extractFile(
  asarPath,
  'dist-electron/home-v2-live-preload.cjs',
).toString('utf8');
for (const requiredChannel of [
  'home-v2-nodes:getSnapshot',
  'home-v2-nodes:setMode',
  'home-v2-nodes:setCustomUrl',
  'home-v2-nodes:readIdentity',
  'home-v2-nodes:readAvatar',
  'home-v2-accounts:list',
  'home-v2-shell:getState',
  'home-v2-shell:saveState',
  'qdn-views:show',
]) {
  if (!preloadSource.includes(requiredChannel)) {
    throw new Error(`Home v2 live preload is missing ${requiredChannel}.`);
  }
}
for (const forbiddenChannel of [
  "invoke('accounts:",
  'qdn:',
  'core:',
  'updates:',
]) {
  if (preloadSource.includes(forbiddenChannel)) {
    throw new Error(`Home v2 live preload exposes forbidden channel ${forbiddenChannel}.`);
  }
}

console.log(
  `Verified Home v2 live preview artifact (${entries.length} archive entries, v2-only renderer and scoped preload).`,
);
