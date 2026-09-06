import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Download, ExternalLink, X } from 'lucide-react'

import { t } from '../../i18n'
import type { NetworkId } from '../contracts'
import type { HomeV2AppearanceSettings } from '../appearance'
import { DocumentViewer } from '../../DocumentViewer'
import { ArchiveViewer } from '../../ArchiveViewer'
import type { QdnDisplaySettings, QdnResource, QdnService } from '../../qdn'
import { classifyHomeV2ResourceViewer } from './home-v2-retained-viewer'
import './home-v2-resource-viewer.css'
import { HomeV2RichPreview } from './HomeV2RichPreview'
import { useViewerSave, ViewerSaveFeedback } from './ViewerSaveFeedback'
import { boundedPosition, type ViewerPosition } from '../../viewer-position'
import { useViewerScroll } from '../../use-viewer-scroll'

export function PositionedMedia({ kind, url, position }: { kind: 'audio' | 'video'; url: string; position?: ViewerPosition }) {
  const ref = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    const media = ref.current
    if (!media) return
    let restored = false
    const restore = () => {
      if (restored || !Number.isFinite(media.duration) || media.duration <= 0) return
      try {
        media.currentTime = boundedPosition(position?.mediaTime ?? 0, media.duration)
        restored = true
      } catch { /* Retry on loadeddata if metadata was not enough to seek. */ }
    }
    const save = () => { if (position && restored) position.mediaTime = boundedPosition(media.currentTime, 604800) }
    media.addEventListener('loadedmetadata', restore)
    media.addEventListener('loadeddata', restore)
    media.addEventListener('timeupdate', save)
    if (media.readyState >= 1) restore()
    return () => {
      save()
      media.removeEventListener('loadedmetadata', restore)
      media.removeEventListener('loadeddata', restore)
      media.removeEventListener('timeupdate', save)
      if (!media.paused) media.pause()
    }
  }, [position, url])
  return kind === 'video' ? <video ref={ref} controls playsInline preload="metadata" src={url} />
    : <audio ref={ref} controls preload="metadata" src={url} />
}

export type HomeV2ResourceViewerState = {
  readonly filename: string | null
  readonly identifier: string | null
  readonly mimeType: string | null
  readonly name: string
  readonly network: NetworkId
  readonly path: string | null
  readonly service: string
  readonly sourceTabId: string
  readonly streamUrl: string
}

type HomeV2ResourceViewerProps = {
  readonly position?: ViewerPosition
  readonly presentation?: 'overlay' | 'tab'
  readonly appearance: HomeV2AppearanceSettings
  readonly loadRetainedBytes: (
    url: string,
    maxBytes?: number,
  ) => Promise<{ bytes: Uint8Array; contentType?: string }>
  readonly saveRetainedFile: (
    url: string,
    filename: string,
    mimeType?: string,
  ) => Promise<{ canceled: boolean }>
  readonly saveRetainedBytes: (
    filename: string,
    bytes: Uint8Array,
    mimeType?: string,
  ) => Promise<{ canceled: boolean }>
  readonly resource: HomeV2ResourceViewerState
  readonly onClose: () => void
}

