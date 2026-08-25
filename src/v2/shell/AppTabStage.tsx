import { useEffect, useMemo, useRef, useState } from 'react'
import type { HomeV2Snapshot } from '../contracts'
import type { ProductState } from '../product-model'
import { parseAppResourceLocation } from '../resource-location'
import { isSameRenderResourcePath, resolveLaunchIdentifier } from './render-path-identity'
import {
  readHomeV2AppNavigationMessage,
  readHomeV2AppTitleMessage,
} from '../app-frame-messages'
import type {
  HomeV2AppBridgeProtocol,
  HomeV2AppRequestContext,
  HomeV2NodeClient,
} from '../../home-v2-live/node-client'
import { t } from '../../i18n'
import {
  getHomeV2AppNetwork,
  getHomeV2BridgeStateDetails,
  getHomeV2AppRouteDescriptor,
  homeV2BridgeErrorPayload,
  normalizeHomeV2BridgeError,
} from '../../home-v2-live/app-runtime'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function waitForAnimationFrames(count: number) {
  return new Promise<void>((resolve) => {
    const next = (remaining: number) => {
      if (remaining <= 0) {
        resolve()
        return
      }
      window.requestAnimationFrame(() => next(remaining - 1))
    }
    next(count)
  })
}

function resolveRender(productState: ProductState, snapshot: HomeV2Snapshot) {
  const tab = productState.tabs.find((candidate) => candidate.id === productState.activeTabId)
  if (!tab) throw new Error('No active app tab was selected.')
  const node = snapshot.nodes[tab.context.sourceNetwork]
  if (!node.capabilities.read || !node.nodeApiUrl) {
    throw new Error(node.error ?? t('home2.app.networkUnavailable', {
      network: tab.context.sourceNetwork === 'qortal' ? 'Qortal' : 'Qortium',
    }))
  }
  const resource = parseAppResourceLocation(tab.context.resourceLocation)
  const name = resource.identity.name
  const identifier = resource.identity.identifier
  const suffix = identifier ? `/${encodeURIComponent(identifier)}` : ''
  const query = new URLSearchParams(resource.search)
  query.set('accent', snapshot.appearance.accent)
  query.set('lang', snapshot.appearance.resolvedLanguage)
  query.set('textSize', snapshot.appearance.textSize)
  query.set('theme', snapshot.appearance.resolvedTheme)
  query.set('uiStyle', snapshot.appearance.ui)
  const queryString = query.toString()
  return {
    identity: resource.identity,
    nodeApiUrl: node.nodeApiUrl,
    tab,
    url: `${node.nodeApiUrl}/render/APP/${encodeURIComponent(name)}${suffix}${resource.routePath}${queryString ? `?${queryString}` : ''}${resource.hash}`,
  }
}

function useResolvedRender(
  productState: ProductState,
  snapshot: HomeV2Snapshot,
  translationVersion = 0,
) {
  const tab = productState.tabs.find((candidate) => candidate.id === productState.activeTabId)
  const node = tab ? snapshot.nodes[tab.context.sourceNetwork] : null
  const nodeChecking = node?.state === 'unknown' && node.lastCheckedAt === null && !node.error
  const appearance = snapshot.appearance

  // Node polling rebuilds the full Home snapshot every few seconds. Only
  // recompute the app document when a fact that can change its URL or bridge
  // route changes; telemetry such as height, peers, sync progress, status text,
  // and lastCheckedAt must not hide/re-show the native WebContentsView or move
  // keyboard focus out of the app.
  return useMemo(() => {
    if (nodeChecking) {
      const networkLabel = tab?.context.sourceNetwork === 'qortal' ? 'Qortal' : 'Qortium'
      return { error: null, status: t('home2.app.checkingNetwork', { network: networkLabel }), value: null }
    }
    try {
      return { error: null, status: null, value: resolveRender(productState, snapshot) }
    } catch (cause) {
      return {
        error: cause instanceof Error ? cause.message : t('home2.app.unableToOpen'),
        status: null,
        value: null,
      }
    }
  }, [
    appearance.accent,
    appearance.resolvedLanguage,
    appearance.resolvedTheme,
    appearance.textSize,
    node?.capabilities.read,
    node?.customAuthenticated,
    node?.customConfigured,
    node?.error,
    node?.mode,
    node?.nodeApiUrl,
    nodeChecking,
    productState.activeTabId,
    translationVersion,
    tab?.context.identityId,
    tab?.context.resourceLocation,
    tab?.context.sourceNetwork,
  ])
}

