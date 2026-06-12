import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { t } from './i18n';
import type { QdnDisplaySettings, QdnPreview } from './qdn';
import { getQdnViewerKind } from './qdn';
import { canUseIsolatedQdnViews, getMediaErrorMessage, QdnIsolatedFrameContent } from './QdnViewer';

type QdnPreviewViewerProps = {
  account: QortiumAccountSummary | null;
  displaySettings: QdnDisplaySettings;
  nodeApiUrl: string;
  preview: QdnPreview;
  suspended?: boolean;
  tabId: string;
};

type PreviewErrorState = {
  message: string;
} | null;

function formatError(error: unknown) {
  if (!(error instanceof Error)) {
    return t('preview.failed');
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function PreviewMediaContent({
  isVideo,
  renderUrl,
  onError,
  onReady,
}: {
  isVideo: boolean;
  onError: (message: string) => void;
  onReady: () => void;
  renderUrl: string;
}) {
  return (
    <div className={`qdn-viewer__media qdn-viewer__media--${isVideo ? 'video' : 'audio'} qdn-preview__media`}>
      <div className="qdn-viewer__media-stage">
        {isVideo ? (
          <video
            className="qdn-viewer__media-player qdn-viewer__media-player--video"
            controls
            key={renderUrl}
            preload="metadata"
            playsInline
            src={renderUrl}
            onCanPlay={onReady}
            onError={(event) => onError(getMediaErrorMessage(event.currentTarget))}
          />
        ) : (
          <audio
            className="qdn-viewer__media-player qdn-viewer__media-player--audio"
            controls
            key={renderUrl}
            preload="metadata"
            src={renderUrl}
            onCanPlay={onReady}
            onError={(event) => onError(getMediaErrorMessage(event.currentTarget))}
          />
        )}
      </div>
    </div>
  );
}

export function QdnPreviewViewer({
  account,
  displaySettings,
  nodeApiUrl,
  preview,
  suspended = false,
  tabId,
}: QdnPreviewViewerProps) {
  const [renderUrl, setRenderUrl] = useState(preview.renderUrl);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<PreviewErrorState>(null);
  const viewerKind = getQdnViewerKind(preview.service);

  async function refreshPreview() {
    setIsRefreshing(true);

    try {
      const result = await window.qortiumHome.qdn.previewContent({ path: preview.sourcePath });

      if (!result.canceled) {
        setError(null);
        setRenderUrl(result.renderUrl);
      }
    } catch (refreshError) {
      setError({ message: formatError(refreshError) });
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <section className="qdn-viewer qdn-preview" aria-label={t('preview.ariaLabel')}>
      <div className="qdn-preview__head">
        <div className="qdn-viewer__status qdn-preview__toolbar">
          <div className="qdn-viewer__status-text">
            <span className="qdn-viewer__status-label">
              {t('preview.previewingAs', { service: preview.service })}
            </span>
            <span className="qdn-viewer__resource" title={preview.sourcePath}>
              {preview.sourcePath}
            </span>
          </div>
          <button
            className="button button--secondary qdn-preview__refresh"
            type="button"
            disabled={isRefreshing}
            onClick={() => void refreshPreview()}
          >
            <RefreshCw aria-hidden="true" size={18} strokeWidth={2} />
            {t('common.refresh')}
          </button>
        </div>

        {error ? (
          <p className="qdn-viewer__message qdn-viewer__message--error qdn-preview__error" role="alert">
            {error.message}
          </p>
        ) : null}
      </div>

      {viewerKind === 'iframe' ? (
        canUseIsolatedQdnViews() ? (
          <QdnIsolatedFrameContent
            account={account}
            displaySettings={displaySettings}
            nodeApiUrl={nodeApiUrl}
            renderUrl={renderUrl}
            resourceUrl={preview.sourcePath}
            suspended={suspended}
            tabId={tabId}
          />
        ) : (
          <iframe
            className="qdn-viewer__frame"
            key={renderUrl}
            title={preview.sourcePath}
            src={renderUrl}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals"
            allow="fullscreen; clipboard-read; clipboard-write; screen-wake-lock"
          />
        )
      ) : null}

      {viewerKind === 'image' ? (
        <div className="qdn-viewer__image-stage">
          <img
            className="qdn-viewer__image"
            alt={preview.sourceName}
            key={renderUrl}
            src={renderUrl}
            onError={() => setError({ message: t('preview.failed') })}
          />
        </div>
      ) : null}

      {viewerKind === 'audio' || viewerKind === 'video' ? (
        <PreviewMediaContent
          isVideo={viewerKind === 'video'}
          renderUrl={renderUrl}
          onError={(message) => setError({ message })}
          onReady={() => setError(null)}
        />
      ) : null}
    </section>
  );
}
