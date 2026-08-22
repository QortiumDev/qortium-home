import assert from 'node:assert/strict'
import type { IpcMainInvokeEvent } from 'electron'
import type { CoreManagerEntry } from './core-manager.js'
import {
  createAuthorizedHomeV2QortalMaintenanceHandlers,
  createHomeV2QortalMaintenanceService,
  type HomeV2QortalMaintenanceDependencies,
} from './home-v2-qortal-maintenance-contract.js'
import type { QortalLatestReleaseSource } from './qortal-latest-release-source.js'

const COMMIT = 'a'.repeat(40)
const release = {
  asset: {
    digest: `sha256:${'b'.repeat(64)}`,
    downloadUrl: 'https://github.com/Qortal/qortal/releases/download/v6.2.0/qortal.jar',
    name: 'qortal.jar' as const,
    size: 123,
  },
  commit: COMMIT,
  tagName: 'v6.2.0',
}
const rawRelease = {
  assets: [{ private: '/secret', name: 'qortal.jar' }],
  draft: false,
  prerelease: false,
  tag_name: release.tagName,
  target_commitish: COMMIT,
}

function status(options: {
  install?: 'adopted' | 'home-managed' | 'missing' | 'unknown'
  ownership?: 'home-github' | 'node-native' | 'observe-only'
  runtime?: 'running' | 'stopped' | 'unknown'
  version?: string
} = {}) {
  const install = options.install ?? 'missing'
  const runtime = options.runtime ?? 'stopped'
  const ownership = options.ownership ?? 'observe-only'
  const version = options.version ?? '6.1.9'
  return {
    capabilities: {
      canInitialInstall: install === 'missing' && runtime === 'stopped',
      canStart: false,
      canStop: false,
      canUpdate: install === 'home-managed' && runtime === 'stopped' && ownership === 'home-github',
    },
    install: install === 'home-managed'
      ? { kind: install, record: { jarIdentity: { semver: version }, private: '/secret' } }
      : install === 'adopted'
        ? { kind: install, record: { adoptedJar: { semver: version }, private: '/secret' } }
        : install === 'unknown'
          ? { kind: install, reason: '/secret install reason' }
          : { kind: install },
    runtime: runtime === 'running'
      ? { authority: { pid: 42, private: '/secret' }, state: runtime }
      : runtime === 'unknown'
        ? { reason: '/secret runtime reason', state: runtime }
        : { state: runtime },
    updateOwnership: {
      detection: { reason: '/secret ownership evidence' },
      ownership,
    },
  }
}

function manager(options: {
  install?: (value: unknown) => Promise<unknown>
  status?: () => Promise<unknown>
  update?: (value: unknown) => Promise<unknown>
} = {}) {
  return {
    config: { paths: { installPath: '/secret/managed' } },
    getStatus: options.status ?? (async () => status()),
    install: options.install ?? (async () => ({ kind: 'installed', record: { private: '/secret' } })),
    networkId: 'qortal',
    update: options.update ?? (async () => ({ kind: 'updated', record: { private: '/secret' } })),
  } as unknown as CoreManagerEntry
}

function source(options: {
  expected?: QortalLatestReleaseSource['getExpectedLatest']
  latest?: QortalLatestReleaseSource['getLatest']
} = {}): QortalLatestReleaseSource {
  return {
    getExpectedLatest: options.expected ?? (async () => ({ kind: 'available', rawRelease, release })),
    getLatest: options.latest ?? (async () => ({ kind: 'available', release })),
  }
}

function service(options: {
  discovery?: HomeV2QortalMaintenanceDependencies['probeDiscovery']
  manager?: CoreManagerEntry
  source?: QortalLatestReleaseSource
} = {}) {
  return createHomeV2QortalMaintenanceService({
    probeDiscovery: options.discovery ?? (async () => 'clear'),
    releaseSource: options.source ?? source(),
    resolveManager: () => options.manager ?? manager(),
  })
}

function statusRequest(extra: Record<string, unknown> = {}) {
  return {
    network: 'qortal',
    revision: 1,
    schema: 'home-v2-qortal-maintenance-request',
    ...extra,
  }
}

function releaseRequest(extra: Record<string, unknown> = {}) {
  return {
    network: 'qortal',
    revision: 1,
    schema: 'home-v2-qortal-maintenance-release-request',
    ...extra,
  }
}

function mutationRequest(action: 'initial-install' | 'strict-update', extra: Record<string, unknown> = {}) {
  return {
    action,
    expectedTag: release.tagName,
    network: 'qortal',
    revision: 1,
    schema: 'home-v2-qortal-maintenance-mutation-request',
    ...extra,
  }
}

function assertRedacted(value: unknown) {
  const serialized = JSON.stringify(value)
  for (const forbidden of ['/secret', '"authority"', 'cause', 'digest', 'download', 'pid', 'rawRelease', 'reason', 'record']) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, 'i'))
  }
}

{
  let resolved = 0
  const exact = createHomeV2QortalMaintenanceService({
    probeDiscovery: async () => 'clear',
    releaseSource: source(),
    resolveManager: () => { resolved += 1; return manager() },
  })
  await assert.rejects(exact.getStatus({ ...statusRequest(), extra: true }), /exact Qortal maintenance/i)
  await assert.rejects(exact.getStatus({ ...statusRequest(), network: 'qortium' }), /exact Qortal maintenance/i)
  await assert.rejects(exact.runAction({ ...mutationRequest('initial-install'), expectedTag: ' v6.2.0' }), /exact Qortal maintenance/i)
  assert.equal(resolved, 0)
}