function DesktopAppStage(props: AppTabStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const suspendedRef = useRef(props.suspended === true)
  const resolvedTabIdRef = useRef<string | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [snapshotUrl, setSnapshotUrl] = useState('')
  const resolution = useResolvedRender(
    props.productState,
    props.snapshot,
    props.translationVersion,
  )
  const resolved = resolution.value

  suspendedRef.current = props.suspended === true
  resolvedTabIdRef.current = resolved ? String(resolved.tab.id) : null

  useEffect(() => {
    const bridge = window.homeV2Apps
    if (!bridge || !resolved) return
    const identityId = String(resolved.tab.context.identityId)
    const launchAccountId = identityId.startsWith('home-v2:identity:')
      ? identityId.slice('home-v2:identity:'.length)
      : null
    void bridge.updateBridgeStates({
      bridgeStates: getHomeV2BridgeStateDetails({
        accountId: launchAccountId === 'none' ? null : launchAccountId,
        nodes: props.snapshot.nodes,
        platform: 'desktop',
      }),
      tabId: resolved.tab.id,
    })
  }, [props.snapshot.nodes, resolved])

  useEffect(() => {
    const host = hostRef.current
    const bridge = window.homeV2Apps
    if (!host || !bridge || !resolved) return

    if (props.suspended) {
      let cancelled = false
      const suspend = async () => {
        const snapshot = await bridge
          .capture({ tabId: resolved.tab.id })
          .catch(() => null)
        if (cancelled) return
        if (snapshot) {
          try {
            const image = new Image()
            image.src = snapshot
            await image.decode()
          } catch {
            // Decoding only pre-warms the paint; the snapshot remains usable.
          }
          if (cancelled) return
          setSnapshotUrl(snapshot)
          await waitForAnimationFrames(2)
          if (cancelled) return
        }
        await bridge.hide({ tabId: resolved.tab.id })
      }
      void suspend()
      return () => {
        cancelled = true
      }
    }

    let cancelled = false
    const show = () => {
      const bounds = host.getBoundingClientRect()
      if (bounds.width < 1 || bounds.height < 1) return
      const identityId = String(resolved.tab.context.identityId)
      const launchAccountId = identityId.startsWith('home-v2:identity:')
        ? identityId.slice('home-v2:identity:'.length)
        : null
      const accountId = launchAccountId === 'none' ? null : launchAccountId
      void bridge.show({
        accountId,
        bounds: { height: bounds.height, width: bounds.width, x: bounds.x, y: bounds.y },
        bridgeStates: getHomeV2BridgeStateDetails({
          accountId,
          nodes: props.snapshot.nodes,
          platform: 'desktop',
        }),
        displaySettings: {
          // Apps receive the v2 accent set as-is, matching the render-URL
          // `accent` query param above. Apps that predate `clay` simply don't
          // recognize the value and fall back to their own default accent
          // until they republish with clay support.
          accent: props.snapshot.appearance.accent,
          language: props.snapshot.appearance.resolvedLanguage,
          textSize: props.snapshot.appearance.textSize,
          theme: props.snapshot.appearance.resolvedTheme,
          ui: props.snapshot.appearance.ui,
        },
        nodeApiUrl: resolved.nodeApiUrl,
        renderUrl: resolved.url,
        resourceUrl: resolved.tab.context.resourceLocation,
        tabId: resolved.tab.id,
      })
        .then(async () => {
          if (cancelled) return
          setRuntimeError(null)
          await waitForAnimationFrames(2)
          if (!cancelled) setSnapshotUrl('')
        })
        .catch((cause: unknown) => {
          if (!cancelled) setRuntimeError(cause instanceof Error ? cause.message : t('home2.app.unableToLoad'))
        })
    }
    show()
    const observer = new ResizeObserver(show)
    observer.observe(host)
    window.addEventListener('resize', show)
    return () => {
      cancelled = true
      observer.disconnect()
      window.removeEventListener('resize', show)
      // Suspension hides this view itself, after the snapshot paints — but only
      // for the tab that is suspending. A different departing tab must still be
      // hidden here, or its native view stays painted over the trusted prompt.
      const sameTabSuspending =
        suspendedRef.current && resolvedTabIdRef.current === String(resolved.tab.id)
      if (!sameTabSuspending) {
        void bridge.hide({ tabId: resolved.tab.id })
      }
    }
  }, [props.suspended, resolved])

  return <section className="home-v2-app-stage home-v2-app-stage--live" tabIndex={-1}>
    <div ref={hostRef} className="home-v2-app-view-host" />
    {snapshotUrl ? <img className="home-v2-app-stage__snapshot" src={snapshotUrl} alt="" /> : null}
    {resolution.status ? <div className="home-v2-app-stage__status" role="status">{resolution.status}</div> : null}
    {resolution.error || runtimeError ? <div className="home-v2-app-stage__error">{resolution.error ?? runtimeError}</div> : null}
  </section>
}

