import assert from 'node:assert/strict'
import {
  isApprovedQortiumTransportManagedTarget,
  isApprovedQortiumTransportRuntimePath,
} from './qortium-transport-runtime-authority.js'

const posixExpected = '/home/alice/.config/qortium-core/runtime'
assert.equal(isApprovedQortiumTransportRuntimePath(posixExpected, posixExpected, 'linux'), true)
for (const candidate of [
  '',
  '.',
  'runtime',
  '/home/alice/.config/qortium-core/runtime/../runtime',
  '/home/alice/.config/qortium-core/other',
  '/tmp/runtime',
  `${posixExpected}\0escape`,
]) {
  assert.equal(isApprovedQortiumTransportRuntimePath(candidate, posixExpected, 'linux'), false)
}
assert.equal(
  isApprovedQortiumTransportRuntimePath(posixExpected.toUpperCase(), posixExpected, 'linux'),
  false,
)

const windowsExpected = 'C:\\Users\\Alice\\AppData\\Roaming\\qortium-core\\runtime'
assert.equal(isApprovedQortiumTransportRuntimePath(windowsExpected, windowsExpected, 'win32'), true)
assert.equal(
  isApprovedQortiumTransportRuntimePath(windowsExpected.toLowerCase(), windowsExpected, 'win32'),
  true,
)
for (const candidate of [
  'runtime',
  'C:\\Users\\Alice\\AppData\\Roaming\\qortium-core\\other',
  'C:\\Users\\Alice\\AppData\\Roaming\\qortium-core\\runtime\\..\\runtime',
  '\\\\server\\share\\runtime',
]) {
  assert.equal(isApprovedQortiumTransportRuntimePath(candidate, windowsExpected, 'win32'), false)
}

const expectedTarget = {
  installPath: '/home/alice/.config/qortium-core/install',
  jarPath: '/home/alice/.config/qortium-core/install/qortium.jar',
  previewPath: '/home/alice/.config/qortium-core/install/preview',
  runtimePath: posixExpected,
}
assert.equal(isApprovedQortiumTransportManagedTarget(expectedTarget, expectedTarget, 'linux'), true)
for (const field of ['installPath', 'jarPath', 'previewPath', 'runtimePath'] as const) {
  assert.equal(isApprovedQortiumTransportManagedTarget({
    ...expectedTarget,
    [field]: `/tmp/untrusted-${field}`,
  }, expectedTarget, 'linux'), false)
}

console.log('Qortium transport runtime authority tests passed.')
