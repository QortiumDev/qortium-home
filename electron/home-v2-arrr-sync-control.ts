// Node-wide ARRR controller operations. No seed or entropy access belongs here.
import type { ArrrCustodyReadQueue, ArrrCustodyResponse } from './arrr-custody.js'
import type { ArrrCustodyRoute } from './home-v2-arrr-custody-read.js'

export const ARRR_SYNC_CONTROL_CONTRACT = 'qortium-home-arrr-sync-control-v1' as const
export const HOME_V2_ARRR_SYNC_CONTROL_ACTIONS = ['STOP_ARRR_SYNC', 'START_ARRR_SYNC'] as const
export type ArrrSyncControlAction = (typeof HOME_V2_ARRR_SYNC_CONTROL_ACTIONS)[number]
export function isHomeV2ArrrSyncControlAction(action: string): action is ArrrSyncControlAction {
  return action === 'STOP_ARRR_SYNC' || action === 'START_ARRR_SYNC'
}
export function arrrSyncControlOperation(action: ArrrSyncControlAction) {
  return action === 'STOP_ARRR_SYNC' ? 'Stop ARRR syncing' : 'Start ARRR syncing'
}
export function arrrSyncControlImpact(action: ArrrSyncControlAction) {
  return action === 'STOP_ARRR_SYNC'
    ? "Stop this node's ARRR wallet controller for all accounts and apps. Core keeps running; stored wallet data is kept."
    : "Start this node's ARRR wallet controller. Wallet syncing resumes when the wallet is opened."
}
export function arrrSyncControlRows(action: ArrrSyncControlAction, nodeApiUrl: string) {
  return [
    { label: 'Impact', value: arrrSyncControlImpact(action) },
    { label: 'Node', value: nodeApiUrl },
    { label: 'Persistence', value: 'Until Core restarts; saved settings are unchanged.' },
  ] as const
}
export function validArrrSyncControlRows(action: ArrrSyncControlAction, value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 3) return false
  const node = value[1]?.value
  if (typeof node !== 'string' || node.length === 0 || node.length > 500 || /[\u0000-\u001f\u007f]/.test(node)) return false
  const expected = arrrSyncControlRows(action, node)
  return expected.every((row, i) => value[i] && Object.keys(value[i]).length === 2 && value[i].label === row.label && value[i].value === row.value)
}
export function validateArrrSyncControlRequest(value: Record<string, unknown>) {
  if (Object.keys(value).some(key => !['action', 'coin'].includes(key)) ||
      (value.coin !== undefined && value.coin !== 'ARRR')) {
    throw new Error('ARRR sync controls accept only the action and optional coin: ARRR. The node is selected by Home.')
  }
}
export class ArrrSyncControlError extends Error {
  constructor(message: string, readonly code: 'ARRR_SYNC_CONTROL_FAILED' | 'ARRR_SYNC_CONTROL_UNCERTAIN') {
    super(message)
    this.name = 'ArrrSyncControlError'
  }
}
export type ArrrSyncControlResult = Readonly<{
  contract: typeof ARRR_SYNC_CONTROL_CONTRACT
  coin: 'ARRR'
  operation: 'stop' | 'start'
  scope: 'node'
  completed: true
  enabled: boolean
  observedAt: number
}>
export type ArrrSyncControlDeps = {
  action: ArrrSyncControlAction
  requestValue: Record<string, unknown>
  resolveRoute: () => Promise<ArrrCustodyRoute>
  assertContext: () => void
  requireApproval: (route: ArrrCustodyRoute) => Promise<void>
  queue: ArrrCustodyReadQueue
  principalKey: string
  queueTags?: Readonly<Record<string, string | number>>
  post: (route: ArrrCustodyRoute, path: '/crosschain/arrr/stop' | '/crosschain/arrr/start') => Promise<ArrrCustodyResponse>
  readEnabled: (route: ArrrCustodyRoute) => Promise<unknown>
}

export async function runHomeV2ArrrSyncControl(deps: ArrrSyncControlDeps): Promise<ArrrSyncControlResult> {
  validateArrrSyncControlRequest(deps.requestValue)
  if (!isHomeV2ArrrSyncControlAction(deps.action)) throw new Error('Unsupported ARRR sync control.')
  deps.assertContext()
  const initial = await deps.resolveRoute()
  deps.assertContext()
  if (!initial.trusted) throw new Error('ARRR sync controls require an admin-trusted Qortium node.')
  const validate = async () => {
    deps.assertContext()
    const route = await deps.resolveRoute()
    deps.assertContext()
    if (!route.trusted || route.nodeRoute !== initial.nodeRoute || route.nodeApiUrl !== initial.nodeApiUrl ||
        route.bindingId !== initial.bindingId || route.revision !== initial.revision) {
      throw new Error('The selected Qortium node or its API key changed before the ARRR operation completed.')
    }
    return route
  }
  await deps.requireApproval(initial)
  await validate()
  return deps.queue.run(initial.nodeRoute, async () => {
    const route = await validate()
    const enabled = deps.action === 'START_ARRR_SYNC'
    // Once POST begins a transport/context failure is an uncertain outcome.
    // Never auto-retry or imply that a revoked/closed tab undid the node write.
    try {
      const response = await deps.post(route, enabled ? '/crosschain/arrr/start' : '/crosschain/arrr/stop')
      await validate()
      if (!response.ok || response.body.trim() !== 'true') {
        throw new ArrrSyncControlError(enabled
          ? 'Core did not confirm that the ARRR controller started. Check sync status before trying again.'
          : 'Core did not confirm that the ARRR controller stopped. Shutdown may still be in progress; wait and check stop completion before starting.', 'ARRR_SYNC_CONTROL_FAILED')
      }
      const status = await deps.readEnabled(route)
      await validate()
      if (!status || typeof status !== 'object' || (status as { enabled?: unknown }).enabled !== enabled) {
        throw new ArrrSyncControlError('ARRR controller state could not be confirmed. Check sync status before trying again.', 'ARRR_SYNC_CONTROL_UNCERTAIN')
      }
      return Object.freeze({ contract: ARRR_SYNC_CONTROL_CONTRACT, coin: 'ARRR', operation: enabled ? 'start' : 'stop', scope: 'node', completed: true, enabled, observedAt: Date.now() })
    } catch (error) {
      if (error instanceof ArrrSyncControlError) throw error
      throw new ArrrSyncControlError('The ARRR controller request may have taken effect, but its result could not be confirmed. Check sync status before trying again.', 'ARRR_SYNC_CONTROL_UNCERTAIN')
    }
  }, { principalKey: deps.principalKey, tags: deps.queueTags })
}
