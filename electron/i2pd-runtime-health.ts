export type I2pdObservedRouterState =
  | 'external-running'
  | 'legacy-stopped'
  | 'managed-running'
  | 'managed-stopped'
  | 'missing'
  | 'unknown'

/**
 * Process ownership and SAM readiness are independent observations. A live
 * owned process is never called stopped just because its SAM endpoint is still
 * starting or unavailable.
 */
export function projectI2pdObservedRouterState(input: Readonly<{
  absentState: Exclude<I2pdObservedRouterState, 'external-running' | 'managed-running'>
  managedProcessActive: boolean
  samReady: boolean
}>): I2pdObservedRouterState {
  if (input.managedProcessActive) return 'managed-running'
  if (input.samReady) return 'external-running'
  return input.absentState
}
