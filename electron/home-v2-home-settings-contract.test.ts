import assert from 'node:assert/strict'
import {
  HOME_V2_HOME_SETTINGS_ACTIONS,
  HOME_V2_HOME_SETTINGS_KEYS,
  HOME_V2_HOME_SETTINGS_PROMPTED_ACTION,
  HOME_V2_HOME_SETTINGS_UNPROMPTED_ACTIONS,
  HOME_V2_READ_ONLY_ACCENTS,
  encodeHomeV2HomeSettingsRoundTripRequest,
  getHomeV2HomeSettingsApprovalDetails,
  getHomeV2HomeSettingsMetadata,
  isHomeV2HomeSettingsAction,
  isHomeV2HomeSettingsUnpromptedAction,
  parseHomeV2HomeSettings,
  parseHomeV2HomeSettingsPatch,
  parseHomeV2HomeSettingsRequest,
  parseHomeV2HomeSettingsRoundTripRequest,
  parseHomeV2HomeSettingsRoundTripResponse,
  projectHomeV2HomeSettings,
  type HomeV2HomeSettings,
} from './home-v2-home-settings-contract.js'
import { HOME_SETTINGS_SCHEMA } from './home-settings-bridge.js'

function settings(overrides: Record<string, unknown> = {}): HomeV2HomeSettings {
  return {
    accent: 'green',
    appNotifications: true,
    appZoom: 100,
    language: 'en',
    textSize: 'medium',
    theme: 'dark',
    ui: 'classic',
    ...overrides,
  } as HomeV2HomeSettings
}

// ---------------------------------------------------------------------------
// The surface itself.
// ---------------------------------------------------------------------------

// Exactly the 1.x three, and nothing more. The whole value of this bridge is
// that it is small enough to reason about.
assert.deepEqual([...HOME_V2_HOME_SETTINGS_ACTIONS], [
  'GET_HOME_SETTINGS_METADATA',
  'GET_HOME_SETTINGS',
  'UPDATE_HOME_SETTINGS',
])

// Reads never prompt; exactly one action does.
assert.deepEqual([...HOME_V2_HOME_SETTINGS_UNPROMPTED_ACTIONS], [
  'GET_HOME_SETTINGS_METADATA',
  'GET_HOME_SETTINGS',
])
assert.equal(HOME_V2_HOME_SETTINGS_PROMPTED_ACTION, 'UPDATE_HOME_SETTINGS')
assert.equal(
  HOME_V2_HOME_SETTINGS_UNPROMPTED_ACTIONS.length + 1,
  HOME_V2_HOME_SETTINGS_ACTIONS.length,
  'every action must be either unprompted or the one prompted action',
)
for (const action of HOME_V2_HOME_SETTINGS_ACTIONS) {
  assert.equal(isHomeV2HomeSettingsAction(action), true)
  assert.equal(
    isHomeV2HomeSettingsUnpromptedAction(action),
    action !== HOME_V2_HOME_SETTINGS_PROMPTED_ACTION,
  )
}
assert.equal(isHomeV2HomeSettingsAction('UPDATE_NODE_SETTINGS'), false)
assert.equal(isHomeV2HomeSettingsAction('GET_HOME_SETTINGS_EXTRA'), false)
assert.equal(isHomeV2HomeSettingsUnpromptedAction('UPDATE_HOME_SETTINGS'), false)

// ---------------------------------------------------------------------------
// The seven-key contract and its projection.
// ---------------------------------------------------------------------------

assert.deepEqual([...HOME_V2_HOME_SETTINGS_KEYS], [
  'theme', 'accent', 'language', 'textSize', 'appZoom', 'ui', 'appNotifications',
])
assert.equal(HOME_V2_HOME_SETTINGS_KEYS.length, 7)

// A read returns the seven keys and NOTHING else. This is the security-relevant
// assertion of the whole module: a node URL, an account id or an API key must
// never be able to ride along in a settings reply.
const projected = projectHomeV2HomeSettings(settings())
assert.deepEqual(Object.keys(projected).sort(), [...HOME_V2_HOME_SETTINGS_KEYS].sort())

// An eighth key is REFUSED, not silently dropped, when it arrives on the wire.
assert.throws(
  () => parseHomeV2HomeSettings({ ...settings(), nodeApiUrl: 'http://127.0.0.1:24891' }),
  /exactly the seven writable keys/,
)
// A missing key is refused too: a partial object is not a settings reply.
const incomplete = settings() as unknown as Record<string, unknown>
delete incomplete.ui
assert.throws(() => parseHomeV2HomeSettings(incomplete), /exactly the seven writable keys/)
assert.throws(() => parseHomeV2HomeSettings(null), /exactly the seven writable keys/)
assert.throws(() => parseHomeV2HomeSettings([]), /exactly the seven writable keys/)

