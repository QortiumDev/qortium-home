import assert from 'node:assert/strict'
import type { IpcMainInvokeEvent } from 'electron'
import type { CoreManagerEntry } from './core-manager.js'
import {
  createAuthorizedHomeV2CoreManagerHandlers,
  createHomeV2CoreManagerService,
} from './home-v2-core-manager-contract.js'

function qortalStatus(overrides: Record<string, unknown> = {}) {
  return {
    capabilities: {
      canInitialInstall: false,
      canStart: true,
      canStop: false,
      canUpdate: false,
    },
    install: {
      candidate: { canonicalJarPath: '/secret/qortal.jar' },
      kind: 'adopted',
      record: { apiKeyPath: '/secret/apikey.txt' },
    },
    runtime: { state: 'stopped' },
    updateOwnership: { kind: 'unknown', reason: 'secret policy evidence' },
    ...overrides,
  }
}

function qortalManager(options: {
  action?: () => Promise<unknown>
  getStatus?: () => Promise<unknown>
} = {}) {
  return {
    getStatus: options.getStatus ?? (async () => qortalStatus()),
    networkId: 'qortal',
    start: options.action ?? (async () => ({ kind: 'started', authority: {}, javaSource: 'system' })),
    stop: options.action ?? (async () => ({ kind: 'stopped' })),
  } as unknown as CoreManagerEntry
}

function qortiumStatus(overrides: Record<string, unknown> = {}) {
  return {
    apiKeyPath: '/secret/apikey.txt',
    installed: {
      installPath: '/secret/install',
      jarPath: '/secret/qortium.jar',
      tagName: 'v9.9.9-secret',
    },
    java: { available: true, path: '/secret/java' },
    runtime: {
      apiKeyPath: '/secret/apikey.txt',
      owner: 'home',
      pid: 4242,
      running: false,
      runtimePath: '/secret/runtime',
    },
    supported: true,
    ...overrides,
  }
}

function qortiumManager(options: {
  action?: () => Promise<unknown>
  getStatus?: () => Promise<unknown>
} = {}) {
  const action = options.action ?? (async () => qortiumStatus({ runtime: { running: true } }))
  return {
    getStatus: options.getStatus ?? (async () => qortiumStatus()),
    networkId: 'qortium',
    start: action,
    startForHomeV2: action,
    stop: action,
    stopForHomeV2: action,
  } as unknown as CoreManagerEntry
}

function assertRedacted(value: unknown) {
  const serialized = JSON.stringify(value)
  for (const forbidden of [
    '/secret',
    'apiKey',
    'authority',
    'cause',
    'pid',
    'record',
    'token',
    'updateOwnership',
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, 'i'))
  }
}

{
  let resolverCalls = 0
  const service = createHomeV2CoreManagerService(() => {
    resolverCalls += 1
    return qortalManager()
  })
  await assert.rejects(service.getStatus({ network: 'other' }), /Choose Qortal or Qortium/)
  assert.equal(resolverCalls, 0)
  await assert.rejects(
    service.getStatus({ network: 'qortal', extra: true }),
    /one network/,
  )
  assert.equal(resolverCalls, 0)
}

{
  let serviceCalls = 0
  const handlers = createAuthorizedHomeV2CoreManagerHandlers(
    () => {
      throw new Error('unauthorized')
    },
    {
      getMaintenanceStatus: async () => { serviceCalls += 1; return {} as never },
      checkMaintenanceRelease: async () => { serviceCalls += 1; return {} as never },
      runMaintenanceAction: async () => { serviceCalls += 1; return {} as never },
      getStatus: async () => { serviceCalls += 1; return {} as never },
      start: async () => { serviceCalls += 1; return {} as never },
      stop: async () => { serviceCalls += 1; return {} as never },
    },
  )
  assert.throws(
    () => handlers.start({} as IpcMainInvokeEvent, { network: 'qortal' }),
    /unauthorized/,
  )
  assert.throws(
    () => handlers.runMaintenanceAction({} as IpcMainInvokeEvent, { raw: '/secret' }),
    /unauthorized/,
  )
  assert.equal(serviceCalls, 0)
}

