import assert from 'node:assert/strict'
import {
  createHomeV2CoreUpdatePolicyEngine,
  createHomeV2CoreUpdatePolicyScheduler,
} from './home-v2-core-update-policy-engine.js'
import type { HomeV2CoreUpdatePolicySettings } from './home-v2-core-update-policy-codec.js'

function settings(
  coreUpdatePolicy: HomeV2CoreUpdatePolicySettings['coreUpdatePolicy'],
  javaUpdatePolicy: HomeV2CoreUpdatePolicySettings['javaUpdatePolicy'],
  generation = 1,
): HomeV2CoreUpdatePolicySettings {
  return { coreUpdatePolicy, generation, javaUpdatePolicy, storageIssue: null }
}

function managerFixture(options: {
  runtime?: 'running' | 'stopped' | 'unknown'
  runtimeThrows?: boolean
  coreAvailable?: boolean
  installed?: boolean
  javaAvailable?: boolean
} = {}) {
  const calls = {
    check: 0,
    coreDownload: 0,
    coreInstall: 0,
    javaDownload: 0,
    javaInstall: 0,
    refreshJava: 0,
  }
  const rawStatus = {
    installed: options.installed === false ? null : {
      channel: 'prerelease',
      jarSemver: '1.0.0',
      tagName: 'v1.0.0',
    },
    java: {
      managedUpgradeAvailable: options.javaAvailable === true,
      source: 'managed',
      updateAvailableVersion: options.javaAvailable === true ? '25.0.2+1' : null,
    },
  }
  const manager = {
    networkId: 'qortium' as const,
    checkReleases: async () => {
      calls.check += 1
      return {
        prerelease: options.coreAvailable === true
          ? { available: true, channel: 'prerelease', commit: 'a'.repeat(40), tagName: 'v1.1.0' }
          : { available: false, channel: 'prerelease', message: 'none' },
        stable: { available: false, channel: 'stable', message: 'none' },
      }
    },
    getMaintenanceRuntimeStateForHomeV2: async () => {
      if (options.runtimeThrows) throw new Error('runtime unavailable')
      return options.runtime ?? 'stopped'
    },
    getAutomaticUpdateStatusForHomeV2: async ({ refreshManagedJava }: {
      refreshManagedJava: boolean
    }) => {
      if (refreshManagedJava) calls.refreshJava += 1
      return rawStatus
    },
    getStatus: async () => rawStatus,
    installCoreAutomaticallyForHomeV2: async (request: {
      activationLease?: () => Promise<void | (() => void)>
      preDownloadGuard?: () => Promise<void>
    }) => {
      calls.coreInstall += 1
      await request.preDownloadGuard?.()
      calls.coreDownload += 1
      const release = await request.activationLease?.()
      release?.()
      return rawStatus
    },
    installJavaAutomaticallyForHomeV2: async (request: {
      activationLease?: () => Promise<void | (() => void)>
      preDownloadGuard?: () => Promise<void>
    }) => {
      calls.javaInstall += 1
      await request.preDownloadGuard?.()
      calls.javaDownload += 1
      const release = await request.activationLease?.()
      release?.()
      return rawStatus
    },
  }
  return { calls, manager }
}

{
  const fixture = managerFixture({ coreAvailable: true, installed: false })
  const engine = createHomeV2CoreUpdatePolicyEngine({
    readSettings: async () => settings('notify', 'off'),
    resolveManager: () => fixture.manager as never,
  })
  await engine.runPass()
  assert.equal(fixture.calls.check, 0)
  assert.equal(fixture.calls.coreInstall, 0)
}

{
  const fixture = managerFixture({ coreAvailable: true, javaAvailable: true })
  const engine = createHomeV2CoreUpdatePolicyEngine({
    readSettings: async () => settings('off', 'off'),
    resolveManager: () => fixture.manager as never,
  })
  await engine.runPass()
  assert.deepEqual(fixture.calls, {
    check: 0,
    coreDownload: 0,
    coreInstall: 0,
    javaDownload: 0,
    javaInstall: 0,
    refreshJava: 0,
  })
}

