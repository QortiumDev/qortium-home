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
import {
  setTranslationLanguage,
  subscribeTranslationChange,
} from '../../i18n'
import { AppTabStage, androidAppStageKey } from './AppTabStage'
import { createProductState, reduceProductState } from '../product-model'
import type { ProductState } from '../product-model'
import { buildAppResourceLocation } from '../resource-location'
import type { AppResourceLocation, HomeV2Snapshot } from '../contracts'
import { recordedAuthorizeCalls } from '../test-kit/fake-capacitor-core'
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

  // Replacing the ACTIVE tab's app in place (OPEN_CURRENT_TAB) must change the
  // key. The AndroidAppStage instance is what holds the bridge token, the
  // native authorized-document registration, the message listener and the
  // iframe; reusing it for a different app would leave the incoming app inside
  // the outgoing app's browsing context and token. The key includes the
  // resourceLocation exactly so this cannot happen.
  const wallets = fixtureApp(fixtureIds.walletsApp)
  const activeChatTab = withAActive.tabs.find((tab) => tab.id === fixtureIds.chatTab)!
  const replacedInPlace = reduceProductState(withAActive, {
    type: 'replace-tab-app',
    app: wallets,
    context: fixtureTabContext(wallets, fixtureIds.chatTab),
    tabId: fixtureIds.chatTab,
    fromResourceLocation: activeChatTab.context.resourceLocation,
  })
  assert.equal(replacedInPlace.activeTabId, fixtureIds.chatTab)
  assert.notEqual(
    androidAppStageKey(replacedInPlace),
    keyA,
    'replacing an active tab’s app must remount the Android stage, not reuse its token and iframe',
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

  // Round 6: extract tab A's ACTUAL qdnHomeBridge token from its own iframe
  // src, rather than fabricating an arbitrary string for the forged message
  // below. A fabricated token would be rejected by the OUTER `data.bridgeToken
  // !== token` guard in AndroidAppStage's message handler regardless of
  // whether A's listener was actually cleaned up — proving nothing about the
  // cleanup this test exists to pin. Using A's real token means the ONLY
  // thing that can still reject the forged message is the listener/source
  // check this test is actually about.
  const frameASrc = String(iframeAfterA?.getAttribute('src'))
  const frameAToken = new URL(frameASrc).searchParams.get('qdnHomeBridge')
  assert.equal(typeof frameAToken, 'string', "tab A's iframe src must carry its own qdnHomeBridge token")
  assert.ok(frameAToken && frameAToken.length >= 16, "tab A's extracted token must be a real bridge token")

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

  // Round 5, Minor 2 (Sol round-4 re-review), fixed round 6: the assertion
  // above only proves nothing HAPPENED to be sent during the switch — it
  // does not prove tab A's own message listener is actually gone. Post a
  // REAL message now, claiming to come from tab A's retained (and,
  // post-switch, stale) frame reference AND carrying A's own real token
  // (extracted above, not fabricated — a fabricated token would be rejected
  // by the outer bridgeToken check regardless of whether the listener is
  // gone, proving nothing), and confirm it is rejected — either because
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
          bridgeToken: frameAToken,
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

// Round 7 (Sol round-6 re-review, bug 3): an initial `qdn://APP/name#/route`
// deep link's fragment used to be silently dropped when the proxied iframe
// `source` was built from `authorizedDocument.pathname`/`.search` alone (see
// AppTabStage.tsx's AndroidAppStage effect) — an app opened straight into a
// deep sub-route would instead land on its root route. The fix carries the
// hash into the iframe `src`, but (see the second half of this test) the
// hash must never reach the native authorize() registration: a fragment is
// a client-only concept that is never sent to the server, so it can never
// legitimately participate in QdnRenderProxy.isExactAuthorizedRenderDocument's
// server-side match — only the client-side iframe navigation.
async function testAndroidIframeSrcIncludesInitialHashWhileAuthorizationDropsIt(): Promise<void> {
  const chat = fixtureApp(fixtureIds.chatApp)
  const hashLocation = `${buildAppResourceLocation(chat.sourceNetwork, chat.resourceIdentity)}#/settings` as AppResourceLocation

  let state = createProductState()
  state = reduceProductState(state, {
    type: 'open-app',
    app: chat,
    context: { ...fixtureTabContext(chat, fixtureIds.chatTab), resourceLocation: hashLocation },
    tabId: fixtureIds.chatTab,
  })
  state = reduceProductState(state, { type: 'activate-tab', tabId: fixtureIds.chatTab })

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const priorAuthorizeCallCount = recordedAuthorizeCalls.length

  act(() => {
    root.render(
      React.createElement(AppTabStage, {
        productState: state,
        snapshot: homeV2Fixture,
        requestApp: async () => null,
        onOpenAddress: async () => undefined,
      }),
    )
  })
  await act(async () => {
    await flushAsync()
  })

  const iframe = container.querySelector('iframe.home-v2-app-frame')
  assert.equal(iframe !== null, true, 'the app tab should have a loaded iframe')
  const src = String(iframe?.getAttribute('src'))
  assert.equal(
    new URL(src).hash,
    '#/settings',
    'an initial hash deep link must be carried into the iframe src, not dropped',
  )

  const newCalls = recordedAuthorizeCalls.slice(priorAuthorizeCallCount)
  assert.equal(newCalls.length, 1, 'exactly one native authorize() call should have been made')
  const registeredUrl = String(newCalls[0]?.authorizedDocumentUrl)
  assert.doesNotMatch(
    registeredUrl,
    /#/,
    'the document URL registered with the native proxy must never carry the hash fragment — it ' +
      'never reaches the server and must not participate in the exact-URL match',
  )
  assert.match(
    registeredUrl,
    /fixture-chat/,
    "sanity check: the registered document is still this tab's Chat resource",
  )

  await act(async () => {
    root.unmount()
  })
  container.remove()
}

// R4-4: WEBSITE and GAME resources open as app tabs, so the render URL must
// be built from the PARSED service. resolveRender used to hardcode
// `/render/APP/`, which asked Core for an APP resource that does not exist
// whenever the tab was a website or a game — the tab loaded nothing.
async function testRenderUrlUsesTheParsedServiceNotAHardcodedApp(): Promise<void> {
  const chat = fixtureApp(fixtureIds.chatApp)
  // Same name and identifier as the Chat fixture, different SERVICE. The
  // descriptor carries it too, because product-model's open-app now checks
  // the service alongside the name, identifier and source network.
  const website = {
    ...chat,
    resourceIdentity: { ...chat.resourceIdentity, service: 'WEBSITE' as const },
  }
  const websiteLocation = buildAppResourceLocation(
    website.sourceNetwork,
    website.resourceIdentity,
  )

  let state = createProductState()
  state = reduceProductState(state, {
    type: 'open-app',
    app: website,
    context: {
      ...fixtureTabContext(chat, fixtureIds.chatTab),
      resourceLocation: websiteLocation,
    },
    tabId: fixtureIds.chatTab,
  })
  state = reduceProductState(state, { type: 'activate-tab', tabId: fixtureIds.chatTab })

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const priorAuthorizeCallCount = recordedAuthorizeCalls.length

  act(() => {
    root.render(
      React.createElement(AppTabStage, {
        productState: state,
        snapshot: homeV2Fixture,
        requestApp: async () => null,
        onOpenAddress: async () => undefined,
      }),
    )
  })
  await act(async () => {
    await flushAsync()
  })

  const newCalls = recordedAuthorizeCalls.slice(priorAuthorizeCallCount)
  assert.equal(newCalls.length, 1, 'exactly one native authorize() call should have been made')
  const registeredUrl = String(newCalls[0]?.authorizedDocumentUrl)
  assert.match(
    new URL(registeredUrl).pathname,
    /^\/render\/WEBSITE\/fixture-chat/,
    'a WEBSITE tab must render through /render/WEBSITE/, not /render/APP/',
  )
  const src = String(container.querySelector('iframe.home-v2-app-frame')?.getAttribute('src'))
  assert.match(new URL(src).pathname, /^\/render\/WEBSITE\/fixture-chat/)

  await act(async () => {
    root.unmount()
  })
  container.remove()
}

async function testDesktopTelemetryRefreshDoesNotHideOrReshowTheApp(): Promise<void> {
  const { withAActive } = openTwoTabProductState()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const showCalls: unknown[] = []
  const hideCalls: unknown[] = []
  const bridgeStateCalls: unknown[] = []
  const priorGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
  const priorResizeObserver = globalThis.ResizeObserver

  HTMLElement.prototype.getBoundingClientRect = () => ({
    bottom: 640,
    height: 600,
    left: 0,
    right: 900,
    top: 40,
    width: 900,
    x: 0,
    y: 40,
    toJSON: () => ({}),
  })
  globalThis.ResizeObserver = class {
    disconnect() {}
    observe() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver

  Object.defineProperty(window, 'homeV2Apps', {
    configurable: true,
    value: {
      accountLocked: () => undefined,
      capture: async () => null,
      destroy: async () => undefined,
      hide: async (request: unknown) => { hideCalls.push(request) },
      navigate: async () => false,
      reload: async () => false,
      updateAccountState: async () => undefined,
      updateBridgeStates: async (request: unknown) => { bridgeStateCalls.push(request) },
      resolvePermission: () => undefined,
      show: async (request: unknown) => { showCalls.push(request) },
      onOpenAddress: () => () => undefined,
      onPermissionRequest: () => () => undefined,
      onPermissionTimeout: () => () => undefined,
      onNavigationChanged: () => () => undefined,
    },
  })

  const renderStage = (
    snapshot: HomeV2Snapshot,
    translationVersion = 0,
  ) => {
    root.render(React.createElement(AppTabStage, {
      productState: withAActive,
      snapshot,
      translationVersion,
      requestApp: async () => null,
    }))
  }

  const checkingSnapshot: HomeV2Snapshot = {
    ...homeV2Fixture,
    nodes: {
      ...homeV2Fixture.nodes,
      qortium: {
        ...homeV2Fixture.nodes.qortium,
        capabilities: { admin: false, read: false, write: false },
        error: null,
        lastCheckedAt: null,
        nodeApiUrl: null,
        state: 'unknown',
        statusText: 'Checking',
      },
    },
  }
  await act(async () => {
    renderStage(checkingSnapshot)
    await flushAsync()
  })
  assert.equal(container.querySelector('.home-v2-app-stage__status')?.textContent, 'Checking Qortium…')
  assert.equal(container.querySelector('.home-v2-app-stage__error'), null)
  assert.equal(showCalls.length, 0, 'the app view must wait for the initial node check')

  await new Promise<void>((resolve) => {
    const unsubscribe = subscribeTranslationChange(() => {
      unsubscribe()
      resolve()
    })
    setTranslationLanguage('fr')
  })
  await act(async () => {
    renderStage(checkingSnapshot, 1)
    await flushAsync()
  })
  assert.equal(
    container.querySelector('.home-v2-app-stage__status')?.textContent,
    'Vérification de Qortium…',
    'a lazy-catalog revision must refresh memoized app-stage copy',
  )

  const unavailableSnapshot: HomeV2Snapshot = {
    ...checkingSnapshot,
    nodes: {
      ...checkingSnapshot.nodes,
      qortium: {
        ...checkingSnapshot.nodes.qortium,
        error: 'Qortium is unavailable.',
        lastCheckedAt: 1,
        state: 'offline',
        statusText: 'Unavailable',
      },
    },
  }
  await act(async () => {
    renderStage(unavailableSnapshot)
    await flushAsync()
  })
  assert.equal(container.querySelector('.home-v2-app-stage__status'), null)
  assert.equal(container.querySelector('.home-v2-app-stage__error')?.textContent, 'Qortium is unavailable.')
  assert.equal(showCalls.length, 0, 'a completed failed check must not show the app view')

  await act(async () => {
    renderStage(homeV2Fixture)
    await flushAsync()
  })
  assert.equal(showCalls.length, 1, 'the desktop app view should be shown once on mount')
  assert.equal(hideCalls.length, 0, 'the desktop app view should not be hidden on mount')
  assert.equal(bridgeStateCalls.length, 1, 'initial bridge state should be delivered independently')

  const telemetryRefresh: HomeV2Snapshot = {
    ...homeV2Fixture,
    nodes: {
      ...homeV2Fixture.nodes,
      qortium: {
        ...homeV2Fixture.nodes.qortium,
        height: (homeV2Fixture.nodes.qortium.height ?? 0) + 1,
        lastCheckedAt: (homeV2Fixture.nodes.qortium.lastCheckedAt ?? 0) + 15_000,
        peerCount: (homeV2Fixture.nodes.qortium.peerCount ?? 0) + 1,
        statusText: 'Online · refreshed',
      },
    },
  }
  await act(async () => {
    renderStage(telemetryRefresh)
    await flushAsync()
  })
  assert.equal(showCalls.length, 1, 'telemetry-only refresh must not re-show the app view')
  assert.equal(hideCalls.length, 0, 'telemetry-only refresh must not hide the app view or steal focus')
  assert.equal(bridgeStateCalls.length, 2, 'telemetry refresh may update bridge state without cycling the view')

  const changedNodeRoute: HomeV2Snapshot = {
    ...telemetryRefresh,
    nodes: {
      ...telemetryRefresh.nodes,
      qortium: {
        ...telemetryRefresh.nodes.qortium,
        nodeApiUrl: 'http://127.0.0.1:24892',
      },
    },
  }
  await act(async () => {
    renderStage(changedNodeRoute)
    await flushAsync()
  })
  assert.equal(showCalls.length, 2, 'a real node-route change must show the updated app view')
  assert.equal(hideCalls.length, 1, 'a real node-route change must hide the superseded app view')

  await act(async () => {
    root.unmount()
  })
  container.remove()
  delete window.homeV2Apps
  HTMLElement.prototype.getBoundingClientRect = priorGetBoundingClientRect
  globalThis.ResizeObserver = priorResizeObserver
}

async function main(): Promise<void> {
  testAndroidAppStageKeyChangesExactlyOnTabIdentityChange()
  await testTabSwitchNeverRendersAStaleIframeUnderTheNewTabsContext()
  await testAndroidIframeSrcIncludesInitialHashWhileAuthorizationDropsIt()
  await testRenderUrlUsesTheParsedServiceNotAHardcodedApp()
  await testDesktopTelemetryRefreshDoesNotHideOrReshowTheApp()
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
