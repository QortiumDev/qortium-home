// Round 4, Defect A (Sol round-3 re-review): reproduces the tab-switch race
// and proves the fix (Android app stage keyed by active tab id) closes it —
// see AppTabStage.tsx's androidAppStageKey doc comment for the mechanism.
//
// Requires a real DOM (react-dom/client mounts/unmounts/effects do not run
// under react-dom/server's renderToStaticMarkup, which the rest of this
// package's React tests use) — see scripts/run-app-tab-stage-android-test.mjs,
// which sets up jsdom globals BEFORE this bundle's own `react`/`react-dom`
// imports evaluate, and package.json's test:app-tab-stage-android script,
// which aliases `@capacitor/core` to test-kit/fake-capacitor-core.ts so
// AndroidAppStage's native proxy-authorization call resolves deterministically
// without a real Android bridge.
import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { AppTabStage, androidAppStageKey } from './AppTabStage'
import { createProductState, reduceProductState } from '../product-model'
import type { ProductState } from '../product-model'
import {
  fixtureApp,
  fixtureIds,
  fixtureTabContext,
  homeV2Fixture,
} from '../test-kit/fixtures'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function openTwoTabProductState(): { withAActive: ProductState; withBActive: ProductState } {
  const chat = fixtureApp(fixtureIds.chatApp)
  const trust = fixtureApp(fixtureIds.trustApp)
  let state = createProductState()
  state = reduceProductState(state, {
    type: 'open-app',
    app: chat,
    context: fixtureTabContext(chat, fixtureIds.chatTab),
    tabId: fixtureIds.chatTab,
  })
  state = reduceProductState(state, {
    type: 'open-app',
    app: trust,
    context: fixtureTabContext(trust, fixtureIds.tab),
    tabId: fixtureIds.tab,
  })
  // open-app activates whichever tab it just opened (trust, last) — build
  // both single-active-tab snapshots explicitly rather than relying on that.
  const withAActive = reduceProductState(state, { type: 'activate-tab', tabId: fixtureIds.chatTab })
  const withBActive = reduceProductState(state, { type: 'activate-tab', tabId: fixtureIds.tab })
  return { withAActive, withBActive }
}

// Pure-logic guarantee, testable without a DOM: React unmounts/remounts an
// element whenever its `key` changes, and does so for THIS key on every tab
// switch (see AppTabStage.tsx's androidAppStageKey doc comment for why that
// guarantees no stale-instance window) — and does NOT gratuitously change
// key across an unrelated re-render of the SAME active tab (which would
// defeat in-app navigation/reload state for no reason).
function testAndroidAppStageKeyChangesExactlyOnTabIdentityChange(): void {
  const { withAActive, withBActive } = openTwoTabProductState()

  const keyA = androidAppStageKey(withAActive)
  const keyB = androidAppStageKey(withBActive)
  assert.notEqual(keyA, keyB, 'switching the active tab must change the Android stage key')

  const rerenderSameTab = reduceProductState(withAActive, {
    type: 'set-tab-title',
    tabId: fixtureIds.chatTab,
    title: 'Renamed while active',
  })
  assert.equal(
    androidAppStageKey(rerenderSameTab),
    keyA,
    'an unrelated re-render of the SAME active tab must not change the key (no gratuitous remount)',
  )

  const empty = createProductState()
  assert.equal(androidAppStageKey(empty), 'none')
}