// ---------------------------------------------------------------------------
// The clay asymmetry: readable and discoverable, never writable.
// ---------------------------------------------------------------------------

assert.deepEqual([...HOME_V2_READ_ONLY_ACCENTS], ['clay'])

// clay is Home 2's DEFAULT accent, so a read must tolerate it or the bridge is
// broken on a fresh profile.
assert.equal(parseHomeV2HomeSettings(settings({ accent: 'clay' })).accent, 'clay')
assert.equal(projectHomeV2HomeSettings(settings({ accent: 'clay' })).accent, 'clay')

// ...and the WRITE side refuses it, because UPDATE_HOME_SETTINGS is a
// 1.x-compatible surface. If this assertion ever fails because someone widened
// HOME_SETTINGS_SCHEMA, that is the bug, not this test.
assert.throws(() => parseHomeV2HomeSettingsPatch({ accent: 'clay' }), /accent must be a valid string/)
assert.throws(
  () => parseHomeV2HomeSettingsRequest('UPDATE_HOME_SETTINGS', { patch: { accent: 'clay' } }),
  /accent must be a valid string/,
)
// Every other accent is writable, so the refusal is specific to clay and not a
// broken accent path.
for (const accent of ['green', 'blue', 'orange', 'purple', 'red', 'teal', 'cyan', 'pink', 'yellow']) {
  assert.deepEqual(parseHomeV2HomeSettingsPatch({ accent }), { accent })
}

// ---------------------------------------------------------------------------
// Metadata.
// ---------------------------------------------------------------------------

const metadata = getHomeV2HomeSettingsMetadata()
assert.deepEqual(metadata.map((entry) => entry.key), [...HOME_V2_HOME_SETTINGS_KEYS])

const accentMetadata = metadata.find((entry) => entry.key === 'accent')!
// Discoverable: clay appears in the value space a read may return...
assert.equal(accentMetadata.allowedValues?.includes('clay'), true)
// ...and is absent from the set a write accepts, so the asymmetry is
// self-describing rather than something an app finds out by being rejected.
assert.equal(accentMetadata.writableValues?.includes('clay'), false)
assert.equal(accentMetadata.allowedValues?.length, 10)
assert.equal(accentMetadata.writableValues?.length, 9)

// accent is the ONLY key where the two differ. If a second read-only value is
// ever added this test says so out loud.
for (const entry of metadata) {
  if (!entry.allowedValues) {
    assert.equal(entry.writableValues, undefined, `${entry.key} should not claim writableValues`)
    continue
  }
  if (entry.key === 'accent') continue
  assert.deepEqual(
    [...entry.allowedValues],
    [...(entry.writableValues ?? [])],
    `${entry.key} must be writable in exactly the values it is readable in`,
  )
}

// The numeric key keeps its bounds, and every key keeps a default an app can
// fall back to.
const zoomMetadata = metadata.find((entry) => entry.key === 'appZoom')!
assert.equal(zoomMetadata.type, 'number')
assert.equal(zoomMetadata.min, 50)
assert.equal(zoomMetadata.max, 200)
assert.equal(zoomMetadata.allowedValues, undefined)
for (const entry of metadata) {
  assert.notEqual(entry.default, undefined, `${entry.key} needs a default`)
}
// Metadata still describes the same schema 1.x published: same keys, same
// types, same defaults. Only accent's value lists differ.
for (const definition of HOME_SETTINGS_SCHEMA) {
  const entry = metadata.find((candidate) => candidate.key === definition.key)!
  assert.equal(entry.type, definition.type)
  assert.equal(entry.default, definition.default)
}

// ---------------------------------------------------------------------------
// Patch validation.
// ---------------------------------------------------------------------------

// Unknown keys are refused, not ignored. A request meaning something the bridge
// does not implement must never be answered as if it meant the subset it does.
assert.throws(() => parseHomeV2HomeSettingsPatch({ theme: 'dark', nodeApiUrl: 'x' }), /not writable/)
assert.throws(() => parseHomeV2HomeSettingsPatch({ apiKey: 'secret' }), /not writable/)
// An empty patch is a request to change nothing, which would raise a prompt
// about nothing.
assert.throws(() => parseHomeV2HomeSettingsPatch({}), /at least one setting/)
assert.throws(() => parseHomeV2HomeSettingsPatch(null), /settings patch object/)
assert.throws(() => parseHomeV2HomeSettingsPatch([]), /settings patch object/)

