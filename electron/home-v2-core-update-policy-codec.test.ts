import assert from 'node:assert/strict'
import {
  parseLegacyJavaAutoUpdateSettings,
  parseLegacyCoreUpdateSettings,
  parseStoredHomeV2CoreUpdatePolicySettings,
  validateWritableHomeV2CoreUpdatePolicySettings,
} from './home-v2-core-update-policy-codec.js'

const stored = parseStoredHomeV2CoreUpdatePolicySettings({
  coreUpdatePolicy: 'install',
  generation: 4,
  javaUpdatePolicy: 'notify',
  schema: 'qortium-home-v2-core-update-policy',
  version: 1,
})
assert.equal(stored.generation, 4)
assert.equal(stored.storageIssue, null)
assert.deepEqual(parseLegacyCoreUpdateSettings({
  coreUpdatePolicy: 'off',
  javaUpdatePolicy: 'install',
}), { coreUpdatePolicy: 'off', javaUpdatePolicy: 'install' })
assert.equal(parseLegacyCoreUpdateSettings({
  coreUpdatePolicy: 'install',
}), null)
assert.equal(parseLegacyJavaAutoUpdateSettings({ autoUpdate: true }), 'install')
assert.equal(parseLegacyJavaAutoUpdateSettings({ autoUpdate: false }), 'notify')
assert.equal(parseLegacyJavaAutoUpdateSettings({ autoUpdate: true, extra: 'authority' }), null)
assert.equal(parseLegacyJavaAutoUpdateSettings({}), null)
assert.equal(parseLegacyJavaAutoUpdateSettings({ autoUpdate: 'true' }), null)
assert.equal(parseLegacyCoreUpdateSettings({
  javaUpdatePolicy: 'install',
}), null)
assert.equal(parseLegacyCoreUpdateSettings({
  coreUpdatePolicy: 'invalid',
  javaUpdatePolicy: 'install',
}), null)
assert.equal(parseLegacyCoreUpdateSettings({
  coreUpdatePolicy: 'install',
  javaUpdatePolicy: 'invalid',
}), null)
assert.equal(parseLegacyCoreUpdateSettings({
  coreUpdatePolicy: 'install',
  javaUpdatePolicy: 'install',
  unexpected: true,
}), null)
assert.equal(parseLegacyCoreUpdateSettings(null), null)
assert.throws(() => parseStoredHomeV2CoreUpdatePolicySettings({ ...stored, extra: true }))
assert.throws(() => validateWritableHomeV2CoreUpdatePolicySettings({
  coreUpdatePolicy: 'automatic',
  javaUpdatePolicy: 'notify',
}))

console.log('Core update settings codec tests passed.')
