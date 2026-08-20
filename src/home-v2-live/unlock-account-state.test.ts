import assert from 'node:assert/strict'
import { assertHomeV2UnlockCompleted } from '../../electron/home-v2-unlock-contract'
import { completeUnlockAfterAccountStatePropagation } from './unlock-account-state'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

const tabs = [
  { context: { identityId: 'home-v2:identity:wallet-one' }, id: 'tab-wallet' },
  { context: { identityId: 'home-v2:identity:wallet-one:address-two' }, id: 'tab-address' },
  { context: { identityId: 'home-v2:identity:wallet-one-other' }, id: 'tab-prefix-trap' },
  { context: { identityId: 'home-v2:identity:wallet-two' }, id: 'tab-unrelated' },
]

{
  const first = deferred()
  const second = deferred()
  const requests: unknown[] = []
  let bridgeUnlocked = false
  let desktopApproved = false
  const completion = completeUnlockAfterAccountStatePropagation({
    accountId: 'wallet-one',
    tabs,
    updateAccountState: (request) => {
      requests.push(request)
      const update = request.tabId === 'tab-wallet' ? first.promise : second.promise
      return update.then(() => {
        bridgeUnlocked = true
      })
    },
    resolveDesktop: () => {
      assertHomeV2UnlockCompleted('wallet-one', () => bridgeUnlocked)
      desktopApproved = true
    },
  })

  await Promise.resolve()
  assert.equal(desktopApproved, false)
  first.resolve()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(desktopApproved, false)
  second.resolve()
  await completion

  assert.equal(desktopApproved, true)
  assert.deepEqual(requests, [
    { accountId: 'wallet-one', isUnlocked: true, tabId: 'tab-wallet' },
    { accountId: 'wallet-one:address-two', isUnlocked: true, tabId: 'tab-address' },
  ])
}

{
  const update = deferred()
  let androidCompleted = false
  const completion = completeUnlockAfterAccountStatePropagation({
    accountId: 'wallet-one',
    tabs: tabs.slice(0, 1),
    updateAccountState: () => update.promise,
    completeAndroid: async () => {
      androidCompleted = true
    },
  })

  await Promise.resolve()
  assert.equal(androidCompleted, false)
  update.resolve()
  await completion
  assert.equal(androidCompleted, true)
}

{
  const failure = deferred()
  let androidCompleted = false
  let desktopApproved = false
  const completion = completeUnlockAfterAccountStatePropagation({
    accountId: 'wallet-one',
    tabs: tabs.slice(0, 1),
    updateAccountState: () => failure.promise,
    completeAndroid: async () => {
      androidCompleted = true
    },
    resolveDesktop: () => {
      desktopApproved = true
    },
  })

  failure.reject(new Error('account state update failed'))
  await assert.rejects(completion, /account state update failed/)
  assert.equal(androidCompleted, false)
  assert.equal(desktopApproved, false)
}

assert.throws(
  () => assertHomeV2UnlockCompleted('wallet-one', () => false),
  /The account was not unlocked\./,
)

console.log('Home v2 unlock account-state ordering tests passed.')