// appZoom is bounded and integral. Out of range is REJECTED rather than
// clamped: clamping would make the approval prompt show a proposed value the
// app never asked for.
assert.deepEqual(parseHomeV2HomeSettingsPatch({ appZoom: 50 }), { appZoom: 50 })
assert.deepEqual(parseHomeV2HomeSettingsPatch({ appZoom: 200 }), { appZoom: 200 })
assert.throws(() => parseHomeV2HomeSettingsPatch({ appZoom: 49 }), /between 50 and 200/)
assert.throws(() => parseHomeV2HomeSettingsPatch({ appZoom: 201 }), /between 50 and 200/)
assert.throws(() => parseHomeV2HomeSettingsPatch({ appZoom: 100.5 }), /between 50 and 200/)
assert.throws(() => parseHomeV2HomeSettingsPatch({ appZoom: '100' }), /between 50 and 200/)
assert.throws(() => parseHomeV2HomeSettingsPatch({ appNotifications: 'yes' }), /valid boolean/)
assert.throws(() => parseHomeV2HomeSettingsPatch({ theme: 'midnight' }), /valid string/)
assert.throws(() => parseHomeV2HomeSettingsPatch({ ui: 'brutalist' }), /valid string/)
assert.throws(() => parseHomeV2HomeSettingsPatch({ language: 'klingon' }), /valid string/)

// ---------------------------------------------------------------------------
// Request parsing, including the 1.x acceptance shapes.
// ---------------------------------------------------------------------------

assert.deepEqual(
  parseHomeV2HomeSettingsRequest('GET_HOME_SETTINGS_METADATA', { action: 'GET_HOME_SETTINGS_METADATA' }),
  { action: 'GET_HOME_SETTINGS_METADATA', kind: 'metadata' },
)
assert.deepEqual(
  parseHomeV2HomeSettingsRequest('GET_HOME_SETTINGS', { action: 'GET_HOME_SETTINGS' }),
  { action: 'GET_HOME_SETTINGS', kind: 'read' },
)

// `patch`, `settings`, and the bare body: all three are what 1.x accepted
// (qdn.ts:955-957), so an app written against Home 1.x calls Home 2 unchanged.
const viaPatch = parseHomeV2HomeSettingsRequest('UPDATE_HOME_SETTINGS', {
  action: 'UPDATE_HOME_SETTINGS',
  patch: { theme: 'light' },
})
const viaSettings = parseHomeV2HomeSettingsRequest('UPDATE_HOME_SETTINGS', {
  action: 'UPDATE_HOME_SETTINGS',
  settings: { theme: 'light' },
})
const viaBody = parseHomeV2HomeSettingsRequest('UPDATE_HOME_SETTINGS', {
  action: 'UPDATE_HOME_SETTINGS',
  theme: 'light',
})
assert.deepEqual(viaPatch.kind === 'update' && viaPatch.patch, { theme: 'light' })
assert.deepEqual(viaSettings.kind === 'update' && viaSettings.patch, { theme: 'light' })
// The bare-body form must strip `action` rather than reject the request for
// carrying it.
assert.deepEqual(viaBody.kind === 'update' && viaBody.patch, { theme: 'light' })

// An update with no recognisable patch is refused, not treated as a no-op.
assert.throws(
  () => parseHomeV2HomeSettingsRequest('UPDATE_HOME_SETTINGS', { action: 'UPDATE_HOME_SETTINGS' }),
  /at least one setting/,
)

// A multi-key patch survives whole.
const multi = parseHomeV2HomeSettingsRequest('UPDATE_HOME_SETTINGS', {
  patch: { appNotifications: false, appZoom: 125, theme: 'dark' },
})
assert.deepEqual(multi.kind === 'update' && multi.patch, {
  appNotifications: false,
  appZoom: 125,
  theme: 'dark',
})

// ---------------------------------------------------------------------------
// Approval details: per key, current then proposed.
// ---------------------------------------------------------------------------

