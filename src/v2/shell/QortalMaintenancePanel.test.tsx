import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type {
  HomeV2CoreManagerClient,
  HomeV2QortalMaintenanceActionResult,
  HomeV2QortalMaintenanceRelease,
  HomeV2QortalMaintenanceStatus,
} from '../../home-v2-live/core-manager-client'
import {
  parseHomeV2QortalMaintenanceActionResult,
  parseHomeV2QortalMaintenanceRelease,
  parseHomeV2QortalMaintenanceStatus,
} from '../../home-v2-live/core-manager-client'
import type { HomeV2CoreManagement } from './CoreManagerCards'
import { QortalMaintenancePanel } from './QortalMaintenancePanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const missingStatus: HomeV2QortalMaintenanceStatus = {
  capabilities: { canCheckRelease: true, canInitialInstall: true, canUpdate: false },
  discovery: 'clear',
  install: 'missing',
  installedVersion: null,
  issue: null,
  network: 'qortal',
  revision: 1,
  runtime: 'stopped',
  schema: 'home-v2-qortal-maintenance',
  updateAuthority: 'observe-only',
}

const installRelease: HomeV2QortalMaintenanceRelease = {
  action: 'initial-install',
  available: true,
  code: null,
  network: 'qortal',
  revision: 1,
  schema: 'home-v2-qortal-maintenance-release',
  tag: 'v6.2.0',
}

const updateRelease: HomeV2QortalMaintenanceRelease = {
  ...installRelease,
  action: 'strict-update',
  tag: 'v6.3.0',
}

const installedStatus: HomeV2QortalMaintenanceStatus = {
  ...missingStatus,
  capabilities: { canCheckRelease: true, canInitialInstall: false, canUpdate: true },
  discovery: 'not-applicable',
  install: 'home-managed',
  installedVersion: '6.2.0',
  updateAuthority: 'home-github',
}

function client(overrides: Partial<HomeV2CoreManagerClient> = {}): HomeV2CoreManagerClient {
  return {
    getMaintenanceStatus: async () => ({} as never),
    checkMaintenanceRelease: async () => ({} as never),
    runMaintenanceAction: async () => ({} as never),
    getUpdatePolicy: async () => ({} as never),
    setUpdatePolicy: async () => ({} as never),
    getStatus: async () => ({} as never),
    start: async () => ({} as never),
    stop: async () => ({} as never),
    getQortalMaintenanceStatus: async () => missingStatus,
    checkQortalMaintenanceRelease: async () => installRelease,
    runQortalMaintenanceAction: async () => ({
      code: null,
      network: 'qortal',
      outcome: 'completed',
      revision: 1,
      schema: 'home-v2-qortal-maintenance-action',
      status: installedStatus,
      warning: null,
    }),
    ...overrides,
  }
}

const management = {
  available: true,
  busyActions: { qortal: null, qortium: null },
  lastActions: { qortal: null, qortium: null },
  statuses: {} as never,
} satisfies HomeV2CoreManagement

assert.deepEqual(parseHomeV2QortalMaintenanceStatus(missingStatus), missingStatus)
assert.throws(() => parseHomeV2QortalMaintenanceStatus({
  ...missingStatus,
  network: 'qortium',
}), /Invalid Home 2 Qortal maintenance status/)
assert.throws(() => parseHomeV2QortalMaintenanceStatus({
  ...missingStatus,
  privatePath: '/secret/qortal',
}), /Invalid Home 2 Qortal maintenance status/)
assert.throws(() => parseHomeV2QortalMaintenanceStatus({
  ...installedStatus,
  installedVersion: 'v'.repeat(129),
}), /Invalid Home 2 Qortal maintenance status/)
assert.throws(() => parseHomeV2QortalMaintenanceStatus({
  ...installedStatus,
  updateAuthority: 'node-native',
}), /Invalid Home 2 Qortal maintenance status/)
assert.deepEqual(parseHomeV2QortalMaintenanceRelease(installRelease), installRelease)
assert.throws(() => parseHomeV2QortalMaintenanceRelease({
  ...installRelease,
  available: false,
}), /Invalid Home 2 Qortal maintenance release/)
assert.throws(() => parseHomeV2QortalMaintenanceActionResult({
  code: null,
  network: 'qortal',
  outcome: 'completed',
  privateReason: '/secret',
  revision: 1,
  schema: 'home-v2-qortal-maintenance-action',
  status: installedStatus,
  warning: null,
}), /Invalid Home 2 Qortal maintenance action result/)

const container = document.createElement('div')
document.body.appendChild(container)
let root = createRoot(container)
const originalSetInterval = window.setInterval
const originalClearInterval = window.clearInterval
let refreshInterval: (() => void) | null = null
window.setInterval = ((handler: TimerHandler) => {
  assert.equal(typeof handler, 'function')
  refreshInterval = handler as () => void
  return 1
}) as typeof window.setInterval
window.clearInterval = (() => undefined) as typeof window.clearInterval

function button(label: string) {
  const found = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === label)
  assert(found, `expected button ${label}`)
  return found as HTMLButtonElement
}

async function render(nextClient: HomeV2CoreManagerClient) {
  window.homeV2CoreManagers = nextClient
  await act(async () => {
    root.render(<QortalMaintenancePanel management={management} />)
    await Promise.resolve()
    await Promise.resolve()
  })
}

