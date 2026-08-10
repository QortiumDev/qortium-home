import { useEffect, useMemo, useRef, useState } from 'react'
import type { HomeV2Snapshot } from '../contracts'
import type { ProductState } from '../product-model'
import { parseAppResourceLocation } from '../resource-location'
import type { HomeV2NodeClient } from '../../home-v2-live/node-client'

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
  const query = new URLSearchParams({
    accent: snapshot.appearance.accent,
    lang: snapshot.appearance.resolvedLanguage,
    textSize: snapshot.appearance.textSize,
    theme: snapshot.appearance.resolvedTheme,
    uiStyle: 'classic',
  })
  return {
    nodeApiUrl: node.nodeApiUrl,
    tab,
    url: `${node.nodeApiUrl}/render/APP/${encodeURIComponent(name)}${suffix}?${query}`,
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
  }, [resolved, token])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || data.type !== 'qortium:qdn-request' || data.bridgeToken !== token || typeof data.requestId !== 'string') return
      const protocol = data.protocol === 'qortalRequest' ? 'qortalRequest' : 'qdnRequest'
      void props.nodeClient?.requestApp(protocol, data.request).then((result) => {
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
  }, [props.nodeClient, token])

  return <section className="home-v2-app-stage home-v2-app-stage--live">
    {source ? <iframe className="home-v2-app-frame" src={source} title="QDN app" /> : null}
    {resolution.error || runtimeError ? <div className="home-v2-app-stage__error">{resolution.error ?? runtimeError}</div> : null}
  </section>
}

export interface AppTabStageProps {
  readonly productState: ProductState
  readonly snapshot: HomeV2Snapshot
  readonly nodeClient?: HomeV2NodeClient | null
  readonly selectedAccountId?: string | null
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
      show(request: unknown): Promise<void>
      onNavigationChanged(listener: (event: unknown) => void): () => void
    }
  }
}
