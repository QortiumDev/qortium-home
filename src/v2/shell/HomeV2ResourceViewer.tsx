import { useCallback, useEffect, useMemo } from 'react'
import { Download, ExternalLink, X } from 'lucide-react'

import { t } from '../../i18n'
import type { NetworkId } from '../contracts'
import type { HomeV2AppearanceSettings } from '../appearance'
import { DocumentViewer } from '../../DocumentViewer'
import { ArchiveViewer } from '../../ArchiveViewer'
import type { QdnDisplaySettings, QdnResource, QdnService } from '../../qdn'
import { classifyHomeV2ResourceViewer } from './home-v2-retained-viewer'
import './home-v2-resource-viewer.css'

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
  readonly presentation?: 'overlay' | 'tab'
  readonly appearance: HomeV2AppearanceSettings
  readonly loadRetainedBytes: (
    url: string,
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

export function HomeV2ResourceViewer({ appearance, loadRetainedBytes, saveRetainedBytes, saveRetainedFile, resource, onClose, presentation = 'overlay' }: HomeV2ResourceViewerProps) {
  const kind = classifyHomeV2ResourceViewer(resource)
  const coordinate = `${resource.service}/${resource.name}/${resource.identifier ?? 'default'}`
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
          displaySettings={displaySettings}
          knownFilename={resource.filename}
          knownMimeType={resource.mimeType}
          loadBytes={loadBytes}
          onDismiss={onClose}
          onDownload={async () => {
            await saveRetainedFile(
              resource.streamUrl,
              resource.filename ?? `${resource.service}_${resource.name}`,
              resource.mimeType ?? undefined,
            )
          }}
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

        <div className="home-v2-resource-viewer__content">
          {kind === 'archive' ? (
            <ArchiveViewer
              displaySettings={displaySettings}
              loadBytes={loadByteArray}
              onActionContextChange={() => undefined}
              saveBytes={saveRetainedBytes}
              resource={qdnResource}
            />
          ) : kind === 'image' ? (
            <img alt={resource.filename ?? t('home2.resourceViewer.resourceAlt', { name: resource.name })} src={resource.streamUrl} />
          ) : kind === 'audio' ? (
            <audio controls preload="metadata" src={resource.streamUrl} />
          ) : kind === 'video' ? (
            <video controls playsInline preload="metadata" src={resource.streamUrl} />
          ) : (
            <div className="home-v2-resource-viewer__download-panel">
              <Download aria-hidden="true" size={34} />
              <p>{t('home2.resourceViewer.downloadDescription')}</p>
            </div>
          )}
        </div>

        <footer>
          <button
            className="home-v2-primary-button home-v2-resource-viewer__open"
            type="button"
            onClick={() => void saveRetainedFile(
              resource.streamUrl,
              resource.filename ?? `${resource.service}_${resource.name}`,
              resource.mimeType ?? undefined,
            )}
          >
            <ExternalLink aria-hidden="true" size={17} />
            {t('home2.resourceViewer.openOrSave')}
          </button>
        </footer>
      </section>
    </div>
  )
}