function maintenanceManager(options: {
  installed?: Record<string, unknown> | null
  java?: Record<string, unknown>
  onInstall?: (request: unknown) => Promise<unknown>
  onInstallJava?: () => Promise<unknown>
  observedRuntime?: 'running' | 'stopped' | 'unknown'
  release?: Record<string, unknown>
  prerelease?: Record<string, unknown>
  stable?: Record<string, unknown>
  runtime?: Record<string, unknown>
} = {}) {
  const status = () => qortiumStatus({
    installed: options.installed === undefined
      ? null
      : options.installed,
    java: options.java ?? {
      available: false,
      majorVersion: null,
      managedJavaTarget: 25,
      managedUpgradeAvailable: false,
      path: '/secret/java',
      source: 'missing',
      version: null,
    },
    runtime: options.runtime ?? { owner: 'home', running: false },
  })
  const unavailable = {
    available: false,
    channel: 'stable',
    message: '/secret/raw release error',
  }
  return {
    checkReleases: async () => ({
      prerelease: options.prerelease ?? options.release ?? unavailable,
      stable: options.stable ?? options.release ?? unavailable,
    }),
    getStatus: async () => status(),
    getMaintenanceRuntimeStateForHomeV2: async () => options.observedRuntime ?? 'stopped',
    install: options.onInstall ?? (async () => status()),
    installJava: options.onInstallJava ?? (async () => status()),
    networkId: 'qortium',
    startForHomeV2: async () => status(),
    stopForHomeV2: async () => status(),
  } as unknown as CoreManagerEntry
}

{
  const service = createHomeV2CoreManagerService(() => maintenanceManager())
  await assert.rejects(service.getMaintenanceStatus({}), /exact Core maintenance request/i)
  await assert.rejects(
    service.checkMaintenanceRelease({
      channel: 'stable',
      revision: 1,
      schema: 'home-v2-core-maintenance-release-request',
    }),
    /exact Core maintenance release request/i,
  )
}

{
  const manager = maintenanceManager()
  const service = createHomeV2CoreManagerService(() => manager)
  const status = await service.getMaintenanceStatus({
    revision: 1,
    schema: 'home-v2-core-maintenance-request',
  })
  assert.equal(status.capabilities.canInitialInstall, true)
  assert.equal(status.capabilities.canInstallJava, true)
  assert.equal(status.core.installedVersion, null)
  assert.equal(status.java.source, 'missing')
  assertRedacted(status)
}

{
  const release = {
    asset: { digest: '/secret/digest', downloadUrl: '/secret/url', name: 'secret.zip', size: 123 },
    available: true,
    channel: 'prerelease',
    commit: 'a'.repeat(40),
    commitTimestamp: '/secret/time',
    htmlUrl: '/secret/html',
    name: '/secret/name',
    publishedAt: '/secret/published',
    tagName: 'v1.2.3',
  }
  let installRequest: unknown = null
  const manager = maintenanceManager({
    onInstall: async (request) => { installRequest = request; return {} },
    release,
  })
  const service = createHomeV2CoreManagerService(() => manager)
  const checked = await service.checkMaintenanceRelease({
    revision: 1,
    schema: 'home-v2-core-maintenance-release-request',
  })
  assert.deepEqual(checked, {
    action: 'initial-install',
    available: true,
    channel: 'prerelease',
    // Both channels carry the same tag here, so the prerelease is NOT offered:
    // it must be strictly newer than the stable release to join the list.
    offers: [{ channel: 'stable', relation: 'initial-install', tag: 'v1.2.3' }],
    revision: 1,
    schema: 'home-v2-core-maintenance-release',
    tag: 'v1.2.3',
  })
  assertRedacted(checked)
  const result = await service.runMaintenanceAction({
    action: 'initial-install',
    channel: 'prerelease',
    expectedTag: 'v1.2.3',
    revision: 1,
    schema: 'home-v2-core-maintenance-mutation-request',
  })
  assert.equal(result.outcome, 'completed')
  assert.deepEqual(installRequest, {
    channel: 'prerelease',
    expectedTag: 'v1.2.3',
    mode: 'initial-install',
  })
  assertRedacted(result)
}