function AndroidAppStage(props: AppTabStageProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [source, setSource] = useState<string | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [token] = useState(() => Array.from(
    crypto.getRandomValues(new Uint8Array(18)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join(''))
  const resolution = useResolvedRender(
    props.productState,
    props.snapshot,
    props.translationVersion,
  )
  const resolved = resolution.value

  // Fix A (finding 1) live-resource tracking: on Android every app on a node
  // shares one proxy origin (QdnRenderProxy.java's per-view isolation would
  // wipe QDN apps' own local storage between visits, so it deliberately keys
  // the proxy by node origin only — see that file's class doc comment).
  //
  // Round 6 (owner-directed redesign, ending the round-2/4/5
  // identifier-confusion class): QdnBridgeWebViewClient/QdnRenderProxy now
  // gate the live bridge token / injection / CSP-strip on an EXACT match
  // against this tab's registered authorized document URL (see
  // QdnRenderProxy.isExactAuthorizedRenderDocument and the authorize() call
  // below, which registers that EXACT trusted URL before the iframe is
  // created — the native side can do this safely because Android renders at
  // most ONE app tab's iframe at a time: React unmounts/remounts a fresh
  // iframe, keyed by tab id, on every tab switch, so "the currently
  // registered document" is always this tab's own). Given that exact-URL
  // gate, the self-report below can no longer grant a mismatched document
  // ANY bridge capability to begin with (a non-matching document was never
  // given a working token or injection at the byte-serving layer) — it is
  // kept ONLY as a UX/consistency signal (refuse to relay a request while
  // the visibly-loaded page has drifted from the launch resource), NOT a
  // security boundary of its own; see shouldCarryBridgeToken's doc comment
  // in QdnBridgeWebViewClient.java for the layer that actually is one.
  const liveResourcePathRef = useRef<string | null>(null)
  const deliveredBridgeStateRevisionsRef = useRef<Record<string, string> | null>(null)

  useEffect(() => {
    liveResourcePathRef.current = resolved ? resolved.url : null
  }, [resolved, source])

  useEffect(() => {
    const frameWindow = frameRef.current?.contentWindow
    if (!resolved || !source || !frameWindow) {
      deliveredBridgeStateRevisionsRef.current = null
      return
    }
    const identityId = String(resolved.tab.context.identityId)
    const launchAccountId = identityId.startsWith('home-v2:identity:')
      ? identityId.slice('home-v2:identity:'.length)
      : null
    const details = getHomeV2BridgeStateDetails({
      accountId: launchAccountId === 'none' ? null : launchAccountId,
      nodes: props.snapshot.nodes,
      platform: 'android',
    })
    const next = Object.fromEntries(details.map((detail) => [detail.protocol, detail.revision]))
    const previous = deliveredBridgeStateRevisionsRef.current
    deliveredBridgeStateRevisionsRef.current = next
    if (!previous) return
    const targetOrigin = new URL(source).origin
    for (const detail of details) {
      if (previous[detail.protocol] === detail.revision) continue
      frameWindow.postMessage({
        type: 'qortium:bridge-state-changed',
        bridgeToken: token,
        detail,
      }, targetOrigin)
    }
  }, [props.snapshot.nodes, resolved, source, token])

  useEffect(() => {
    if (!resolved) return
    let cancelled = false
    setRuntimeError(null)
    // Round 6: the EXACT URL this effect is about to load into the iframe
    // (see below) is built ONCE here and used, verbatim, for BOTH the native
    // authorize() registration AND the iframe's own `source` — so the
    // registered document and the requested document can never independently
    // drift apart. `homeV2Bridge` is set now (not just when building
    // `source`) because it is a constant marker every homeV2 app-tab
    // document request carries; including it here means the exact-URL
    // comparison never needs to special-case it (see
    // QdnRenderProxy.IGNORED_DOCUMENT_QUERY_PARAMS's doc comment). The live
    // bridge token itself is deliberately NOT included — it is random per
    // tab and explicitly excluded from that same comparison.
    //
    // Round 7 (Sol round-6 re-review, bug 3): an initial `#/route` deep link
    // (resolved.url may carry one — see resolveRender's use of
    // resource.hash) is captured here and reattached ONLY to the iframe's
    // own `source` below, never to the URL handed to the native authorize()
    // registration. A fragment is a client-only concept — it is never sent
    // in an HTTP request, so it never reaches Core or this proxy, cannot
    // change the bytes served, and must not participate in the server-side
    // exact-URL match (QdnRenderProxy.isExactAuthorizedRenderDocument only
    // ever compares pathname + filtered query; giving it a hash to
    // (deliberately) ignore is not the same guarantee as it never being
    // asked to carry one at all).
    const initialHash = new URL(resolved.url).hash
    const authorizedDocument = new URL(resolved.url)
    authorizedDocument.searchParams.set('homeV2Bridge', '1')
    // The fragment is cleared AFTER homeV2Bridge is folded in (not before —
    // see the comment above): what matters for the exact-URL gate is only
    // that no hash reaches authorize() below, not the order these two
    // mutations happen in.
    authorizedDocument.hash = ''
    void import('../../home-v2-live/android-app-host')
      .then(({ authorizeHomeV2AndroidAppOrigin }) =>
        // Registers this EXACT document natively BEFORE the iframe is
        // created below, so QdnBridgeWebViewClient can refuse the bridge
        // token / injection / CSP-strip to anything else from the very
        // first request — see QdnRenderProxy.authorize's doc comment.
        authorizeHomeV2AndroidAppOrigin(resolved.nodeApiUrl, authorizedDocument.toString()),
      )
      .then((proxyOrigin) => {
        if (cancelled) return
        const proxied = new URL(
          `${authorizedDocument.pathname}${authorizedDocument.search}`,
          proxyOrigin,
        )
        proxied.searchParams.set('qdnHomeBridge', token)
        // The hash is appended last, and directly (not via a `new URL(...,
        // base)` third argument, which would have to survive the
        // searchParams mutation above) — URL.hash is independent of
        // .search, so setting it after qdnHomeBridge is added still
        // serializes as `...?query#hash`, matching a normal deep link.
        proxied.hash = initialHash
        setSource(proxied.toString())
      })
      .catch((cause: unknown) => {
        if (!cancelled) setRuntimeError(cause instanceof Error ? cause.message : t('home2.app.unableToPrepareView'))
      })
    return () => { cancelled = true }
  }, [props.reloadVersion, resolved, token])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data
      if (
        !data ||
        data.bridgeToken !== token ||
        event.source !== frameRef.current?.contentWindow ||
        !source ||
        event.origin !== new URL(source).origin
      ) return

      const titleMessage = readHomeV2AppTitleMessage(data, token)
      if (titleMessage) {
        if (resolved) props.onTitleChanged?.(resolved.tab.id, titleMessage.title)
        return
      }

      const navigationMessage = readHomeV2AppNavigationMessage(data, token, source)
      if (navigationMessage) {
        const activeEntry = navigationMessage.entries.find(
          (entry) => entry.index === navigationMessage.activeIndex,
        )
        if (activeEntry) {
          try {
            liveResourcePathRef.current = new URL(activeEntry.url).toString()
          } catch {
            liveResourcePathRef.current = null
          }
        }
        if (resolved) props.onNavigationChanged?.(resolved.tab.id, navigationMessage)
        return
      }

      if (data.type !== 'qortium:qdn-request' || typeof data.requestId !== 'string') return

      // Round 6: refuse to relay a request from an iframe whose (app-
      // controlled, so not fully trusted — see the liveResourcePathRef
      // comment above) self-reported live location no longer matches the
      // resource this tab was launched for. This is UX/consistency
      // defense-in-depth, NOT the security boundary — see this file's
      // liveResourcePathRef doc comment: the native exact-URL gate
      // (QdnRenderProxy.isExactAuthorizedRenderDocument) already means a
      // mismatched document was never given a working bridge token or
      // injection to relay a request WITH in the first place. Kept, rather
      // than removed, because it still catches the case where the app itself
      // drifted (accidentally or otherwise) and honestly reports it — a
      // cleaner failure than acting on a request the loaded page has no
      // business making. Folds the query the same way the (now-removed)
      // native authorize() identifier registration used to (resolveLaunchIdentifier),
      // reusing resolved.identity rather than re-parsing resourceLocation.
      const launchIdentity = resolved
        ? {
            name: resolved.identity.name,
            identifier: resolveLaunchIdentifier(resolved.identity.identifier, resolved.url),
          }
        : null
      const liveResourcePath = liveResourcePathRef.current
      if (
        !launchIdentity ||
        !liveResourcePath ||
        !isSameRenderResourcePath(liveResourcePath, launchIdentity)
      ) {
        ;(event.source as Window | null)?.postMessage({
          type: 'qortium:qdn-response', bridgeToken: token, requestId: data.requestId,
          error: { message: 'The app view navigated away from its launch resource.' },
        }, '*')
        return
      }

      const protocol = data.protocol === 'qortalRequest' ? 'qortalRequest' : 'qdnRequest'
      const identityId = String(resolved?.tab.context.identityId ?? '')
      const launchAccountId = identityId.startsWith('home-v2:identity:')
        ? identityId.slice('home-v2:identity:'.length)
        : null
      const context: HomeV2AppRequestContext = {
        resourceLocation: resolved?.tab.context.resourceLocation ?? '',
        selectedAccountId: launchAccountId === 'none' ? null : launchAccountId,
        tabId: resolved?.tab.id ?? '',
      }
      const request = props.requestApp
        ? props.requestApp(protocol, data.request, context)
        : props.nodeClient?.requestApp(protocol, data.request, context)
      void request?.then(async (result) => {
        if (
          result &&
          typeof result === 'object' &&
          'openIn' in result &&
          result.openIn === 'new-tab' &&
          'address' in result &&
          typeof result.address === 'string'
        ) {
          await props.onOpenAddress?.(result.address)
          result = true
        }
        ;(event.source as Window | null)?.postMessage({
          type: 'qortium:qdn-response', bridgeToken: token, requestId: data.requestId, result,
        }, '*')
      }).catch((cause: unknown) => {
        const rawAction = isRecord(data.request) && typeof data.request.action === 'string'
          ? data.request.action.trim().toUpperCase()
          : 'UNKNOWN'
        const network = getHomeV2AppNetwork(protocol, rawAction)
        const route = getHomeV2AppRouteDescriptor({
          accountId: context.selectedAccountId,
          network,
          node: props.snapshot.nodes[network],
          platform: 'android',
          protocol,
        })
        const error = normalizeHomeV2BridgeError(cause, {
          action: rawAction,
          network,
          routeRevision: route.revision,
        })
        ;(event.source as Window | null)?.postMessage({
          type: 'qortium:qdn-response', bridgeToken: token, requestId: data.requestId,
          error: homeV2BridgeErrorPayload(error),
        }, '*')
      })
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [
    props.nodeClient,
    props.onNavigationChanged,
    props.onOpenAddress,
    props.onTitleChanged,
    props.requestApp,
    resolved,
    source,
    token,
  ])

  useEffect(() => {
    if (!resolved || !source || !props.onNavigationControllerChange) return
    const controller: AppTabNavigationController = {
      goToIndex: async (index) => {
        const frameWindow = frameRef.current?.contentWindow
        if (!frameWindow || !Number.isSafeInteger(index) || index < 0) return false
        frameWindow.postMessage({
          type: 'qortium:qdn-navigation-command',
          bridgeToken: token,
          index,
        }, new URL(source).origin)
        return true
      },
    }
    props.onNavigationControllerChange(resolved.tab.id, controller)
    return () => props.onNavigationControllerChange?.(resolved.tab.id, null)
  }, [props.onNavigationControllerChange, resolved, source, token])

  return <section className="home-v2-app-stage home-v2-app-stage--live" tabIndex={-1}>
    {source ? <iframe
      // The key must NOT depend on `resolved`: a transient unreadable node
      // makes it null while `source` stays set, so the key flipped
      // tabId -> 'app' and back, remounting the iframe and reloading the app
      // twice per hiccup. AndroidAppStage is already keyed per tab by its
      // caller, so only an explicit reload needs to change this key.
      key={`app:${props.reloadVersion ?? 0}`}
      ref={frameRef}
      className="home-v2-app-frame"
      src={source}
      title={t('home2.app.frameTitle')}
    /> : null}
    {resolution.status ? <div className="home-v2-app-stage__status" role="status">{resolution.status}</div> : null}
    {resolution.error || runtimeError ? <div className="home-v2-app-stage__error">{resolution.error ?? runtimeError}</div> : null}
  </section>
}

export interface AppTabNavigationSnapshot {
  readonly activeIndex: number
  readonly entries: readonly {
    readonly index: number
    readonly url: string
  }[]
}

export interface AppTabNavigationController {
  goToIndex(index: number): Promise<boolean>
}

export interface AppTabStageProps {
  readonly productState: ProductState
  readonly snapshot: HomeV2Snapshot
  readonly translationVersion?: number
  readonly nodeClient?: HomeV2NodeClient | null
  readonly selectedAccountId?: string | null
  readonly reloadVersion?: number
  readonly suspended?: boolean
  readonly onNavigationChanged?: (
    tabId: ProductState['tabs'][number]['id'],
    snapshot: AppTabNavigationSnapshot,
  ) => void
  readonly onNavigationControllerChange?: (
    tabId: ProductState['tabs'][number]['id'],
    controller: AppTabNavigationController | null,
  ) => void
  readonly onOpenAddress?: (address: string) => Promise<unknown>
  readonly onTitleChanged?: (
    tabId: ProductState['tabs'][number]['id'],
    title: string | null,
  ) => void
  readonly requestApp?: (
    protocol: HomeV2AppBridgeProtocol,
    request: unknown,
    context: HomeV2AppRequestContext,
  ) => Promise<unknown>
}

// Round 4, Defect A (Sol round-3 re-review): the key React unmounts/remounts
// AndroidAppStage on. Includes both the active tab id AND its
// resourceLocation — a tab switch always changes the id, but keying on the
// resourceLocation too means this stays correct even if some future caller
// ever navigated the CURRENTLY active tab's own resource in place (not
// reachable from today's UI: openApp always mints a fresh tab id, and
// activate-tab never touches resourceLocation — see HomeV2LiveApp.tsx).
//
// Without this, the SAME AndroidAppStage component instance (and its
// `source`/`token` state, message listener, and liveResourcePathRef) is
// reused across a tab switch: on the render where `productState.activeTabId`
// flips from A to B, the memoized `resolved` (derived from productState via
// useMemo, so it updates SYNCHRONOUSLY within that same render) already
// reports tab B's context, while the iframe's `key` (`${resolved.tab.id}:…`,
// AndroidAppStage's OWN inner key) also flips to B — causing React to
// discard A's iframe DOM node and mount a brand-new one, but with `src` set
// to whatever `source` state STILL holds (A's stale render URL, since the
// effect that calls setSource(B's url) has not run yet). That freshly
// created iframe briefly starts loading A's stale content while every other
// signal (resolved, launchIdentity, liveResourcePathRef re-seeded from
// resolved) already says "B" — exactly the stale-token/new-context window
// this fix closes. liveResourcePathRef cannot be trusted to catch this
// either: its own effect re-seeds it to resolved.url (B's URL) the instant
// `resolved` changes, so the "does the live location match the launch" check
// in the message handler below is comparing B's expected URL against itself,
// not against what the iframe is actually loading.
//
// Keying the WHOLE AndroidAppStage instance here (not just its inner iframe)
// makes React discard that entire component instance — and, in the SAME
// commit, run its effect cleanups (which remove the stale message listener)
// BEFORE the fresh instance for B ever mounts — so there is no render, and
// no committed DOM state, in which A's iframe/token exist at the same time
// `resolved` reports B. DesktopAppStage is deliberately NOT included in this
// keying: it owns a persistent native WebContentsView (see its own effect,
// which explicitly hides — rather than destroys — a departing tab's view),
// and remounting it on every tab switch would defeat that.
export function androidAppStageKey(productState: ProductState): string {
  const tab = productState.tabs.find((candidate) => candidate.id === productState.activeTabId)
  return tab ? `${tab.id}:${tab.context.resourceLocation}` : 'none'
}

export function AppTabStage(props: AppTabStageProps) {
  if (window.homeV2Apps) return <DesktopAppStage {...props} />
  return <AndroidAppStage key={androidAppStageKey(props.productState)} {...props} />
}

declare global {
  interface Window {
    homeV2Apps?: {
      accountLocked(): void
      invalidateRuntime(request: unknown): void
      capture(request: { tabId: string }): Promise<string | null>
      destroy(request: { tabId: string }): Promise<void>
      hide(request: { tabId: string }): Promise<void>
      navigate(request: { index: number; tabId: string }): Promise<boolean>
      reload(request: { tabId: string }): Promise<boolean>
      updateAccountState(request: { accountId: string; isUnlocked: boolean; tabId: string }): Promise<void>
      updateBridgeStates(request: unknown): Promise<void>
      openAsWidget(request: { tabId: string }): Promise<
        { ok: true; widgetId: string } | { ok: false; message: string }
      >
      syncWidgets(request: unknown): Promise<void>
      resolvePermission(request: unknown): void
      show(request: unknown): Promise<void>
      onOpenAddress(listener: (event: unknown) => void): () => void
      onOpenResourceViewer(listener: (event: unknown) => void): () => void
      onNotificationClicked(listener: (event: unknown) => void): () => void
      onPermissionRequest(listener: (event: unknown) => void): () => void
      onPermissionTimeout(listener: (event: unknown) => void): () => void
      onNavigationChanged(listener: (event: unknown) => void): () => void
    }
  }
}