const details = getHomeV2HomeSettingsApprovalDetails(
  settings({ appZoom: 100, theme: 'dark' }),
  { appZoom: 125, theme: 'light' },
)
assert.deepEqual(details, [
  { label: 'Theme (current)', value: 'dark' },
  { label: 'Theme (proposed)', value: 'light' },
  { label: 'App zoom (current)', value: '100' },
  { label: 'App zoom (proposed)', value: '125' },
])
// Only the keys actually being changed appear. A prompt that listed all seven
// would bury the change the user is being asked about.
assert.deepEqual(
  getHomeV2HomeSettingsApprovalDetails(settings(), { ui: 'modern' }),
  [
    { label: 'Interface style (current)', value: 'classic' },
    { label: 'Interface style (proposed)', value: 'modern' },
  ],
)
// Booleans are rendered, not dropped.
assert.deepEqual(
  getHomeV2HomeSettingsApprovalDetails(settings({ appNotifications: true }), { appNotifications: false }),
  [
    { label: 'App notifications (current)', value: 'true' },
    { label: 'App notifications (proposed)', value: 'false' },
  ],
)
// A read-only accent still renders as the CURRENT value, so a user on a clay
// profile sees what they are moving away from.
assert.deepEqual(
  getHomeV2HomeSettingsApprovalDetails(settings({ accent: 'clay' }), { accent: 'teal' }),
  [
    { label: 'Accent color (current)', value: 'clay' },
    { label: 'Accent color (proposed)', value: 'teal' },
  ],
)

// ---------------------------------------------------------------------------
// The desktop round-trip envelope.
// ---------------------------------------------------------------------------

const readEnvelope = encodeHomeV2HomeSettingsRoundTripRequest({ id: 'req-1', operation: 'read' })
assert.deepEqual(readEnvelope, {
  id: 'req-1',
  operation: 'read',
  patch: null,
  revision: 1,
  schema: 'home-v2-home-settings-request',
})
assert.deepEqual(parseHomeV2HomeSettingsRoundTripRequest(readEnvelope), readEnvelope)

const applyEnvelope = encodeHomeV2HomeSettingsRoundTripRequest({
  id: 'req-2',
  operation: 'apply',
  patch: { theme: 'light' },
})
const parsedApply = parseHomeV2HomeSettingsRoundTripRequest(applyEnvelope)
assert.equal(parsedApply.operation, 'apply')
assert.deepEqual(parsedApply.patch, { theme: 'light' })

// A caller bug in either direction is refused rather than reaching the shell as
// a no-op write or an unrequested one.
assert.throws(
  () => encodeHomeV2HomeSettingsRoundTripRequest({ id: 'x', operation: 'apply' }),
  /apply needs a patch/,
)
assert.throws(
  () => encodeHomeV2HomeSettingsRoundTripRequest({ id: 'x', operation: 'read', patch: { theme: 'dark' } }),
  /read must not carry a patch/,
)
assert.throws(
  () => encodeHomeV2HomeSettingsRoundTripRequest({ id: '', operation: 'read' }),
  /needs an id/,
)

// The renderer end is exact-key: it acts on an envelope it fully recognises or
// on none at all.
assert.throws(
  () => parseHomeV2HomeSettingsRoundTripRequest({ ...readEnvelope, extra: true }),
  /exact Home 2 Home settings request/,
)
assert.throws(
  () => parseHomeV2HomeSettingsRoundTripRequest({ ...readEnvelope, schema: 'something-else' }),
  /exact Home 2 Home settings request/,
)
assert.throws(
  () => parseHomeV2HomeSettingsRoundTripRequest({ ...readEnvelope, revision: 2 }),
  /exact Home 2 Home settings request/,
)
assert.throws(
  () => parseHomeV2HomeSettingsRoundTripRequest({ ...readEnvelope, operation: 'delete' }),
  /exact Home 2 Home settings request/,
)
// The renderer re-validates the patch itself rather than trusting that main
// already did: the shell is the thing that performs the write.
assert.throws(
  () => parseHomeV2HomeSettingsRoundTripRequest({ ...applyEnvelope, patch: { accent: 'clay' } }),
  /accent must be a valid string/,
)
assert.throws(
  () => parseHomeV2HomeSettingsRoundTripRequest({ ...applyEnvelope, patch: { nodeApiUrl: 'x' } }),
  /not writable/,
)

// The main-process end validates the reply, so a renderer that grew an eighth
// field could not have it forwarded to an app.
assert.deepEqual(
  parseHomeV2HomeSettingsRoundTripResponse({ requestId: 'req-1', settings: settings() }),
  { requestId: 'req-1', settings: settings() },
)
assert.throws(
  () => parseHomeV2HomeSettingsRoundTripResponse({
    requestId: 'req-1',
    settings: { ...settings(), apiKey: 'secret' },
  }),
  /exactly the seven writable keys/,
)
assert.throws(
  () => parseHomeV2HomeSettingsRoundTripResponse({ settings: settings() }),
  /needs a requestId/,
)

console.log('Home v2 Home settings contract tests passed.')