{
  const manager = maintenanceManager({
    installed: { channel: 'stable', jarSemver: '1.2.3', tagName: 'v1.2.3' },
    release: {
      asset: { digest: '/secret', downloadUrl: '/secret', name: 'secret', size: 1 },
      available: true,
      channel: 'stable',
      commit: 'a'.repeat(40),
      commitTimestamp: '',
      htmlUrl: '',
      name: '',
      publishedAt: '',
      tagName: 'v1.2.3',
    },
  })
  const checked = await createHomeV2CoreManagerService(() => manager).checkMaintenanceRelease({
    revision: 1,
    schema: 'home-v2-core-maintenance-release-request',
  })
  assert.equal(checked.channel, 'stable')
  assert.equal(checked.action, 'none')
  assertRedacted(checked)
}

{
  const service = createHomeV2CoreManagerService((network) =>
    network === 'qortal' ? qortalManager() : qortiumManager())
  const qortal = await service.getStatus({ network: 'qortal' })
  assert.deepEqual(qortal, {
    capabilities: { canStart: true, canStop: false },
    control: 'api-only',
    install: 'adopted',
    issue: null,
    network: 'qortal',
    revision: 1,
    runtime: 'stopped',
    schema: 'home-v2-core-manager',
  })
  assertRedacted(qortal)
  const qortium = await service.getStatus({ network: 'qortium' })
  assert.equal(qortium.control, 'full')
  assert.equal(qortium.install, 'home-managed')
  assert.deepEqual(qortium.capabilities, { canStart: true, canStop: false })
  assertRedacted(qortium)
}

{
  const statuses = [
    qortiumStatus({ java: { available: false }, runtime: { owner: 'home', running: false } }),
    qortiumStatus({ installed: null, runtime: { owner: 'external', running: true } }),
    qortiumStatus({ runtime: { blocked: { markerPath: '/secret/marker' }, owner: 'home', running: true } }),
    qortiumStatus({ runtime: { owner: 'external', running: true }, supported: false }),
  ]
  for (const [index, status] of statuses.entries()) {
    const normalized = await createHomeV2CoreManagerService(() =>
      qortiumManager({ getStatus: async () => status })).getStatus({ network: 'qortium' })
    if (index === 0) assert.equal(normalized.capabilities.canStart, false)
    if (index === 1) {
      assert.equal(normalized.capabilities.canStop, true)
      assert.equal(normalized.control, 'api-only')
    }
    if (index === 2) {
      assert.equal(normalized.capabilities.canStop, true)
      assert.equal(normalized.control, 'full')
    }
    if (index === 3) {
      assert.deepEqual(normalized.capabilities, { canStart: false, canStop: false })
      assert.equal(normalized.control, 'none')
      assert.equal(normalized.issue, 'unsupported-platform')
    }
    assertRedacted(normalized)
  }
  const unknownQortal = await createHomeV2CoreManagerService(() =>
    qortalManager({ getStatus: async () => qortalStatus({
      capabilities: { canInitialInstall: false, canStart: false, canStop: false, canUpdate: false },
      runtime: { reason: '/secret/native observer', state: 'unknown' },
    }) })).getStatus({ network: 'qortal' })
  assert.equal(unknownQortal.control, 'observe-only')
  assertRedacted(unknownQortal)
}

{
  const service = createHomeV2CoreManagerService(() => {
    throw new Error('/secret/registry details')
  })
  const status = await service.getStatus({ network: 'qortal' })
  assert.equal(status.issue, 'manager-unavailable')
  assertRedacted(status)
}

