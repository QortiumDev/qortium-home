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
import { toHomeV2TransportManagement, useHomeV2TransportMaintenance } from '../../home-v2-live/transport-maintenance-controller'
import { homeV2Fixture } from '../test-kit/fixtures'
import { HomeV2NodeCoreSection } from './HomeV2NodeCoreSection'
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
  sam?: HomeV2TransportMaintenanceStatus['router']['sam']
  version?: string | null
}>

function transportStatus(options: StatusOptions = {}): HomeV2TransportMaintenanceStatus {
  const coreInstall = options.coreInstall ?? 'installed'
  const coreRuntime = options.coreRuntime ?? 'stopped'
  const issue = options.issue ?? null
  const maintenance = options.maintenance ?? 'install'
  const mode = options.mode ?? 'direct-only'
  const routerState = options.routerState ?? 'missing'
  const sam = options.sam ?? (
    routerState === 'managed-running' || routerState === 'external-running'
      ? 'ready' as const
      : routerState === 'unsupported' || routerState === 'unknown'
        ? 'unknown' as const
        : 'unavailable' as const
  )
  const version = options.version ?? null
  const fatalIssue = issue === 'manager-unavailable' || issue === 'status-unavailable'
  const canChange = coreInstall === 'installed' && coreRuntime === 'stopped' &&
    mode !== 'unknown' && !fatalIssue
  const routerReady = sam === 'ready'
  return {
    capabilities: {
      canEnsureRouter: coreInstall === 'installed' && issue === null &&
        ((routerState === 'managed-stopped' && ['start', 'update'].includes(maintenance) &&
          coreRuntime !== 'unknown') ||
          (['install', 'migrate'].includes(maintenance) && coreRuntime === 'stopped')),
      canRevealRouterFolder: routerState === 'managed-running' ||
        (routerState === 'managed-stopped' && maintenance !== 'migrate'),
      canSetDirectAndI2p: canChange && routerReady,
      canSetDirectOnly: canChange,
      canSetI2pOnly: canChange && routerReady,
      canStopRouter: routerState === 'managed-running' && !fatalIssue,
      canSetModeWhileRunning: coreInstall === 'installed' && coreRuntime === 'running' &&
        mode !== 'unknown' && !fatalIssue,
      canUpdateRouter: coreInstall === 'installed' && coreRuntime === 'stopped' && issue === null &&
        maintenance === 'update' &&
        (routerState === 'managed-running' || routerState === 'managed-stopped'),
    },
    core: { install: coreInstall, runtime: coreRuntime },
    issue,
    network: 'qortium',
    revision: 2,
    router: { maintenance, sam, state: routerState, version },
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
const legacyStatus = transportStatus({
  maintenance: 'migrate',
  routerState: 'managed-stopped',
  version: '2.60.0-q2',
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
function TransportMaintenanceHarness({ dashboard = false }: { dashboard?: boolean }) {
  const maintenance = useHomeV2TransportMaintenance(management.onRefresh)
  if (dashboard) return <HomeV2NodeCoreSection networks={['qortium']} snapshot={homeV2Fixture}
    coreManagement={{ ...management, statuses: {
      qortium: {
        capabilities: { canStart: false, canStop: true }, control: 'full', install: 'home-managed',
        issue: null, network: 'qortium', revision: 1, runtime: 'running', schema: 'home-v2-core-manager',
      },
      qortal: {
        capabilities: { canStart: true, canStop: false }, control: 'full', install: 'home-managed',
        issue: null, network: 'qortal', revision: 1, runtime: 'stopped', schema: 'home-v2-core-manager',
      },
    }, transport: toHomeV2TransportManagement(maintenance) }} />
  return <TransportMaintenancePanel maintenance={maintenance} />
}

assert.deepEqual(parseHomeV2TransportMaintenanceStatus(missingStatus), missingStatus)
assert.deepEqual(parseHomeV2TransportMaintenanceStatus(legacyStatus), legacyStatus)
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

async function render(nextClient: HomeV2CoreManagerClient, dashboard = false) {
  window.homeV2CoreManagers = nextClient
  await act(async () => {
    root.render(<TransportMaintenanceHarness dashboard={dashboard} />)
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

  const processUpSamDown = transportStatus({
    maintenance: 'none',
    mode: 'direct-and-i2p',
    routerState: 'managed-running',
    sam: 'unavailable',
    version: '2.60.0-q2',
  })
  await render(client({ getTransportMaintenanceStatus: async () => processUpSamDown }))
  assert.match(container.textContent ?? '', /router process is running/i)
  assert.match(container.textContent ?? '', /SAM service: unavailable or still starting/i)
  assert.equal(hasButton('Stop I2P router'), true,
    'a live managed process must remain stoppable while SAM is unavailable')
  assert.equal(hasButton('Start I2P router'), false,
    'Home must not offer a second start while the managed process is alive')
  const unreadyOptions = [...container.querySelectorAll('option')]
  assert.equal((unreadyOptions[0] as HTMLOptionElement).disabled, true)
  assert.equal((unreadyOptions[2] as HTMLOptionElement).disabled, true)

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
  const updateActions: Array<{ action: string; mode: string | null }> = []
  await render(client({
    getTransportMaintenanceStatus: async () => updateStatus,
    runTransportMaintenanceAction: async (action, mode) => {
      updateActions.push({ action, mode })
      return actionResult(updateStatus)
    },
  }))
  assert.ok(button('Start I2P router'))
  const updateButton = button('Update and restart I2P router')
  assert.equal(updateButton.disabled, false)
  await act(async () => {
    button('Start I2P router').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    button('Update and restart I2P router').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.deepEqual(updateActions, [
    { action: 'ensure-router', mode: null },
    { action: 'update-router', mode: null },
  ])
  assert.match(container.textContent ?? '', /strictly newer verified build/)

  await render(client({ getTransportMaintenanceStatus: async () => legacyStatus }))
  assert.ok(button('Start I2P router'))
  assert.match(container.textContent ?? '', /2\.60\.0-q2/)
  assert.match(container.textContent ?? '', /installed but stopped/)

  // A running Core can now change the mode through the node's API, so the
  // selector stays usable and the note says a restart applies it. Router
  // Installing or migrating still needs Core stopped, and still says so.
  const runningStatus = transportStatus({ coreRuntime: 'running' })
  await render(client({ getTransportMaintenanceStatus: async () => runningStatus }))
  assert.equal(container.querySelector('select')?.hasAttribute('disabled'), false)
  assert.match(container.textContent ?? '', /Qortium Core must restart before it uses the new mode/)
  assert.doesNotMatch(container.textContent ?? '', /Stop Qortium Core before applying/)
  assert.match(container.textContent ?? '', /Stop Qortium Core to install or update its I2P router/)
  assert.equal(hasButton('Install and start I2P router'), false)

  const runningStartStatus = transportStatus({
    coreRuntime: 'running',
    maintenance: 'start',
    routerState: 'managed-stopped',
    version: '2.60.0-q2',
  })
  await render(client({ getTransportMaintenanceStatus: async () => runningStartStatus }))
  assert.ok(button('Start I2P router'))
  assert.match(container.textContent ?? '', /installed but stopped/)
  assert.doesNotMatch(container.textContent ?? '', /Stop Qortium Core to install or update/)

  const runningOldReleaseStatus = transportStatus({
    coreRuntime: 'running',
    maintenance: 'update',
    routerState: 'managed-stopped',
    version: '2.60.0-q2',
  })
  await render(client({ getTransportMaintenanceStatus: async () => runningOldReleaseStatus }))
  assert.equal(button('Start I2P router').disabled, false)
  assert.equal(button('Update and restart I2P router').disabled, true)

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
  // Router install progress reaches the panel. i2pd publishes these behind a
  // legacy flag that Home 2 turns OFF at startup, so before the Home 2 listener
  // existed the router could download and extract showing nothing at all.
  {
    let emit: ((event: unknown) => void) | null = null
    await render(client({
      getTransportMaintenanceStatus: async () => readyStatus,
      onTransportProgress: (listener: (event: unknown) => void) => {
        emit = listener
        return () => { emit = null }
      },
    } as never))
    assert(emit, 'the panel must subscribe to router progress')
    await act(async () => {
      emit?.({
        action: 'downloading', kind: 'info', message: 'Downloading I2P router.',
        percent: 42, revision: 1, schema: 'home-v2-transport-progress',
      })
      await Promise.resolve()
    })
    assert.match(container.textContent ?? '', /Downloading I2P router\./)

    // A malformed event is dropped, not rendered: a stale percentage beats a
    // wrong one, and beats a blank bar.
    await act(async () => {
      emit?.({ action: 'nonsense', kind: 'info', message: 'x', percent: 1, revision: 1,
        schema: 'home-v2-transport-progress' })
      await Promise.resolve()
    })
    assert.match(container.textContent ?? '', /Downloading I2P router\./)

    // 'idle' clears it.
    await act(async () => {
      emit?.({ action: 'idle', kind: 'info', message: 'Idle.', percent: null, revision: 1,
        schema: 'home-v2-transport-progress' })
      await Promise.resolve()
    })
    assert.doesNotMatch(container.textContent ?? '', /Downloading I2P router\./)
  }

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

  // Exercise the real dashboard row through the same controller/bridge as
  // Settings. A live mode write saves only; the separate button opts into a
  // stop/start. Merely selecting a mode must do neither.
  const dashboardSelect = () => container.querySelector(
    '[data-home-v2-node-core-transport="dashboard"] select',
  ) as HTMLSelectElement
  const dashboardCalls: string[] = []
  let dashboardStatus = transportStatus({
    coreRuntime: 'running', maintenance: 'none', routerState: 'managed-running', version: '2.60.0-q2',
  })
  let dashboardRefreshFails = false
  let refuseStop = false
  let refuseStart = false
  const coreActionResult = (runtime: 'running' | 'stopped', blocked = false) => ({
    code: blocked ? 'operation-blocked' as const : null, network: 'qortium' as const,
    outcome: blocked ? 'blocked' as const : 'completed' as const, revision: 1 as const,
    schema: 'home-v2-core-manager-action' as const, warning: null,
    status: {
      capabilities: { canStart: runtime === 'stopped', canStop: runtime === 'running' },
      control: 'full' as const, install: 'home-managed' as const, issue: null,
      network: 'qortium' as const, revision: 1 as const, runtime,
      schema: 'home-v2-core-manager' as const,
    },
  })
  let resolveMode!: (result: HomeV2TransportMaintenanceActionResult) => void
  await render(client({
    getTransportMaintenanceStatus: async () => {
      if (dashboardRefreshFails) throw new Error('offline')
      return dashboardStatus
    },
    runTransportMaintenanceAction: async (action, mode) => {
      dashboardCalls.push(`${action}:${mode}`)
      dashboardStatus = { ...dashboardStatus, transportMode: mode! }
      return new Promise((resolve) => { resolveMode = resolve })
    },
    stop: async (network) => {
      dashboardCalls.push(`stop:${network}`)
      return coreActionResult(refuseStop ? 'running' : 'stopped', refuseStop)
    },
    start: async (network) => {
      dashboardCalls.push(`start:${network}`)
      return coreActionResult(refuseStart ? 'stopped' : 'running', refuseStart)
    },
  }), true)
  assert.equal(dashboardSelect().disabled, false)
  assert.equal([...dashboardSelect().options].every((option) => !option.disabled), true)
  assert.equal(button('Apply transport mode').disabled, true)
  assert.match(container.textContent ?? '', /Qortium Core must restart before it uses the new mode/)
  await act(async () => {
    dashboardSelect().value = 'i2p-only'
    dashboardSelect().dispatchEvent(new Event('change', { bubbles: true }))
  })
  assert.deepEqual([...dashboardCalls], [])
  await act(async () => { button('Apply transport mode').click() })
  assert.deepEqual(dashboardCalls, ['set-mode-live:i2p-only'])
  assert.equal(dashboardSelect().disabled, true, 'pending write blocks more changes')
  assert.equal(container.querySelector('[data-home-v2-transport-restart]'), null)
  await act(async () => {
    resolveMode({ ...actionResult(dashboardStatus), warning: 'restart-required' })
  })
  assert.deepEqual(dashboardCalls, ['set-mode-live:i2p-only'], 'saving must never restart Core')
  let restartButton = container.querySelector('[data-home-v2-transport-restart]') as HTMLButtonElement
  assert(restartButton)
  dashboardRefreshFails = true
  await act(async () => { refreshInterval?.() })
  assert.equal(dashboardSelect().disabled, true)
  assert.equal(restartButton.disabled, true)
  assert.match(container.textContent ?? '', /shown state may be stale/)
  await act(async () => { restartButton.click() })
  assert.deepEqual(dashboardCalls, ['set-mode-live:i2p-only'])
  dashboardRefreshFails = false
  await act(async () => { refreshInterval?.() })
  restartButton = container.querySelector('[data-home-v2-transport-restart]') as HTMLButtonElement
  refuseStop = true
  await act(async () => { restartButton.click() })
  assert.deepEqual([...dashboardCalls], ['set-mode-live:i2p-only', 'stop:qortium'],
    'a refused stop must not proceed to start')
  assert(container.querySelector('[data-home-v2-transport-restart]'), 'keep pending restart after refusal')
  refuseStop = false
  refuseStart = true
  await act(async () => { restartButton.click() })
  assert.deepEqual([...dashboardCalls], ['set-mode-live:i2p-only', 'stop:qortium', 'stop:qortium', 'start:qortium'])
  assert(container.querySelector('[data-home-v2-transport-restart]'), 'failed start must not clear pending restart')
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /restart/i)
  refuseStart = false
  await act(async () => { restartButton.click() })
  assert.deepEqual([...dashboardCalls].slice(-2), ['stop:qortium', 'start:qortium'])
  assert.equal(container.querySelector('[data-home-v2-transport-restart]'), null)

  // The backend can still refuse a live write (for example an unsupported
  // Core API). Keep the actual mode and report failure without a restart.
  await render(client({
    getTransportMaintenanceStatus: async () => ({ ...dashboardStatus, transportMode: 'direct-only' }),
    runTransportMaintenanceAction: async () => ({
      ...actionResult({ ...dashboardStatus, transportMode: 'direct-only' }),
      outcome: 'blocked', code: 'action-not-allowed',
    }),
  }), true)
  await act(async () => {
    dashboardSelect().value = 'i2p-only'
    dashboardSelect().dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => { button('Apply transport mode').click() })
  assert.equal(dashboardSelect().value, 'direct-only')
  assert(container.querySelector('[role="alert"]'))
  assert.equal(container.querySelector('[data-home-v2-transport-restart]'), null)

  // Stopped Core still uses the settings-file write and needs no restart now.
  await render(client({
    getTransportMaintenanceStatus: async () => readyStatus,
    runTransportMaintenanceAction: async (action, mode) => {
      dashboardCalls.push(`${action}:${mode}`)
      return actionResult({ ...readyStatus, transportMode: mode! })
    },
  }), true)
  await act(async () => {
    dashboardSelect().value = 'direct-and-i2p'
    dashboardSelect().dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => { button('Apply transport mode').click() })
  assert.equal(dashboardCalls.at(-1), 'set-mode:direct-and-i2p')
  assert.equal(container.querySelector('[data-home-v2-transport-restart]'), null)

  for (const coreRuntime of ['running', 'stopped', 'unknown'] as const) {
    await render(client({ getTransportMaintenanceStatus: async () => transportStatus({ coreRuntime }) }), true)
    const selector = dashboardSelect()
    assert.equal(selector.disabled, coreRuntime === 'unknown')
    assert.equal(selector.options[0].disabled, true, 'I2P modes require ready SAM')
    assert.equal(selector.options[2].disabled, true)
    assert.equal(selector.options[1].disabled, coreRuntime === 'unknown')
  }

  let dashboardEmit: ((event: unknown) => void) | undefined
  await render(client({
    getTransportMaintenanceStatus: async () => readyStatus,
    onTransportProgress: (listener) => {
      dashboardEmit = listener
      return () => { dashboardEmit = undefined }
    },
  }), true)
  await act(async () => {
    dashboardEmit?.({ action: 'downloading', kind: 'info', message: 'Downloading I2P router.',
      percent: 42, revision: 1, schema: 'home-v2-transport-progress' })
  })
  assert.equal(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'), '42')
  await act(async () => {
    dashboardEmit?.({ action: 'idle', kind: 'info', message: 'Idle.',
      percent: null, revision: 1, schema: 'home-v2-transport-progress' })
  })
  assert.equal(container.querySelector('[role="progressbar"]'), null)

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
