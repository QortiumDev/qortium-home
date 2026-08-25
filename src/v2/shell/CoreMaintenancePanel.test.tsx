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
  capabilities: { canInitialInstall: true, canInstallJava: true },
  core: { channel: null, installedVersion: null, runtime: 'stopped' },
  java: { source: 'missing', updateAvailable: false, version: null },
  revision: 1,
  schema: 'home-v2-core-maintenance',
} as const
let currentStatus: HomeV2CoreMaintenanceStatus = status
const actions: string[] = []
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
    schema: 'home-v2-core-maintenance-release', tag: 'v1.2.3',
  }),
  runMaintenanceAction: async (action, release) => {
    actions.push(`${action}:${release?.expectedTag ?? ''}`)
    return { code: null, outcome: 'completed', revision: 1,
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
    capabilities: { canInitialInstall: false, canInstallJava: true },
    core: { channel: 'prerelease', installedVersion: '1.2.3', runtime: 'stopped' },
    java: { source: 'managed', updateAvailable: true, version: '25.0.1' },
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
} finally {
  act(() => root.unmount())
  delete window.homeV2CoreManagers
  container.remove()
}

console.log('Home v2 Core maintenance panel tests passed.')
