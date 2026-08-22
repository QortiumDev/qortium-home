import assert from 'node:assert/strict';
import { selectCompatibleUpdateAsset, type AppUpdateAssetPlatform } from './app-update-assets';

const assets = [
  { name: 'Qortium-Home-1.5.1-macos1015-x64.dmg' },
  { name: 'Qortium-Home-1.5.1-macos11-universal.dmg' },
  { name: 'Qortium-Home-1.5.1-universal.dmg' },
  { name: 'Qortium-Home-1.5.1-x86_64.AppImage' },
  { name: 'Qortium-Home-1.5.1-x64.exe' },
];

function macPlatform(arch: 'arm64' | 'x64', osVersion?: string): AppUpdateAssetPlatform {
  return { arch, os: 'macos', osVersion };
}

assert.equal(
  selectCompatibleUpdateAsset(assets, macPlatform('x64', '12.7.6'))?.name,
  'Qortium-Home-1.5.1-universal.dmg',
);
assert.equal(
  selectCompatibleUpdateAsset(assets, macPlatform('arm64', '26.5'))?.name,
  'Qortium-Home-1.5.1-universal.dmg',
);
assert.equal(
  selectCompatibleUpdateAsset(assets, macPlatform('x64', '11.7.10'))?.name,
  'Qortium-Home-1.5.1-macos11-universal.dmg',
);
assert.equal(
  selectCompatibleUpdateAsset(assets, macPlatform('arm64', '11.0'))?.name,
  'Qortium-Home-1.5.1-macos11-universal.dmg',
);
assert.equal(
  selectCompatibleUpdateAsset(assets, macPlatform('x64', '10.15.7'))?.name,
  'Qortium-Home-1.5.1-macos1015-x64.dmg',
);
assert.equal(selectCompatibleUpdateAsset(assets, macPlatform('arm64', '10.15.7')), null);
assert.equal(selectCompatibleUpdateAsset(assets, macPlatform('x64', '10.14.6')), null);

// When browser-mode fallback cannot determine the OS version, choose the
// current universal build instead of guessing that a legacy runtime is needed.
assert.equal(
  selectCompatibleUpdateAsset(assets, macPlatform('x64'))?.name,
  'Qortium-Home-1.5.1-universal.dmg',
);
assert.equal(
  selectCompatibleUpdateAsset(assets, macPlatform('x64', 'not-a-version'))?.name,
  'Qortium-Home-1.5.1-universal.dmg',
);

assert.equal(
  selectCompatibleUpdateAsset(assets, { arch: 'x64', os: 'linux' })?.name,
  'Qortium-Home-1.5.1-x86_64.AppImage',
);
assert.equal(
  selectCompatibleUpdateAsset(assets, { arch: 'x64', os: 'windows' })?.name,
  'Qortium-Home-1.5.1-x64.exe',
);

const androidAssets = [
  { name: 'Qortium-Home-2.1.0-unsigned.apk' },
  { name: 'Qortium-Home-2.1.0.aab' },
  { name: 'Qortium-Home-2.1.0.apk.sig' },
  { name: 'Qortium-Home-2.1.0.apk' },
  { name: 'Qortium-Home-2.1.0-android-release.apk' },
];
assert.equal(
  selectCompatibleUpdateAsset(androidAssets, { arch: 'arm64', os: 'android' })?.name,
  'Qortium-Home-2.1.0-android-release.apk',
);
assert.equal(
  selectCompatibleUpdateAsset(androidAssets.slice(0, 4), { arch: 'arm64', os: 'android' })?.name,
  'Qortium-Home-2.1.0.apk',
);

console.log('Home macOS update asset selection fixtures passed.');
