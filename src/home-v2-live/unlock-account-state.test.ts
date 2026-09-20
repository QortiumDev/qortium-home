import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  assertHomeV2UnlockCompleted,
  homeV2UnlockPromptRequired,
  requireHomeV2Unlock,
} from '../../electron/home-v2-unlock-contract'
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

// UNLOCK_SELECTED_ACCOUNT for an ALREADY unlocked account never asks (owner
// decision 2026-09-20); a locked account still does. The predicate is read
// live, so a lock that lands during an await is a locked account.
{
  const unlocked = new Set(['wallet-one'])
  const isUnlocked = (accountId: string) => unlocked.has(accountId)
  assert.equal(homeV2UnlockPromptRequired('wallet-one', isUnlocked), false, 'already unlocked: no prompt')
  assert.equal(homeV2UnlockPromptRequired('wallet-two', isUnlocked), true, 'locked: prompt')
  unlocked.delete('wallet-one')
  assert.equal(homeV2UnlockPromptRequired('wallet-one', isUnlocked), true, 'locked since: prompt')
  assert.doesNotThrow(() => assertHomeV2UnlockCompleted('wallet-two', () => true))
}

// Behaviour: with a stubbed lock state and a counting prompt, an
// already-unlocked account never emits a permission request; a locked one
// emits exactly one and must actually be unlocked when it resolves.
{
  const unlocked = new Set<string>()
  const isUnlocked = (accountId: string) => unlocked.has(accountId)
  let prompts = 0
  const prompt = async () => {
    prompts += 1
    unlocked.add('wallet-one')
  }
  unlocked.add('wallet-one')
  assert.equal(await requireHomeV2Unlock({ accountId: 'wallet-one', isUnlocked, prompt }), 'already-unlocked')
  assert.equal(prompts, 0, 'an already-unlocked account must not raise the unlock prompt')

  unlocked.clear()
  assert.equal(await requireHomeV2Unlock({ accountId: 'wallet-one', isUnlocked, prompt }), 'prompted')
  assert.equal(prompts, 1, 'a locked account raises exactly one prompt')

  // A prompt that resolves without the account actually unlocking fails.
  unlocked.clear()
  await assert.rejects(
    requireHomeV2Unlock({ accountId: 'wallet-one', isUnlocked, prompt: async () => { prompts += 1 } }),
    /The account was not unlocked\./,
  )
  assert.equal(prompts, 2)
  // A denied prompt propagates and never asserts.
  await assert.rejects(
    requireHomeV2Unlock({ accountId: 'wallet-one', isUnlocked, prompt: async () => { throw new Error('Account access was denied.') } }),
    /Account access was denied\./,
  )
  // Locked → prompt → locked again before the assert (lock state read AFTER
  // the await, never captured before it).
  unlocked.clear()
  await assert.rejects(
    requireHomeV2Unlock({
      accountId: 'wallet-one',
      isUnlocked,
      prompt: async () => { unlocked.add('wallet-one'); unlocked.delete('wallet-one') },
    }),
    /The account was not unlocked\./,
  )
}

