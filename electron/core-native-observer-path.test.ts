import assert from 'node:assert/strict';
import {
  resolveCoreNativeObserverPath,
  type CoreNativeObserverPathContext,
} from './core-native-observer-path.js';

function resolve(overrides: Partial<CoreNativeObserverPathContext> = {}) {
  return resolveCoreNativeObserverPath({
    appPath: '/Users/alice/qortium-home',
    arch: 'arm64',
    isPackaged: false,
    platform: 'darwin',
    resourcesPath: '/Applications/Qortium.app/Contents/Resources',
    ...overrides,
  });
}

assert.deepEqual(resolve(), {
  executablePath: '/Users/alice/qortium-home/.native-build/macos/arm64/qortium-core-observer',
  kind: 'resolved',
});
assert.deepEqual(resolve({ arch: 'x64', isPackaged: true }), {
  executablePath: '/Applications/Qortium.app/Contents/Resources/native/macos/x64/qortium-core-observer',
  kind: 'resolved',
});

const windows = {
  appPath: 'C:\\src\\qortium-home',
  arch: 'x64',
  platform: 'win32',
  resourcesPath: 'C:\\Program Files\\Qortium\\resources',
} as const;
assert.deepEqual(resolve({ ...windows, isPackaged: false }), {
  executablePath: 'C:\\src\\qortium-home\\.native-build\\windows\\x64\\qortium-core-observer.exe',
  kind: 'resolved',
});
assert.deepEqual(resolve({ ...windows, isPackaged: true }), {
  executablePath: 'C:\\Program Files\\Qortium\\resources\\native\\windows\\x64\\qortium-core-observer.exe',
  kind: 'resolved',
});

for (const overrides of [
  { platform: 'linux' as const },
  { arch: 'ia32' },
  { ...windows, arch: 'arm64' },
]) {
  assert.equal(resolve(overrides).kind, 'unknown');
}

for (const [field, invalidRoot] of [
  ['appPath', 'relative/app'],
  ['resourcesPath', 'relative/resources'],
  ['appPath', '/Users/alice/../bob/app'],
  ['resourcesPath', '/Applications/Qortium.app/Contents/Resources/'],
  ['appPath', '/Users/alice/app\0suffix'],
] as const) {
  assert.equal(resolve({ [field]: invalidRoot }).kind, 'unknown', `${field} must reject ${JSON.stringify(invalidRoot)}`);
}

for (const [field, invalidRoot] of [
  ['appPath', 'C:relative\\app'],
  ['resourcesPath', 'C:\\Program Files\\Qortium\\..\\Other\\resources'],
  ['appPath', 'C:/src/qortium-home'],
  ['resourcesPath', 'C:\\Program Files\\Qortium\\resources\\'],
  ['resourcesPath', 'C:\\resources\0suffix'],
] as const) {
  assert.equal(
    resolve({ ...windows, [field]: invalidRoot }).kind,
    'unknown',
    `Windows ${field} must reject ${JSON.stringify(invalidRoot)}`,
  );
}

assert.equal(
  resolve({ appPath: '/Users/alice/qortium-home/', isPackaged: true }).kind,
  'unknown',
  'the unused root is validated too, preventing packaging-state changes from activating ambiguous input',
);

assert.equal(
  resolve({ isPackaged: 'yes' as unknown as boolean }).kind,
  'unknown',
  'runtime callers cannot bypass packaging-state validation',
);

console.log('Core native observer path checks passed.');
