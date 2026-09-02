// Unit tests for the pure node-settings derivation module, plus source pins
// on the bridge glue (properties that are true of the CODE rather than of a
// return value, in the home-v2-minting.test.ts convention).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  HOME_V2_NODE_SETTINGS_WRITE_ACTIONS,
  HOME_V2_RESTART_NODE_IMPACT,
  buildHomeV2NodeSettingsApprovalRows,
  createHomeV2NodeSettingsUpdateResult,
  homeV2NodeSettingsOperationLabel,
  homeV2WritableSettingKeys,
  isHomeV2NodeSettingsWriteAction,
  normalizeHomeV2NodeSettingsPatch,
} from './home-v2-node-settings.js'

// ---------------------------------------------------------------------------
// Action predicates and labels
// ---------------------------------------------------------------------------
assert.deepEqual([...HOME_V2_NODE_SETTINGS_WRITE_ACTIONS], ['RESTART_NODE', 'UPDATE_NODE_SETTINGS'])
assert.equal(isHomeV2NodeSettingsWriteAction('UPDATE_NODE_SETTINGS'), true)
assert.equal(isHomeV2NodeSettingsWriteAction('RESTART_NODE'), true)
assert.equal(isHomeV2NodeSettingsWriteAction('GET_NODE_SETTINGS_METADATA'), false)
assert.equal(homeV2NodeSettingsOperationLabel('RESTART_NODE'), 'Restart the node')
assert.equal(homeV2NodeSettingsOperationLabel('UPDATE_NODE_SETTINGS'), 'Update node settings')
assert.equal(HOME_V2_RESTART_NODE_IMPACT, 'Restart the selected Core node')

// ---------------------------------------------------------------------------
// Patch normalization — the 1.x request shapes and caps, kept exactly
// ---------------------------------------------------------------------------
assert.deepEqual(
  normalizeHomeV2NodeSettingsPatch({ patch: { qdnEnabled: false } }),
  { qdnEnabled: false },
)
assert.deepEqual(
  normalizeHomeV2NodeSettingsPatch({ settings: { maxPeers: 40 } }),
  { maxPeers: 40 },
)
assert.deepEqual(
  normalizeHomeV2NodeSettingsPatch({ payload: { localeLang: 'es' } }),
  { localeLang: 'es' },
)
// `patch` wins over `settings`, as in 1.x resolution order.
assert.deepEqual(
  normalizeHomeV2NodeSettingsPatch({ patch: { a: 1 }, settings: { b: 2 } }),
  { a: 1 },
)
assert.throws(() => normalizeHomeV2NodeSettingsPatch({}), /settings patch object/)
assert.throws(() => normalizeHomeV2NodeSettingsPatch({ patch: [] }), /settings patch object/)
assert.throws(() => normalizeHomeV2NodeSettingsPatch({ patch: {} }), /at least one setting/)
assert.throws(
  () => normalizeHomeV2NodeSettingsPatch({
    patch: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, true])),
  }),
  /at most 64 settings/,
)
assert.throws(
  () => normalizeHomeV2NodeSettingsPatch({ patch: { ['k'.repeat(121)]: true } }),
  /at most 120 characters/,
)
// A top-level undefined (or function) value would render on the prompt but
// be silently dropped by JSON.stringify from the body — refused instead, so
// what is shown is exactly what is sent.
assert.throws(
  () => normalizeHomeV2NodeSettingsPatch({ patch: { qdnEnabled: undefined } }),
  /JSON-serializable/,
)
assert.throws(
  () => normalizeHomeV2NodeSettingsPatch({ patch: { qdnEnabled: () => true } }),
  /JSON-serializable/,
)
// NaN serializes as null on BOTH the display and body paths, so it stays
// accepted — divergence, not nullness, is what the guard refuses.
assert.deepEqual(normalizeHomeV2NodeSettingsPatch({ patch: { maxPeers: NaN } }), { maxPeers: NaN })
assert.throws(
  () => normalizeHomeV2NodeSettingsPatch({ patch: { 'bad\u0000key': true } }),
  /at most 120 characters/,
)

// ---------------------------------------------------------------------------
// Writable keys — object map (current Core), array forms, fail-closed default
// ---------------------------------------------------------------------------
// The REAL wire shape: Core's JAXB map serialization, verified live against
// a running Previewnet Core (writable.entry = [{ key, value }]). Treating
// 'entry' itself as the one writable key was the bug the live probe caught.
{
  const keys = homeV2WritableSettingKeys({
    writable: { entry: [
      { key: 'wallets', value: { restartRequired: true, type: 'BOOLEAN_MAP' } },
      { key: 'maxPeers', value: { restartRequired: true, type: 'INTEGER' } },
    ] },
  })
  assert.equal(keys.has('wallets'), true)
  assert.equal(keys.has('maxPeers'), true)
  assert.equal(keys.has('entry'), false)
  assert.equal(keys.size, 2)
}
{
  const keys = homeV2WritableSettingKeys({
    writable: { qdnEnabled: { restartRequired: false, type: 'BOOLEAN' }, maxPeers: { restartRequired: true, type: 'INTEGER' } },
  })
  assert.equal(keys.has('qdnEnabled'), true)
  assert.equal(keys.has('maxPeers'), true)
  assert.equal(keys.has('apiKeyPath'), false)
}
assert.equal(homeV2WritableSettingKeys({ writable: [{ key: 'qdnEnabled' }, 'maxPeers'] }).size, 2)
assert.equal(homeV2WritableSettingKeys({ writable: 7 }).size, 0)
assert.equal(homeV2WritableSettingKeys(null).size, 0)
assert.equal(homeV2WritableSettingKeys({}).size, 0)

