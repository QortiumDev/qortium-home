import { useEffect, useMemo, useRef, useState } from 'react'
import type { HomeV2Snapshot } from '../contracts'
import type { ProductState } from '../product-model'
import { parseAppResourceLocation } from '../resource-location'
import {
  readHomeV2AppNavigationMessage,
  readHomeV2AppTitleMessage,
} from '../app-frame-messages'
import type {
  HomeV2AppBridgeProtocol,
  HomeV2AppRequestContext,
  HomeV2NodeClient,
} from '../../home-v2-live/node-client'

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
    nodeApiUrl: node.nodeApiUrl,
    tab,
    url: `${node.nodeApiUrl}/render/APP/${encodeURIComponent(name)}${suffix}${resource.routePath}${queryString ? `?${queryString}` : ''}${resource.hash}`,
  }
}

function DesktopAppStage(props: AppTabStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
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

  useEffect(() => {
    const host = hostRef.current
    const bridge = window.homeV2Apps
    if (!host || !bridge || !resolved) return
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
      }).catch((cause: unknown) => {
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
      void bridge.hide({ tabId: resolved.tab.id })
    }
  }, [props.snapshot.appearance, resolved])

  return <section className="home-v2-app-stage home-v2-app-stage--live">
    <div ref={hostRef} className="home-v2-app-view-host" />
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

  useEffect(() => {
    if (!resolved) return
    let cancelled = false
    setRuntimeError(null)
    void import('../../home-v2-live/android-app-host')
      .then(({ authorizeHomeV2AndroidAppOrigin }) => authorizeHomeV2AndroidAppOrigin(resolved.nodeApiUrl))
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
        if (resolved) props.onNavigationChanged?.(resolved.tab.id, navigationMessage)
        return
      }

      if (data.type !== 'qortium:qdn-request' || typeof data.requestId !== 'string') return
      const protocol = data.protocol === 'qortalRequest' ? 'qortalRequest' : 'qdnRequest'
      const context: HomeV2AppRequestContext = {
        resourceLocation: resolved?.tab.context.resourceLocation ?? '',
        selectedAccountId: props.selectedAccountId ?? null,
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
    props.selectedAccountId,
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
      destroy(request: { tabId: string }): Promise<void>
      hide(request: { tabId: string }): Promise<void>
      navigate(request: { index: number; tabId: string }): Promise<boolean>
      reload(request: { tabId: string }): Promise<boolean>
      resolvePermission(request: unknown): void
      show(request: unknown): Promise<void>
      onOpenAddress(listener: (event: unknown) => void): () => void
      onPermissionRequest(listener: (event: unknown) => void): () => void
      onNavigationChanged(listener: (event: unknown) => void): () => void
    }
  }
}