async function testTabSwitchNeverRendersAStaleIframeUnderTheNewTabsContext(): Promise<void> {
  const { withAActive, withBActive } = openTwoTabProductState()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const requestAppCalls: unknown[] = []

  function renderStage(productState: ProductState) {
    root.render(
      React.createElement(AppTabStage, {
        productState,
        snapshot: homeV2Fixture,
        requestApp: async (protocol, request, context) => {
          requestAppCalls.push({ protocol, request, context })
          return null
        },
        onOpenAddress: async () => undefined,
      }),
    )
  }

  // Mount tab A (Chat) and let its native-proxy authorization + iframe
  // creation settle, matching a real, fully-loaded app tab.
  act(() => renderStage(withAActive))
  await act(async () => {
    await flushAsync()
  })

  const iframeAfterA = container.querySelector('iframe.home-v2-app-frame')
  assert.equal(iframeAfterA !== null, true, 'tab A should have a loaded iframe before switching tabs')
  assert.match(
    String(iframeAfterA?.getAttribute('src')),
    /fixture-chat/,
    "tab A's iframe must point at Chat's render URL",
  )
  // Round 5, Minor 2 (Sol round-4 re-review): retained BEFORE the switch, so
  // the stale-listener check below posts from a real, live reference to tab
  // A's own frame — not a placeholder that could never have matched
  // anything regardless of whether A's listener actually got cleaned up.
  const frameAWindow = (iframeAfterA as HTMLIFrameElement | null)?.contentWindow ?? null
  assert.equal(frameAWindow !== null, true, "tab A's iframe must have a contentWindow to retain a reference to")

  // Switch to tab B (Trust) — this is the exact moment the round-3 finding
  // describes: `resolved` flips to B synchronously (it's derived via
  // useMemo), while B's own native-proxy authorization is only just
  // starting (async). Deliberately NOT awaiting anything extra here: this
  // synchronous `act()` call flushes exactly the same amount of work React's
  // real renderer would have flushed on a real tab-switch click, no more —
  // checking the DOM immediately after it returns is what catches a stale
  // render that only a LATER microtask would have corrected.
  act(() => renderStage(withBActive))

  const iframeImmediatelyAfterSwitch = container.querySelector('iframe.home-v2-app-frame')
  // BEFORE this fix (AndroidAppStage unkeyed at the tab level, only its
  // OWN inner iframe keyed by tab id): this assertion FAILED — a brand
  // new iframe DOM node was created (its key already read B's tab id,
  // since `resolved` had already flipped) but with `src` still equal to
  // whatever `source` state the reused component instance last held,
  // i.e. tab A's stale render URL — a real iframe, actually loading A's
  // content, at the exact moment every other signal already says "B".
  // AFTER this fix: the whole AndroidAppStage instance (not just its
  // iframe) is discarded on the SAME key change, so `source` resets to
  // null in this same synchronous commit and NO iframe exists yet.
  // Compared as a plain boolean, not the live element itself: node:assert's
  // failure path util.inspects both sides of a failed equality, and a live
  // jsdom Element/Window graph is large and heavily back-referenced (parent/
  // owner/defaultView pointers) — inspecting it is needlessly slow. assert.ok
  // below (for the truthy checks) does not have this problem, since it never
  // formats the value itself.
  assert.equal(
    iframeImmediatelyAfterSwitch === null,
    true,
    "no iframe (let alone tab A's stale one) may exist in the render where the active tab is " +
      'already B but the new tab has not finished its own native-proxy authorization',
  )

  // Now let B's own authorization settle and confirm it loads correctly —
  // proving the fix does not simply break Android app tabs.
  await act(async () => {
    await flushAsync()
  })
  const iframeAfterB = container.querySelector('iframe.home-v2-app-frame')
  assert.equal(iframeAfterB !== null, true, "tab B's iframe should load once its own authorization settles")
  assert.match(
    String(iframeAfterB?.getAttribute('src')),
    /fixture-trust/,
    "tab B's iframe must point at Trust's render URL, never Chat's",
  )
  assert.doesNotMatch(
    String(iframeAfterB?.getAttribute('src')),
    /fixture-chat/,
    "tab B's iframe must never carry over tab A's resource",
  )

  // No app-bridge request was ever dispatched under a mismatched tab
  // context during the switch (nothing sent one in this scenario — this
  // pins that unmounting tab A's listener, rather than merely papering
  // over the DOM, is what happened; a stray listener would otherwise keep
  // firing into props.requestApp using whichever `resolved` closure it
  // last captured).
  assert.equal(requestAppCalls.length, 0)

  // Round 5, Minor 2 (Sol round-4 re-review): the assertion above only
  // proves nothing HAPPENED to be sent during the switch — it does not
  // prove tab A's own message listener is actually gone. Post a REAL
  // message now, claiming to come from tab A's retained (and, post-switch,
  // stale) frame reference, and confirm it is rejected — either because
  // React's unmount genuinely removed A's `window.addEventListener('message',
  // ...)` listener (see AppTabStage.tsx's AndroidAppStage effect cleanup),
  // or because B's current listener correctly rejects a source that is not
  // its own `frameRef.current?.contentWindow` (see that effect's
  // `event.source !== frameRef.current?.contentWindow` check) — either way,
  // this proves the source-mismatch rejection genuinely fires for a live,
  // retained stale reference, not merely that no message happened to be
  // sent in this scenario.
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'qortium:qdn-request',
          bridgeToken: 'stale-frame-a-forged-token',
          requestId: 'stale-frame-a-request',
          protocol: 'qdnRequest',
          request: { action: 'GET_ACCOUNT_DATA' },
        },
        origin: 'https://fixture-proxy.qdn.androidplatform.net',
        source: frameAWindow as unknown as MessageEventSource,
      }),
    )
    await flushAsync()
  })
  assert.equal(
    requestAppCalls.length,
    0,
    "a message whose event.source is tab A's retained (now-stale) frame reference must never be " +
      'honored once B is the active tab — proves the cleanup/source-mismatch rejection actually ' +
      'fires for a real stale reference',
  )

  await act(async () => {
    root.unmount()
  })
  container.remove()
}

async function main(): Promise<void> {
  testAndroidAppStageKeyChangesExactlyOnTabIdentityChange()
  await testTabSwitchNeverRendersAStaleIframeUnderTheNewTabsContext()
  console.log('AppTabStage.test.tsx passed')
}

// A forced, explicit exit rather than letting the process fall off the end
// of the module: React's act()/scheduler can leave a MessageChannel or timer
// handle registered against the jsdom-backed globals, which would otherwise
// keep the event loop alive (or mask a genuine test failure as an
// indefinite hang instead of a clear non-zero exit).
try {
  await main()
  process.exit(0)
} catch (error) {
  console.error(error)
  process.exit(1)
}
