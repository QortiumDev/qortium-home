#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedVersion = '2.1.0';
const expectedAndroidVersionCode = 39;
const expectedPlatformVersion = '2.1';

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
const androidGradle = read('android/app/build.gradle');

assert.equal(packageJson.version, expectedVersion, 'package.json version must match the Home release');
assert.equal(packageLock.version, expectedVersion, 'package-lock.json version must match package.json');
assert.equal(packageLock.packages?.['']?.version, expectedVersion, 'lockfile root version must match package.json');
assert.match(
  androidGradle,
  new RegExp(`\\bversionCode\\s+${expectedAndroidVersionCode}\\b`),
  'Android versionCode must advance with the Home release',
);
assert.match(
  androidGradle,
  new RegExp(`\\bversionName\\s+"${expectedVersion.replaceAll('.', '\\.')}"`),
  'Android versionName must match package.json',
);

for (const relativePath of [
  'electron/home-v2-app-bridge.ts',
  'src/home-v2-live/node-client.ts',
]) {
  assert.match(
    read(relativePath),
    new RegExp(`platformVersion:\\s*['"]${expectedPlatformVersion.replaceAll('.', '\\.')}['"]`),
    `${relativePath} must advertise the planned QAVS platform version`,
  );
}

for (const retiredPath of ['vite.config.ts', 'src/main.tsx', 'src/App.tsx']) {
  assert.equal(existsSync(path.join(repoRoot, retiredPath)), false, `${retiredPath} is a retired v1 renderer entry`);
}

const developmentIndex = read('index.html');
assert.equal(developmentIndex.includes('/src/main.tsx'), false, 'development index must not restore the v1 renderer');
assert.equal(developmentIndex.includes('/v2-live.html'), true, 'development index must direct harnesses to Home 2');

console.log(
  `Release metadata is consistent: Home ${expectedVersion}, Android ${expectedAndroidVersionCode}, QAVS ${expectedPlatformVersion}.`,
);
