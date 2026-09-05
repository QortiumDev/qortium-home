import { useEffect, useState } from 'react'
import type { ShellEntry } from '../product-model'
import type { HomeV2AppearanceSettings } from '../appearance'
import type { HomeV2NodeClient } from '../../home-v2-live/node-client'
import { closeHomeV2PublicViewer, openHomeV2PublicViewer, loadHomeV2RetainedViewerBytes,
  saveHomeV2RetainedViewerBytes, saveHomeV2RetainedViewerFile } from '../../home-v2-live/retained-viewer-client'
import { HomeV2ResourceViewer, type HomeV2ResourceViewerState } from './HomeV2ResourceViewer'
import { t } from '../../i18n'

export function HomeV2ViewerTab({ entry, appearance, nodeClient, reloadVersion, routeKey, onClose }: {
  entry: Extract<ShellEntry, { kind: 'viewer' }>
  appearance: HomeV2AppearanceSettings
  nodeClient?: HomeV2NodeClient | null
  reloadVersion?: number
  routeKey: string
  onClose: () => void
}) {
  const [resource, setResource] = useState<HomeV2ResourceViewerState | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    // Android deliberately revokes all app/private streams on security
    // transitions. Public viewers survive by acquiring fresh public access.
    const refresh = () => setAttempt(value => value + 1)
    window.addEventListener('home-v2-public-viewers-invalidated', refresh)
    return () => window.removeEventListener('home-v2-public-viewers-invalidated', refresh)
  }, [])
  useEffect(() => {
    let canceled = false
    setResource(null)
    setError('')
    void openHomeV2PublicViewer(entry.location, entry.id, nodeClient).then(value => {
      if (!canceled) setResource(value)
    }).catch(error => { if (!canceled) setError(error instanceof Error ? error.message : String(error)) })
    return () => { canceled = true; void closeHomeV2PublicViewer(entry.id).catch(() => undefined) }
  }, [entry.id, entry.location, nodeClient, reloadVersion, routeKey, attempt])
  return <div className="home-v2-page-slot" data-viewer-tab={entry.id}>
    {error ? <div><p role="alert">{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>{t('common.retry')}</button></div> : resource ? <HomeV2ResourceViewer
      presentation="tab" appearance={appearance} resource={resource} onClose={onClose}
      loadRetainedBytes={loadHomeV2RetainedViewerBytes} saveRetainedBytes={saveHomeV2RetainedViewerBytes}
      saveRetainedFile={saveHomeV2RetainedViewerFile} /> : <p role="status">{t('common.loading')}</p>}
  </div>
}
