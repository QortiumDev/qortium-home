import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type {
  HomeV2CoreManagerActionResult,
  HomeV2CoreManagerStatus,
} from '../../electron/home-v2-core-manager-contract'
import type { HomeV2CoreManagerClient } from './core-manager-client'
import type { HomeV2NodeClient } from './node-client'
import {
  createInitialHomeV2Nodes,
  useHomeV2NodeCoreController,
} from './node-core-controller'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// A minimal fake clock for window.setTimeout, so the lifecycle follow-up reads
// can be driven without the test actually waiting seconds for them.
const scheduled = new Map<number, { at: number; run: () => void }>()
let fakeNow = 0
let nextTimerId = 1
const realSetTimeout = window.setTimeout
const realClearTimeout = window.clearTimeout
;(window as unknown as { setTimeout: unknown }).setTimeout =
  ((run: () => void, delay = 0) => {
    const id = nextTimerId++
    scheduled.set(id, { at: fakeNow + delay, run })
    return id
  }) as unknown as typeof window.setTimeout
;(window as unknown as { clearTimeout: unknown }).clearTimeout =
  ((id: number) => { scheduled.delete(id) }) as unknown as typeof window.clearTimeout
const clock = {
  async advance(ms: number) {
    fakeNow += ms
    for (const [id, timer] of [...scheduled.entries()]) {
      if (timer.at <= fakeNow) {
        scheduled.delete(id)
        timer.run()
      }
    }
    await Promise.resolve()
    await Promise.resolve()
  },
  restore() {
    ;(window as unknown as { setTimeout: unknown }).setTimeout = realSetTimeout
    ;(window as unknown as { clearTimeout: unknown }).clearTimeout = realClearTimeout
  },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function nodeSnapshot(label: string) {
  const nodes = createInitialHomeV2Nodes()
  return {
    version: 1,
    nodes: {
      qortal: { ...nodes.qortal, label: `${label}-qortal` },
      qortium: { ...nodes.qortium, label: `${label}-qortium` },
    },
  }
}

function coreStatus(
  network: 'qortal' | 'qortium',
  runtime: 'running' | 'stopped' = 'stopped',
): HomeV2CoreManagerStatus {
  return {
    capabilities: {
      canStart: runtime === 'stopped',
      canStop: runtime === 'running',
    },
    control: 'full',
    install: 'home-managed',
    issue: null,
    network,
    revision: 1,
    runtime,
    schema: 'home-v2-core-manager',
  }
}

function actionResult(
  network: 'qortal' | 'qortium',
  runtime: 'running' | 'stopped',
): HomeV2CoreManagerActionResult {
  return {
    code: null,
    network,
    outcome: 'completed',
    revision: 1,
    schema: 'home-v2-core-manager-action',
    status: coreStatus(network, runtime),
    warning: null,
  }
}

type Controller = ReturnType<typeof useHomeV2NodeCoreController>
let controller!: Controller

function Harness({
  coreClient,
  nodeClient,
  onLifecycleSettled,
}: {
  readonly coreClient: HomeV2CoreManagerClient | null
  readonly nodeClient: HomeV2NodeClient | null
  readonly onLifecycleSettled?: () => void
}) {
  controller = useHomeV2NodeCoreController({ coreClient, nodeClient, onLifecycleSettled })
  return <span>{controller.nodes.qortium.label}</span>
}

const container = document.createElement('div')
document.body.appendChild(container)
const root = createRoot(container)

try {
  const oldRefresh = deferred<ReturnType<typeof nodeSnapshot>>()
  const newRefresh = deferred<ReturnType<typeof nodeSnapshot>>()
  const mutation = deferred<ReturnType<typeof nodeSnapshot>>()
  let snapshotCalls = 0
  let mutationCalls = 0
  const nodeClient = {
    getSnapshot: () => {
      snapshotCalls += 1
      return snapshotCalls === 1 ? oldRefresh.promise : newRefresh.promise
    },
    setMode: () => {
      mutationCalls += 1
      return mutation.promise
    },
  } as unknown as HomeV2NodeClient

  await act(async () => {
    root.render(<Harness coreClient={null} nodeClient={nodeClient} />)
    await Promise.resolve()
  })
  assert.equal(snapshotCalls, 1)
  const newestRefresh = controller.refreshNodes()
  assert.equal(snapshotCalls, 2)
  await act(async () => {
    newRefresh.resolve(nodeSnapshot('new'))
    await newestRefresh
  })
  assert.equal(controller.nodes.qortium.label, 'new-qortium')
  await act(async () => {
    oldRefresh.resolve(nodeSnapshot('old'))
    await Promise.resolve()
  })
  assert.equal(controller.nodes.qortium.label, 'new-qortium')

  let firstMutation!: ReturnType<Controller['setNodeMode']>
  let rejectedConcurrentMutation!: ReturnType<Controller['setNodeMode']>
  act(() => {
    firstMutation = controller.setNodeMode('qortium', 'public')
    rejectedConcurrentMutation = controller.setNodeMode('qortal', 'public')
  })
  assert.equal(await rejectedConcurrentMutation, false)
  assert.equal(mutationCalls, 1)
  await act(async () => {
    mutation.resolve(nodeSnapshot('mutation'))
    assert.equal(await firstMutation, true)
  })
  assert.equal(controller.nodes.qortium.label, 'mutation-qortium')

  const qortiumStart = deferred<HomeV2CoreManagerActionResult>()
  const qortalStop = deferred<HomeV2CoreManagerActionResult>()
  let qortiumStartCalls = 0
  let qortalStartCalls = 0
  let qortalStopCalls = 0
  const coreClient: HomeV2CoreManagerClient = {
    getMaintenanceStatus: async () => ({} as never),
    checkMaintenanceRelease: async () => ({} as never),
    runMaintenanceAction: async () => ({} as never),
    getUpdatePolicy: async () => ({} as never),
    setUpdatePolicy: async () => ({} as never),
    getStatus: async (network) => coreStatus(network, network === 'qortal' ? 'running' : 'stopped'),
    start: async (network) => {
      if (network === 'qortal') {
        qortalStartCalls += 1
        return actionResult('qortal', 'running')
      }
      qortiumStartCalls += 1
      return qortiumStart.promise
    },
    stop: async (network) => {
      assert.equal(network, 'qortal')
      qortalStopCalls += 1
      return qortalStop.promise
    },
  }
  await act(async () => {
    root.render(<Harness coreClient={coreClient} nodeClient={null} />)
    await Promise.resolve()
    await Promise.resolve()
  })
  let startPromise!: ReturnType<Controller['runCoreAction']>
  let stopPromise!: ReturnType<Controller['runCoreAction']>
  let rejectedStart!: ReturnType<Controller['runCoreAction']>
  act(() => {
    startPromise = controller.runCoreAction('qortium', 'start')
    stopPromise = controller.runCoreAction('qortal', 'stop')
    rejectedStart = controller.runCoreAction('qortal', 'start')
  })
  assert.equal(await rejectedStart, null)
  assert.equal(qortiumStartCalls, 1)
  assert.equal(qortalStopCalls, 1)
  assert.equal(qortalStartCalls, 0)
  await act(async () => {
    qortiumStart.resolve(actionResult('qortium', 'running'))
    qortalStop.resolve(actionResult('qortal', 'stopped'))
    await Promise.all([startPromise, stopPromise])
  })
  assert.equal(controller.coreStatuses.qortium.runtime, 'running')
  assert.equal(controller.coreStatuses.qortal.runtime, 'stopped')
  assert.deepEqual(controller.coreBusyActions, { qortal: null, qortium: null })
} finally {
  act(() => root.unmount())
  container.remove()
}

// A transient poll failure must NOT report the nodes as unreadable. Everything
// downstream keys off capabilities.read, and losing it reloads the open app —
// which wipes anything the user was typing. Only a sustained outage counts.
{
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  try {
    let snapshotCalls = 0
    let failing = true
    const nodeClient = {
      getSnapshot: () => {
        snapshotCalls += 1
        return failing
          ? Promise.reject(new Error('network blip'))
          : Promise.resolve(nodeSnapshot('recovered'))
      },
      setMode: () => Promise.resolve(nodeSnapshot('recovered')),
    } as unknown as HomeV2NodeClient

    await act(async () => {
      root.render(<Harness coreClient={null} nodeClient={nodeClient} />)
      await Promise.resolve()
    })

    const readable = () => controller.nodes.qortium.capabilities.read
    const initiallyReadable = readable()

    // Two failures in a row are absorbed.
    for (let attempt = snapshotCalls; attempt < 2; attempt += 1) {
      await act(async () => {
        await controller.refreshNodes()
      })
      assert.equal(
        readable(),
        initiallyReadable,
        'a single failed poll must not change node readability',
      )
    }

    // The third consecutive failure is treated as a real outage.
    await act(async () => {
      await controller.refreshNodes()
    })
    assert.equal(readable(), false, 'a sustained outage must mark nodes unavailable')

    // Recovery clears the streak, so the next blip is absorbed again.
    failing = false
    await act(async () => {
      await controller.refreshNodes()
    })
    assert.equal(controller.nodes.qortium.label, 'recovered-qortium')
    failing = true
    await act(async () => {
      await controller.refreshNodes()
    })
    assert.equal(
      readable(),
      controller.nodes.qortium.capabilities.read,
      'the failure streak must reset after a successful poll',
    )
    assert.equal(controller.nodes.qortium.label, 'recovered-qortium')
  } finally {
    act(() => root.unmount())
    container.remove()
  }
}

// --- A lifecycle action must invalidate everything that reads runtime -----
// Start/stop changes state the maintenance slice and the transport row read
// through their OWN 30s polls. Without this callback, stopping the Core left
// the install gate reading "not stopped" for up to half a minute: the tile
// told the user to stop a Core they had just stopped, kept Update disabled,
// and the Refresh button did not reach the gate either.
{
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  try {
    let settled = 0
    const coreClient: HomeV2CoreManagerClient = {
      getMaintenanceStatus: async () => ({} as never),
      checkMaintenanceRelease: async () => ({} as never),
      runMaintenanceAction: async () => ({} as never),
      getUpdatePolicy: async () => ({} as never),
      setUpdatePolicy: async () => ({} as never),
      getStatus: async (network) => coreStatus(network, 'stopped'),
      start: async (network) => actionResult(network, 'running'),
      stop: async () => { throw new Error('stop failed') },
    }
    await act(async () => {
      root.render(
        <Harness coreClient={coreClient} nodeClient={null} onLifecycleSettled={() => { settled += 1 }} />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => { await controller.runCoreAction('qortium', 'start') })
    assert.equal(settled, 1, 'a successful start must invalidate the derived state')

    // ...and on FAILURE too: a stop that reported an error may still have
    // stopped it, and a stale gate is exactly how the tile contradicts itself.
    await act(async () => { await controller.runCoreAction('qortal', 'stop') })
    assert.equal(settled, 2, 'a failed action must invalidate the derived state as well')

    // The settle is not instant. A Core told to start has only SPAWNED by the
    // time the action returns -- its API answers seconds later -- so the refresh
    // that fires immediately sees a half-started Core, and the regular poll is
    // up to 15s away. Follow-up reads close that window.
    //
    // This start is the subject: with no node client the node never becomes
    // readable, which is the state a Core that has not finished starting is in.
    await act(async () => { await controller.runCoreAction('qortium', 'start') })
    const afterAction = settled
    await act(async () => { await clock.advance(1_500) })
    assert.ok(
      settled > afterAction,
      'a lifecycle action must keep re-reading while the Core settles',
    )
    // The window must reach past FIFTEEN seconds. Measured on a real managed
    // Core restart (2026-08-30): process up at 15:36:57, API first answering at
    // 15:37:12. An earlier draft stopped at 9s, so every read would have landed
    // while the API was still silent and the tile would have waited for the
    // regular poll regardless.
    // The window must reach past FIFTEEN seconds. Measured on a real managed
    // Core restart (2026-08-30): process up at 15:36:57, API first answering at
    // 15:37:12. An earlier draft of this fix stopped at 9s, so every read would
    // have landed while the API was still silent.
    //
    // Advanced in STEPS on purpose. One long jump from 1.5s to 20s is satisfied
    // by the early reads and lets a too-short schedule pass -- which it did.
    await act(async () => { await clock.advance(8_000) })   // t = 9.5s
    const afterEarlyReads = settled
    await act(async () => { await clock.advance(12_000) })  // t = 21.5s
    assert.ok(
      settled > afterEarlyReads,
      'a read must land AFTER ~15s, which is how long a real Core took to answer',
    )
    // ...but it must STOP once the schedule has run. This fills the gap before
    // the regular poll; it must not become a second polling loop.
    await act(async () => { await clock.advance(10_000) })  // t = 31.5s
    const afterAll = settled
    await act(async () => { await clock.advance(120_000) })
    assert.equal(
      settled,
      afterAll,
      'the follow-ups must be finite, not a second poll loop',
    )
  } finally {
    act(() => root.unmount())
    container.remove()
  }
}

// Starting a Core through Home adopts the local node -- once. The owner asked
// for the switch AND for the freedom to move away afterwards, so this must be
// tied to the start action, never re-applied because the Core happens to be up.
{
  const localNodes = createInitialHomeV2Nodes()
  const setModeCalls: Array<{ mode: string; network: string }> = []
  // The mode PERSISTS, as it does on a real node: without that the refresh that
  // follows a start would keep reporting the old mode and this test would prove
  // nothing about the one-time behaviour.
  let qortiumMode: 'local' | 'public' = 'public'
  const snapshotNow = () => ({
    version: 1,
    nodes: {
      qortal: localNodes.qortal,
      qortium: { ...localNodes.qortium, mode: qortiumMode },
    },
  })
  const nodeClient = {
    getSnapshot: async () => snapshotNow(),
    setMode: async (network: string, mode: string) => {
      setModeCalls.push({ mode, network })
      if (network === 'qortium') qortiumMode = mode as 'local' | 'public'
      return snapshotNow()
    },
  } as unknown as HomeV2NodeClient
  const coreClient = {
    getStatus: async (network: 'qortal' | 'qortium') => coreStatus(network, 'stopped'),
    start: async (network: 'qortal' | 'qortium') => actionResult(network, 'running'),
    stop: async (network: 'qortal' | 'qortium') => actionResult(network, 'stopped'),
  } as unknown as Parameters<typeof Harness>[0]['coreClient']

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  try {
  await act(async () => {
    root.render(<Harness coreClient={coreClient} nodeClient={nodeClient} />)
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    await controller.runCoreAction('qortium', 'start')
  })
  assert.deepEqual(setModeCalls, [{ mode: 'local', network: 'qortium' }],
    'starting a Core through Home switches that node to local')

  // Already local: nothing to switch, and no redundant write.
  setModeCalls.length = 0
  await act(async () => {
    await controller.runCoreAction('qortium', 'start')
  })
  assert.deepEqual(setModeCalls, [],
    'a node already on local must not be re-switched')

  // A STOP never touches the node mode.
  await act(async () => {
    await controller.runCoreAction('qortal', 'stop')
  })
  assert.deepEqual(setModeCalls, [], 'stopping a Core must not change the node mode')
  } finally {
    act(() => root.unmount())
    container.remove()
  }
}

console.log('home v2 node/core controller hook tests passed')
