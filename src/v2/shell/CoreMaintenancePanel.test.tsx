import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type {
  HomeV2CoreMaintenanceStatus,
  HomeV2CoreManagerClient,
  HomeV2CoreUpdatePolicyState,
} from '../../home-v2-live/core-manager-client'
import { parseHomeV2CoreUpdatePolicySetResult } from '../../home-v2-live/core-manager-client'
import { useHomeV2CoreMaintenance } from '../../home-v2-live/core-maintenance-controller'
import type { NetworkId } from '../contracts'
import type { HomeV2CoreManagement } from './CoreManagerCards'
import { CoreMaintenancePanel } from './CoreMaintenancePanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const status = {
  capabilities: { canInitialInstall: true, canInstallJava: true, canInstallOnChainUpdate: false, canRefreshHelpers: false, canUpdateRunningInPlace: false },
  core: { helpersOutOfSyncVersion: null, installModified: false, localApiUrl: null, update: null, updateSources: null, channel: null, installedCommit: null, installedTag: null, nodeAutoUpdateMode: null, runtimeBlockedReason: null, installedVersion: null, runtime: 'stopped' },
  java: { source: 'missing', targetMajorVersion: null, updateAvailable: false, version: null },
  revision: 1,
  schema: 'home-v2-core-maintenance',
} as const
let currentStatus: HomeV2CoreMaintenanceStatus = status
const actions: string[] = []
let revealCalls = 0
function policyState(
  generation: number,
  values: Partial<Pick<HomeV2CoreUpdatePolicyState,
    'coreUpdatePolicy' | 'javaUpdatePolicy' | 'qortalUpdatePolicy'>> = {},
): HomeV2CoreUpdatePolicyState {
  return {
  activity: {
    checkedAt: null,
    core: { channel: null, state: 'idle', version: null },
    generation,
    issue: null,
    java: { state: 'idle', version: null },
    qortal: { state: 'idle', version: null },
  },
  coreUpdatePolicy: values.coreUpdatePolicy ?? 'notify',
  generation,
  javaUpdatePolicy: values.javaUpdatePolicy ?? 'notify',
  qortalUpdatePolicy: values.qortalUpdatePolicy ?? 'notify',
  revision: 1,
  schema: 'home-v2-core-update-policy',
  settingsIssue: null,
  }
}
const policy = policyState(0)
let currentPolicy = policy
let conflictNextPolicyWrite = false
let blockedPolicyWrite: Promise<void> | null = null
const policySetCalls: Array<{ expectedGeneration: number; field: string; value: string }> = []
const client: HomeV2CoreManagerClient = {
  getMaintenanceStatus: async () => currentStatus,
  checkMaintenanceRelease: async () => ({
    action: 'initial-install', available: true, channel: 'prerelease', revision: 1,
    offers: [{ channel: 'prerelease' as const, relation: 'initial-install' as const, tag: 'v1.2.3' }],
    schema: 'home-v2-core-maintenance-release', tag: 'v1.2.3',
  }),
  runMaintenanceAction: async (action, release) => {
    actions.push(`${action}:${release?.expectedTag ?? ''}`)
    return { code: null, outcome: 'completed', revision: 1,
      downgrade: null,
      schema: 'home-v2-core-maintenance-action', status }
  },
  getUpdatePolicy: async () => currentPolicy,
  setUpdatePolicy: async (expectedGeneration, field, value) => {
    policySetCalls.push({ expectedGeneration, field, value })
    await blockedPolicyWrite
    if (conflictNextPolicyWrite) {
      conflictNextPolicyWrite = false
      currentPolicy = policyState(currentPolicy.generation + 1, {
        coreUpdatePolicy: currentPolicy.coreUpdatePolicy,
        javaUpdatePolicy: currentPolicy.javaUpdatePolicy,
        qortalUpdatePolicy: currentPolicy.qortalUpdatePolicy,
      })
      return {
        outcome: 'conflict', revision: 1,
        schema: 'home-v2-core-update-policy-set-result', state: currentPolicy,
      }
    }
    assert.equal(expectedGeneration, currentPolicy.generation)
    currentPolicy = policyState(currentPolicy.generation + 1, {
      coreUpdatePolicy: field === 'coreUpdatePolicy' ? value : currentPolicy.coreUpdatePolicy,
      javaUpdatePolicy: field === 'javaUpdatePolicy' ? value : currentPolicy.javaUpdatePolicy,
      qortalUpdatePolicy: field === 'qortalUpdatePolicy' ? value : currentPolicy.qortalUpdatePolicy,
    })
    return {
      outcome: 'saved', revision: 1,
      schema: 'home-v2-core-update-policy-set-result', state: currentPolicy,
    }
  },
  getStatus: async () => ({} as never),
  revealInstall: async () => {
    revealCalls += 1
    return true
  },
  start: async () => ({} as never),
  stop: async () => ({} as never),
}
window.homeV2CoreManagers = client

