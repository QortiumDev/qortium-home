import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type {
  HomeV2CoreManagerClient,
  HomeV2TransportMaintenanceActionResult,
  HomeV2TransportMaintenanceStatus,
  HomeV2TransportMode,
} from '../../home-v2-live/core-manager-client'
import {
  parseHomeV2TransportMaintenanceActionResult,
  parseHomeV2TransportMaintenanceStatus,
} from '../../home-v2-live/core-manager-client'
import { useHomeV2TransportMaintenance } from '../../home-v2-live/transport-maintenance-controller'
import type { HomeV2CoreManagement } from './CoreManagerCards'
import { TransportMaintenancePanel } from './TransportMaintenancePanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type StatusOptions = Readonly<{
  coreInstall?: HomeV2TransportMaintenanceStatus['core']['install']
  coreRuntime?: HomeV2TransportMaintenanceStatus['core']['runtime']
  issue?: HomeV2TransportMaintenanceStatus['issue']
  maintenance?: HomeV2TransportMaintenanceStatus['router']['maintenance']
  mode?: HomeV2TransportMode
  routerState?: HomeV2TransportMaintenanceStatus['router']['state']
  version?: string | null
}>

function transportStatus(options: StatusOptions = {}): HomeV2TransportMaintenanceStatus {
  const coreInstall = options.coreInstall ?? 'installed'
  const coreRuntime = options.coreRuntime ?? 'stopped'
  const issue = options.issue ?? null
  const maintenance = options.maintenance ?? 'install'
  const mode = options.mode ?? 'direct-only'
  const routerState = options.routerState ?? 'missing'
  const version = options.version ?? null
  const fatalIssue = issue === 'manager-unavailable' || issue === 'status-unavailable'
  const canChange = coreInstall === 'installed' && coreRuntime === 'stopped' &&
    mode !== 'unknown' && !fatalIssue
  const routerReady = routerState === 'external-running' || routerState === 'managed-running'
  return {
    capabilities: {
      canEnsureRouter: coreInstall === 'installed' && coreRuntime === 'stopped' && issue === null &&
        ['install', 'start', 'update'].includes(maintenance),
      canSetDirectAndI2p: canChange && routerReady,
      canSetDirectOnly: canChange,
      canSetI2pOnly: canChange && routerReady,
      canStopRouter: routerState === 'managed-running' && !fatalIssue,
    },
    core: { install: coreInstall, runtime: coreRuntime },
    issue,
    network: 'qortium',
    revision: 1,
    router: { maintenance, state: routerState, version },
    schema: 'home-v2-transport-maintenance',
    transportMode: mode,
  }
}

const missingStatus = transportStatus()
const readyStatus = transportStatus({
  maintenance: 'none',
  routerState: 'managed-running',
  version: '2.60.0-q2',
})
const externalStatus = transportStatus({
  maintenance: 'none',
  routerState: 'external-running',
})

function actionResult(
  status: HomeV2TransportMaintenanceStatus,
): HomeV2TransportMaintenanceActionResult {
  return {
    code: null,
    network: 'qortium',
    outcome: 'completed',
    revision: 1,
    schema: 'home-v2-transport-maintenance-action',
    status,
    warning: null,
  }
}

function client(overrides: Partial<HomeV2CoreManagerClient> = {}): HomeV2CoreManagerClient {
  return {
    checkMaintenanceRelease: async () => ({} as never),
    getMaintenanceStatus: async () => ({} as never),
    getStatus: async () => ({} as never),
    getUpdatePolicy: async () => ({} as never),
    runMaintenanceAction: async () => ({} as never),
    setUpdatePolicy: async () => ({} as never),
    start: async () => ({} as never),
    stop: async () => ({} as never),
    getTransportMaintenanceStatus: async () => missingStatus,
    runTransportMaintenanceAction: async () => actionResult(readyStatus),
    ...overrides,
  }
}

const management: HomeV2CoreManagement = {
  available: true,
  busyActions: { qortal: null, qortium: null },
  lastActions: { qortal: null, qortium: null },
  statuses: {} as never,
}

// The panel takes its controller as a prop now, so the app can own exactly one
// per domain. This harness stands in for HomeV2LiveApp: it calls the real
// controller hook and hands the whole return to the panel, so the polling,
// staleness and busy behaviour below is still exercised end to end.
function TransportMaintenanceHarness() {
  const maintenance = useHomeV2TransportMaintenance(management.onRefresh)
  return <TransportMaintenancePanel maintenance={maintenance} />
}

assert.deepEqual(parseHomeV2TransportMaintenanceStatus(missingStatus), missingStatus)
assert.throws(() => parseHomeV2TransportMaintenanceStatus({
  ...missingStatus,
  privatePath: '/secret/i2pd',
}), /Invalid Home 2 transport maintenance status/)
assert.throws(() => parseHomeV2TransportMaintenanceStatus({
  ...readyStatus,
  router: { ...readyStatus.router, version: 'x'.repeat(129) },
}), /Invalid Home 2 transport maintenance status/)
assert.throws(() => parseHomeV2TransportMaintenanceStatus({
  ...missingStatus,
  capabilities: { ...missingStatus.capabilities, canSetI2pOnly: true },
}), /Invalid Home 2 transport maintenance status/)
assert.deepEqual(parseHomeV2TransportMaintenanceActionResult(actionResult(readyStatus)), actionResult(readyStatus))
assert.throws(() => parseHomeV2TransportMaintenanceActionResult({
  ...actionResult(readyStatus),
  cause: '/secret',
}), /Invalid Home 2 transport maintenance action result/)
assert.throws(() => parseHomeV2TransportMaintenanceActionResult({
  ...actionResult(readyStatus),
  code: 'operation-failed',
}), /Invalid Home 2 transport maintenance action result/)

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

