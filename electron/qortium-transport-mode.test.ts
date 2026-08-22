import assert from 'node:assert/strict'
import {
  getQortiumTransportMode,
  parseQortiumTransportSettingsJson,
  QORTIUM_TRANSPORT_SETTINGS_MAX_BYTES,
  QORTIUM_TRANSPORTS_BY_MODE,
  updateQortiumTransportSettings,
} from './qortium-transport-mode.js'

assert.deepEqual(QORTIUM_TRANSPORTS_BY_MODE, {
  'direct-and-i2p': ['IP', 'I2P'],
  'direct-only': ['IP'],
  'i2p-only': ['I2P'],
})
assert.equal(Object.isFrozen(QORTIUM_TRANSPORTS_BY_MODE), true)
for (const transports of Object.values(QORTIUM_TRANSPORTS_BY_MODE)) {
  assert.equal(Object.isFrozen(transports), true)
}

for (const settings of [
  {},
  { allowedTransports: null },
  { allowedTransports: [] },
  { allowedTransports: ['IP', 'I2P'] },
  { allowedTransports: [' ip ', ' i2p '] },
] as const) {
  assert.equal(getQortiumTransportMode(settings), 'direct-and-i2p')
}
assert.equal(getQortiumTransportMode({ allowedTransports: ['ip'] }), 'direct-only')
assert.equal(getQortiumTransportMode({ allowedTransports: [' I2P '] }), 'i2p-only')

for (const allowedTransports of [
  'IP',
  1,
  {},
  [null],
  [''],
  ['IP', 'IP'],
  ['IP', ' ip '],
  ['I2P', 'IP'],
  ['IP', 'I2P', 'IP'],
  ['IP', 'QUIC'],
] as const) {
  assert.equal(getQortiumTransportMode({ allowedTransports }), 'unknown')
  const parsed = parseQortiumTransportSettingsJson(JSON.stringify({ allowedTransports }))
  assert.equal(parsed.kind, 'unknown')
  assert.equal(parsed.reason, 'unknown-allowed-transports')
  assert(parsed.settings)
}

for (const source of ['', '{', 'null', '[]', 'true', '"settings"'] as const) {
  const result = parseQortiumTransportSettingsJson(source)
  assert.equal(result.kind, 'unknown')
  assert.equal(result.settings, null)
}

const exactBoundaryShell = JSON.stringify({ padding: '' })
const exactBoundary = JSON.stringify({
  padding: 'x'.repeat(QORTIUM_TRANSPORT_SETTINGS_MAX_BYTES - Buffer.byteLength(exactBoundaryShell)),
})
assert.equal(Buffer.byteLength(exactBoundary), QORTIUM_TRANSPORT_SETTINGS_MAX_BYTES)
assert.equal(parseQortiumTransportSettingsJson(exactBoundary).kind, 'known')
assert.deepEqual(parseQortiumTransportSettingsJson(`${exactBoundary} `), {
  kind: 'unknown',
  reason: 'oversize',
  settings: null,
})

for (const unsafeSource of [
  '{"__proto__":{"polluted":true}}',
  '{"nested":{"constructor":"bad"}}',
  '{"nested":[{"prototype":"bad"}]}',
] as const) {
  assert.deepEqual(parseQortiumTransportSettingsJson(unsafeSource), {
    kind: 'unknown',
    reason: 'unsafe-structure',
    settings: null,
  })
}
assert.equal(({} as { polluted?: unknown }).polluted, undefined)

const original = {
  allowedTransports: ['IP'],
  apiKey: 'preserved',
  nested: { enabled: true, peers: [1, 2, 3] },
}
const built = updateQortiumTransportSettings(original, 'i2p-only')
assert.deepEqual(built, {
  kind: 'built',
  jsonLine:
    '{"allowedTransports":["I2P"],"apiKey":"preserved","nested":{"enabled":true,"peers":[1,2,3]}}\n',
})
assert.deepEqual(original, {
  allowedTransports: ['IP'],
  apiKey: 'preserved',
  nested: { enabled: true, peers: [1, 2, 3] },
})
if (built.kind === 'built') {
  assert.equal(built.jsonLine.endsWith('\n'), true)
  assert.equal(built.jsonLine.slice(0, -1).includes('\n'), false)
  assert.deepEqual(JSON.parse(built.jsonLine), {
    allowedTransports: ['I2P'],
    apiKey: 'preserved',
    nested: { enabled: true, peers: [1, 2, 3] },
  })
}

for (const [mode, expected] of [
  ['direct-and-i2p', ['IP', 'I2P']],
  ['direct-only', ['IP']],
  ['i2p-only', ['I2P']],
] as const) {
  const result = updateQortiumTransportSettings({ unrelated: 'value' }, mode)
  assert.equal(result.kind, 'built')
  if (result.kind === 'built') {
    assert.deepEqual(JSON.parse(result.jsonLine).allowedTransports, expected)
  }
}

assert.deepEqual(updateQortiumTransportSettings({}, 'unknown'), {
  kind: 'rejected',
  reason: 'invalid-mode',
})

const cyclic: Record<string, unknown> = {}
cyclic.self = cyclic
const sparse = new Array(2)
sparse[1] = 'value'
const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: () => 'unsafe' })
for (const unsafe of [
  new Date(),
  { value: undefined },
  { value: Number.NaN },
  { value: 1n },
  { value: () => true },
  { sparse },
  cyclic,
  accessor,
] as const) {
  assert.deepEqual(updateQortiumTransportSettings(unsafe, 'direct-only'), {
    kind: 'rejected',
    reason: 'unsafe-structure',
  })
}

const emptyOutput = updateQortiumTransportSettings({ padding: '' }, 'direct-only')
assert.equal(emptyOutput.kind, 'built')
assert(emptyOutput.kind === 'built')
const exactOutput = updateQortiumTransportSettings({
  padding: 'é'.repeat(
    Math.floor(
      (QORTIUM_TRANSPORT_SETTINGS_MAX_BYTES - Buffer.byteLength(emptyOutput.jsonLine)) / 2,
    ),
  ),
}, 'direct-only')
assert.equal(exactOutput.kind, 'built')
assert(exactOutput.kind === 'built')
assert.equal(Buffer.byteLength(exactOutput.jsonLine), QORTIUM_TRANSPORT_SETTINGS_MAX_BYTES)
assert.deepEqual(updateQortiumTransportSettings({
  padding: `${JSON.parse(exactOutput.jsonLine).padding}é`,
}, 'direct-only'), {
  kind: 'rejected',
  reason: 'oversize',
})

console.log('Qortium transport mode tests passed.')