const management: HomeV2CoreManagement = {
  available: true,
  busyActions: { qortal: null, qortium: null },
  lastActions: { qortal: null, qortium: null },
  statuses: {} as never,
}

// The panel takes its controller as a prop now, so the app can own exactly one
// per domain. This harness stands in for HomeV2LiveApp: it calls the real
// controller hook and hands the whole return to the panel, so everything below
// still exercises the live polling, busy gating and serialized policy writes.
function CoreMaintenanceHarness({
  networks = ['qortium', 'qortal'],
}: {
  readonly networks?: readonly NetworkId[]
}) {
  const maintenance = useHomeV2CoreMaintenance({
    onCoreRefresh: management.onRefresh,
    qortalEnabled: networks.includes('qortal'),
    qortiumEnabled: networks.includes('qortium'),
  })
  return <CoreMaintenancePanel maintenance={maintenance} networks={networks} />
}

const container = document.createElement('div')
document.body.appendChild(container)
let root = createRoot(container)

function button(label: string) {
  const found = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)
  assert(found, `expected button ${label}`)
  return found as HTMLButtonElement
}

assert.throws(() => parseHomeV2CoreUpdatePolicySetResult({
  outcome: 'saved',
  revision: 1,
  schema: 'home-v2-core-update-policy-set-result',
  state: {
    ...policy,
    activity: { ...policy.activity, generation: 1 },
  },
}), /Invalid Home 2 Core update policy state/)
assert.throws(() => parseHomeV2CoreUpdatePolicySetResult({
  outcome: 'saved',
  revision: 1,
  schema: 'home-v2-core-update-policy-set-result',
  state: {
    ...policy,
    activity: {
      ...policy.activity,
      core: { ...policy.activity.core, version: 'v'.repeat(129) },
    },
  },
}), /Invalid Home 2 Core update policy state/)

