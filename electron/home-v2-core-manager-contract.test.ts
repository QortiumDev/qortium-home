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
      getStatus: async () => { serviceCalls += 1; return {} as never },
      start: async () => { serviceCalls += 1; return {} as never },
      stop: async () => { serviceCalls += 1; return {} as never },
    },
  )
  assert.throws(
    () => handlers.start({} as IpcMainInvokeEvent, { network: 'qortal' }),
    /unauthorized/,
  )
  assert.equal(serviceCalls, 0)
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

console.log('Home v2 Core-manager contract tests passed.')
