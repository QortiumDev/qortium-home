import assert from 'node:assert/strict'
import type { IpcMainInvokeEvent } from 'electron'
import type { CoreManagerEntry } from './core-manager.js'
import {
  createAuthorizedHomeV2QortalAdoptionHandlers,
  HomeV2QortalAdoptionService,
  type HomeV2QortalAdoptionDependencies,
} from './home-v2-qortal-adoption-contract.js'
import type { HomeV2QortalMaintenanceStatus } from './home-v2-qortal-maintenance-contract.js'
import type { QortalInstallCandidate } from './qortal-install-source.js'

const maintenanceStatus = (install: HomeV2QortalMaintenanceStatus['install'] = 'missing') => ({
  capabilities: { canCheckRelease: false, canInitialInstall: false, canUpdate: false },
  discovery: install === 'missing' ? 'candidate-found' as const : 'not-applicable' as const,
  install,
  installedVersion: install === 'adopted' ? '6.2.0' : null,
  issue: null,
  network: 'qortal' as const,
  revision: 1 as const,
  runtime: 'stopped' as const,
  schema: 'home-v2-qortal-maintenance' as const,
  updateAuthority: 'observe-only' as const,
})

function candidate(name = 'one', origins: QortalInstallCandidate['origins'] = ['default-location']): QortalInstallCandidate {
  const installPath = `/secret/${name}`
  return {
    canonicalInstallPath: installPath,
    hubHint: origins.includes('qortal-hub'),
    jarState: {
      canonicalPath: `${installPath}/qortal.jar`,
      dev: 1,
      identity: { buildTimestamp: 'private', buildVersion: 'private', commit: 'a'.repeat(40), semver: '6.2.0' },
      ino: 2,
      kind: 'file',
      mtimeMs: 3,
      sha256: `sha256:${'a'.repeat(64)}`,
      size: 4,
    },
    origins,
    runningProcessMatch: origins.includes('running-process'),
    settingsState: {
      canonicalPath: `${installPath}/settings.json`,
      dev: 1,
      ino: 3,
      mtimeMs: 4,
      sha256: `sha256:${'b'.repeat(64)}`,
      size: 5,
    },
  }
}

function listRequest(extra: Record<string, unknown> = {}) {
  return { network: 'qortal', revision: 1, schema: 'home-v2-qortal-adoption-list-request', ...extra }
}

function browseRequest(extra: Record<string, unknown> = {}) {
  return { network: 'qortal', revision: 1, schema: 'home-v2-qortal-adoption-browse-request', ...extra }
}

function selectionRequest(candidateId: string, extra: Record<string, unknown> = {}) {
  return {
    candidateId,
    network: 'qortal',
    revision: 1,
    schema: 'home-v2-qortal-adoption-selection-request',
    ...extra,
  }
}

function event(senderId: number) {
  return { sender: { id: senderId } } as unknown as IpcMainInvokeEvent
}

let uuidIndex = 0
function nextUuid() {
  uuidIndex += 1
  return `00000000-0000-4000-8000-${uuidIndex.toString(16).padStart(12, '0')}`
}

type HarnessOptions = {
  choose?: HomeV2QortalAdoptionDependencies['chooseDirectory']
  candidates?: readonly QortalInstallCandidate[]
  discoveryKind?: 'complete' | 'incomplete'
  install?: 'adopted' | 'home-managed' | 'missing' | 'unknown'
  lease?: HomeV2QortalAdoptionDependencies['tryBeginInteractive']
  now?: () => number
  persistKind?: 'blocked' | 'persisted' | 'unchanged' | 'unknown'
  platform?: NodeJS.Platform
}

