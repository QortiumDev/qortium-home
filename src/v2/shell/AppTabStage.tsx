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
    throw new Error(node.error ?? `${tab.context.sourceNetwork} is unavailable.`)
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
  query.set('uiStyle', 'classic')
  const queryString = query.toString()
  return {
    identity: resource.identity,
    nodeApiUrl: node.nodeApiUrl,
    tab,
    url: `${node.nodeApiUrl}/render/APP/${encodeURIComponent(name)}${suffix}${resource.routePath}${queryString ? `?${queryString}` : ''}${resource.hash}`,
  }
}

function DesktopAppStage(props: AppTabStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const suspendedRef = useRef(props.suspended === true)
  const resolvedTabIdRef = useRef<string | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [snapshotUrl, setSnapshotUrl] = useState('')
  const resolution = useMemo(() => {
    try {
      return { error: null, value: resolveRender(props.productState, props.snapshot) }
    } catch (cause) {
      return {
        error: cause instanceof Error ? cause.message : 'Unable to open this app.',
        value: null,
      }
    }
  }, [props.productState, props.snapshot])
  const resolved = resolution.value

  suspendedRef.current = props.suspended === true
  resolvedTabIdRef.current = resolved ? String(resolved.tab.id) : null

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
      void bridge.show({
        accountId: launchAccountId === 'none' ? null : launchAccountId,
        bounds: { height: bounds.height, width: bounds.width, x: bounds.x, y: bounds.y },
        displaySettings: {
          accent: props.snapshot.appearance.accent === 'clay' ? 'orange' : props.snapshot.appearance.accent,
          language: props.snapshot.appearance.resolvedLanguage,
          textSize: props.snapshot.appearance.textSize,
          theme: props.snapshot.appearance.resolvedTheme,
          ui: 'classic',
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
          if (!cancelled) setRuntimeError(cause instanceof Error ? cause.message : 'Unable to load this app.')
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
  }, [props.snapshot.appearance, props.suspended, resolved])

  return <section className="home-v2-app-stage home-v2-app-stage--live">
    <div ref={hostRef} className="home-v2-app-view-host" />
    {snapshotUrl ? <img className="home-v2-app-stage__snapshot" src={snapshotUrl} alt="" /> : null}
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
  const resolution = useMemo(() => {
    try {
      return { error: null, value: resolveRender(props.productState, props.snapshot) }
    } catch (cause) {
      return {
        error: cause instanceof Error ? cause.message : 'Unable to open this app.',
        value: null,
      }
    }
  }, [props.productState, props.snapshot])
  const resolved = resolution.value

  // Fix A (finding 1) live-resource tracking: on Android every app on a node
  // shares one proxy origin (QdnRenderProxy.java's per-view isolation would
  // wipe QDN apps' own local storage between visits, so it deliberately keys
  // the proxy by node origin only — see that file's class doc comment).
  //
  // Fix 2 (Sol re-review #2): QdnBridgeWebViewClient/QdnRenderProxy now ALSO
  // enforce, at the trusted native layer, that this tab's iframe can never
  // load a different app's render bytes in the first place (see
  // QdnRenderProxy.isSameActiveAppTabResource and the authorize() call
  // below, which registers this tab's launch identity before the iframe is
  // created — the native side can do this safely because Android renders at
  // most ONE app tab's iframe at a time: React unmounts/remounts a fresh
  // iframe, keyed by tab id, on every tab switch, so "the currently
  // registered identity" is always this tab's). That closes the real gap:
  // the self-report below is app-controlled (an app can simply not send an
  // honest qortium:qdn-navigation, or send a stale/forged one) and was
  // proven bypassable, so it is kept ONLY as a redundant, defense-in-depth
  // signal — the actual enforcement is now the native layer refusing to
  // serve mismatched render bytes to this WebView at all.
  const liveResourcePathRef = useRef<string | null>(null)

  useEffect(() => {
    liveResourcePathRef.current = resolved ? resolved.url : null
  }, [resolved, source])

  useEffect(() => {
    if (!resolved) return
    let cancelled = false
    setRuntimeError(null)
    void import('../../home-v2-live/android-app-host')
      .then(({ authorizeHomeV2AndroidAppOrigin }) =>
        // Fix 2: registers this tab's launch identity natively BEFORE the
        // iframe is created below, so QdnBridgeWebViewClient can refuse to
        // serve a different resource into it from the very first request.
        // The exact pathname is passed too so a legitimate deep link into a
        // default-identity app's specific sub-page (its first path segment
        // otherwise looking exactly like a spoofed identifier) is not itself
        // blocked — see QdnRenderProxy.AppIdentity's doc comment.
        //
        // Fix 3 (Sol round-3, Defect B): the registered identifier is
        // resolved from the FULL first request (query wins), not just
        // resolved.identity's path-based value — see
        // render-path-identity.ts's resolveLaunchIdentifier doc comment for
        // why a smuggled `?identifier=` query would otherwise register the
        // wrong (too-permissive) launch identity.
        authorizeHomeV2AndroidAppOrigin(
          resolved.nodeApiUrl,
          resolved.identity.name,
          resolveLaunchIdentifier(resolved.identity.identifier, resolved.url),
          new URL(resolved.url).pathname,
        ),
      )
      .then((proxyOrigin) => {
        if (cancelled) return
        const direct = new URL(resolved.url)
        const proxied = new URL(`${direct.pathname}${direct.search}`, proxyOrigin)
        proxied.searchParams.set('qdnHomeBridge', token)
        proxied.searchParams.set('homeV2Bridge', '1')
        setSource(proxied.toString())
      })
      .catch((cause: unknown) => {
        if (!cancelled) setRuntimeError(cause instanceof Error ? cause.message : 'Unable to prepare the app view.')
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

      // Fix A (finding 1) / Fix 2 defense in depth: refuse a request from an
      // iframe whose (app-controlled, so not fully trusted — see the
      // liveResourcePathRef comment above) self-reported live location no
      // longer matches the resource this tab was launched for.
      // Fix 3 (Sol round-3, Defect B): fold the query the same way the
      // native authorize() registration now does (resolveLaunchIdentifier),
      // reusing resolved.identity rather than re-parsing
      // resourceLocation — a second, independent parse of the same address
      // could otherwise drift from what was actually registered natively.
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
        ;(event.source as Window | null)?.postMessage({
          type: 'qortium:qdn-response', bridgeToken: token, requestId: data.requestId,
          error: { message: cause instanceof Error ? cause.message : 'App request failed.' },
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

  return <section className="home-v2-app-stage home-v2-app-stage--live">
    {source ? <iframe
      key={`${resolved?.tab.id ?? 'app'}:${props.reloadVersion ?? 0}`}
      ref={frameRef}
      className="home-v2-app-frame"
      src={source}
      title="QDN app"
    /> : null}
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
      capture(request: { tabId: string }): Promise<string | null>
      destroy(request: { tabId: string }): Promise<void>
      hide(request: { tabId: string }): Promise<void>
      navigate(request: { index: number; tabId: string }): Promise<boolean>
      reload(request: { tabId: string }): Promise<boolean>
      updateAccountState(request: { accountId: string; isUnlocked: boolean; tabId: string }): Promise<void>
      resolvePermission(request: unknown): void
      show(request: unknown): Promise<void>
      onOpenAddress(listener: (event: unknown) => void): () => void
      onPermissionRequest(listener: (event: unknown) => void): () => void
      onPermissionTimeout(listener: (event: unknown) => void): () => void
      onNavigationChanged(listener: (event: unknown) => void): () => void
    }
  }
}
