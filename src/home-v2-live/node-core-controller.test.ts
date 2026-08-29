import assert from 'node:assert/strict'
import {
  parseHomeV2CoreMaintenanceActionResult,
  parseHomeV2CoreMaintenanceRelease,
  parseHomeV2CoreMaintenanceProgress,
  parseHomeV2CoreMaintenanceStatus,
  parseHomeV2CoreManagerActionResult,
  parseHomeV2CoreManagerStatus,
  parseHomeV2CoreUpdatePolicyState,
} from './core-manager-client'
import {
  createInitialHomeV2Nodes,
  parseHomeV2NodesSnapshot,
  unavailableHomeV2Node,
} from './node-core-controller'

function coreStatus(network: 'qortal' | 'qortium') {
  return {
    capabilities: { canStart: true, canStop: false },
    control: 'full',
    install: 'home-managed',
    issue: null,
    network,
    revision: 1,
    runtime: 'stopped',
    schema: 'home-v2-core-manager',
  } as const
}

const qortiumStatus = coreStatus('qortium')
assert.deepEqual(
  parseHomeV2CoreManagerStatus(qortiumStatus, 'qortium'),
  qortiumStatus,
)
assert.throws(() =>
  parseHomeV2CoreManagerStatus({ ...qortiumStatus, revision: 2 }, 'qortium'),
)

const maintenanceStatus = {
  capabilities: { canInitialInstall: true, canInstallJava: true, canUpdateRunningInPlace: false },
  core: { channel: null, installedCommit: null, installedTag: null, nodeAutoUpdateMode: null, runtimeBlockedReason: null, installedVersion: null, runtime: 'stopped' },
  java: { source: 'missing', updateAvailable: false, version: null },
  revision: 1,
  schema: 'home-v2-core-maintenance',
} as const
assert.deepEqual(parseHomeV2CoreMaintenanceStatus(maintenanceStatus), maintenanceStatus)
assert.throws(() => parseHomeV2CoreMaintenanceStatus({ ...maintenanceStatus, java: { path: '/secret' } }))
const maintenanceRelease = {
  action: 'initial-install', available: true, channel: 'prerelease', revision: 1,
  schema: 'home-v2-core-maintenance-release', tag: 'v1.2.3',
} as const
assert.deepEqual(parseHomeV2CoreMaintenanceRelease(maintenanceRelease), maintenanceRelease)
assert.throws(() => parseHomeV2CoreMaintenanceRelease({ ...maintenanceRelease, action: 'downgrade' }))
const maintenanceAction = {
  code: null, outcome: 'completed', revision: 1,
  schema: 'home-v2-core-maintenance-action', status: maintenanceStatus,
} as const
assert.deepEqual(parseHomeV2CoreMaintenanceActionResult(maintenanceAction), maintenanceAction)
assert.throws(() => parseHomeV2CoreMaintenanceActionResult({ ...maintenanceAction, code: '/secret/raw' }))
const updatePolicy = {
  activity: {
    checkedAt: '2026-08-22T00:00:00.000Z',
    core: { channel: 'prerelease', state: 'available', version: 'v1.2.3' },
    generation: 3,
    issue: null,
    java: { state: 'up-to-date', version: null },
    qortal: { state: 'idle', version: null },
  },
  coreUpdatePolicy: 'notify',
  generation: 3,
  javaUpdatePolicy: 'off',
  qortalUpdatePolicy: 'notify',
  revision: 1,
  schema: 'home-v2-core-update-policy',
  settingsIssue: null,
} as const
assert.deepEqual(parseHomeV2CoreUpdatePolicyState(updatePolicy), updatePolicy)
assert.throws(() => parseHomeV2CoreUpdatePolicyState({
  ...updatePolicy,
  activity: { ...updatePolicy.activity, rawPath: '/secret' },
}))
assert.throws(() =>
  parseHomeV2CoreManagerStatus({ ...qortiumStatus, runtime: 'starting' }, 'qortium'),
)
assert.throws(() =>
  parseHomeV2CoreManagerStatus(
    { ...qortiumStatus, capabilities: { canStart: true } },
    'qortium',
  ),
)
assert.throws(() => parseHomeV2CoreManagerStatus(qortiumStatus, 'qortal'))

const completed = {
  code: null,
  network: 'qortium',
  outcome: 'completed',
  revision: 1,
  schema: 'home-v2-core-manager-action',
  status: { ...qortiumStatus, capabilities: { canStart: false, canStop: true }, runtime: 'running' },
  warning: null,
} as const
assert.deepEqual(
  parseHomeV2CoreManagerActionResult(completed, 'qortium'),
  completed,
)
assert.throws(() =>
  parseHomeV2CoreManagerActionResult(
    { ...completed, code: 'raw-manager-detail' },
    'qortium',
  ),
)
assert.throws(() =>
  parseHomeV2CoreManagerActionResult(
    { ...completed, status: coreStatus('qortal') },
    'qortium',
  ),
)

const nodes = createInitialHomeV2Nodes()
assert.equal(nodes.qortium.mode, 'local')
assert.equal(nodes.qortium.lastEnabledMode, 'local')
assert.equal(nodes.qortal.mode, 'disabled')
assert.equal(nodes.qortal.lastEnabledMode, 'local')
const parsedNodes = parseHomeV2NodesSnapshot({ version: 1, nodes })
assert.equal(parsedNodes.qortium.network, 'qortium')
assert.equal(parsedNodes.qortal.network, 'qortal')
assert.throws(() =>
  parseHomeV2NodesSnapshot({ version: 1, nodes: { ...nodes, unexpected: {} } }),
)
assert.throws(() =>
  parseHomeV2NodesSnapshot({
    version: 1,
    nodes: { ...nodes, qortal: { ...nodes.qortal, mode: 'automatic' } },
  }),
)
const unavailable = unavailableHomeV2Node(nodes.qortium, new Error('offline'))
assert.equal(unavailable.ref, nodes.qortium.ref)
assert.equal(unavailable.nodeApiUrl, nodes.qortium.nodeApiUrl)
assert.deepEqual(unavailable.capabilities, { admin: false, read: false, write: false })