function harness(options: HarnessOptions = {}) {
  let browseCalls = 0
  let discoveryCalls = 0
  let persistenceCalls = 0
  let publicInstall: HomeV2QortalMaintenanceStatus['install'] = options.install ?? 'missing'
  const install = options.install ?? 'missing'
  const manager = {
    getStatus: async () => ({ install: install === 'unknown'
      ? { kind: 'unknown', reason: '/secret/reason' }
      : install === 'missing' ? { kind: 'missing' } : { kind: install } }),
    networkId: 'qortal',
    persistAdoptedSelection: async () => {
      persistenceCalls += 1
      const kind = options.persistKind ?? 'persisted'
      if (kind === 'persisted' || kind === 'unchanged') publicInstall = 'adopted'
      return kind === 'persisted' || kind === 'unchanged'
        ? { kind, record: { private: '/secret' } }
        : { kind, reason: '/secret/internal/reason' }
    },
  } as unknown as CoreManagerEntry
  const service = new HomeV2QortalAdoptionService({
    chooseDirectory: options.choose ?? (async () => { browseCalls += 1; return null }),
    discover: async (_manager, selected) => {
      discoveryCalls += 1
      if (selected === '/invalid') return { candidates: [], kind: 'incomplete' }
      return { candidates: options.candidates ?? [candidate()], kind: options.discoveryKind ?? 'complete' }
    },
    getMaintenanceStatus: async () => maintenanceStatus(publicInstall),
    now: options.now ?? (() => 1_000),
    platform: options.platform ?? 'linux',
    resolveManager: () => manager,
    tryBeginInteractive: options.lease ?? (() => ({ release() {}, revision: 1 })),
    uuid: nextUuid,
  })
  return {
    get browseCalls() { return browseCalls },
    get discoveryCalls() { return discoveryCalls },
    get persistenceCalls() { return persistenceCalls },
    service,
  }
}

function assertRedacted(value: unknown) {
  const serialized = JSON.stringify(value)
  for (const forbidden of ['/secret', '\\\\secret', 'sha256', 'digest', 'canonical', 'mtime', 'record', 'reason',
    'pid', 'argv', 'startIdentity', 'rawSettingsArgument', 'size', 'basename']) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, 'i'))
  }
}

{
  const current = harness()
  await assert.rejects(current.service.list(1, { ...listRequest(), extra: true }), /exact Qortal adoption/i)
  await assert.rejects(current.service.browse(1, event(1), { ...browseRequest(), network: 'qortium' }),
    /exact Qortal adoption/i)
  await assert.rejects(current.service.select(1, selectionRequest('not-a-token')), /exact Qortal adoption selection/i)
  assert.equal(current.discoveryCalls, 0, 'malformed requests must be rejected before work')
  assert.equal(current.browseCalls, 0)
}

{
  const current = harness()
  const handlers = createAuthorizedHomeV2QortalAdoptionHandlers(
    () => { throw new Error('unauthorized') },
    current.service,
  )
  assert.throws(() => handlers.list(event(1), listRequest()), /unauthorized/)
  assert.throws(() => handlers.browse(event(1), browseRequest()), /unauthorized/)
  assert.throws(() => handlers.select(event(1), selectionRequest(nextUuid())), /unauthorized/)
  assert.equal(current.discoveryCalls, 0, 'sender authorization must precede parsing and work')
  assert.equal(current.browseCalls, 0)
}

