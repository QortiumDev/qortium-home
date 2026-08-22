import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type {
  HomeV2CoreMaintenanceStatus,
  HomeV2CoreManagerClient,
  HomeV2CoreUpdatePolicyState,
} from '../../home-v2-live/core-manager-client'
import { parseHomeV2CoreUpdatePolicySetResult } from '../../home-v2-live/core-manager-client'
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
  values: Partial<Pick<HomeV2CoreUpdatePolicyState, 'coreUpdatePolicy' | 'javaUpdatePolicy'>> = {},
): HomeV2CoreUpdatePolicyState {
  return {
  activity: {
    checkedAt: null,
    core: { channel: null, state: 'idle', version: null },
    generation,
    issue: null,
    java: { state: 'idle', version: null },
  },
  coreUpdatePolicy: values.coreUpdatePolicy ?? 'notify',
  generation,
  javaUpdatePolicy: values.javaUpdatePolicy ?? 'notify',
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

const management = {
  available: true,
  busyActions: { qortal: null, qortium: null },
  lastActions: { qortal: null, qortium: null },
  statuses: {} as never,
} satisfies HomeV2CoreManagement
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
    root.render(<CoreMaintenancePanel management={management} />)
    await Promise.resolve()
  })
  assert.match(container.textContent ?? '', /Qortium Core maintenance/)
  assert.match(container.textContent ?? '', /Not installed/)
  assert.equal(container.querySelector('select'), null)
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
    root.render(<CoreMaintenancePanel management={management} />)
    await Promise.resolve()
  })
  const corePolicy = container.querySelector('[data-home-v2-core-update-policy]') as HTMLSelectElement
  const javaPolicy = container.querySelector('[data-home-v2-java-update-policy]') as HTMLSelectElement
  assert(corePolicy)
  assert(javaPolicy)
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
    { expectedGeneration: 3, field: 'coreUpdatePolicy' },
    { expectedGeneration: 4, field: 'javaUpdatePolicy' },
  ])

  act(() => root.unmount())
  const getMaintenanceStatus = client.getMaintenanceStatus
  const getUpdatePolicy = client.getUpdatePolicy
  client.getMaintenanceStatus = async () => { throw new Error('unavailable') }
  client.getUpdatePolicy = async () => { throw new Error('unavailable') }
  root = createRoot(container)
  await act(async () => {
    root.render(<CoreMaintenancePanel management={management} />)
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