for (const fixture of [
  {
    code: null,
    expectedCode: null,
    expectedOutcome: 'completed',
    kind: 'started',
  },
  {
    code: 'api-key-unavailable',
    expectedCode: 'api-key-unavailable',
    expectedOutcome: 'blocked',
    kind: 'blocked',
  },
  {
    code: null,
    expectedCode: 'action-unconfirmed',
    expectedOutcome: 'unconfirmed',
    kind: 'start-unconfirmed',
  },
  {
    code: null,
    expectedCode: 'operation-failed',
    expectedOutcome: 'failed',
    kind: 'failed',
  },
] as const) {
  let statusReads = 0
  const manager = qortalManager({
    action: async () => ({
      action: 'start',
      authority: { canonicalJarPath: '/secret/qortal.jar' },
      cause: new Error('/secret/cause'),
      code: fixture.code,
      kind: fixture.kind,
      reason: '/secret/reason',
      receipt: { pid: 99 },
      runtime: { reason: '/secret/runtime', state: 'unknown' },
    }),
    getStatus: async () => {
      statusReads += 1
      return qortalStatus()
    },
  })
  const result = await createHomeV2CoreManagerService(() => manager).start({
    network: 'qortal',
  })
  assert.equal(result.outcome, fixture.expectedOutcome)
  assert.equal(result.code, fixture.expectedCode)
  assert.equal(result.warning, null)
  assert.equal(statusReads, 2)
  assertRedacted(result)
}

{
  const manager = qortalManager({
    action: async () => ({
      action: 'start',
      cause: new Error('/secret/warning'),
      kind: 'completed-with-warning',
      outcome: { authority: { pid: 1 }, javaSource: 'system', kind: 'started' },
    }),
  })
  const result = await createHomeV2CoreManagerService(() => manager).start({
    network: 'qortal',
  })
  assert.equal(result.outcome, 'completed')
  assert.equal(result.code, null)
  assert.equal(result.warning, 'operation-lock-release-failed')
  assertRedacted(result)
}

for (const nested of [
  { code: 'process-ownership-unproven', kind: 'blocked', reason: '/secret/reason' },
  { kind: 'start-unconfirmed', receipt: { pid: 7 }, runtime: { state: 'unknown' } },
] as const) {
  const manager = qortalManager({
    action: async () => ({
      action: 'start',
      cause: new Error('/secret/warning'),
      kind: 'completed-with-warning',
      outcome: nested,
    }),
  })
  const result = await createHomeV2CoreManagerService(() => manager).start({
    network: 'qortal',
  })
  assert.equal(
    result.outcome,
    nested.kind === 'blocked' ? 'blocked' : 'unconfirmed',
  )
  assert.equal(result.warning, 'operation-lock-release-failed')
  assertRedacted(result)
}

{
  const manager = qortalManager({
    action: async () => ({
      action: 'stop',
      cause: new Error('/secret/stop warning'),
      kind: 'completed-with-warning',
      outcome: { kind: 'stopped' },
    }),
    getStatus: async () => qortalStatus({
      capabilities: { canInitialInstall: false, canStart: false, canStop: true, canUpdate: false },
      runtime: { authority: { pid: 42 }, state: 'running' },
    }),
  })
  const result = await createHomeV2CoreManagerService(() => manager).stop({
    network: 'qortal',
  })
  assert.equal(result.outcome, 'completed')
  assert.equal(result.warning, 'operation-lock-release-failed')
  assertRedacted(result)
}

{
  let statusReads = 0
  const manager = qortiumManager({
    action: async () => { throw new Error('/secret/action failure') },
    getStatus: async () => {
      statusReads += 1
      return qortiumStatus()
    },
  })
  const result = await createHomeV2CoreManagerService(() => manager).start({
    network: 'qortium',
  })
  assert.equal(result.outcome, 'failed')
  assert.equal(result.code, 'operation-failed')
  assert.equal(result.warning, null)
  assert.equal(statusReads, 2)
  assertRedacted(result)
}

{
  let releaseAction!: () => void
  const actionGate = new Promise<void>((resolve) => { releaseAction = resolve })
  const manager = qortalManager({ action: async () => {
    await actionGate
    return { authority: {}, javaSource: 'system', kind: 'started' }
  } })
  const service = createHomeV2CoreManagerService(() => manager)
  const first = service.start({ network: 'qortal' })
  await Promise.resolve()
  const second = await service.start({ network: 'qortal' })
  assert.equal(second.outcome, 'blocked')
  assert.equal(second.code, 'operation-in-progress')
  releaseAction()
  assert.equal((await first).outcome, 'completed')
}

