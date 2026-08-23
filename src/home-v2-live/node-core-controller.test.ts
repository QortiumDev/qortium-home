import assert from 'node:assert/strict'
import {
  parseHomeV2CoreMaintenanceActionResult,
  parseHomeV2CoreMaintenanceRelease,
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
  capabilities: { canInitialInstall: true, canInstallJava: true },
  core: { channel: null, installedVersion: null, runtime: 'stopped' },
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

console.log('home v2 node/core controller tests passed')