// ---------------------------------------------------------------------------
// Approval rows — named settings, named values, forge-resistant annotations
// ---------------------------------------------------------------------------
{
  const rows = buildHomeV2NodeSettingsApprovalRows(
    { qdnEnabled: true, listenPort: 24892 },
    { qdnEnabled: false, maxPeers: 40 },
  )
  assert.deepEqual(rows.map((row) => row.label), [
    'qdnEnabled (current)',
    'qdnEnabled (proposed)',
    'maxPeers (current)',
    'maxPeers (proposed)',
  ])
  assert.equal(rows[0].value, 'true')
  assert.equal(rows[1].value, 'false')
  // A key the node does not currently have renders Home's own annotation.
  assert.equal(rows[2].value, '(not present)')
  assert.equal(rows[3].value, '40')
}
// String values render QUOTED, so the literal string "(not present)" from an
// app cannot forge the annotation row.
{
  const rows = buildHomeV2NodeSettingsApprovalRows({}, { localeLang: '(not present)' })
  assert.equal(rows[1].value, '"(not present)"')
  assert.notEqual(rows[1].value, rows[0].value)
}
// The empty string gets its own unforgeable annotation (a quoted empty string
// would render as two bare quotes, which reads as nothing).
{
  const rows = buildHomeV2NodeSettingsApprovalRows({ localeLang: '' }, { localeLang: 'en' })
  assert.equal(rows[0].value, '(empty)')
  assert.equal(rows[1].value, '"en"')
}
// Control characters in a current value escape rather than render.
{
  const rows = buildHomeV2NodeSettingsApprovalRows({ a: 'x\u0000y' }, { a: 'z' })
  assert.equal(rows[0].value.includes('\u0000'), false)
  assert.equal(rows[0].value.includes('\\u0000'), true)
}
// A value too large to display in full is refused before any prompt.
assert.throws(
  () => buildHomeV2NodeSettingsApprovalRows({}, { big: 'x'.repeat(1_001) }),
  /too large to display safely/,
)
assert.throws(
  () => buildHomeV2NodeSettingsApprovalRows(null, { a: 1 }),
  /current node settings response is not an object/,
)

// ---------------------------------------------------------------------------
// Update-result sanitization — allowlist rebuild, settingsPath dropped
// ---------------------------------------------------------------------------
{
  const result = createHomeV2NodeSettingsUpdateResult({
    applied: ['qdnEnabled'],
    removed: [],
    restartRequired: ['maxPeers', 7, 'ok\u0000bad'],
    saved: true,
    settingsPath: '/home/user/.config/qortium/settings.json',
    updated: ['qdnEnabled', 'maxPeers'],
  })
  assert.deepEqual([...result.applied], ['qdnEnabled'])
  assert.deepEqual([...result.restartRequired], ['maxPeers'])
  assert.deepEqual([...result.updated], ['qdnEnabled', 'maxPeers'])
  assert.equal(result.saved, true)
  assert.equal('settingsPath' in result, false)
}
assert.deepEqual(
  createHomeV2NodeSettingsUpdateResult('garbage'),
  { applied: [], removed: [], restartRequired: [], saved: false, updated: [] },
)
{
  // The entry ceiling holds against an unbounded hostile array.
  const result = createHomeV2NodeSettingsUpdateResult({
    updated: Array.from({ length: 1_000 }, (_, i) => `k${i}`),
  })
  assert.equal(result.updated.length, 256)
}

// ---------------------------------------------------------------------------
// SOURCE PINS — the bridge glue's security properties
// ---------------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url))
const bridgeSource = readFileSync(join(here, '..', 'electron', 'home-v2-app-bridge.ts'), 'utf8')

// The write handler resolves admin trust through the shared resolver and
// asserts it — never through the signed-write key path.
assert.equal(bridgeSource.includes('resolveHomeV2NodeSettingsNode'), true)
// Both writes re-resolve trust after the prompt and compare origin+revision —
// pinned INSIDE the node-settings handler, so the identical check in the
// list handler cannot satisfy this vacuously.
{
  const handlerStart = bridgeSource.indexOf('async function handleHomeV2NodeSettingsAction')
  assert.notEqual(handlerStart, -1, 'the node-settings handler must exist')
  const handler = bridgeSource.slice(handlerStart)
  assert.equal(
    handler.split('after.trust.revision !== before.trust.revision').length >= 3,
    true,
    'both write paths must refuse a node or credential that changed while the prompt was open',
  )
}
// The keyed calls refuse redirects, so the administrative key stays pinned to
// the host the trust gate approved.
{
  const start = bridgeSource.indexOf('async function requestHomeV2NodeSettingsText')
  assert.notEqual(start, -1, 'the node-settings keyed request helper must exist')
  const helper = bridgeSource.slice(start, start + 1_800)
  assert.equal(helper.includes("redirect: 'error'"), true)
  // Keyed-call errors are scrubbed to fixed operation/status messages — the
  // node's error body (which a hostile responder could stuff with received
  // headers) must never flow onward to the app.
  assert.equal(helper.includes('readableNodeErrorMessage'), false)
}

const runtimeSource = readFileSync(join(here, '..', 'electron', 'home-v2-app-runtime.ts'), 'utf8')
// SHOW_ACTIONS honesty: the writes are advertised only on an admin-trusted,
// reachable route — the same rule the foreign-wallet family uses.
assert.equal(
  runtimeSource.includes('isHomeV2NodeSettingsWriteAction'),
  true,
  'getHomeV2AvailableAppActions must gate the node-settings writes on admin trust',
)

console.log('Home v2 node settings tests passed.')