function hasButton(label: string) {
  return [...container.querySelectorAll('button')]
    .some((candidate) => candidate.textContent?.trim() === label)
}

async function render(nextClient: HomeV2CoreManagerClient) {
  window.homeV2CoreManagers = nextClient
  await act(async () => {
    root.render(<TransportMaintenanceHarness />)
    await Promise.resolve()
    await Promise.resolve()
  })
}

try {
  const actions: Array<{ action: string; mode: string | null }> = []
  await render(client({
    runTransportMaintenanceAction: async (action, mode) => {
      actions.push({ action, mode })
      return actionResult(readyStatus)
    },
  }))
  assert.equal(container.querySelector('[data-home-v2-transport-maintenance="desktop"]') !== null, true)
  assert.match(container.textContent ?? '', /verified local I2P router/)
  assert.deepEqual(
    [...container.querySelectorAll('option')].map((option) => option.textContent?.trim()),
    ['Direct + I2P', 'Direct only', 'I2P only'],
  )
  const ensureButton = button('Install and start I2P router')
  assert.equal(ensureButton.getAttribute('aria-describedby'), 'transport-maintenance-router-state')
  assert.equal(
    container.querySelector('select')?.getAttribute('aria-describedby'),
    'transport-maintenance-mode-note',
  )
  await act(async () => {
    ensureButton.click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.deepEqual([...actions], [{ action: 'ensure-router', mode: null }])
  assert.match(container.textContent ?? '', /Local SAM readiness does not confirm I2P reachability/)
  assert.doesNotMatch(container.textContent ?? '', /SAM.*(?:private|reachable)/i)

  await render(client({ getTransportMaintenanceStatus: async () => externalStatus,
    runTransportMaintenanceAction: async (action, mode) => {
      actions.push({ action, mode })
      return actionResult({ ...externalStatus, transportMode: mode ?? externalStatus.transportMode })
    } }))
  assert.match(container.textContent ?? '', /will not install, update, start, or stop that router/)
  assert.equal(hasButton('Install and start I2P router'), false)
  const select = container.querySelector('select') as HTMLSelectElement
  await act(async () => {
    select.value = 'i2p-only'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => {
    button('Apply transport mode').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.deepEqual(actions.at(-1), { action: 'set-mode', mode: 'i2p-only' })
  assert.match(container.textContent ?? '', /take effect the next time Qortium Core starts/)

  const updateStatus = transportStatus({
    maintenance: 'update',
    routerState: 'managed-stopped',
    version: '2.59.0-q1',
  })
  await render(client({ getTransportMaintenanceStatus: async () => updateStatus }))
  assert.ok(button('Update and restart I2P router'))
  assert.match(container.textContent ?? '', /strictly newer verified build/)

  const runningStatus = transportStatus({ coreRuntime: 'running' })
  await render(client({ getTransportMaintenanceStatus: async () => runningStatus }))
  assert.match(container.textContent ?? '', /Stop Qortium Core/)
  assert.equal(container.querySelector('select')?.hasAttribute('disabled'), true)
  assert.equal(hasButton('Install and start I2P router'), false)

  let refreshShouldFail = false
  await render(client({
    getTransportMaintenanceStatus: async () => {
      if (refreshShouldFail) throw new Error('refresh unavailable')
      return missingStatus
    },
  }))
  refreshShouldFail = true
  await act(async () => {
    const interval = refreshInterval
    assert(interval)
    interval()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /shown state may be stale/)
  assert.equal(button('Install and start I2P router').disabled, true)

  let resolveOldAction!: (value: HomeV2TransportMaintenanceActionResult) => void
  const oldAction = new Promise<HomeV2TransportMaintenanceActionResult>((resolve) => {
    resolveOldAction = resolve
  })
  await render(client({ runTransportMaintenanceAction: async () => oldAction }))
  await act(async () => {
    button('Install and start I2P router').click()
    await Promise.resolve()
  })
  await render(client({ getTransportMaintenanceStatus: async () => externalStatus }))
  await act(async () => {
    resolveOldAction(actionResult(readyStatus))
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.match(container.textContent ?? '', /Another local I2P router is running/)
  assert.doesNotMatch(container.textContent ?? '', /router maintenance completed/i)

  act(() => root.unmount())
  root = createRoot(container)
  await render(client({ getTransportMaintenanceStatus: async () => { throw new Error('unavailable') } }))
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /status is unavailable/)
  assert.ok(button('Retry I2P transport status'))

  act(() => root.unmount())
  root = createRoot(container)
  // A managed, running router must offer the stop half of the control. Home 2 shipped
  // only the start half; stopping was reachable solely as a side effect of direct-only.
  const stopActions: Array<{ action: string; mode: string | null }> = []
  await render(client({
    getTransportMaintenanceStatus: async () => readyStatus,
    runTransportMaintenanceAction: async (action, mode) => {
      stopActions.push({ action, mode })
      return actionResult(readyStatus)
    },
  }))
  const stopButton = button('Stop I2P router')
  await act(async () => {
    stopButton.click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.deepEqual([...stopActions], [{ action: 'stop-router', mode: null }])

  act(() => root.unmount())
  root = createRoot(container)
  await render(client({
    getTransportMaintenanceStatus: undefined,
    runTransportMaintenanceAction: undefined,
  }))
  assert.equal(container.textContent, '')
} finally {
  act(() => root.unmount())
  window.setInterval = originalSetInterval
  window.clearInterval = originalClearInterval
  delete window.homeV2CoreManagers
  container.remove()
}

console.log('Home v2 transport maintenance panel tests passed.')
