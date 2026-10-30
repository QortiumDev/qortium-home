import assert from 'node:assert/strict';
import { assertHomeReleasePlatforms, homeReleasePlatform, homeReleaseSupportsLegacyMac } from './lib/home-release-platforms.mjs';
const current = ['x86_64.AppImage', 'arm64.AppImage', 'x64.exe', 'universal.dmg', 'android-release.apk']
  .map((suffix) => ({ name: `Qortium-Home-2.1.0-beta.14-${suffix}` }));
assert.doesNotThrow(() => assertHomeReleasePlatforms('v2.1.0-beta.14', current));
const legacy = ['macos11-universal.dmg', 'macos1015-x64.dmg'].map((suffix) => ({ name: `Qortium-Home-2.1.0-beta.14-${suffix}` }));
assert.throws(() => assertHomeReleasePlatforms('v2.1.0-beta.14', [...current, ...legacy]), /requires exactly/);
assert.throws(() => assertHomeReleasePlatforms('v2.1.0-beta.14', current.slice(1)), /requires exactly/);
assert.throws(() => assertHomeReleasePlatforms('v2.1.0-beta.14', [...current.slice(1), current[1]]), /requires exactly/);
const previous = [...current, ...legacy].map(({ name }) => ({ name: name.replace('beta.14', 'beta.13') }));
assert.doesNotThrow(() => assertHomeReleasePlatforms('v2.1.0-beta.13', previous));
assert.equal(homeReleasePlatform(previous.at(-1).name), 'macos1015-x64');
for (const tag of ['1.8.0', '2.1.0-beta.1', 'v2.1.0-beta.13']) assert.equal(homeReleaseSupportsLegacyMac(tag), true);
for (const tag of ['2.1.0-beta.14', '2.1.0-beta.15', '2.1.0-rc.1', '2.1.0', '2.1.1', '2.2.0', '3.0.0']) assert.equal(homeReleaseSupportsLegacyMac(tag), false);
assert.throws(() => homeReleaseSupportsLegacyMac('broken'), /Invalid/);
console.log('Home release platform completeness and legacy retirement tests passed.');
