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
}: {
  readonly coreClient: HomeV2CoreManagerClient | null
  readonly nodeClient: HomeV2NodeClient | null
}) {
  controller = useHomeV2NodeCoreController({ coreClient, nodeClient })
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

console.log('home v2 node/core controller hook tests passed')
