import assert from 'node:assert/strict'
import { projectI2pdObservedRouterState } from './i2pd-runtime-health.js'

for (const test of [
  { managedProcessActive: true, samReady: true, expected: 'managed-running' },
  { managedProcessActive: true, samReady: false, expected: 'managed-running' },
  { managedProcessActive: false, samReady: true, expected: 'external-running' },
  { managedProcessActive: false, samReady: false, expected: 'managed-stopped' },
] as const) {
  assert.equal(projectI2pdObservedRouterState({
    absentState: 'managed-stopped',
    managedProcessActive: test.managedProcessActive,
    samReady: test.samReady,
  }), test.expected)
}

assert.equal(projectI2pdObservedRouterState({
  absentState: 'unknown',
  managedProcessActive: false,
  samReady: false,
}), 'unknown')

console.log('i2pd runtime health tests passed.')
