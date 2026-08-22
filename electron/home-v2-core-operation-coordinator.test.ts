import assert from 'node:assert/strict'
import { homeV2CoreOperationCoordinator as coordinator } from './home-v2-core-operation-coordinator.js'

const revision = coordinator.automaticRevision
const automatic = coordinator.tryBeginAutomatic(['qortium'], revision)
assert(automatic)
assert.equal(coordinator.tryBeginInteractive(['qortium']), null)
automatic.release()

const qortiumStart = coordinator.tryBeginInteractive(['qortium'], { serializeStart: true })
assert(qortiumStart)
const qortalStart = coordinator.tryBeginInteractive(['qortal'], { serializeStart: true })
assert.equal(qortalStart, null)
qortiumStart.release()

const staleRevision = coordinator.automaticRevision
const lifecycle = coordinator.tryBeginInteractive(['qortal'])
assert(lifecycle)
assert.equal(coordinator.tryBeginAutomatic(['qortium'], staleRevision), null)
lifecycle.release()

const both = coordinator.tryBeginAutomatic(
  ['qortal', 'qortium'],
  coordinator.automaticRevision,
)
assert(both)
assert.equal(coordinator.tryBeginInteractive(['qortal']), null)
assert.equal(coordinator.tryBeginInteractive(['qortium']), null)
both.release()

console.log('Home 2 Core operation coordinator tests passed.')