try {
  const actions: Array<{ action: string; expectedTag: string }> = []
  await render(client({
    runQortalMaintenanceAction: async (action, expectedTag) => {
      actions.push({ action, expectedTag })
      return {
        code: null,
        network: 'qortal',
        outcome: 'completed',
        revision: 1,
        schema: 'home-v2-qortal-maintenance-action',
        status: installedStatus,
        warning: null,
      }
    },
  }))
  assert.match(container.textContent ?? '', /verified stable release/)
  assert.equal(container.querySelector('[data-network="qortal"]') !== null, true)
  assert.equal([...container.querySelectorAll('button')].some((item) => /Start|Stop/.test(item.textContent ?? '')), false)

  await act(async () => {
    button('Check stable release').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.match(container.textContent ?? '', /v6\.2\.0 is ready to install/)
  const installButton = button('Install Qortal Core')
  assert.equal(installButton.getAttribute('aria-describedby'), 'qortal-maintenance-state')
  assert.match(document.getElementById('qortal-maintenance-state')?.textContent ?? '', /not installed/)
  await act(async () => {
    installButton.click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.deepEqual(actions, [{ action: 'initial-install', expectedTag: 'v6.2.0' }])
  assert.match(container.textContent ?? '', /maintenance completed/)

  const nativeStatus: HomeV2QortalMaintenanceStatus = {
    ...installedStatus,
    capabilities: { canCheckRelease: false, canInitialInstall: false, canUpdate: false },
    updateAuthority: 'node-native',
  }
  await render(client({ getQortalMaintenanceStatus: async () => nativeStatus }))
  assert.match(container.textContent ?? '', /own automatic updater manages updates/)
  assert.equal([...container.querySelectorAll('button')]
    .some((item) => item.textContent?.includes('Check stable release')), false)

  const adoptedStatus: HomeV2QortalMaintenanceStatus = {
    ...installedStatus,
    capabilities: { canCheckRelease: false, canInitialInstall: false, canUpdate: false },
    install: 'adopted',
  }
  await render(client({ getQortalMaintenanceStatus: async () => adoptedStatus }))
  assert.match(container.textContent ?? '', /does not modify adopted files/)

  let refreshedStatus = installedStatus
  await render(client({
    getQortalMaintenanceStatus: async () => refreshedStatus,
    checkQortalMaintenanceRelease: async () => updateRelease,
  }))
  await act(async () => {
    button('Check stable release').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.ok(button('Update Qortal Core'))
  refreshedStatus = {
    ...installedStatus,
    capabilities: { canCheckRelease: false, canInitialInstall: false, canUpdate: false },
  }
  await act(async () => {
    const interval = refreshInterval
    assert(interval)
    interval()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal([...container.querySelectorAll('button')]
    .some((item) => item.textContent?.includes('Update Qortal Core')), false)

  let refreshShouldFail = false
  await render(client({
    getQortalMaintenanceStatus: async () => {
      if (refreshShouldFail) throw new Error('refresh unavailable')
      return installedStatus
    },
    checkQortalMaintenanceRelease: async () => updateRelease,
  }))
  await act(async () => {
    button('Check stable release').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.ok(button('Update Qortal Core'))
  refreshShouldFail = true
  await act(async () => {
    const interval = refreshInterval
    assert(interval)
    interval()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.match(container.textContent ?? '', /shown state may be stale/)
  assert.equal([...container.querySelectorAll('button')]
    .some((item) => item.textContent?.includes('Update Qortal Core')), false)

  let resolveOldAction!: (value: HomeV2QortalMaintenanceActionResult) => void
  const oldAction = new Promise<HomeV2QortalMaintenanceActionResult>((resolve) => {
    resolveOldAction = resolve
  })
  await render(client({
    getQortalMaintenanceStatus: async () => installedStatus,
    checkQortalMaintenanceRelease: async () => updateRelease,
    runQortalMaintenanceAction: async () => oldAction,
  }))
  await act(async () => {
    button('Check stable release').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    button('Update Qortal Core').click()
    await Promise.resolve()
  })
  await render(client({ getQortalMaintenanceStatus: async () => nativeStatus }))
  await act(async () => {
    resolveOldAction({
      code: null,
      network: 'qortal',
      outcome: 'completed',
      revision: 1,
      schema: 'home-v2-qortal-maintenance-action',
      status: installedStatus,
      warning: null,
    })
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.doesNotMatch(container.textContent ?? '', /maintenance completed/)
  assert.match(container.textContent ?? '', /own automatic updater manages updates/)

  let resolveOldCheck!: (value: HomeV2QortalMaintenanceRelease) => void
  const oldCheck = new Promise<HomeV2QortalMaintenanceRelease>((resolve) => {
    resolveOldCheck = resolve
  })
  await render(client({ checkQortalMaintenanceRelease: async () => oldCheck }))
  await act(async () => {
    button('Check stable release').click()
    await Promise.resolve()
  })
  await render(client({ getQortalMaintenanceStatus: async () => nativeStatus }))
  await act(async () => {
    resolveOldCheck({ ...installRelease, tag: 'v9.9.9' })
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.doesNotMatch(container.textContent ?? '', /v9\.9\.9/)
  assert.match(container.textContent ?? '', /own automatic updater manages updates/)

  act(() => root.unmount())
  root = createRoot(container)
  await render(client({ getQortalMaintenanceStatus: async () => { throw new Error('unavailable') } }))
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /status is unavailable/)
  assert.ok(button('Retry Qortal maintenance status'))

  act(() => root.unmount())
  root = createRoot(container)
  delete window.homeV2CoreManagers
  await act(async () => {
    root.render(<QortalMaintenancePanel management={management} />)
    await Promise.resolve()
  })
  assert.equal(container.textContent, '')
} finally {
  act(() => root.unmount())
  window.setInterval = originalSetInterval
  window.clearInterval = originalClearInterval
  delete window.homeV2CoreManagers
  container.remove()
}

console.log('Home v2 Qortal maintenance panel tests passed.')
