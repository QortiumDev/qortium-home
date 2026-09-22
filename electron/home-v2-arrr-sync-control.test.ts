import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { createArrrCustodyReadQueue } from './arrr-custody.js'
import { ARRR_SYNC_CONTROL_CONTRACT, arrrSyncControlRows, validArrrSyncControlRows, runHomeV2ArrrSyncControl, type ArrrSyncControlDeps } from './home-v2-arrr-sync-control.js'
import type { ArrrCustodyRoute } from './home-v2-arrr-custody-read.js'

const route: ArrrCustodyRoute = { trusted: true, reason: null, apiKey: 'test-only', bindingId: 'binding', revision: 'revision', nodeRoute: 'custom|https://node.test', nodeApiUrl: 'https://node.test' }
function fixture() {
  const calls: string[] = []
  let valid = true
  let current = route
  const deps: ArrrSyncControlDeps = {
    action: 'STOP_ARRR_SYNC', requestValue: { coin: 'ARRR' }, principalKey: 'tab-a',
    queue: createArrrCustodyReadQueue(),
    assertContext: () => { if (!valid) throw new Error('context changed') },
    resolveRoute: async () => current,
    requireApproval: async () => { calls.push('approve') },
    post: async (_route, path) => { calls.push(path); return { ok: true, status: 200, body: 'true', data: true } },
    readEnabled: async () => { calls.push('status'); return { enabled: false, privateField: 'never-return' } },
  }
  return { deps, calls, invalidate: () => { valid = false }, changeRoute: () => { current = { ...route, revision: 'changed' } } }
}
for (const action of ['STOP_ARRR_SYNC', 'START_ARRR_SYNC'] as const) {
  const f = fixture(); f.deps.action = action
  f.deps.readEnabled = async () => ({ enabled: action === 'START_ARRR_SYNC', secret: 'not-returned' })
  const result = await runHomeV2ArrrSyncControl(f.deps)
  assert.equal(result.completed, true)
  assert.equal(result.enabled, action === 'START_ARRR_SYNC')
  assert.equal(result.contract, ARRR_SYNC_CONTROL_CONTRACT)
  assert.equal(result.scope, 'node')
  assert.deepEqual(f.calls, ['approve', action === 'START_ARRR_SYNC' ? '/crosschain/arrr/start' : '/crosschain/arrr/stop'])
  assert.equal(JSON.stringify(result).includes('not-returned'), false)
  assert.equal(validArrrSyncControlRows(action, arrrSyncControlRows(action, route.nodeApiUrl)), true)
  assert.equal(validArrrSyncControlRows(action, arrrSyncControlRows(action === 'STOP_ARRR_SYNC' ? 'START_ARRR_SYNC' : 'STOP_ARRR_SYNC', route.nodeApiUrl)), false)
}
for (const requestValue of [{ coin: 'BTC' }, { coin: 'ARRR', apiKey: 'injected' }, { payload: { coin: 'ARRR' } }, { nodeApiUrl: 'https://attacker.test' }]) {
  const f = fixture(); f.deps.requestValue = requestValue
  await assert.rejects(runHomeV2ArrrSyncControl(f.deps)); assert.deepEqual(f.calls, [])
}
{
  const f = fixture(); f.deps.requireApproval = async () => { throw new Error('denied') }
  await assert.rejects(runHomeV2ArrrSyncControl(f.deps), /denied/); assert.deepEqual(f.calls, [])
}
{
  const f = fixture(); f.deps.resolveRoute = async () => ({ ...route, trusted: false })
  await assert.rejects(runHomeV2ArrrSyncControl(f.deps), /admin-trusted/); assert.deepEqual(f.calls, [])
}
for (const change of ['context', 'route'] as const) {
  const f = fixture(); f.deps.requireApproval = async () => change === 'context' ? f.invalidate() : f.changeRoute()
  await assert.rejects(runHomeV2ArrrSyncControl(f.deps)); assert.deepEqual(f.calls, [])
}
{
  const f = fixture(); const original = f.deps.resolveRoute; let resolves = 0
  f.deps.resolveRoute = async () => { const r = await original(); if (++resolves === 2) f.invalidate(); return r }
  await assert.rejects(runHomeV2ArrrSyncControl(f.deps), /context changed/); assert.deepEqual(f.calls, ['approve'])
}
{
  const f = fixture(); let release!: () => void
  const blocker = f.deps.queue.run(route.nodeRoute, () => new Promise<void>(r => { release = r }), { principalKey: 'other' })
  const control = runHomeV2ArrrSyncControl(f.deps)
  await new Promise(r => setImmediate(r)); f.invalidate(); release(); await blocker
  await assert.rejects(control, /context changed/); assert.deepEqual(f.calls, ['approve'])
}
for (const body of ['false', '"true"', '{"accepted":true}', '']) {
  const f = fixture(); f.deps.post = async () => ({ ok: true, status: 200, body, data: null })
  await assert.rejects(runHomeV2ArrrSyncControl(f.deps), { code: 'ARRR_SYNC_CONTROL_FAILED' })
}
for (const phase of ['post', 'readback'] as const) {
  const f = fixture()
  if (phase === 'post') f.deps.post = async () => { f.invalidate(); return { ok: true, status: 200, body: 'true', data: true } }
  else f.deps.readEnabled = async () => { f.invalidate(); return { enabled: false } }
  await assert.rejects(runHomeV2ArrrSyncControl(f.deps), { code: 'ARRR_SYNC_CONTROL_UNCERTAIN' })
}
{
  const f = fixture(); f.deps.readEnabled = async () => ({ enabled: true })
  await assert.rejects(runHomeV2ArrrSyncControl(f.deps), { code: 'ARRR_SYNC_CONTROL_UNCERTAIN' })
}
console.log('ARRR sync control approval, queue, lifecycle, readback and result tests passed')