export function HomeV2ResourceViewer({ appearance, loadRetainedBytes, saveRetainedBytes, saveRetainedFile, resource, onClose, presentation = 'overlay', position: publicPosition }: HomeV2ResourceViewerProps) {
  const kind = classifyHomeV2ResourceViewer(resource)
  // Private/source-bound overlays deliberately retain their existing lifetime.
  const position = presentation === 'tab' ? publicPosition : undefined
  const contentRef = useRef<HTMLDivElement>(null)
  const rich = ['text', 'code', 'json', 'csv', 'markdown'].includes(kind)
  useViewerScroll(contentRef, position, !rich && kind !== 'archive' && kind !== 'document')
  const coordinate = `${resource.service}/${resource.name}/${resource.identifier ?? 'default'}`
  const saveKey = JSON.stringify([resource.sourceTabId, resource.network, resource.service, resource.name, resource.identifier, resource.path])
  // Public tabs reacquire access when remounted. Source-bound/private overlays
  // must not inherit another capability's completion after reapproval instead.
  // Use an opaque key: never store the capability URL in the status registry.
  const overlaySaveKey = useMemo(() => ({}), [saveKey, resource.streamUrl])
  const save = useViewerSave(presentation === 'tab' ? saveKey : overlaySaveKey)
  const filename = resource.filename ?? `${resource.service}_${resource.name}`
  const saveResource = () => save.run(filename, () => saveRetainedFile(resource.streamUrl, filename, resource.mimeType ?? undefined))
  const saveEntry = (entry: { filename: string; read: () => Promise<Uint8Array> }) => save.run(entry.filename, async () => {
    const bytes = await entry.read()
    if (bytes.byteLength > 100 * 1024 * 1024) throw new Error('Archive entry exceeds the viewer byte limit.')
    return saveRetainedBytes(entry.filename, bytes)
  })
  const saveFeedback = <ViewerSaveFeedback state={save.state} />
  const qdnResource: QdnResource = useMemo(() => ({
    displayUrl: `${resource.network === 'qortal' ? 'qortal' : 'qdn'}://${coordinate}`,
    identifier: resource.identifier ?? undefined,
    name: resource.name,
    path: resource.path ?? '',
    service: resource.service as QdnService,
  }), [coordinate, resource.identifier, resource.name, resource.network, resource.path, resource.service])
  const displaySettings: QdnDisplaySettings = useMemo(() => ({
    accent: appearance.accent === 'clay' ? 'orange' : appearance.accent,
    language: appearance.resolvedLanguage,
    textSize: appearance.textSize,
    theme: appearance.resolvedTheme,
    ui: appearance.ui,
  }), [appearance])
  const loadBytes = useCallback(async () => {
    const loaded = await loadRetainedBytes(resource.streamUrl)
    return {
      bytes: loaded.bytes,
      contentType: loaded.contentType,
    }
  }, [loadRetainedBytes, resource.streamUrl])
  const loadByteArray = useCallback(
    async () => (await loadBytes()).bytes,
    [loadBytes],
  )

  useEffect(() => {
    if (presentation === 'tab') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, presentation])
  const viewerClass = `home-v2-resource-overlay${presentation === 'tab' ? ' home-v2-resource-overlay--tab' : ''}`

  if (kind === 'document') {
    return (
      <div className={`${viewerClass} home-v2-resource-overlay--retained`} role="presentation">
        <DocumentViewer
          presentation={presentation === 'tab' ? 'tab' : 'dialog'}
          position={position}
          displaySettings={displaySettings}
          knownFilename={resource.filename}
          knownMimeType={resource.mimeType}
          loadBytes={loadBytes}
          onDismiss={onClose}
          onDownload={saveResource}
          downloadBusy={save.busy}
          downloadFeedback={saveFeedback}
          resource={qdnResource}
        />
      </div>
    )
  }

  return (
    <div className={viewerClass} role="presentation">
      <section
        aria-label={t('home2.resourceViewer.ariaLabel')}
        aria-modal={presentation === 'overlay' ? true : undefined}
        className="home-v2-resource-viewer"
        role={presentation === 'overlay' ? 'dialog' : 'region'}
      >
        <header>
          <div>
            <span className="home-v2-resource-viewer__eyebrow">
              {t('home2.resourceViewer.publicResource', {
                network: resource.network === 'qortal' ? 'Qortal' : 'Qortium',
              })}
            </span>
            <h2>{resource.filename ?? resource.name}</h2>
            <p title={coordinate}>{coordinate}</p>
          </div>
          <button
            aria-label={t('home2.resourceViewer.close')}
            className="home-v2-resource-viewer__icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>

        <div className="home-v2-resource-viewer__content" ref={contentRef}>
          {kind === 'text' || kind === 'code' || kind === 'json' || kind === 'csv' || kind === 'markdown' ? (
            <HomeV2RichPreview key={resource.streamUrl} kind={kind} url={resource.streamUrl} loadBytes={loadRetainedBytes} position={position} scrollRef={contentRef} />
          ) : kind === 'archive' ? (
            <ArchiveViewer
              displaySettings={displaySettings}
              position={position}
              loadBytes={loadByteArray}
              onActionContextChange={() => undefined}
              saveBytes={saveRetainedBytes}
              saveEntry={saveEntry}
              saveBusy={save.busy}
              saveFeedback={saveFeedback}
              resource={qdnResource}
            />
          ) : kind === 'image' ? (
            <img alt={resource.filename ?? t('home2.resourceViewer.resourceAlt', { name: resource.name })} src={resource.streamUrl} />
          ) : kind === 'audio' ? (
            <PositionedMedia kind="audio" url={resource.streamUrl} position={position} />
          ) : kind === 'video' ? (
            <PositionedMedia kind="video" url={resource.streamUrl} position={position} />
          ) : (
            <div className="home-v2-resource-viewer__download-panel">
              <Download aria-hidden="true" size={34} />
              <p>{t('home2.resourceViewer.downloadDescription')}</p>
            </div>
          )}
        </div>

        <footer>
          {saveFeedback}
          <button
            className="home-v2-primary-button home-v2-resource-viewer__open"
            type="button"
            disabled={save.busy}
            aria-busy={save.busy}
            onClick={() => void saveResource()}
          >
            <ExternalLink aria-hidden="true" size={17} />
            {save.busy ? t('common.saving') : t('home2.resourceViewer.openOrSave')}
          </button>
        </footer>
      </section>
    </div>
  )
}