{
  let releaseAction!: () => void
  const actionGate = new Promise<void>((resolve) => { releaseAction = resolve })
  const qortal = qortalManager({ action: async () => {
    await actionGate
    return { authority: {}, javaSource: 'system', kind: 'started' }
  } })
  const qortium = qortiumManager()
  const service = createHomeV2CoreManagerService((network) =>
    network === 'qortal' ? qortal : qortium)
  const first = service.start({ network: 'qortal' })
  await Promise.resolve()
  const second = await service.start({ network: 'qortium' })
  assert.equal(second.outcome, 'blocked')
  assert.equal(second.code, 'operation-in-progress')
  releaseAction()
  await first
}

{
  let releaseJava!: () => void
  const javaGate = new Promise<void>((resolve) => { releaseJava = resolve })
  const qortal = qortalManager()
  const qortium = maintenanceManager({
    onInstallJava: async () => {
      await javaGate
      return qortiumStatus()
    },
  })
  const service = createHomeV2CoreManagerService((network) =>
    network === 'qortal' ? qortal : qortium)
  const javaInstall = service.runMaintenanceAction({
    action: 'install-java',
    revision: 1,
    schema: 'home-v2-core-maintenance-mutation-request',
  })
  await Promise.resolve()
  const qortalStart = await service.start({ network: 'qortal' })
  assert.equal(qortalStart.outcome, 'blocked')
  assert.equal(qortalStart.code, 'operation-in-progress')
  releaseJava()
  assert.equal((await javaInstall).outcome, 'completed')
}

// --- Updating a RUNNING, Home-started Core is allowed -------------------
// The tester's report: "installing core update should stop and start core for
// you — someone had to manually stop the core first." Home 2 refused every
// install while the Core ran, even though core-manager's stop -> replace ->
// restart dance existed and was reachable from the Home 1.x path.
{
  const release = {
    asset: { digest: '/secret/digest', downloadUrl: '/secret/url', name: 'secret.zip', size: 123 },
    available: true,
    channel: 'prerelease',
    commit: 'a'.repeat(40),
    commitTimestamp: '/secret/time',
    htmlUrl: '/secret/html',
    name: '/secret/name',
    publishedAt: '/secret/published',
    tagName: 'v2.0.0',
  }
  let installRequest: unknown = null
  const manager = maintenanceManager({
    installed: { channel: 'prerelease', jarSemver: '1.0.0', tagName: 'v1.0.0' },
    onInstall: async (request) => { installRequest = request; return {} },
    release,
    // Running, and Home started it — so Home may stop it.
    runtime: { owner: 'home', running: true },
    observedRuntime: 'running',
  })
  const service = createHomeV2CoreManagerService(() => manager)
  await service.checkMaintenanceRelease({
    revision: 1,
    schema: 'home-v2-core-maintenance-release-request',
  })
  const result = await service.runMaintenanceAction({
    action: 'strict-update',
    channel: 'prerelease',
    expectedTag: 'v2.0.0',
    revision: 1,
    schema: 'home-v2-core-maintenance-mutation-request',
  })
  assert.equal(result.outcome, 'completed', 'a Home-owned running Core may be updated in place')
  assert.deepEqual(installRequest, {
    channel: 'prerelease',
    expectedTag: 'v2.0.0',
    mode: 'strict-update',
  })
  assert.equal(result.status.capabilities.canUpdateRunningInPlace, true)
}

// ...but NOT when Home did not start it: stopping someone else's process is
// not Home's to do.
{
  const manager = maintenanceManager({
    installed: { channel: 'prerelease', jarSemver: '1.0.0', tagName: 'v1.0.0' },
    onInstall: async () => { throw new Error('must not install') },
    release: {
    asset: { digest: '/secret/digest', downloadUrl: '/secret/url', name: 'secret.zip', size: 123 },
    available: true,
    channel: 'prerelease',
    commit: 'a'.repeat(40),
    commitTimestamp: '/secret/time',
    htmlUrl: '/secret/html',
    name: '/secret/name',
    publishedAt: '/secret/published',
    tagName: 'v2.0.0',
  },
    runtime: { owner: 'external', running: true },
    observedRuntime: 'running',
  })
  const service = createHomeV2CoreManagerService(() => manager)
  await service.checkMaintenanceRelease({
    revision: 1,
    schema: 'home-v2-core-maintenance-release-request',
  })
  const result = await service.runMaintenanceAction({
    action: 'strict-update',
    channel: 'prerelease',
    expectedTag: 'v2.0.0',
    revision: 1,
    schema: 'home-v2-core-maintenance-mutation-request',
  })
  assert.equal(result.outcome, 'blocked')
  assert.equal(result.code, 'action-not-allowed')
  assert.equal(result.status.capabilities.canUpdateRunningInPlace, false)
}

