import { useEffect } from 'react'
import { Download, ExternalLink, X } from 'lucide-react'

import type { NetworkId } from '../contracts'
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
  readonly resource: HomeV2ResourceViewerState
  readonly onClose: () => void
}

const IMAGE_SERVICES = new Set(['IMAGE', 'THUMBNAIL', 'QCHAT_IMAGE'])
const AUDIO_SERVICES = new Set(['AUDIO', 'VOICE', 'PODCAST'])
const VIDEO_SERVICES = new Set(['VIDEO'])
const SAFE_RASTER_MIME_TYPES = new Set([
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

function resourceKind(resource: HomeV2ResourceViewerState) {
  const mime = resource.mimeType?.split(';', 1)[0].trim().toLowerCase() ?? ''
  if (SAFE_RASTER_MIME_TYPES.has(mime) || (IMAGE_SERVICES.has(resource.service) && !mime)) return 'image'
  if (AUDIO_SERVICES.has(resource.service) || mime.startsWith('audio/')) return 'audio'
  if (VIDEO_SERVICES.has(resource.service) || mime.startsWith('video/')) return 'video'
  if (mime === 'application/pdf') return 'pdf'
  return 'download'
}

export function HomeV2ResourceViewer({ resource, onClose }: HomeV2ResourceViewerProps) {
  const kind = resourceKind(resource)
  const coordinate = `${resource.service}/${resource.name}/${resource.identifier ?? 'default'}`

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="home-v2-resource-overlay" role="presentation">
      <section
        aria-label="Public resource viewer"
        aria-modal="true"
        className="home-v2-resource-viewer"
        role="dialog"
      >
        <header>
          <div>
            <span className="home-v2-resource-viewer__eyebrow">
              Public {resource.network === 'qortal' ? 'Qortal' : 'Qortium'} resource
            </span>
            <h2>{resource.filename ?? resource.name}</h2>
            <p title={coordinate}>{coordinate}</p>
          </div>
          <button
            aria-label="Close resource viewer"
            className="home-v2-resource-viewer__icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>

        <div className="home-v2-resource-viewer__content">
          {kind === 'image' ? (
            <img alt={resource.filename ?? `${resource.name} resource`} src={resource.streamUrl} />
          ) : kind === 'audio' ? (
            <audio controls preload="metadata" src={resource.streamUrl} />
          ) : kind === 'video' ? (
            <video controls playsInline preload="metadata" src={resource.streamUrl} />
          ) : kind === 'pdf' ? (
            <iframe sandbox="" src={resource.streamUrl} title={resource.filename ?? 'PDF resource'} />
          ) : (
            <div className="home-v2-resource-viewer__download-panel">
              <Download aria-hidden="true" size={34} />
              <p>This file is kept outside the page. Save it or open the public resource explicitly.</p>
            </div>
          )}
        </div>

        <footer>
          <a
            className="home-v2-primary-button home-v2-resource-viewer__open"
            href={resource.streamUrl}
            rel="noreferrer noopener"
            target="_blank"
          >
            <ExternalLink aria-hidden="true" size={17} />
            Open or save resource
          </a>
        </footer>
      </section>
    </div>
  )
}