{
  const fixture = managerFixture({ coreAvailable: true, javaAvailable: true })
  const engine = createHomeV2CoreUpdatePolicyEngine({
    readSettings: async () => settings('notify', 'notify'),
    resolveManager: () => fixture.manager as never,
  })
  const activity = await engine.runPass()
  assert.equal(activity.core.state, 'available')
  assert.equal(activity.java.state, 'available')
  assert.equal(fixture.calls.coreInstall, 0)
  assert.equal(fixture.calls.javaInstall, 0)
}

{
  const fixture = managerFixture({ coreAvailable: true, javaAvailable: true })
  const selected = settings('install', 'install')
  const engine = createHomeV2CoreUpdatePolicyEngine({
    readSettings: async () => selected,
    resolveManager: () => fixture.manager as never,
  })
  const activity = await engine.runPass()
  assert.equal(activity.core.state, 'up-to-date')
  assert.equal(activity.java.state, 'up-to-date')
  assert.equal(fixture.calls.coreInstall, 1)
  assert.equal(fixture.calls.javaInstall, 1)
  assert.equal(fixture.calls.coreDownload, 1)
  assert.equal(fixture.calls.javaDownload, 1)
}

{
  const fixture = managerFixture({ coreAvailable: true, runtime: 'running' })
  const engine = createHomeV2CoreUpdatePolicyEngine({
    readSettings: async () => settings('install', 'off'),
    resolveManager: () => fixture.manager as never,
  })
  const activity = await engine.runPass()
  assert.equal(activity.core.state, 'pending-safe-state')
  assert.equal(fixture.calls.coreInstall, 0)
}

{
  const fixture = managerFixture({ coreAvailable: true, javaAvailable: true, runtimeThrows: true })
  const engine = createHomeV2CoreUpdatePolicyEngine({
    readSettings: async () => settings('install', 'install'),
    resolveManager: () => fixture.manager as never,
  })
  const activity = await engine.runPass()
  assert.equal(activity.core.state, 'failed')
  assert.equal(activity.java.state, 'up-to-date')
  assert.equal(activity.issue, 'operation-failed')
}

{
  let generation = settings('install', 'off', 1)
  const fixture = managerFixture({ coreAvailable: true })
  fixture.manager.installCoreAutomaticallyForHomeV2 = async (request) => {
    fixture.calls.coreInstall += 1
    generation = settings('off', 'off', 2)
    await request.preDownloadGuard?.()
    fixture.calls.coreDownload += 1
    return await fixture.manager.getStatus()
  }
  const engine = createHomeV2CoreUpdatePolicyEngine({
    readSettings: async () => generation,
    resolveManager: () => fixture.manager as never,
  })
  const activity = await engine.runPass()
  assert.equal(activity.issue, 'policy-revoked')
  assert.equal(activity.core.state, 'failed')
  assert.equal(fixture.calls.coreDownload, 0)
}

{
  let scheduled = 0
  let intervals = 0
  let passes = 0
  const pass = { release: null as (() => void) | null }
  const scheduler = createHomeV2CoreUpdatePolicyScheduler(
    async () => {
      passes += 1
      await new Promise<void>((resolve) => { pass.release = resolve })
    },
    {
      setInterval: (() => { intervals += 1; return { unref() {} } }) as never,
      setTimeout: ((callback: () => void) => {
        scheduled += 1
        callback()
        return { unref() {} }
      }) as never,
    },
  )
  assert.equal(scheduler.start(), true)
  assert.equal(scheduler.start(), false)
  assert.equal(intervals, 1)
  assert.equal(scheduled, 1)
  await Promise.resolve()
  const first = scheduler.trigger()
  scheduler.trigger()
  pass.release?.()
  await first
  await Promise.resolve()
  assert.equal(passes, 2)
  scheduler.stop()
  await scheduler.trigger()
  assert.equal(passes, 2)
}

{
  let passes = 0
  let releasePass!: () => void
  const scheduler = createHomeV2CoreUpdatePolicyScheduler(
    async () => {
      passes += 1
      await new Promise<void>((resolve) => { releasePass = resolve })
    },
    {
      setInterval: (() => ({ unref() {} })) as never,
      setTimeout: ((callback: () => void) => {
        callback()
        return { unref() {} }
      }) as never,
    },
  )
  scheduler.start()
  await Promise.resolve()
  scheduler.trigger()
  scheduler.stop()
  releasePass()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(passes, 1)
}

console.log('Home 2 Core update policy engine tests passed.')
