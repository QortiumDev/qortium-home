import { useEffect, useMemo, useRef, useState } from 'react'
import type { HomeV2Snapshot } from '../contracts'
import type { ProductState } from '../product-model'
import { parseAppResourceLocation } from '../resource-location'
import { isSameRenderResourcePath } from './render-path-identity'
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
        authorizeHomeV2AndroidAppOrigin(
          resolved.nodeApiUrl,
          resolved.identity.name,
          resolved.identity.identifier,
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
      const launchIdentity = (() => {
        if (!resolved) return null
        try {
          return parseAppResourceLocation(resolved.tab.context.resourceLocation).identity
        } catch {
          return null
        }
      })()
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

export function AppTabStage(props: AppTabStageProps) {
  return window.homeV2Apps ? <DesktopAppStage {...props} /> : <AndroidAppStage {...props} />
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