// --- Install progress survives the parser ROUND TRIP ---------------------
// The bug this pins was live an hour ago in the sibling parser: the status
// parser validated a new capability and then did not copy it into the object
// it returns, so the renderer saw undefined and the feature was dead while
// every main-process test passed. Comparing parse(x) to x is what catches it.
{
  const progress = {
    action: 'downloading',
    kind: 'info',
    message: 'Downloading Qortium Core.',
    percent: 42,
    revision: 1,
    schema: 'home-v2-core-manager-progress',
  } as const
  const parsed = parseHomeV2CoreMaintenanceProgress(progress)
  assert.deepEqual(
    parsed,
    { action: 'downloading', kind: 'info', message: 'Downloading Qortium Core.', percent: 42 },
    'every field the UI reads must survive the parse',
  )

  // A phase with no honest denominator keeps percent null rather than 0 — a
  // zero would render a bar stuck at the left instead of an indeterminate one.
  assert.equal(
    parseHomeV2CoreMaintenanceProgress({ ...progress, action: 'extracting', percent: null })?.percent,
    null,
  )
}

// Malformed events are DROPPED, not rendered: the UI keeps its previous value
// rather than showing a wrong percentage.
for (const bad of [
  null,
  'downloading',
  { action: 'downloading', kind: 'info', message: 'x', percent: 42, revision: 2, schema: 'home-v2-core-manager-progress' },
  { action: 'downloading', kind: 'info', message: 'x', percent: 42, revision: 1, schema: 'wrong' },
  { action: 'teleporting', kind: 'info', message: 'x', percent: 1, revision: 1, schema: 'home-v2-core-manager-progress' },
  { action: 'downloading', kind: 'shouting', message: 'x', percent: 1, revision: 1, schema: 'home-v2-core-manager-progress' },
  { action: 'downloading', kind: 'info', message: 'x', percent: 101, revision: 1, schema: 'home-v2-core-manager-progress' },
  { action: 'downloading', kind: 'info', message: 'x', percent: -1, revision: 1, schema: 'home-v2-core-manager-progress' },
  { action: 'downloading', kind: 'info', message: 'x', percent: Number.NaN, revision: 1, schema: 'home-v2-core-manager-progress' },
  // An extra field is a different contract than the one we agreed.
  { action: 'downloading', extra: 1, kind: 'info', message: 'x', percent: 1, revision: 1, schema: 'home-v2-core-manager-progress' },
]) {
  assert.equal(parseHomeV2CoreMaintenanceProgress(bad), null, `refuses ${JSON.stringify(bad)}`)
}

// --- The build identity survives the parser ROUND TRIP -------------------
// Third time this guard has earned its place: a field the parser validates and
// then omits from its result reads as undefined in the UI, with every
// main-process test still green (#436).
{
  const status = {
    capabilities: { canInitialInstall: false, canInstallJava: false, canUpdateRunningInPlace: false },
    core: {
      channel: 'stable',
      installedCommit: 'abcdef0123456789abcdef0123456789abcdef01',
      installedTag: 'v1.7.2',
      nodeAutoUpdateMode: 'INSTALL',
      runtimeBlockedReason: 'Qortium Core runtime data was created for a different network.',
      installedVersion: '1.7.2',
      runtime: 'running',
    },
    java: { source: 'managed', updateAvailable: false, version: '25' },
    revision: 1,
    schema: 'home-v2-core-maintenance',
  } as const
  const parsed = parseHomeV2CoreMaintenanceStatus(status)
  assert.equal(parsed.core.installedCommit, status.core.installedCommit)
  assert.equal(parsed.core.runtimeBlockedReason, status.core.runtimeBlockedReason)
  assert.equal(parsed.core.nodeAutoUpdateMode, status.core.nodeAutoUpdateMode)
  assert.equal(parsed.core.installedTag, 'v1.7.2')
  assert.deepEqual(parsed, status, 'every field the UI reads must survive the parse')

  // Absent build identity is null, not undefined — the UI tests for null.
  const bare = parseHomeV2CoreMaintenanceStatus({
    ...status,
    core: {
      ...status.core,
      installedCommit: null,
      installedTag: null,
      nodeAutoUpdateMode: null,
      runtimeBlockedReason: null,
    },
  })
  assert.equal(bare.core.installedCommit, null)
  assert.equal(bare.core.installedTag, null)
  assert.equal(bare.core.runtimeBlockedReason, null)
  assert.equal(bare.core.nodeAutoUpdateMode, null)
}

// dataPeerCount must survive the parser round trip. A field the parser validates
// but never returns reads as undefined downstream with no type error, which is
// how #436 shipped a dead feature with every main-process test green.
{
  const base = createInitialHomeV2Nodes()
  const parsed = parseHomeV2NodesSnapshot({
    version: 1,
    nodes: {
      ...base,
      qortium: { ...base.qortium, peerCount: 15, dataPeerCount: 16 },
    },
  })
  assert.equal(parsed.qortium.peerCount, 15)
  assert.equal(
    parsed.qortium.dataPeerCount,
    16,
    'dataPeerCount must be RETURNED by the parser, not merely accepted',
  )
}

console.log('home v2 node/core controller tests passed')