{
  const current = harness({ candidates: [candidate('merged', ['qortal-hub', 'running-process'])] })
  const listed = await current.service.list(7, listRequest())
  assert.equal(listed.state, 'complete')
  assert.equal(listed.canBrowse, true)
  assert.equal(listed.canSelect, true)
  assert.equal(listed.candidates.length, 1)
  assert.match(listed.candidates[0]!.candidateId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.deepEqual(listed.candidates[0]!.origins, ['qortal-hub', 'running-process'])
  assert.equal(listed.candidates[0]!.hubHint, true)
  assert.equal(listed.candidates[0]!.runningProcessMatch, true)
  assert.equal(listed.candidates[0]!.version, '6.2.0')
  assertRedacted(listed)

  const mismatch = await current.service.select(8, selectionRequest(listed.candidates[0]!.candidateId))
  assert.equal(mismatch.code, 'candidate-expired')
  assert.equal(current.persistenceCalls, 0)
  const selected = await current.service.select(7, selectionRequest(listed.candidates[0]!.candidateId))
  assert.equal(selected.outcome, 'completed', 'a sender mismatch must not consume the rightful sender token')
  assert.equal(selected.status.install, 'adopted', 'selection must return freshly read maintenance status')
  assertRedacted(selected)
}

{
  const current = harness()
  const first = await current.service.list(1, listRequest())
  const second = await current.service.list(1, listRequest())
  assert.notEqual(first.candidates[0]!.candidateId, second.candidates[0]!.candidateId)
  assert.equal((await current.service.select(1, selectionRequest(first.candidates[0]!.candidateId))).code,
    'candidate-expired', 'a new sender snapshot must invalidate earlier handles')
  assert.equal((await current.service.select(1, selectionRequest(nextUuid()))).code, 'candidate-expired')
}

{
  let now = 1_000
  const current = harness({ now: () => now })
  const listed = await current.service.list(1, listRequest())
  now += 10 * 60_000
  assert.equal((await current.service.select(1, selectionRequest(listed.candidates[0]!.candidateId))).code,
    'candidate-expired')
  assert.equal(current.persistenceCalls, 0)
}

{
  const current = harness()
  const oldest = await current.service.list(1, listRequest())
  for (let senderId = 2; senderId <= 33; senderId += 1) {
    await current.service.list(senderId, listRequest())
  }
  assert.equal((await current.service.select(1, selectionRequest(oldest.candidates[0]!.candidateId))).code,
    'candidate-expired', 'sender snapshots must be bounded and evict their tokens together')
}

{
  const current = harness({
    candidates: Array.from({ length: 16 }, (_, index) => candidate(`bounded-${index}`)),
  })
  const oldest = await current.service.list(100, listRequest())
  for (let senderId = 101; senderId <= 104; senderId += 1) {
    await current.service.list(senderId, listRequest())
  }
  assert.equal((await current.service.select(100, selectionRequest(oldest.candidates[0]!.candidateId))).code,
    'candidate-expired', 'the global opaque-token store must remain bounded')
}

{
  const tooMany = harness({ candidates: Array.from({ length: 17 }, (_, index) => candidate(`many-${index}`)) })
  const listed = await tooMany.service.list(1, listRequest())
  assert.equal(listed.state, 'incomplete')
  assert.equal(listed.code, 'discovery-incomplete')
  assert.deepEqual(listed.candidates, [])
}

for (const install of ['adopted', 'home-managed'] as const) {
  const current = harness({ install })
  const listed = await current.service.list(1, listRequest())
  assert.equal(listed.state, 'not-applicable')
  assert.equal(listed.canBrowse, false)
  assert.equal(listed.canSelect, false)
  assert.equal(current.discoveryCalls, 0)
}
{
  const current = harness({ install: 'unknown' })
  const listed = await current.service.list(1, listRequest())
  assert.equal(listed.state, 'incomplete')
  assert.equal(listed.code, 'status-unavailable')
  assert.equal(listed.canBrowse, false)
}

{
  const canceled = harness()
  const result = await canceled.service.browse(1, event(1), browseRequest())
  assert.equal(result.canceled, true)
  assert.equal(result.list.state, 'complete')
  assert.equal(canceled.browseCalls, 1)
  assertRedacted(result)

  const invalid = harness({ choose: async () => '/invalid' })
  const invalidResult = await invalid.service.browse(1, event(1), browseRequest())
  assert.equal(invalidResult.canceled, false)
  assert.equal(invalidResult.list.state, 'incomplete')
  assert.deepEqual(invalidResult.list.candidates, [])
}

{
  let chooseCalls = 0
  const windows = harness({ choose: async () => { chooseCalls += 1; return 'C:\\secret' }, platform: 'win32' })
  const listed = await windows.service.list(1, listRequest())
  assert.equal(listed.state, 'unsupported')
  assert.equal(listed.code, 'unsupported-platform')
  assert.equal(listed.candidates.length, 1, 'Windows may list redacted candidates')
  assert.equal(listed.canBrowse, false)
  assert.equal(listed.canSelect, false)
  assert.equal((await windows.service.browse(1, event(1), browseRequest())).list.state, 'unsupported')
  assert.equal(chooseCalls, 0, 'Windows must reject Browse before opening a chooser')
  assert.equal((await windows.service.select(1, selectionRequest(listed.candidates[0]!.candidateId))).code,
    'unsupported-platform')
  assert.equal(windows.persistenceCalls, 0, 'Windows must reject selection before persistence')
}

{
  const busy = harness({ lease: () => null })
  const listed = await busy.service.list(1, listRequest())
  assert.equal((await busy.service.select(1, selectionRequest(listed.candidates[0]!.candidateId))).code,
    'operation-in-progress')
  assert.equal(busy.persistenceCalls, 0)
}

for (const [persistKind, outcome, code] of [
  ['blocked', 'blocked', 'candidate-changed'],
  ['unknown', 'failed', 'persistence-unknown'],
  ['unchanged', 'completed', null],
] as const) {
  const current = harness({ persistKind })
  const listed = await current.service.list(1, listRequest())
  const result = await current.service.select(1, selectionRequest(listed.candidates[0]!.candidateId))
  assert.equal(result.outcome, outcome)
  assert.equal(result.code, code)
  assert.equal(current.persistenceCalls, 1)
  assertRedacted(result)
}

console.log('Home v2 Qortal adoption contract checks passed.')