{
  let serviceCalls = 0
  const handlers = createAuthorizedHomeV2QortalMaintenanceHandlers(
    () => { throw new Error('unauthorized') },
    {
      checkRelease: async () => { serviceCalls += 1; return {} as never },
      getStatus: async () => { serviceCalls += 1; return {} as never },
      runAction: async () => { serviceCalls += 1; return {} as never },
    },
  )
  assert.throws(() => handlers.runAction({} as IpcMainInvokeEvent, { raw: '/secret' }), /unauthorized/)
  assert.equal(serviceCalls, 0)
}

for (const [discovery, canInstall] of [
  ['clear', true],
  ['candidate-found', false],
  ['multiple-candidates', false],
  ['unknown', false],
] as const) {
  const value = await service({ discovery: async () => discovery }).getStatus(statusRequest())
  assert.equal(value.discovery, discovery)
  assert.equal(value.capabilities.canInitialInstall, canInstall)
  assert.equal(value.capabilities.canCheckRelease, canInstall)
  assertRedacted(value)
}

for (const [ownership, canUpdate] of [
  ['home-github', true],
  ['node-native', false],
  ['observe-only', false],
] as const) {
  const value = await service({
    manager: manager({ status: async () => status({ install: 'home-managed', ownership }) }),
  }).getStatus(statusRequest())
  assert.equal(value.discovery, 'not-applicable')
  assert.equal(value.updateAuthority, ownership)
  assert.equal(value.capabilities.canUpdate, canUpdate)
  assert.equal(value.capabilities.canCheckRelease, canUpdate)
  assertRedacted(value)
}

{
  const checked = await service().checkRelease(releaseRequest())
  assert.deepEqual(checked, {
    action: 'initial-install',
    available: true,
    code: null,
    network: 'qortal',
    revision: 1,
    schema: 'home-v2-qortal-maintenance-release',
    tag: 'v6.2.0',
  })
  assertRedacted(checked)
  const update = await service({
    manager: manager({ status: async () => status({ install: 'home-managed', ownership: 'home-github' }) }),
  }).checkRelease(releaseRequest())
  assert.equal(update.action, 'strict-update')
  const current = await service({
    manager: manager({ status: async () => status({ install: 'home-managed', ownership: 'home-github', version: '6.2.0' }) }),
  }).checkRelease(releaseRequest())
  assert.equal(current.action, 'none')
  assert.equal(current.code, 'up-to-date')
}

{
  let installValue: unknown = null
  const result = await service({
    manager: manager({ install: async (value) => {
      installValue = value
      return { kind: 'installed', record: { private: '/secret' } }
    } }),
  }).runAction(mutationRequest('initial-install'))
  assert.equal(result.outcome, 'completed')
  assert.equal(result.code, null)
  assert.equal(result.warning, null)
  assert.equal(installValue, rawRelease, 'only the main-owned resolved release reaches the manager')
  assertRedacted(result)
}

{
  let probes = 0
  let installs = 0
  const result = await service({
    discovery: async () => (++probes < 2 ? 'clear' : 'candidate-found'),
    manager: manager({ install: async () => {
      installs += 1
      return { kind: 'installed', record: { private: '/secret' } }
    } }),
  }).runAction(mutationRequest('initial-install'))
  assert.equal(result.outcome, 'blocked')
  assert.equal(result.code, 'install-selection-required')
  assert.equal(installs, 0, 'candidate discovery must be revalidated before manager staging')
  assertRedacted(result)
}

for (const [managerCode, publicCode] of [
  ['adopted-unsupported', 'adopted-update-unsupported'],
  ['process-active', 'runtime-not-stopped'],
  ['release-not-newer', 'release-not-newer'],
  ['candidate-changed', 'target-changed'],
  ['update-node-native', 'update-node-native'],
  ['update-ownership-unknown', 'update-ownership-unknown'],
] as const) {
  const result = await service({
    manager: manager({
      status: async () => status({ install: 'home-managed', ownership: 'home-github' }),
      update: async () => ({ code: managerCode, kind: 'blocked', reason: '/secret' }),
    }),
  }).runAction(mutationRequest('strict-update'))
  assert.equal(result.outcome, 'blocked')
  assert.equal(result.code, publicCode)
  assertRedacted(result)
}

{
  const result = await service({
    manager: manager({
      status: async () => status({ install: 'home-managed', ownership: 'home-github' }),
      update: async () => ({
        action: 'update',
        cause: new Error('/secret warning'),
        kind: 'completed-with-warning',
        outcome: { kind: 'updated', record: { private: '/secret' } },
      }),
    }),
  }).runAction(mutationRequest('strict-update'))
  assert.equal(result.outcome, 'completed')
  assert.equal(result.warning, 'cleanup-incomplete')
  assertRedacted(result)
}

{
  let releaseGate!: () => void
  const gate = new Promise<void>((resolve) => { releaseGate = resolve })
  const busySource = source({ expected: async () => {
    await gate
    return { kind: 'available', rawRelease, release }
  } })
  const current = service({ source: busySource })
  const first = current.runAction(mutationRequest('initial-install'))
  await Promise.resolve()
  const second = await current.runAction(mutationRequest('initial-install'))
  assert.equal(second.outcome, 'blocked')
  assert.equal(second.code, 'operation-in-progress')
  releaseGate()
  assert.equal((await first).outcome, 'completed')
}

console.log('Home v2 Qortal maintenance contract tests passed.')