try {
  await act(async () => {
    root.render(<CoreMaintenanceHarness />)
    await Promise.resolve()
  })
  assert.match(container.textContent ?? '', /Qortium Core maintenance/)
  assert.match(container.textContent ?? '', /Not installed/)
  assert.equal(container.querySelectorAll('select').length, 1)
  assert(container.querySelector('[data-home-v2-qortal-update-policy]'))
  assert.ok(button('Install Java'))

  await act(async () => { button('Check release').click(); await Promise.resolve() })
  assert.match(container.textContent ?? '', /v1\.2\.3 is ready for installation/)
  await act(async () => { button('Install Core').click(); await Promise.resolve() })
  assert.deepEqual(actions, ['initial-install:v1.2.3'])
  assert.match(container.textContent ?? '', /maintenance completed/)

  await act(async () => { button('Install Java').click(); await Promise.resolve() })
  assert.deepEqual(actions, ['initial-install:v1.2.3', 'install-java:'])

  act(() => root.unmount())
  currentStatus = {
    ...status,
    capabilities: { canInitialInstall: false, canInstallJava: true, canInstallOnChainUpdate: false, canRefreshHelpers: false, canUpdateRunningInPlace: false },
    core: { helpersOutOfSyncVersion: null, installModified: false, localApiUrl: null, update: null, updateSources: null, channel: 'prerelease', installedCommit: null, installedTag: null, nodeAutoUpdateMode: null, runtimeBlockedReason: null, installedVersion: '1.2.3', runtime: 'stopped' },
    java: { source: 'managed', targetMajorVersion: null, updateAvailable: true, version: '25.0.1' },
  }
  root = createRoot(container)
  await act(async () => {
    root.render(<CoreMaintenanceHarness />)
    await Promise.resolve()
  })
  const corePolicy = container.querySelector('[data-home-v2-core-update-policy]') as HTMLSelectElement
  const javaPolicy = container.querySelector('[data-home-v2-java-update-policy]') as HTMLSelectElement
  const qortalPolicy = container.querySelector('[data-home-v2-qortal-update-policy]') as HTMLSelectElement
  assert(corePolicy)
  assert(javaPolicy)
  assert(qortalPolicy)
  await act(async () => {
    corePolicy.value = 'install'
    corePolicy.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
  assert.equal(currentPolicy.coreUpdatePolicy, 'install')
  assert.equal(currentPolicy.generation, 1)

  conflictNextPolicyWrite = true
  await act(async () => {
    javaPolicy.value = 'install'
    javaPolicy.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal(currentPolicy.javaUpdatePolicy, 'install')
  assert.equal(currentPolicy.generation, 3)
  assert.deepEqual(policySetCalls.slice(-2).map(({ expectedGeneration, field }) => ({
    expectedGeneration,
    field,
  })), [
    { expectedGeneration: 1, field: 'javaUpdatePolicy' },
    { expectedGeneration: 2, field: 'javaUpdatePolicy' },
  ])

  await act(async () => {
    qortalPolicy.value = 'install'
    qortalPolicy.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
  assert.equal(currentPolicy.qortalUpdatePolicy, 'install')
  assert.equal(currentPolicy.generation, 4)

  let releaseBlockedWrite!: () => void
  blockedPolicyWrite = new Promise<void>((resolve) => { releaseBlockedWrite = resolve })
  const callCountBeforeRace = policySetCalls.length
  await act(async () => {
    corePolicy.value = 'off'
    corePolicy.dispatchEvent(new Event('change', { bubbles: true }))
    javaPolicy.value = 'off'
    javaPolicy.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal(policySetCalls.length, callCountBeforeRace + 1)
  blockedPolicyWrite = null
  await act(async () => {
    releaseBlockedWrite()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal(currentPolicy.coreUpdatePolicy, 'off')
  assert.equal(currentPolicy.javaUpdatePolicy, 'off')
  assert.equal(policySetCalls.length, callCountBeforeRace + 2)
  assert.deepEqual(policySetCalls.slice(-2).map(({ expectedGeneration, field }) => ({
    expectedGeneration,
    field,
  })), [
    { expectedGeneration: 4, field: 'coreUpdatePolicy' },
    { expectedGeneration: 5, field: 'javaUpdatePolicy' },
  ])

  await act(async () => {
    root.render(<CoreMaintenanceHarness networks={['qortal']} />)
    await Promise.resolve()
  })
  assert.equal(container.querySelector('[data-home-v2-core-update-policy]'), null)
  assert.ok(container.querySelector('[data-home-v2-qortal-update-policy]'))
  assert.match(container.textContent ?? '', /Managed Java/)

  await act(async () => {
    root.render(<CoreMaintenanceHarness networks={['qortium']} />)
    await Promise.resolve()
  })
  assert.ok(container.querySelector('[data-home-v2-core-update-policy]'))
  assert.equal(container.querySelector('[data-home-v2-qortal-update-policy]'), null)

  act(() => root.unmount())
  const getMaintenanceStatus = client.getMaintenanceStatus
  const getUpdatePolicy = client.getUpdatePolicy
  client.getMaintenanceStatus = async () => { throw new Error('unavailable') }
  client.getUpdatePolicy = async () => { throw new Error('unavailable') }
  root = createRoot(container)
  await act(async () => {
    root.render(<CoreMaintenanceHarness />)
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /status is unavailable/)
  client.getMaintenanceStatus = getMaintenanceStatus
  client.getUpdatePolicy = getUpdatePolicy

  // Show install folder reaches the main process, and no path is rendered.
  // 1.x had a reveal button; Home 2 dropped it along with the path text, but
  // only the path text was ever the thing this contract redacts.
  act(() => root.unmount())
  root = createRoot(container)
  await act(async () => {
    root.render(<CoreMaintenanceHarness />)
    await Promise.resolve()
    await Promise.resolve()
  })
  const revealButton = button('Show install folder')
  await act(async () => {
    revealButton.click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal(revealCalls, 1)
  assert.doesNotMatch(container.textContent ?? '', /\/(?:home|opt|usr|Users)\//)
  // Both channels are offered, and the newest STABLE is the default selection --
  // a prerelease is opt-in, never something the user lands on by accident.
  {
    const originalCheck = client.checkMaintenanceRelease
    client.checkMaintenanceRelease = async () => ({
      action: 'strict-update' as const, available: true, channel: 'stable' as const, revision: 1 as const,
      offers: [
        { channel: 'stable' as const, relation: 'update' as const, tag: 'v1.2.3' },
        { channel: 'prerelease' as const, relation: 'update' as const, tag: 'v1.3.0' },
      ],
      schema: 'home-v2-core-maintenance-release' as const, tag: 'v1.2.3',
    })
    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => {
      root.render(<CoreMaintenanceHarness />)
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      button('Check release').click()
      await Promise.resolve()
      await Promise.resolve()
    })
    const chooser = container.querySelector<HTMLSelectElement>('[data-home-v2-core-release-choice]')
    assert(chooser, 'expected a release chooser when more than one release is offered')
    assert.deepEqual(
      [...chooser.options].map((option) => option.value),
      ['v1.2.3', 'v1.3.0'],
    )
    assert.equal(chooser.value, 'v1.2.3', 'the newest stable release must be preselected')
    assert.match(container.textContent ?? '', /Prerelease v1\.3\.0/)

    // ...and picking one must actually install THAT one. Asserting only that
    // the select renders would pass even if the selection were ignored.
    actions.length = 0
    await act(async () => {
      chooser.value = 'v1.3.0'
      chooser.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    const installButton = [...container.querySelectorAll('button')]
      .find((item) => /Update/.test(item.textContent ?? ''))
    assert(installButton, 'expected an update button')
    await act(async () => {
      installButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    assert.deepEqual([...actions], ['strict-update:v1.3.0'],
      'the chosen prerelease must be the tag that gets installed')

    client.checkMaintenanceRelease = originalCheck
  }


  // A modified install is SHOWN. 1.x said "modified since install"; Home 2 never
  // surfaced the flag at all, so a tampered or damaged Core looked healthy.
  {
    const originalStatus = client.getMaintenanceStatus
    client.getMaintenanceStatus = async () => ({
      ...currentStatus,
      core: { ...currentStatus.core, installModified: true, localApiUrl: null, update: null, updateSources: null, installedVersion: '1.7.2' },
    })
    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => {
      root.render(<CoreMaintenanceHarness />)
      await Promise.resolve()
      await Promise.resolve()
    })
    assert(container.querySelector('[data-home-v2-core-install-modified]'),
      'a modified install must be visible')
    assert.match(container.textContent ?? '', /Modified since install/)

    // An unmodified install must NOT carry the notice, or it is just noise.
    client.getMaintenanceStatus = async () => ({
      ...currentStatus,
      core: { ...currentStatus.core, helpersOutOfSyncVersion: null,
      installModified: false, localApiUrl: null, update: null, updateSources: null, installedVersion: '1.7.2' },
    })
    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => {
      root.render(<CoreMaintenanceHarness />)
      await Promise.resolve()
      await Promise.resolve()
    })
    assert.equal(container.querySelector('[data-home-v2-core-install-modified]'), null)
    client.getMaintenanceStatus = originalStatus
  }


  // Going backwards asks first. The prompt must name BOTH versions, and nothing
  // may be installed until the user answers.
  {
    const originalCheck = client.checkMaintenanceRelease
    const originalRun = client.runMaintenanceAction
    const calls: Array<{ action: string; confirmDowngrade?: boolean }> = []
    client.checkMaintenanceRelease = async () => ({
      action: 'none' as const, available: true, channel: 'stable' as const, revision: 1 as const,
      offers: [{ channel: 'stable' as const, relation: 'downgrade' as const, tag: '1.5.0' }],
      schema: 'home-v2-core-maintenance-release' as const, tag: '1.5.0',
    })
    client.runMaintenanceAction = async (action, release) => {
      calls.push({ action, confirmDowngrade: release?.confirmDowngrade })
      const confirmed = release?.confirmDowngrade === true
      return {
        code: confirmed ? null : 'downgrade-confirmation-required' as const,
        downgrade: confirmed ? null : { installedVersion: '1.7.0', targetVersion: '1.5.0' },
        outcome: confirmed ? 'completed' as const : 'blocked' as const,
        revision: 1 as const,
        schema: 'home-v2-core-maintenance-action' as const,
        status: currentStatus,
      }
    }
    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => {
      root.render(<CoreMaintenanceHarness />)
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      button('Check release').click()
      await Promise.resolve()
      await Promise.resolve()
    })
    assert.match(container.textContent ?? '', /Older version 1\.5\.0/)

    const startButton = button('Install older version')
    await act(async () => {
      startButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    assert(container.querySelector('[data-home-v2-core-downgrade-confirm]'),
      'a downgrade must be confirmed before it happens')
    assert.match(container.textContent ?? '', /replace the newer 1\.7\.0/)
    assert.deepEqual(calls, [{ action: 'downgrade', confirmDowngrade: false }])

    await act(async () => {
      button('Install the older version').click()
      await Promise.resolve()
      await Promise.resolve()
    })
    assert.deepEqual(calls[1], { action: 'downgrade', confirmDowngrade: true })
    assert.equal(container.querySelector('[data-home-v2-core-downgrade-confirm]'), null)

    client.checkMaintenanceRelease = originalCheck
    client.runMaintenanceAction = originalRun
  }


  // The Java button names the version it will install. A bare "Update Java"
  // does not say WHAT is about to be put on the machine.
  {
    const originalStatus = client.getMaintenanceStatus
    client.getMaintenanceStatus = async () => ({
      ...currentStatus,
      java: { ...currentStatus.java, source: 'managed' as const, targetMajorVersion: 25 },
    })
    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => {
      root.render(<CoreMaintenanceHarness />)
      await Promise.resolve()
      await Promise.resolve()
    })
    assert.ok(button('Update Java to 25'))

    // Nothing installed yet -> install wording, still naming the version.
    client.getMaintenanceStatus = async () => ({
      ...currentStatus,
      java: { ...currentStatus.java, source: 'missing' as const, targetMajorVersion: 25 },
    })
    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => {
      root.render(<CoreMaintenanceHarness />)
      await Promise.resolve()
      await Promise.resolve()
    })
    assert.ok(button('Install Java 25'))

    // Target unknown -> fall back to the generic wording rather than printing
    // a blank or "null" version.
    client.getMaintenanceStatus = async () => ({
      ...currentStatus,
      java: { ...currentStatus.java, source: 'managed' as const, targetMajorVersion: null },
    })
    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => {
      root.render(<CoreMaintenanceHarness />)
      await Promise.resolve()
      await Promise.resolve()
    })
    assert.ok(button('Update Java'))
    assert.doesNotMatch(container.textContent ?? '', /Update Java to/)

    client.getMaintenanceStatus = originalStatus
  }

  {
    // Both sources are reported, not just the winner. With only the selected
    // candidate shown there is no way to tell "the chain has nothing newer"
    // from "the chain was not consulted", and those read very differently
    // mid-rollout.
    const originalStatus = client.getMaintenanceStatus
    client.getMaintenanceStatus = async () => ({
      ...currentStatus,
      core: {
        ...currentStatus.core,
        update: { action: 'available' as const, source: 'github' as const, version: '1.7.3' },
        updateSources: {
          github: { commit: null, version: '1.7.3' },
          onChain: { commit: 'abcdef1234567890', version: '1.7.2' },
        },
      },
    })
    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => {
      root.render(<CoreMaintenanceHarness />)
      await Promise.resolve()
      await Promise.resolve()
    })
    const sources = container.querySelector('[data-home-v2-core-update-sources]')
    assert.ok(sources, 'both update sources must be reported')
    assert.match(sources.textContent ?? '', /GitHub: 1\.7\.3/)
    // The QDN offer carries its commit, shortened -- that is the "live QDN
    // commit" half of this row.
    assert.match(sources.textContent ?? '', /QDN: 1\.7\.2 \(abcdef123456\)/)

    // A source that was consulted and had nothing newer says so, rather than
    // vanishing and looking like it was never asked.
    client.getMaintenanceStatus = async () => ({
      ...currentStatus,
      core: {
        ...currentStatus.core,
        updateSources: { github: { commit: null, version: '1.7.3' }, onChain: null },
      },
    })
    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => {
      root.render(<CoreMaintenanceHarness />)
      await Promise.resolve()
      await Promise.resolve()
    })
    const partial = container.querySelector('[data-home-v2-core-update-sources]')
    assert.ok(partial)
    assert.match(partial.textContent ?? '', /QDN: nothing newer/)

    client.getMaintenanceStatus = originalStatus
  }

} finally {
  act(() => root.unmount())
  delete window.homeV2CoreManagers
  container.remove()
}

console.log('Home v2 Core maintenance panel tests passed.')
