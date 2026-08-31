#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findForbiddenProductionEntry } from './packaged-entry-policy.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedVersion = '2.1.0';
// versionCode is ONE monotonic space shared by both release lines, so 2.1 does
// not get to pick freely:
//   37  Home 1.7.0
//   38, 39  spent by the 2.x line during development
//   40  Home 1.7.1, the published emergency APK from maint/home-1.x
//   41  Home 1.8.0, the final 1.x release, which exists so 1.x users can
//       decline 2.1.0 instead of being pulled onto it
// 2.1.0 must therefore sit ABOVE 41, or Android refuses to install it over
// 1.8.0 as a downgrade -- breaking the 1.x -> 2.x path both releases exist to
// enable. The in-app updater compares semver and would still offer it; the OS
// installer is what rejects it, so the failure surfaces late and reads like a
// packaging bug.
const expectedAndroidVersionCode = 42;
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
assert.equal(
  packageJson.build?.mac?.x64ArchFiles,
  'Contents/Resources/native/macos/{x64,arm64}/qortium-core-observer',
  'universal macOS builds must preserve both prebuilt architecture-specific Core observers',
);
assert.ok(
  packageJson.build?.files?.includes('!**/node_modules/**/android/build/**'),
  'desktop packages must exclude generated Android dependency build output',
);
assert.equal(
  findForbiddenProductionEntry([
    '/node_modules/example/node_modules/@capacitor-community/safe-area/android/build/.transforms/results.bin',
  ]),
  '/node_modules/example/node_modules/@capacitor-community/safe-area/android/build/.transforms/results.bin',
  'the package checker must reject generated Android dependency build output at any dependency depth',
);
assert.equal(
  findForbiddenProductionEntry([
    '/node_modules/@capacitor-community/safe-area/android/src/main/AndroidManifest.xml',
  ]),
  undefined,
  'the package checker must retain required Android dependency sources',
);
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
