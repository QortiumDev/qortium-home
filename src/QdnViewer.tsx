import { Copy, Download, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { QdnResource, QdnResourceProperties, QdnResourceStatus, QdnViewerKind } from './qdn';
import {
  buildQdnDownloadUrl,
  buildQdnRenderUrl,
  buildQdnResourcePropertiesUrl,
  buildQdnStatusUrl,
  formatQdnStatus,
  getQdnResourceKey,
  getQdnViewerKind,
  isTerminalQdnStatus,
} from './qdn';
import { fetchNativeHttpBlobUrl, handleQdnAppRequest, isNativePlatform } from './platform';

const STATUS_POLL_INTERVAL_MS = 5_000;
const TEXT_PREVIEW_MAX_BYTES = 1_048_576;

type LoadedQdnResource = {
  properties?: QdnResourceProperties;
  renderUrl: string;
  status: QdnResourceStatus;
  viewerKind: QdnViewerKind;
};

type QdnViewerState =
  | {
      message: string;
      phase: 'loading';
      status?: QdnResourceStatus;
    }
  | {
      loadedResource: LoadedQdnResource;
      phase: 'ready';
      status: QdnResourceStatus;
    }
  | {
      message: string;
      phase: 'error';
      status?: QdnResourceStatus;
    };

type QdnViewerProps = {
  accountId: string | null;
  nodeApiUrl: string;
  resource: QdnResource;
  tabId: string;
};

type TextPreviewState =
  | {
      phase: 'loading';
    }
  | {
      content: string;
      label: string;
      phase: 'ready';
    }
  | {
      message: string;
      phase: 'too-large';
    }
  | {
      message: string;
      phase: 'error';
    };

type MediaErrorState = {
  message: string;
} | null;

type QdnAppBridgeMessage = {
  bridgeToken?: unknown;
  request?: unknown;
  requestId?: unknown;
  type?: unknown;
};

function canUseIsolatedQdnViews() {
  return !isNativePlatform() && !!window.qortiumHome.qdnViews;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isQdnAppBridgeMessage(value: unknown): value is QdnAppBridgeMessage {
  return isRecord(value) && value.type === 'qortium:qdn-request' && typeof value.requestId === 'string';
}

function createQdnBridgeToken() {
  const bytes = new Uint8Array(16);

  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);

    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function buildAndroidQdnBridgeUrl(renderUrl: string, bridgeToken: string) {
  const url = new URL(renderUrl);

  url.searchParams.set('qdnHomeBridge', bridgeToken);

  return url.toString();
}

function formatError(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Unable to load QDN resource.';
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function getMediaErrorMessage(element: HTMLAudioElement | HTMLVideoElement) {
  switch (element.error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Media loading was canceled.';
    case MediaError.MEDIA_ERR_NETWORK:
      return 'The media could not be loaded from the configured node.';
    case MediaError.MEDIA_ERR_DECODE:
      return 'The media file could not be decoded by this app.';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'This media format is not supported by this app.';
    default:
      return 'The media could not be loaded.';
  }
}

function getStatusProgress(status: QdnResourceStatus | undefined) {
  if (!status) {
    return undefined;
  }

  if (typeof status.percentLoaded === 'number') {
    return Math.max(0, Math.min(100, status.percentLoaded));
  }

  if (
    typeof status.localChunkCount === 'number' &&
    typeof status.totalChunkCount === 'number' &&
    status.totalChunkCount > 0
  ) {
    return Math.max(0, Math.min(100, (status.localChunkCount / status.totalChunkCount) * 100));
  }

  return undefined;
}

function getProgressText(status: QdnResourceStatus | undefined) {
  if (!status) {
    return '';
  }

  const progress = getStatusProgress(status);

  if (typeof status.localChunkCount === 'number' && typeof status.totalChunkCount === 'number') {
    return `${status.localChunkCount.toLocaleString()} / ${status.totalChunkCount.toLocaleString()} chunks${
      typeof progress === 'number' ? `, ${progress.toFixed(0)}%` : ''
    }`;
  }

  return typeof progress === 'number' ? `${progress.toFixed(0)}%` : '';
}

function formatBytes(bytes: number | undefined) {
  if (typeof bytes !== 'number') {
    return '';
  }

  if (bytes < 1024) {
    return `${bytes.toLocaleString()} bytes`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unitIndex]}`;
}

function formatTextPreviewLimit() {
  return formatBytes(TEXT_PREVIEW_MAX_BYTES) || '1 MB';
}

function shouldFormatJson(resource: QdnResource, mimeType: string) {
  return (
    resource.service === 'JSON' ||
    resource.service === 'METADATA' ||
    resource.service === 'LIST' ||
    /\bjson\b/i.test(mimeType)
  );
}

function getTextPreviewLabel(resource: QdnResource, mimeType: string, formattedAsJson: boolean) {
  if (formattedAsJson) {
    return 'JSON';
  }

  if (resource.service === 'CODE') {
    return 'Code';
  }

  if (mimeType) {
    return mimeType.split(';')[0] || 'Text';
  }

  return 'Text';
}

async function writeClipboardText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.append(textArea);
  textArea.focus();
  textArea.select();

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Clipboard copy was not available.');
    }
  } finally {
    textArea.remove();
  }
}

async function readStatus(response: Response) {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `QDN status request failed with HTTP ${response.status}.`);
  }

  return JSON.parse(text) as QdnResourceStatus;
}

function isQdnResourceProperties(value: unknown): value is QdnResourceProperties {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const properties = value as Partial<QdnResourceProperties>;

  return (
    (properties.filename === undefined || typeof properties.filename === 'string') &&
    (properties.mimeType === undefined || typeof properties.mimeType === 'string') &&
    (properties.size === undefined || typeof properties.size === 'number')
  );
}

async function readProperties(response: Response) {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `QDN properties request failed with HTTP ${response.status}.`);
  }

  const data: unknown = JSON.parse(text);

  if (!isQdnResourceProperties(data)) {
    throw new Error('QDN properties response did not match the expected shape.');
  }

  return data;
}

async function loadResourceProperties(resource: QdnResource, nodeApiUrl: string, signal: AbortSignal) {
  try {
    const response = await fetch(buildQdnResourcePropertiesUrl(resource, nodeApiUrl), {
      signal,
    });

    return await readProperties(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    return undefined;
  }
}

async function verifyRenderUrl(renderUrl: string, signal: AbortSignal) {
  const response = await fetch(renderUrl, { signal });

  if (response.status === 404) {
    throw new Error('File not found.');
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `QDN render request failed with HTTP ${response.status}.`);
  }

  await response.body?.cancel();
}

function shouldUseBlobRenderUrl(viewerKind: QdnViewerKind) {
  return isNativePlatform() && (viewerKind === 'audio' || viewerKind === 'image' || viewerKind === 'video');
}

function getBlobContentType(viewerKind: QdnViewerKind, mimeType = '', responseContentType = '') {
  if (viewerKind === 'audio' && (!mimeType || mimeType === 'application/ogg')) {
    return 'audio/ogg';
  }

  if (viewerKind === 'video' && (!mimeType || mimeType === 'application/octet-stream')) {
    return 'video/webm';
  }

  return mimeType || responseContentType || 'application/octet-stream';
}

async function createBlobRenderUrl({
  mimeType,
  renderUrl,
  signal,
  viewerKind,
}: {
  mimeType?: string;
  renderUrl: string;
  signal: AbortSignal;
  viewerKind: QdnViewerKind;
}) {
  if (isNativePlatform()) {
    return fetchNativeHttpBlobUrl({
      contentType: getBlobContentType(viewerKind, mimeType),
      readTimeoutMs: 120_000,
      url: renderUrl,
    });
  }

  const response = await fetch(renderUrl, { signal });

  if (response.status === 404) {
    throw new Error('File not found.');
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `QDN render request failed with HTTP ${response.status}.`);
  }

  const responseContentType = response.headers.get('content-type') ?? '';
  const contentType = getBlobContentType(viewerKind, mimeType, responseContentType);
  const blob = await response.blob();
  const typedBlob = blob.type === contentType ? blob : blob.slice(0, blob.size, contentType);

  return URL.createObjectURL(typedBlob);
}

function useQdnResourceLoader(resource: QdnResource, nodeApiUrl: string, retryToken: number) {
  const [state, setState] = useState<QdnViewerState>({
    phase: 'loading',
    message: 'Checking QDN resource',
  });
  const resourceKey = useMemo(() => getQdnResourceKey(resource), [resource]);

  useEffect(() => {
    const abortController = new AbortController();
    let isDisposed = false;
    let timeoutId: number | undefined;
    let hasTriggeredDownload = false;
    let blobRenderUrl: string | undefined;

    function setSafeState(nextState: QdnViewerState) {
      if (!isDisposed) {
        setState(nextState);
      }
    }

    async function triggerDownload() {
      if (hasTriggeredDownload) {
        return;
      }

      hasTriggeredDownload = true;

      try {
        await fetch(buildQdnDownloadUrl(resource, nodeApiUrl), {
          signal: abortController.signal,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
      }
    }

    async function setReadyState(status: QdnResourceStatus) {
      const viewerKind = getQdnViewerKind(resource.service);
      const directRenderUrl = buildQdnRenderUrl(resource, nodeApiUrl);
      const useBlobRenderUrl = shouldUseBlobRenderUrl(viewerKind);

      if (viewerKind === 'iframe' || (viewerKind === 'image' && !useBlobRenderUrl)) {
        await verifyRenderUrl(directRenderUrl, abortController.signal);
      }

      const properties = await loadResourceProperties(resource, nodeApiUrl, abortController.signal);
      let renderUrl = directRenderUrl;

      if (useBlobRenderUrl) {
        renderUrl = await createBlobRenderUrl({
          mimeType: properties?.mimeType,
          renderUrl: directRenderUrl,
          signal: abortController.signal,
          viewerKind,
        });

        if (isDisposed) {
          URL.revokeObjectURL(renderUrl);
          return;
        }

        blobRenderUrl = renderUrl;
      }

      setSafeState({
        phase: 'ready',
        status,
        loadedResource: {
          properties,
          renderUrl,
          status,
          viewerKind,
        },
      });
    }

    async function pollStatus(build: boolean) {
      try {
        const statusResponse = await fetch(buildQdnStatusUrl(resource, nodeApiUrl, build), {
          signal: abortController.signal,
        });
        const status = await readStatus(statusResponse);

        if (status.status === 'READY') {
          await setReadyState(status);
          return;
        }

        if (isTerminalQdnStatus(status.status)) {
          setSafeState({
            phase: 'error',
            message: formatQdnStatus(status),
            status,
          });
          return;
        }

        setSafeState({
          phase: 'loading',
          message: formatQdnStatus(status),
          status,
        });

        void triggerDownload();
        timeoutId = window.setTimeout(() => {
          void pollStatus(status.status === 'DOWNLOADED');
        }, STATUS_POLL_INTERVAL_MS);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        setSafeState({
          phase: 'error',
          message: formatError(error),
        });
      }
    }

    async function loadResource() {
      setSafeState({
        phase: 'loading',
        message: 'Authorizing QDN resource',
      });

      try {
        await window.qortiumHome.qdn.authorizeResource({
          service: resource.service,
          name: resource.name,
          identifier: resource.identifier,
        });
        await pollStatus(true);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        setSafeState({
          phase: 'error',
          message: formatError(error),
        });
      }
    }

    void loadResource();

    return () => {
      isDisposed = true;
      abortController.abort();

      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      if (blobRenderUrl) {
        URL.revokeObjectURL(blobRenderUrl);
      }
    };
  }, [nodeApiUrl, resource, resourceKey, retryToken]);

  return state;
}

function CopyButton({
  className,
  disabled,
  label,
  value,
}: {
  className?: string;
  disabled?: boolean;
  label: string;
  value: string;
}) {
  const [copyState, setCopyState] = useState<'copied' | 'error' | 'idle'>('idle');
  const buttonLabel = copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : label;

  useEffect(() => {
    if (copyState === 'idle') {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setCopyState('idle'), 1_600);

    return () => window.clearTimeout(timeoutId);
  }, [copyState]);

  return (
    <button
      className={`button button--secondary${className ? ` ${className}` : ''}`}
      type="button"
      disabled={disabled}
      onClick={async () => {
        try {
          await writeClipboardText(value);
          setCopyState('copied');
        } catch {
          setCopyState('error');
        }
      }}
    >
      <Copy aria-hidden="true" size={18} strokeWidth={2} />
      {buttonLabel}
    </button>
  );
}

function getSuggestedResourceFilename(resource: QdnResource, properties: QdnResourceProperties | undefined) {
  if (properties?.filename) {
    return properties.filename;
  }

  const identifier = resource.identifier || 'default';
  const suffix = resource.path.split('/').filter(Boolean).at(-1)?.split('?')[0] || '';

  return suffix || `${resource.service}_${resource.name}_${identifier}`;
}

function QdnDownloadButton({
  loadedResource,
  resource,
}: {
  loadedResource: LoadedQdnResource;
  resource: QdnResource;
}) {
  const [downloadState, setDownloadState] = useState<'error' | 'idle' | 'saved' | 'saving'>('idle');
  const opensNativeDownload = isNativePlatform();
  const buttonLabel =
    downloadState === 'saving'
      ? opensNativeDownload
        ? 'Opening'
        : 'Saving'
      : downloadState === 'saved'
        ? opensNativeDownload
          ? 'Opened'
          : 'Saved'
        : downloadState === 'error'
          ? opensNativeDownload
            ? 'Open failed'
            : 'Save failed'
          : opensNativeDownload
            ? 'Open'
            : 'Download';

  useEffect(() => {
    if (downloadState !== 'saved' && downloadState !== 'error') {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setDownloadState('idle'), 1_800);

    return () => window.clearTimeout(timeoutId);
  }, [downloadState]);

  return (
    <button
      className="button qdn-viewer__action-button"
      type="button"
      disabled={downloadState === 'saving'}
      onClick={async () => {
        setDownloadState('saving');

        try {
          const result = await window.qortiumHome.qdn.downloadResource({
            service: resource.service,
            name: resource.name,
            identifier: resource.identifier,
            path: resource.path,
            suggestedFilename: getSuggestedResourceFilename(resource, loadedResource.properties),
          });

          setDownloadState(result.canceled ? 'idle' : 'saved');
        } catch {
          setDownloadState('error');
        }
      }}
    >
      <Download aria-hidden="true" size={18} strokeWidth={2} />
      {buttonLabel}
    </button>
  );
}

function QdnResourceActions({
  loadedResource,
  resource,
}: {
  loadedResource: LoadedQdnResource;
  resource: QdnResource;
}) {
  return (
    <div className="qdn-viewer__actions">
      <QdnDownloadButton loadedResource={loadedResource} resource={resource} />
      <CopyButton label="Copy QDN URL" value={resource.displayUrl} />
    </div>
  );
}

async function readTextPreview({
  loadedResource,
  resource,
}: {
  loadedResource: LoadedQdnResource;
  resource: QdnResource;
}): Promise<TextPreviewState> {
  const knownSize = loadedResource.properties?.size;

  if (typeof knownSize === 'number' && knownSize > TEXT_PREVIEW_MAX_BYTES) {
    return {
      phase: 'too-large',
      message: `This resource is ${formatBytes(knownSize)}, so it is too large to preview inline. The inline preview limit is ${formatTextPreviewLimit()}.`,
    };
  }

  const result = await window.qortiumHome.qdn.fetchResourceText({
    service: resource.service,
    name: resource.name,
    identifier: resource.identifier,
    path: resource.path,
    maxBytes: TEXT_PREVIEW_MAX_BYTES,
  });

  if (result.tooLarge) {
    return {
      phase: 'too-large',
      message: result.contentLength
        ? `This resource is ${formatBytes(result.contentLength)}, so it is too large to preview inline. The inline preview limit is ${formatTextPreviewLimit()}.`
        : `This resource is too large to preview inline. The inline preview limit is ${formatTextPreviewLimit()}.`,
    };
  }

  const rawContent = result.content;
  const mimeType = loadedResource.properties?.mimeType || result.contentType || '';
  const shouldTryJson = shouldFormatJson(resource, mimeType);
  let content = rawContent;
  let formattedAsJson = false;

  if (shouldTryJson) {
    try {
      content = JSON.stringify(JSON.parse(rawContent), null, 2);
      formattedAsJson = true;
    } catch {
      formattedAsJson = false;
    }
  }

  return {
    phase: 'ready',
    content,
    label: getTextPreviewLabel(resource, mimeType, formattedAsJson),
  };
}

function QdnTextContent({
  loadedResource,
  resource,
}: {
  loadedResource: LoadedQdnResource;
  resource: QdnResource;
}) {
  const [state, setState] = useState<TextPreviewState>({
    phase: 'loading',
  });

  useEffect(() => {
    let isDisposed = false;

    setState({
      phase: 'loading',
    });

    async function loadTextPreview() {
      try {
        const nextState = await readTextPreview({
          loadedResource,
          resource,
        });

        if (!isDisposed) {
          setState(nextState);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        if (!isDisposed) {
          setState({
            phase: 'error',
            message: formatError(error),
          });
        }
      }
    }

    void loadTextPreview();

    return () => {
      isDisposed = true;
    };
  }, [loadedResource, resource]);

  const isReady = state.phase === 'ready';
  const statusText =
    state.phase === 'loading'
      ? 'Loading text preview'
      : state.phase === 'ready'
        ? state.label
        : state.phase === 'too-large'
          ? 'Preview unavailable'
          : 'Preview failed';

  return (
    <div className="qdn-viewer__text">
      <div className="qdn-viewer__text-toolbar">
        <span className="qdn-viewer__type-label">{statusText}</span>
        <div className="qdn-viewer__actions">
          <CopyButton disabled={!isReady} label="Copy text" value={isReady ? state.content : ''} />
          <QdnDownloadButton loadedResource={loadedResource} resource={resource} />
        </div>
      </div>

      {state.phase === 'loading' ? (
        <div className="qdn-viewer__empty qdn-viewer__empty--loading">
          <p className="qdn-viewer__message">Loading text preview</p>
        </div>
      ) : null}

      {state.phase === 'ready' ? (
        <pre className="qdn-viewer__text-content">
          <code>{state.content}</code>
        </pre>
      ) : null}

      {state.phase === 'too-large' || state.phase === 'error' ? (
        <div className={`qdn-viewer__empty qdn-viewer__empty--${state.phase === 'error' ? 'error' : 'ready'}`}>
          <div className="qdn-viewer__details">
            <p className="qdn-viewer__message">{state.message}</p>
            <QdnResourceActions loadedResource={loadedResource} resource={resource} />
            <QdnResourceDetailList loadedResource={loadedResource} resource={resource} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function QdnResourceDetailList({
  loadedResource,
  resource,
}: {
  loadedResource: LoadedQdnResource;
  resource: QdnResource;
}) {
  return (
    <dl className="detail-list qdn-viewer__detail-list">
      <div className="detail-list__row">
        <dt className="detail-list__label">Service</dt>
        <dd className="detail-list__value">{resource.service}</dd>
      </div>
      <div className="detail-list__row">
        <dt className="detail-list__label">Name</dt>
        <dd className="detail-list__value">{resource.name}</dd>
      </div>
      <div className="detail-list__row">
        <dt className="detail-list__label">Identifier</dt>
        <dd className="detail-list__value">{resource.identifier || 'default'}</dd>
      </div>
      {resource.path ? (
        <div className="detail-list__row">
          <dt className="detail-list__label">Path</dt>
          <dd className="detail-list__value">{resource.path}</dd>
        </div>
      ) : null}
      <div className="detail-list__row">
        <dt className="detail-list__label">Status</dt>
        <dd className="detail-list__value">{formatQdnStatus(loadedResource.status)}</dd>
      </div>
      {loadedResource.properties?.filename ? (
        <div className="detail-list__row">
          <dt className="detail-list__label">File</dt>
          <dd className="detail-list__value">{loadedResource.properties.filename}</dd>
        </div>
      ) : null}
      {loadedResource.properties?.mimeType ? (
        <div className="detail-list__row">
          <dt className="detail-list__label">Type</dt>
          <dd className="detail-list__value">{loadedResource.properties.mimeType}</dd>
        </div>
      ) : null}
      {loadedResource.properties?.size ? (
        <div className="detail-list__row">
          <dt className="detail-list__label">Size</dt>
          <dd className="detail-list__value">{formatBytes(loadedResource.properties.size)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function QdnDetailsContent({
  loadedResource,
  message,
  resource,
}: {
  loadedResource: LoadedQdnResource;
  message: string;
  resource: QdnResource;
}) {
  return (
    <div className="qdn-viewer__empty qdn-viewer__empty--ready">
      <div className="qdn-viewer__details">
        <p className="qdn-viewer__message">{message}</p>
        <QdnResourceActions loadedResource={loadedResource} resource={resource} />
        <QdnResourceDetailList loadedResource={loadedResource} resource={resource} />
      </div>
    </div>
  );
}

function QdnMediaContent({
  loadedResource,
  resource,
}: {
  loadedResource: LoadedQdnResource;
  resource: QdnResource;
}) {
  const [mediaError, setMediaError] = useState<MediaErrorState>(null);
  const isVideo = loadedResource.viewerKind === 'video';

  return (
    <div className={`qdn-viewer__media qdn-viewer__media--${isVideo ? 'video' : 'audio'}`}>
      <div className="qdn-viewer__media-stage">
        {isVideo ? (
          <video
            className="qdn-viewer__media-player qdn-viewer__media-player--video"
            controls
            key={loadedResource.renderUrl}
            preload="metadata"
            playsInline
            src={loadedResource.renderUrl}
            onCanPlay={() => setMediaError(null)}
            onError={(event) => setMediaError({ message: getMediaErrorMessage(event.currentTarget) })}
          />
        ) : (
          <audio
            className="qdn-viewer__media-player qdn-viewer__media-player--audio"
            controls
            key={loadedResource.renderUrl}
            preload="metadata"
            src={loadedResource.renderUrl}
            onCanPlay={() => setMediaError(null)}
            onError={(event) => setMediaError({ message: getMediaErrorMessage(event.currentTarget) })}
          />
        )}
      </div>

      <div className="qdn-viewer__details qdn-viewer__media-details">
        {mediaError ? <p className="qdn-viewer__message qdn-viewer__message--error">{mediaError.message}</p> : null}
        <QdnResourceActions loadedResource={loadedResource} resource={resource} />
        <QdnResourceDetailList loadedResource={loadedResource} resource={resource} />
      </div>
    </div>
  );
}

function getElementBounds(element: HTMLElement): QortiumQdnViewBounds {
  const rect = element.getBoundingClientRect();

  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

function areViewBoundsEqual(first: QortiumQdnViewBounds | null, second: QortiumQdnViewBounds) {
  return (
    !!first &&
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
}

function QdnIsolatedFrameContent({
  loadedResource,
  accountId,
  nodeApiUrl,
  resource,
  tabId,
}: {
  accountId: string | null;
  loadedResource: LoadedQdnResource;
  nodeApiUrl: string;
  resource: QdnResource;
  tabId: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastBoundsRef = useRef<QortiumQdnViewBounds | null>(null);
  const [viewError, setViewError] = useState('');

  useEffect(() => {
    const qdnViews = window.qortiumHome.qdnViews;
    const container = containerRef.current;

    if (!qdnViews || !container) {
      return undefined;
    }

    let isDisposed = false;
    let animationFrameId = 0;

    function syncBounds() {
      if (isDisposed || !containerRef.current) {
        return;
      }

      const bounds = getElementBounds(containerRef.current);

      if (areViewBoundsEqual(lastBoundsRef.current, bounds)) {
        return;
      }

      lastBoundsRef.current = bounds;
      void qdnViews.setBounds({ tabId, bounds }).catch((error) => {
        console.warn('Unable to resize isolated QDN view.', error);
      });
    }

    async function showView() {
      const bounds = getElementBounds(container);

      lastBoundsRef.current = bounds;

      try {
        await qdnViews.show({
          accountId,
          bounds,
          nodeApiUrl,
          renderUrl: loadedResource.renderUrl,
          tabId,
        });

        if (!isDisposed) {
          setViewError('');
        }
      } catch (error) {
        if (!isDisposed) {
          setViewError(formatError(error));
        }
      }
    }

    void showView();

    const resizeObserver = new ResizeObserver(syncBounds);

    resizeObserver.observe(container);
    window.addEventListener('resize', syncBounds);
    window.addEventListener('scroll', syncBounds, true);
    animationFrameId = window.requestAnimationFrame(syncBounds);

    return () => {
      isDisposed = true;
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncBounds);
      window.removeEventListener('scroll', syncBounds, true);

      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }

      void qdnViews.hide(tabId).catch((error) => {
        console.warn('Unable to hide isolated QDN view.', error);
      });
    };
  }, [accountId, loadedResource.renderUrl, nodeApiUrl, tabId]);

  return (
    <div
      className={`qdn-viewer__isolated-frame${viewError ? ' qdn-viewer__isolated-frame--error' : ''}`}
      aria-label={resource.displayUrl}
      ref={containerRef}
    >
      {viewError ? (
        <p className="qdn-viewer__message qdn-viewer__message--error">{viewError}</p>
      ) : null}
    </div>
  );
}

function QdnIframeContent({
  loadedResource,
  resource,
}: {
  loadedResource: LoadedQdnResource;
  resource: QdnResource;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const isNativeFrame = isNativePlatform();
  const bridgeToken = useMemo(
    () => (isNativeFrame ? createQdnBridgeToken() : ''),
    [isNativeFrame, loadedResource.renderUrl],
  );
  const frameSrc = useMemo(
    () =>
      isNativeFrame && bridgeToken
        ? buildAndroidQdnBridgeUrl(loadedResource.renderUrl, bridgeToken)
        : loadedResource.renderUrl,
    [bridgeToken, isNativeFrame, loadedResource.renderUrl],
  );

  useEffect(() => {
    if (!isNativeFrame) {
      return undefined;
    }

    const allowedOrigin = new URL(loadedResource.renderUrl).origin;

    async function handleMessage(event: MessageEvent) {
      const frameWindow = frameRef.current?.contentWindow;

      if (!frameWindow || event.source !== frameWindow || event.origin !== allowedOrigin) {
        return;
      }

      if (!isQdnAppBridgeMessage(event.data)) {
        return;
      }

      if (event.data.bridgeToken !== bridgeToken) {
        return;
      }

      const requestId = event.data.requestId;

      try {
        const result = await handleQdnAppRequest(event.data.request);

        frameWindow.postMessage(
          {
            bridgeToken,
            requestId,
            result,
            type: 'qortium:qdn-response',
          },
          event.origin,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'QDN app request failed.';

        frameWindow.postMessage(
          {
            bridgeToken,
            error: {
              error: message,
              message,
            },
            requestId,
            result: null,
            type: 'qortium:qdn-response',
          },
          event.origin,
        );
      }
    }

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [bridgeToken, isNativeFrame, loadedResource.renderUrl]);

  return (
    <iframe
      className="qdn-viewer__frame"
      key={frameSrc}
      ref={frameRef}
      title={resource.displayUrl}
      src={frameSrc}
      referrerPolicy="no-referrer"
      sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals"
      allow="fullscreen; clipboard-read; clipboard-write; screen-wake-lock"
    />
  );
}

function QdnReadyContent({
  loadedResource,
  accountId,
  nodeApiUrl,
  resource,
  tabId,
}: {
  accountId: string | null;
  loadedResource: LoadedQdnResource;
  nodeApiUrl: string;
  resource: QdnResource;
  tabId: string;
}) {
  if (loadedResource.viewerKind === 'iframe') {
    if (canUseIsolatedQdnViews()) {
      return (
        <QdnIsolatedFrameContent
          loadedResource={loadedResource}
          accountId={accountId}
          nodeApiUrl={nodeApiUrl}
          resource={resource}
          tabId={tabId}
        />
      );
    }

    return <QdnIframeContent loadedResource={loadedResource} resource={resource} />;
  }

  if (loadedResource.viewerKind === 'image') {
    return (
      <div className="qdn-viewer__image-stage">
        <img
          className="qdn-viewer__image"
          alt={loadedResource.properties?.filename || resource.displayUrl}
          src={loadedResource.renderUrl}
        />
      </div>
    );
  }

  if (loadedResource.viewerKind === 'text') {
    return <QdnTextContent loadedResource={loadedResource} resource={resource} />;
  }

  if (loadedResource.viewerKind === 'audio' || loadedResource.viewerKind === 'video') {
    return <QdnMediaContent loadedResource={loadedResource} resource={resource} />;
  }

  if (loadedResource.viewerKind === 'download') {
    return (
      <QdnDetailsContent
        loadedResource={loadedResource}
        message={isNativePlatform() ? 'This resource is ready to open.' : 'This resource is ready to download.'}
        resource={resource}
      />
    );
  }

  return (
    <QdnDetailsContent
      loadedResource={loadedResource}
      message={`${resource.service} resources do not have a dedicated viewer yet.`}
      resource={resource}
    />
  );
}

export function QdnViewer({ accountId, nodeApiUrl, resource, tabId }: QdnViewerProps) {
  const [retryToken, setRetryToken] = useState(0);
  const state = useQdnResourceLoader(resource, nodeApiUrl, retryToken);
  const progress = state.phase === 'ready' ? 100 : getStatusProgress(state.status);
  const progressText = getProgressText(state.status);
  const statusLabel = state.phase === 'ready' ? 'Ready' : formatQdnStatus(state.status);

  return (
    <section className="qdn-viewer" aria-label="QDN viewer">
      <div className="qdn-viewer__status" aria-live="polite">
        <div className="qdn-viewer__status-text">
          <span className="qdn-viewer__status-label">{statusLabel}</span>
          <span className="qdn-viewer__resource">{resource.displayUrl}</span>
        </div>
        {typeof progress === 'number' && state.phase !== 'ready' ? (
          <div className="qdn-viewer__progress" aria-label="QDN loading progress">
            <div
              className="qdn-viewer__progress-bar"
              role="progressbar"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.round(progress)}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
            {progressText ? <span className="qdn-viewer__progress-text">{progressText}</span> : null}
          </div>
        ) : null}
      </div>

      {state.phase === 'ready' ? (
        <QdnReadyContent
          loadedResource={state.loadedResource}
          accountId={accountId}
          nodeApiUrl={nodeApiUrl}
          resource={resource}
          tabId={tabId}
        />
      ) : (
        <div className={`qdn-viewer__empty qdn-viewer__empty--${state.phase}`}>
          <p className="qdn-viewer__message">{state.message}</p>
          {state.phase === 'error' ? (
            <button
              className="button qdn-viewer__retry"
              type="button"
              onClick={() => setRetryToken((currentToken) => currentToken + 1)}
            >
              <RefreshCw aria-hidden="true" size={18} strokeWidth={2} />
              Retry
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