// ...and an INITIAL INSTALL over a running Core is still refused: there is no
// previous version to restore if it fails.
{
  const manager = maintenanceManager({
    installed: null,
    onInstall: async () => { throw new Error('must not install') },
    release: {
    asset: { digest: '/secret/digest', downloadUrl: '/secret/url', name: 'secret.zip', size: 123 },
    available: true,
    channel: 'prerelease',
    commit: 'a'.repeat(40),
    commitTimestamp: '/secret/time',
    htmlUrl: '/secret/html',
    name: '/secret/name',
    publishedAt: '/secret/published',
    tagName: 'v2.0.0',
  },
    runtime: { owner: 'home', running: true },
    observedRuntime: 'running',
  })
  const service = createHomeV2CoreManagerService(() => manager)
  await service.checkMaintenanceRelease({
    revision: 1,
    schema: 'home-v2-core-maintenance-release-request',
  })
  const result = await service.runMaintenanceAction({
    action: 'initial-install',
    channel: 'prerelease',
    expectedTag: 'v2.0.0',
    revision: 1,
    schema: 'home-v2-core-maintenance-mutation-request',
  })
  assert.equal(result.outcome, 'blocked')
  assert.equal(result.status.capabilities.canUpdateRunningInPlace, false, 'no install to roll back to')
}

// Which releases are OFFERED. The owner's rule: always offer the newest stable,
// offer the newest prerelease only when it is strictly newer than that stable,
// and let the same version through as a reinstall (the repair case).
{
  const rel = (channel: string, tagName: string) => ({
    asset: { digest: 'd', downloadUrl: 'u', name: 'n.zip', size: 1 },
    available: true, channel, commit: 'b'.repeat(40), commitTimestamp: 't',
    htmlUrl: 'h', name: 'n', publishedAt: 'p', tagName,
  })
  const offersFor = async (
    stable: Record<string, unknown> | undefined,
    prerelease: Record<string, unknown> | undefined,
    installedVersion: string | null,
  ) => {
    const manager = maintenanceManager({
      prerelease, stable,
      installed: installedVersion ? { jarSemver: installedVersion, tagName: installedVersion } : null,
    })
    const checked = await createHomeV2CoreManagerService(() => manager).checkMaintenanceRelease({
      revision: 1, schema: 'home-v2-core-maintenance-release-request',
    })
    assertRedacted(checked)
    return checked.offers
  }

  // A newer prerelease joins the stable one.
  assert.deepEqual(await offersFor(rel('stable', '1.7.0'), rel('prerelease', '1.8.0'), '1.6.0'), [
    { channel: 'stable', relation: 'update', tag: '1.7.0' },
    { channel: 'prerelease', relation: 'update', tag: '1.8.0' },
  ])

  // A prerelease that TRAILS the stable release is not offered at all.
  assert.deepEqual(await offersFor(rel('stable', '1.8.0'), rel('prerelease', '1.7.0'), '1.6.0'), [
    { channel: 'stable', relation: 'update', tag: '1.8.0' },
  ])

  // Same version is NOT offered. core-manager has only 'initial-install' and
  // 'strict-update' modes; every guard tests for one of those by name, so an
  // invented 'reinstall' mode would skip the commit verification and the
  // activation-safety check rather than repair anything.
  assert.deepEqual(await offersFor(rel('stable', '1.7.0'), undefined, '1.7.0'), [])

  // Nothing installed yet.
  assert.deepEqual(await offersFor(rel('stable', '1.7.0'), undefined, null), [
    { channel: 'stable', relation: 'initial-install', tag: '1.7.0' },
  ])

  // Older than installed is withheld until the downgrade confirmation round
  // trip is wired through the contract.
  assert.deepEqual(await offersFor(rel('stable', '1.5.0'), undefined, '1.7.0'), [])
}

console.log('Home v2 Core-manager contract tests passed.')