// Source pins: the desktop bridge consults the predicate BEFORE raising the
// permission request (after the unselected-account and drifted-resource
// refusals GET_SELECTED_ACCOUNT shares), still forces single-request and
// assertHomeV2UnlockCompleted on the locked path, and re-asserts the unlock
// after the profile await in the handler. The Android renderer applies the
// same rule, and both attribute the dialog to the requesting app.
{
  const bridge = readFileSync('electron/home-v2-app-bridge.ts', 'utf8')
  const gateStart = bridge.indexOf('async function requireAccountReadPermission(')
  assert.notEqual(gateStart, -1)
  const gate = bridge.slice(gateStart, gateStart + 60_000)
  const permissionlessReturn = gate.indexOf("isHomeV2PermissionlessAction(action) && writeDetails?.kind !== 'foreign-wallet-read') return")
  const unlockReturn = gate.indexOf("action === 'UNLOCK_SELECTED_ACCOUNT' && !homeV2UnlockPromptRequired(context.accountId, isAccountUnlocked)")
  const resourceGuard = gate.indexOf('if (!liveResourceMatchesGrant(context))')
  const promptSend = gate.indexOf("'home-v2-app:permission-request'")
  assert.ok(resourceGuard !== -1 && permissionlessReturn !== -1 && unlockReturn !== -1 && promptSend !== -1)
  assert.ok(resourceGuard < permissionlessReturn, 'the drifted-resource refusal precedes the permissionless return')
  assert.ok(permissionlessReturn < unlockReturn, 'the already-unlocked return sits right after the permissionless return')
  assert.ok(unlockReturn < promptSend, 'the already-unlocked return precedes the prompt')
  assert.match(gate, /const singleRequestOnly = action === 'UNLOCK_SELECTED_ACCOUNT' \|\|/)
  assert.match(gate, /if \(action === 'UNLOCK_SELECTED_ACCOUNT'\) \{\s*\n\s*assertHomeV2UnlockCompleted\(context\.accountId, isAccountUnlocked\)/)
  const handlerStart = bridge.indexOf("if (action === 'UNLOCK_SELECTED_ACCOUNT') {\n    // The two refusals GET_SELECTED_ACCOUNT's permissionless gate applies")
  assert.notEqual(handlerStart, -1, 'the UNLOCK_SELECTED_ACCOUNT handler must be locatable')
  const handler = bridge.slice(handlerStart, handlerStart + 2_000)
  // The handler runs the behaviour-tested helper with the real permission
  // gate as its prompt, after the same two refusals the gate applies first.
  const accountRefusal = handler.indexOf("if (!context.accountId) throw new Error('No account is selected for this tab.')")
  const resourceRefusal = handler.indexOf('if (!liveResourceMatchesGrant(context)) {')
  const helperCall = handler.indexOf('await requireHomeV2Unlock({')
  assert.ok(accountRefusal !== -1 && resourceRefusal !== -1 && helperCall !== -1)
  assert.ok(accountRefusal < resourceRefusal && resourceRefusal < helperCall)
  assert.match(handler, /isUnlocked: isAccountUnlocked,\s*\n\s*prompt: \(\) => requireAccountReadPermission\(sender, context, protocol, action\),/)
  assert.match(
    handler,
    /const profile = await getAccountProfile\(unlockAccountId\)[\s\S]{0,400}assertHomeV2UnlockCompleted\(unlockAccountId, isAccountUnlocked\)\s*\n\s*return \{/,
    'isUnlocked: true is asserted after the last await',
  )

  const liveApp = readFileSync('src/home-v2-live/HomeV2LiveApp.tsx', 'utf8')
  const androidStart = liveApp.indexOf("if (action === 'UNLOCK_SELECTED_ACCOUNT') {\n        // No protocol guard")
  assert.notEqual(androidStart, -1, 'the Android UNLOCK_SELECTED_ACCOUNT handler must be locatable')
  const android = liveApp.slice(androidStart, androidStart + 5_000)
  const androidSkip = android.indexOf('if (!homeV2UnlockPromptRequired(account.id,')
  const androidDialog = android.indexOf("mode: 'unlock'")
  assert.ok(androidSkip !== -1 && androidDialog !== -1)
  assert.ok(androidSkip < androidDialog, 'Android answers an already-unlocked account before opening the dialog')
  assert.match(android, /requestingAppTitle: parsedUnlockApp\.title/)
  const desktopPrompt = liveApp.indexOf("if (value.action === 'UNLOCK_SELECTED_ACCOUNT') {\n        // The protocol check")
  assert.notEqual(desktopPrompt, -1)
  assert.match(liveApp.slice(desktopPrompt, desktopPrompt + 2_000), /requestingAppTitle: appTitle/)
  const dialog = readFileSync('src/v2/shell/AccountDialog.tsx', 'utf8')
  assert.match(dialog, /mode === 'unlock' && requestingAppTitle \?[\s\S]{0,200}home2\.accountDialog\.unlockRequestedBy/)
}

console.log('Home v2 unlock account-state ordering tests passed.')
