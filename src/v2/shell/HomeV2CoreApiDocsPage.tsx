import { Power, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildHomeV2CoreDocsFrameUrl,
  type HomeV2CoreDocsNetwork,
} from '../core-docs-address'
import { t } from '../../i18n'
import type { HomeV2Snapshot } from '../contracts'
import { networkLabels } from './NetworkBadge'
import type { HomeV2CoreDocsTransport } from '../../home-v2-live/core-docs-client'

type DocsState =
  | { readonly phase: 'checking' }
  | { readonly phase: 'available' }
  | { readonly phase: 'disabled' }
  | { readonly phase: 'enabling' | 'restarting' }
  | { readonly phase: 'restricted' }
  | { readonly message: string; readonly phase: 'error' }

export interface HomeV2CoreApiDocsPageProps {
  readonly network: HomeV2CoreDocsNetwork
  readonly snapshot: HomeV2Snapshot
  readonly onOpenCoreSettings?: () => void
  readonly enable?: (network: HomeV2CoreDocsNetwork) => Promise<unknown>
  readonly probe: (
    network: HomeV2CoreDocsNetwork,
    nodeApiUrl: string,
  ) => Promise<{ status: number }>
  readonly transport: HomeV2CoreDocsTransport
}

export function HomeV2CoreApiDocsPage({
  enable,
  network,
  snapshot,
  onOpenCoreSettings,
  probe,
  transport,
}: HomeV2CoreApiDocsPageProps) {
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<DocsState>({ phase: 'checking' })
  const operationRef = useRef(0)
  const node = snapshot.nodes[network]
  const frameUrl = useMemo(() => {
    if (!node.nodeApiUrl) return null
    const raw = transport === 'android'
      ? new URL('/api-documentation/', `${node.nodeApiUrl}/`)
      : new URL(buildHomeV2CoreDocsFrameUrl(network))
    raw.searchParams.set('theme', snapshot.appearance.resolvedTheme)
    raw.searchParams.set('accent', snapshot.appearance.accent)
    raw.searchParams.set('textSize', snapshot.appearance.textSize)
    raw.searchParams.set('uiStyle', snapshot.appearance.ui)
    return raw.toString()
  }, [network, node.nodeApiUrl, snapshot.appearance, transport])

  useEffect(() => {
    if (operationRef.current !== 0) return
    let disposed = false
    setState({ phase: 'checking' })
    const nodeApiUrl = node.nodeApiUrl
    if (!frameUrl || !node.capabilities.read || !nodeApiUrl) {
      setState({
        message: node.error ?? t('api.loadFailed'),
        phase: 'error',
      })
      return () => {
        disposed = true
      }
    }
    const runProbe = async () => {
      try {
        const status = (await probe(network, nodeApiUrl)).status
        if (disposed) return
        if (status >= 200 && status < 300) setState({ phase: 'available' })
        else if (status === 404) setState({ phase: 'disabled' })
        else if (status === 403 && node.mode === 'custom') setState({ phase: 'restricted' })
        else if (status === 403) setState({ phase: 'disabled' })
        else setState({ message: t('api.httpStatus', { status }), phase: 'error' })
      } catch (error) {
        if (!disposed) {
          setState({
            message: error instanceof Error ? error.message : t('api.loadFailed'),
            phase: 'error',
          })
        }
      }
    }
    void runProbe()
    return () => {
      disposed = true
    }
  }, [frameUrl, network, node.capabilities.read, node.error, node.mode, node.nodeApiUrl, probe, retry])

  // Enabling the docs PATCHes Core's settings and restarts it, so the control
  // follows ADMIN TRUST, not the node being local (owner decision 2026-09-02):
  // a user running their own Core on a VPS with its API key attached in Home
  // administers it exactly as they administer a local one. Qortal never carries
  // admin trust -- Home holds no key for a Qortal node -- so the control stays
  // hidden there, which is what `mode === 'local'` used to achieve by accident.
  const canEnable = !!enable && node.adminTrusted === true

  const enableAndRestart = async () => {
    if (!canEnable) return
    const operation = Date.now()
    operationRef.current = operation
    setState({ phase: 'enabling' })
    try {
      await enable(network)
      if (operationRef.current !== operation) return
      setState({ phase: 'restarting' })
      const deadline = Date.now() + 600_000
      while (Date.now() < deadline && operationRef.current === operation) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000))
        try {
          const status = (await probe(network, node.nodeApiUrl ?? '')).status
          if (status >= 200 && status < 300) {
            operationRef.current = 0
            setState({ phase: 'available' })
            return
          }
        } catch {
          // The local Core is expected to be unavailable while restarting.
        }
      }
      if (operationRef.current === operation) {
        operationRef.current = 0
        setState({ message: t('coreApi.restartTimeout'), phase: 'error' })
      }
    } catch (error) {
      if (operationRef.current === operation) {
        operationRef.current = 0
        setState({
          message: error instanceof Error ? error.message : t('api.loadFailed'),
          phase: 'error',
        })
      }
    }
  }

  useEffect(() => () => {
    operationRef.current = -1
  }, [])

  return (
    <section className="home-v2-core-docs" aria-label={t('coreApi.title')}>
      <header className="home-v2-page-heading">
        <div>
          <span className="home-v2-eyebrow">
            {network === 'qortal' ? 'qortal-core://' : 'core://'}
          </span>
          <h1>{t('coreApi.title')}</h1>
          <p>{networkLabels[network]} · {node.label}</p>
        </div>
      </header>
      {state.phase === 'checking' || state.phase === 'enabling' || state.phase === 'restarting' ? (
        <div className="home-v2-core-docs__status" role="status">
          {state.phase === 'enabling'
            ? t('coreApi.enabling')
            : state.phase === 'restarting'
              ? t('coreApi.restarting')
              : t('coreApi.checking')}
        </div>
      ) : state.phase === 'available' && frameUrl ? (
        <iframe
          referrerPolicy="no-referrer"
          sandbox="allow-forms allow-scripts"
          src={frameUrl}
          title={`${networkLabels[network]} ${t('coreApi.title')}`}
        />
      ) : (
        <div className="home-v2-core-docs__status" role="alert">
          <h2>
            {state.phase === 'disabled'
              ? t('coreApi.disabledTitle')
              : state.phase === 'restricted'
                ? t('coreApi.restrictedTitle')
                : t('common.error')}
          </h2>
          <p>
            {state.phase === 'disabled'
              ? t('coreApi.disabledBody')
              : state.phase === 'restricted'
                ? t('coreApi.restrictedBody')
                : state.phase === 'error'
                  ? state.message
                  : t('api.loadFailed')}
          </p>
          {state.phase === 'disabled' ? (
            canEnable
              ? <p>{t('coreApi.enableHint')}</p>
              : <p>{t('coreApi.networkMode')}</p>
          ) : null}
          <div>
            {state.phase === 'disabled' && canEnable ? (
              <button className="home-v2-primary-button" type="button" onClick={() => void enableAndRestart()}>
                <Power aria-hidden="true" size={17} /> {t('coreApi.enableButton')}
              </button>
            ) : null}
            <button className="home-v2-link-button" type="button" onClick={() => setRetry((value) => value + 1)}>
              <RefreshCw aria-hidden="true" size={17} /> {t('common.retry')}
            </button>
            {onOpenCoreSettings ? (
              <button className="home-v2-link-button" type="button" onClick={onOpenCoreSettings}>
                {t('common.settings')}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}