{
  const rows = arrrSyncControlRows('STOP_ARRR_SYNC', 'https://node.test')
  assert.equal(validArrrSyncControlRows('STOP_ARRR_SYNC', [{ ...rows[0], value: 'Harmless read' }, rows[1], rows[2]]), false)
  assert.equal(validArrrSyncControlRows('STOP_ARRR_SYNC', arrrSyncControlRows('STOP_ARRR_SYNC', 'https://node.test' + String.fromCharCode(10))), false)
}
{
  const f = fixture(); let release!: () => void
  const blocker = f.deps.queue.run(route.nodeRoute, () => new Promise<void>(r => { release = r }), { principalKey: 'other' })
  const control = runHomeV2ArrrSyncControl(f.deps)
  const rejection = assert.rejects(control, { code: 'ARRR_READ_CANCELLED' })
  await new Promise(r => setImmediate(r))
  assert.equal(f.deps.queue.cancelWhere(meta => meta.principalKey === 'tab-a'), 1)
  release(); await blocker; await rejection
  assert.deepEqual(f.calls, ['approve'])
}
// Production wiring: control POST never derives or submits entropy, and all
// controls are dispatched through the same tested orchestrator/read queue.
const bridge = readFileSync(new URL('../electron/home-v2-app-bridge.ts', import.meta.url), 'utf8')
const handler = bridge.slice(bridge.indexOf('async function controlHomeV2ArrrSync('), bridge.indexOf('async function setHomeV2ForeignServer('))
assert.equal(handler.includes('runHomeV2ArrrSyncControl'), true)
assert.equal(handler.includes('queue: homeV2ArrrCustodyReads'), true)
assert.equal(handler.includes("kind: 'node-settings'"), true)
assert.equal(handler.includes("redirect: 'error'"), true)
assert.equal(/getAccountForeignWalletSeed|withArrrEntropy|executeArrrCustodyRead/.test(handler), false)
