import assert from 'node:assert/strict';
import {
  getHomeSettingsMetadata,
  validateHomeSettingsPatch,
} from './home-settings-bridge.js';

const metadata = getHomeSettingsMetadata();
assert.deepEqual(metadata.map((setting) => setting.key), [
  'theme', 'accent', 'language', 'textSize', 'appZoom', 'ui', 'appNotifications',
]);
assert.deepEqual(metadata.find((setting) => setting.key === 'theme')?.allowedValues, ['system', 'light', 'dark']);
assert.deepEqual(metadata.find((setting) => setting.key === 'appZoom'), {
  key: 'appZoom', type: 'number', min: 50, max: 200, default: 100,
});

assert.deepEqual(validateHomeSettingsPatch({ theme: 'dark', appNotifications: false, appZoom: 125 }), {
  theme: 'dark', appNotifications: false, appZoom: 125,
});
assert.throws(() => validateHomeSettingsPatch({ nodeApiUrl: 'http://example.invalid' }), /not writable/);
assert.throws(() => validateHomeSettingsPatch({ theme: 'neon' }), /must be a valid string/);
assert.throws(() => validateHomeSettingsPatch({ appZoom: 49 }), /between 50 and 200/);
assert.throws(() => validateHomeSettingsPatch({ appZoom: 201 }), /between 50 and 200/);
assert.throws(() => validateHomeSettingsPatch({ appZoom: 99.5 }), /between 50 and 200/);

console.log('Home settings bridge tests passed.');
