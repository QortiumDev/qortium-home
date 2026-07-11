import { strict as assert } from 'node:assert';
import { compareAppPlatformVersions, getPlatformVersion } from './app-versioning.js';

assert.equal(getPlatformVersion('1.4.2-preview.1'), '1.4');
assert.equal(compareAppPlatformVersions('1.4.348', '1.6.0'), -1);
assert.equal(compareAppPlatformVersions('1.10.0', '1.9.99'), 1);
assert.equal(compareAppPlatformVersions('1.5.0', '1.4.2'), 1);
assert.equal(compareAppPlatformVersions('1.4.348', '1.4.0'), 0);
assert.equal(compareAppPlatformVersions('invalid', '1.4.2'), null);

console.log('app versioning tests passed');
