import { ChevronDown, Copy, Download, ExternalLink, RefreshCw, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { t } from './i18n';
import type {
  QdnDisplaySettings,
  QdnResource,
  QdnResourceMetadata,
  QdnResourceProperties,
  QdnResourceStatus,
  QdnViewerKind,
} from './qdn';
import {
  buildQdnDownloadUrl,
  buildQdnDisplayUrl,
  buildQdnMetadataUrl,
  buildQdnRenderUrl,
  buildQdnResourcePropertiesUrl,
  buildQdnStatusUrl,
  formatByteSize,
  formatQdnStatus,
  getLoadedViewerKind,
  getQdnResourceKey,
  isGifFilename,
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
  account: QortiumAccountSummary | null;
  displaySettings: QdnDisplaySettings;
  nodeApiUrl: string;
  onOpenMediaPlayer?: (request: QortiumQdnMediaPlayerRequest) => void;
  onOpenNewTab?: (address: string) => void;
  onOpenInCurrentTab?: (address: string) => void;
  resource: QdnResource;
  suspended?: boolean;
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

type GifRepositoryState =
  | {
      phase: 'loading';
    }
  | {
      files: string[];
      phase: 'ready';
    }
  | {
      message: string;
      phase: 'error';
    };

type ElementSize = {
  height: number;
  width: number;
};

type NaturalImageSize = {
  height: number;
  width: number;
};

type QdnAppBridgeMessage = {
  bridgeToken?: unknown;
  request?: unknown;
  requestId?: unknown;
  type?: unknown;
};

export function canUseIsolatedQdnViews() {
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

function getQdnDisplaySettingMessages(displaySettings: QdnDisplaySettings) {
  return [
    {
      action: 'THEME_CHANGED',
      requestedHandler: 'UI',
      theme: displaySettings.theme,
    },
    {
      action: 'LANGUAGE_CHANGED',
      language: displaySettings.language,
      requestedHandler: 'UI',
    },
    {
      action: 'TEXT_SIZE_CHANGED',
      requestedHandler: 'UI',
      textSize: displaySettings.textSize,
    },
    {
      action: 'ACCENT_CHANGED',
      requestedHandler: 'UI',
      accent: displaySettings.accent,
    },
  ];
}

function getQdnSelectedAccountChangedMessage() {
  return {
    action: 'SELECTED_ACCOUNT_CHANGED',
    requestedHandler: 'ACCOUNT',
    type: 'qortium:selected-account-changed',
  };
}

function getPostMessageTargetOrigin(url: string) {
  try {
    const origin = new URL(url).origin;

    return origin === 'null' ? '*' : origin;
  } catch {
    return '*';
  }
}

function postQdnSelectedAccountChanged(frameWindow: Window | null | undefined, renderUrl: string) {
  if (!frameWindow) {
    return;
  }

  frameWindow.postMessage(getQdnSelectedAccountChangedMessage(), getPostMessageTargetOrigin(renderUrl));
}

function postQdnDisplaySettings(
  frameWindow: Window | null | undefined,
  renderUrl: string,
  displaySettings: QdnDisplaySettings,
) {
  if (!frameWindow) {
    return;
  }

  const targetOrigin = getPostMessageTargetOrigin(renderUrl);

  for (const message of getQdnDisplaySettingMessages(displaySettings)) {
    frameWindow.postMessage(message, targetOrigin);
  }
}

function formatError(error: unknown) {
  if (!(error instanceof Error)) {
    return t('viewer.loadFailed');
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

export function getMediaErrorMessage(element: HTMLAudioElement | HTMLVideoElement) {
  switch (element.error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return t('viewer.media.aborted');
    case MediaError.MEDIA_ERR_NETWORK:
      return t('viewer.media.network');
    case MediaError.MEDIA_ERR_DECODE:
      return t('viewer.media.decode');
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return t('viewer.media.unsupported');
    default:
      return t('viewer.media.generic');
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
    const local = status.localChunkCount.toLocaleString();
    const total = status.totalChunkCount.toLocaleString();

    return typeof progress === 'number'
      ? t('viewer.progressChunksWithPercent', { local, total, percent: progress.toFixed(0) })
      : t('viewer.progressChunks', { local, total });
  }

  return typeof progress === 'number' ? t('common.percentValue', { percent: progress.toFixed(0) }) : '';
}

function formatTextPreviewLimit() {
  return formatByteSize(TEXT_PREVIEW_MAX_BYTES) || t('common.unit.mb', { value: 1 });
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
    return t('viewer.codeLabel');
  }

  if (mimeType) {
    return mimeType.split(';')[0] || t('common.formatText');
  }

  return t('common.formatText');
}

function isArchiveResourceProperties(properties: QdnResourceProperties | undefined) {
  const filename = properties?.filename ?? '';
  const mimeType = properties?.mimeType ?? '';

  return /\.zip$/i.test(filename) || /\bzip\b/i.test(mimeType);
}

function shouldUseArchiveRenderUrl(
  resource: QdnResource,
  properties: QdnResourceProperties | undefined,
  viewerKind: QdnViewerKind,
) {
  return (
    !isNativePlatform() &&
    viewerKind === 'iframe' &&
    isArchiveResourceProperties(properties) &&
    (resource.service === 'APP' || resource.service === 'WEBSITE')
  );
}

async function prepareArchiveRenderUrl(resource: QdnResource) {
  const result = await window.qortiumHome.qdn.prepareArchiveRender({
    service: resource.service,
    name: resource.name,
    identifier: resource.identifier,
    path: resource.path,
  });

  return result.renderUrl;
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
    throw new Error(text || t('viewer.statusRequestFailed', { status: response.status }));
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

function isQdnResourceMetadata(value: unknown): value is QdnResourceMetadata {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.description === undefined || typeof value.description === 'string') &&
    (value.files === undefined ||
      (Array.isArray(value.files) && value.files.every((file) => typeof file === 'string'))) &&
    (value.mimeType === undefined || typeof value.mimeType === 'string') &&
    (value.title === undefined || typeof value.title === 'string')
  );
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

async function loadResourceMetadata(resource: QdnResource, nodeApiUrl: string, signal: AbortSignal) {
  const response = await fetch(buildQdnMetadataUrl(resource, nodeApiUrl), {
    signal,
  });

  if (response.status === 404) {
    return undefined;
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `QDN metadata request failed with HTTP ${response.status}.`);
  }

  const data: unknown = JSON.parse(text);

  if (!isQdnResourceMetadata(data)) {
    throw new Error('QDN metadata response did not match the expected shape.');
  }

  return data;
}

async function verifyRenderUrl(renderUrl: string, signal: AbortSignal) {
  const response = await fetch(renderUrl, { signal });

  if (response.status === 404) {
    throw new Error(t('viewer.fileNotFound'));
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || t('viewer.renderRequestFailed', { status: response.status }));
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
    throw new Error(t('viewer.fileNotFound'));
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || t('viewer.renderRequestFailed', { status: response.status }));
  }

  const responseContentType = response.headers.get('content-type') ?? '';
  const contentType = getBlobContentType(viewerKind, mimeType, responseContentType);
  const blob = await response.blob();
  const typedBlob = blob.type === contentType ? blob : blob.slice(0, blob.size, contentType);

  return URL.createObjectURL(typedBlob);
}

function useQdnResourceLoader(
  resource: QdnResource,
  nodeApiUrl: string,
  retryToken: number,
  displaySettings: QdnDisplaySettings,
) {
  const [state, setState] = useState<QdnViewerState>({
    phase: 'loading',
    message: t('viewer.checkingResource'),
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
      const properties = await loadResourceProperties(resource, nodeApiUrl, abortController.signal);
      const viewerKind = getLoadedViewerKind(resource, properties);
      const directRenderUrl = buildQdnRenderUrl(resource, nodeApiUrl, displaySettings);
      const useArchiveRenderUrl = shouldUseArchiveRenderUrl(resource, properties, viewerKind);
      const useBlobRenderUrl = shouldUseBlobRenderUrl(viewerKind);
      let renderUrl = directRenderUrl;

      if (useArchiveRenderUrl) {
        renderUrl = await prepareArchiveRenderUrl(resource);
      } else if (viewerKind === 'iframe' || (viewerKind === 'image' && !useBlobRenderUrl)) {
        await verifyRenderUrl(directRenderUrl, abortController.signal);
      }

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
        message: t('viewer.loadingResource'),
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
    // Display setting changes are sent to active apps without reloading them.
    // The latest settings are still used when the resource is loaded or manually reloaded.
  }, [nodeApiUrl, resource, resourceKey, retryToken]);

  return state;
}

function CopyButton({
  className,
  compact,
  disabled,
  label,
  value,
}: {
  className?: string;
  compact?: boolean;
  disabled?: boolean;
  label: string;
  value: string;
}) {
  const [copyState, setCopyState] = useState<'copied' | 'error' | 'idle'>('idle');
  const buttonLabel = copyState === 'copied' ? t('common.copied') : copyState === 'error' ? t('common.copyFailed') : label;

  useEffect(() => {
    if (copyState === 'idle') {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setCopyState('idle'), 1_600);

    return () => window.clearTimeout(timeoutId);
  }, [copyState]);

  return (
    <button
      className={`button button--secondary${compact ? ' button--compact' : ''}${className ? ` ${className}` : ''}`}
      type="button"
      disabled={disabled}
      title={compact ? label : undefined}
      aria-label={compact ? label : undefined}
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
      <span className="button__label">{buttonLabel}</span>
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
  compact,
  loadedResource,
  resource,
}: {
  compact?: boolean;
  loadedResource: LoadedQdnResource;
  resource: QdnResource;
}) {
  const [downloadState, setDownloadState] = useState<'error' | 'idle' | 'saved' | 'saving'>('idle');
  const opensNativeDownload = isNativePlatform();
  const actionLabel = opensNativeDownload ? t('common.open') : t('common.download');
  const buttonLabel =
    downloadState === 'saving'
      ? opensNativeDownload
        ? t('viewer.download.opening')
        : t('common.saving')
      : downloadState === 'saved'
        ? opensNativeDownload
          ? t('viewer.download.opened')
          : t('viewer.download.saved')
        : downloadState === 'error'
          ? opensNativeDownload
            ? t('viewer.download.openFailed')
            : t('viewer.download.saveFailed')
          : opensNativeDownload
            ? t('common.open')
            : t('common.download');

  useEffect(() => {
    if (downloadState !== 'saved' && downloadState !== 'error') {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setDownloadState('idle'), 1_800);

    return () => window.clearTimeout(timeoutId);
  }, [downloadState]);

  return (
    <button
      className={`button qdn-viewer__action-button${compact ? ' button--compact' : ''}`}
      type="button"
      disabled={downloadState === 'saving'}
      title={compact ? actionLabel : undefined}
      aria-label={compact ? actionLabel : undefined}
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
      <span className="button__label">{buttonLabel}</span>
    </button>
  );
}

function QdnStatusActions({
  loadedResource,
  onOpenNewTab,
  resource,
}: {
  loadedResource: LoadedQdnResource;
  onOpenNewTab?: (address: string) => void;
  resource: QdnResource;
}) {
  // APP/WEBSITE resources have no single downloadable file, so the download
  // action is hidden for them; every other resource type can be saved.
  const canDownload = loadedResource.viewerKind !== 'iframe';

  return (
    <div className="qdn-viewer__status-actions">
      <CopyButton compact label={t('viewer.copyQdnUrl')} value={resource.displayUrl} />
      {canDownload ? <QdnDownloadButton compact loadedResource={loadedResource} resource={resource} /> : null}
      {onOpenNewTab ? (
        <button
          className="button button--secondary button--compact"
          type="button"
          title={t('viewer.openInNewTab')}
          aria-label={t('viewer.openInNewTab')}
          onClick={() => onOpenNewTab(resource.displayUrl)}
        >
          <ExternalLink aria-hidden="true" size={18} strokeWidth={2} />
          <span className="button__label">{t('viewer.openInNewTab')}</span>
        </button>
      ) : null}
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
      message: t('viewer.preview.tooLargeWithSize', { size: formatByteSize(knownSize), limit: formatTextPreviewLimit() }),
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
        ? t('viewer.preview.tooLargeWithSize', {
            size: formatByteSize(result.contentLength),
            limit: formatTextPreviewLimit(),
          })
        : t('viewer.preview.tooLarge', { limit: formatTextPreviewLimit() }),
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
      ? t('viewer.preview.loading')
      : state.phase === 'ready'
        ? state.label
        : state.phase === 'too-large'
          ? t('viewer.preview.unavailable')
          : t('viewer.preview.failed');

  return (
    <div className="qdn-viewer__text">
      <div className="qdn-viewer__text-toolbar">
        <span className="qdn-viewer__type-label">{statusText}</span>
        <div className="qdn-viewer__actions">
          <CopyButton disabled={!isReady} label={t('viewer.copyText')} value={isReady ? state.content : ''} />
        </div>
      </div>

      {state.phase === 'loading' ? (
        <div className="qdn-viewer__empty qdn-viewer__empty--loading">
          <p className="qdn-viewer__message">{t('viewer.preview.loading')}</p>
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
        <dt className="detail-list__label">{t('common.service')}</dt>
        <dd className="detail-list__value">{resource.service}</dd>
      </div>
      <div className="detail-list__row">
        <dt className="detail-list__label">{t('common.name')}</dt>
        <dd className="detail-list__value">{resource.name}</dd>
      </div>
      <div className="detail-list__row">
        <dt className="detail-list__label">{t('common.identifier')}</dt>
        <dd className="detail-list__value">{resource.identifier || 'default'}</dd>
      </div>
      {resource.path ? (
        <div className="detail-list__row">
          <dt className="detail-list__label">{t('common.path')}</dt>
          <dd className="detail-list__value">{resource.path}</dd>
        </div>
      ) : null}
      <div className="detail-list__row">
        <dt className="detail-list__label">{t('common.status')}</dt>
        <dd className="detail-list__value">{formatQdnStatus(loadedResource.status)}</dd>
      </div>
      {loadedResource.properties?.filename ? (
        <div className="detail-list__row">
          <dt className="detail-list__label">{t('viewer.detail.file')}</dt>
          <dd className="detail-list__value">{loadedResource.properties.filename}</dd>
        </div>
      ) : null}
      {loadedResource.properties?.mimeType ? (
        <div className="detail-list__row">
          <dt className="detail-list__label">{t('common.type')}</dt>
          <dd className="detail-list__value">{loadedResource.properties.mimeType}</dd>
        </div>
      ) : null}
      {loadedResource.properties?.size ? (
        <div className="detail-list__row">
          <dt className="detail-list__label">{t('common.size')}</dt>
          <dd className="detail-list__value">{formatByteSize(loadedResource.properties.size)}</dd>
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
        <QdnResourceDetailList loadedResource={loadedResource} resource={resource} />
      </div>
    </div>
  );
}

function QdnImageContent({
  alt,
  renderUrl,
}: {
  alt: string;
  renderUrl: string;
}) {
  const [isActualSize, setIsActualSize] = useState(false);

  useEffect(() => {
    setIsActualSize(false);
  }, [renderUrl]);

  return (
    <div
      className={`qdn-viewer__image-stage qdn-viewer__image-stage--${
        isActualSize ? 'actual' : 'fit'
      }`}
    >
      <QdnImageButton
        alt={alt}
        className={`qdn-viewer__image-toggle qdn-viewer__image-toggle--${
          isActualSize ? 'actual' : 'fit'
        }`}
        isActualSize={isActualSize}
        pressed={isActualSize}
        src={renderUrl}
        title={isActualSize ? 'Fit image to page' : 'Show actual image size'}
        onClick={() => setIsActualSize((currentValue) => !currentValue)}
      />
    </div>
  );
}

function getElementSize(element: HTMLElement): ElementSize {
  return {
    height: Math.max(0, element.clientHeight),
    width: Math.max(0, element.clientWidth),
  };
}

function getContainedImageSize(containerSize: ElementSize, naturalSize: NaturalImageSize) {
  if (
    containerSize.height <= 0 ||
    containerSize.width <= 0 ||
    naturalSize.height <= 0 ||
    naturalSize.width <= 0
  ) {
    return undefined;
  }

  const scale = Math.min(containerSize.width / naturalSize.width, containerSize.height / naturalSize.height);

  return {
    height: `${Math.max(1, Math.floor(naturalSize.height * scale))}px`,
    width: `${Math.max(1, Math.floor(naturalSize.width * scale))}px`,
  };
}

function QdnImageButton({
  alt,
  className,
  isActualSize = false,
  onClick,
  pressed,
  src,
  title,
}: {
  alt: string;
  className: string;
  isActualSize?: boolean;
  onClick: () => void;
  pressed?: boolean;
  src: string;
  title: string;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [containerSize, setContainerSize] = useState<ElementSize>({ height: 0, width: 0 });
  const [naturalSize, setNaturalSize] = useState<NaturalImageSize | null>(null);

  useEffect(() => {
    const element = buttonRef.current;

    if (!element) {
      return;
    }

    function updateSize() {
      if (buttonRef.current) {
        setContainerSize(getElementSize(buttonRef.current));
      }
    }

    updateSize();

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(element);
    window.addEventListener('resize', updateSize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  useEffect(() => {
    setNaturalSize(null);
  }, [src]);

  const fittedSize =
    !isActualSize && naturalSize
      ? getContainedImageSize(containerSize, naturalSize)
      : undefined;

  return (
    <button
      aria-label={title}
      aria-pressed={pressed}
      className={className}
      ref={buttonRef}
      title={title}
      type="button"
      onClick={onClick}
    >
      <img
        className={`qdn-viewer__image qdn-viewer__image--${isActualSize ? 'actual' : 'fit'}`}
        alt={alt}
        src={src}
        style={fittedSize}
        onLoad={(event) => {
          setNaturalSize({
            height: event.currentTarget.naturalHeight,
            width: event.currentTarget.naturalWidth,
          });
        }}
      />
    </button>
  );
}

function isGifRepositoryFile(value: string) {
  const normalized = value.trim();

  return (
    !!normalized &&
    !normalized.includes('\\') &&
    !normalized.split('/').some((segment) => !segment) &&
    isGifFilename(normalized)
  );
}

function getSortedGifRepositoryFiles(metadata: QdnResourceMetadata | undefined) {
  return (metadata?.files ?? [])
    .filter(isGifRepositoryFile)
    .slice()
    .sort((first, second) => first.localeCompare(second, undefined, { sensitivity: 'base' }));
}

function getQdnResourceWithPath(resource: QdnResource, path: string): QdnResource {
  const nextResource = {
    service: resource.service,
    name: resource.name,
    identifier: resource.identifier,
    path,
  };

  return {
    ...nextResource,
    displayUrl: buildQdnDisplayUrl(nextResource),
  };
}

function QdnGifRepositoryContent({
  displaySettings,
  loadedResource,
  nodeApiUrl,
  onOpenNewTab,
  resource,
}: {
  displaySettings: QdnDisplaySettings;
  loadedResource: LoadedQdnResource;
  nodeApiUrl: string;
  onOpenNewTab?: (address: string) => void;
  resource: QdnResource;
}) {
  const [state, setState] = useState<GifRepositoryState>({
    phase: 'loading',
  });
  const [selectedFile, setSelectedFile] = useState('');

  useEffect(() => {
    const abortController = new AbortController();
    let isDisposed = false;

    async function loadGifList() {
      setState({
        phase: 'loading',
      });

      try {
        const metadata = await loadResourceMetadata(resource, nodeApiUrl, abortController.signal);
        const files = getSortedGifRepositoryFiles(metadata);

        if (!isDisposed) {
          setSelectedFile('');
          setState({
            files,
            phase: 'ready',
          });
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

    void loadGifList();

    return () => {
      isDisposed = true;
      abortController.abort();
    };
  }, [nodeApiUrl, resource]);

  if (state.phase === 'loading') {
    return (
      <div className="qdn-viewer__empty qdn-viewer__empty--loading">
        <p className="qdn-viewer__message">{t('viewer.loadingResource')}</p>
      </div>
    );
  }

  if (state.phase === 'error') {
    return <QdnDetailsContent loadedResource={loadedResource} message={state.message} resource={resource} />;
  }

  if (state.files.length === 0) {
    return (
      <QdnDetailsContent
        loadedResource={loadedResource}
        message={t('viewer.preview.unavailable')}
        resource={resource}
      />
    );
  }

  if (selectedFile) {
    const selectedResource = getQdnResourceWithPath(resource, selectedFile);

    return (
      <div className="qdn-viewer__gif-single">
        <QdnImageButton
          alt={selectedFile}
          className="qdn-viewer__gif-single-button"
          src={buildQdnRenderUrl(selectedResource, nodeApiUrl, displaySettings)}
          title={t('common.back')}
          onClick={() => setSelectedFile('')}
        />
      </div>
    );
  }

  return (
    <div className="qdn-viewer__gif-repository">
      <div className="qdn-viewer__gif-grid">
        {state.files.map((file) => {
          const gifResource = getQdnResourceWithPath(resource, file);

          return (
            <figure className="qdn-viewer__gif-card" key={file}>
              <button
                aria-label={t('common.openItem', { target: file })}
                className="qdn-viewer__gif-frame"
                title={t('common.openItem', { target: file })}
                type="button"
                onClick={() => setSelectedFile(file)}
              >
                <img
                  className="qdn-viewer__gif-image"
                  alt={file}
                  loading="lazy"
                  src={buildQdnRenderUrl(gifResource, nodeApiUrl, displaySettings)}
                />
              </button>
              <figcaption className="qdn-viewer__gif-caption">
                <a
                  className="qdn-viewer__gif-link"
                  href={gifResource.displayUrl}
                  onClick={(event) => {
                    event.preventDefault();
                    onOpenNewTab?.(gifResource.displayUrl);
                  }}
                >
                  {file}
                </a>
              </figcaption>
            </figure>
          );
        })}
      </div>
      <div className="qdn-viewer__details qdn-viewer__gif-details">
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

function waitForAnimationFrames(count: number) {
  return new Promise<void>((resolve) => {
    function step(remaining: number) {
      if (remaining <= 0) {
        resolve();
        return;
      }

      window.requestAnimationFrame(() => step(remaining - 1));
    }

    step(count);
  });
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

export function QdnIsolatedFrameContent({
  account,
  displaySettings,
  nodeApiUrl,
  renderUrl,
  resourceUrl,
  suspended,
  tabId,
}: {
  account: QortiumAccountSummary | null;
  displaySettings: QdnDisplaySettings;
  nodeApiUrl: string;
  renderUrl: string;
  resourceUrl: string;
  suspended: boolean;
  tabId: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastBoundsRef = useRef<QortiumQdnViewBounds | null>(null);
  const suspendedRef = useRef(suspended);
  const [viewError, setViewError] = useState('');
  const [snapshotUrl, setSnapshotUrl] = useState('');
  const accountId = account?.id ?? null;
  const isAccountUnlocked = account?.isUnlocked ?? false;

  suspendedRef.current = suspended;

  useEffect(() => {
    const qdnViews = window.qortiumHome.qdnViews;
    const container = containerRef.current;

    if (!qdnViews || !container) {
      return undefined;
    }

    const activeQdnViews = qdnViews;

    if (suspended) {
      let isSuspendDisposed = false;

      async function suspendView() {
        const snapshot = await activeQdnViews.capture(tabId).catch((error) => {
          console.warn('Unable to capture isolated QDN view snapshot.', error);
          return null;
        });

        if (isSuspendDisposed) {
          return;
        }

        // Paint the snapshot beneath the still-visible view before hiding it,
        // so the swap never exposes the empty frame behind both layers.
        if (snapshot) {
          try {
            const image = new Image();

            image.src = snapshot;
            await image.decode();
          } catch {
            // Decoding only pre-warms the paint; show the snapshot regardless.
          }

          if (isSuspendDisposed) {
            return;
          }

          setSnapshotUrl(snapshot);
          await waitForAnimationFrames(2);

          if (isSuspendDisposed) {
            return;
          }
        }

        await activeQdnViews.hide(tabId).catch((error) => {
          console.warn('Unable to suspend isolated QDN view.', error);
        });
      }

      void suspendView();

      return () => {
        isSuspendDisposed = true;
      };
    }

    const initialContainer = container;
    let isDisposed = false;
    let animationFrameId = 0;

    function syncBounds() {
      const currentContainer = containerRef.current;

      if (isDisposed || !currentContainer) {
        return;
      }

      const bounds = getElementBounds(currentContainer);

      if (areViewBoundsEqual(lastBoundsRef.current, bounds)) {
        return;
      }

      lastBoundsRef.current = bounds;
      void activeQdnViews.setBounds({ tabId, bounds }).catch((error) => {
        console.warn('Unable to resize isolated QDN view.', error);
      });
    }

    async function showView() {
      const bounds = getElementBounds(initialContainer);

      lastBoundsRef.current = bounds;

      try {
        await activeQdnViews.show({
          accountId,
          bounds,
          displaySettings,
          nodeApiUrl,
          renderUrl,
          resourceUrl,
          tabId,
        });

        if (isDisposed) {
          return;
        }

        setViewError('');

        // The live view composites above the snapshot, so give it a couple of
        // frames to appear before removing the snapshot underneath it.
        await waitForAnimationFrames(2);

        if (!isDisposed) {
          setSnapshotUrl('');
        }
      } catch (error) {
        if (!isDisposed) {
          setViewError(formatError(error));
          setSnapshotUrl('');
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

      // When this re-runs because the view is being suspended, leave the view
      // visible: the suspend branch hides it itself after capturing the
      // snapshot, and hiding here first would make that capture come up empty.
      if (!suspendedRef.current) {
        void qdnViews.hide(tabId).catch((error) => {
          console.warn('Unable to hide isolated QDN view.', error);
        });
      }
    };
  }, [accountId, renderUrl, nodeApiUrl, suspended, tabId]);

  useEffect(() => {
    const qdnViews = window.qortiumHome.qdnViews;

    if (!qdnViews || suspended) {
      return;
    }

    void qdnViews.updateAccountState({ tabId, accountId, isUnlocked: isAccountUnlocked }).catch((error) => {
      console.warn('Unable to update isolated QDN view account state.', error);
    });
  }, [accountId, isAccountUnlocked, suspended, tabId]);

  useEffect(() => {
    const qdnViews = window.qortiumHome.qdnViews;

    if (!qdnViews || suspended) {
      return;
    }

    void qdnViews.updateDisplaySettings({ tabId, displaySettings }).catch((error) => {
      console.warn('Unable to update isolated QDN view display settings.', error);
    });
  }, [displaySettings, suspended, tabId]);

  return (
    <div
      className={`qdn-viewer__isolated-frame${viewError ? ' qdn-viewer__isolated-frame--error' : ''}`}
      aria-label={resourceUrl}
      ref={containerRef}
    >
      {viewError ? (
        <p className="qdn-viewer__message qdn-viewer__message--error">{viewError}</p>
      ) : null}
      {!viewError && snapshotUrl ? (
        <img className="qdn-viewer__snapshot" src={snapshotUrl} alt="" />
      ) : null}
    </div>
  );
}

function QdnIframeContent({
  account,
  displaySettings,
  loadedResource,
  onOpenMediaPlayer,
  onOpenNewTab,
  onOpenInCurrentTab,
  resource,
}: {
  account: QortiumAccountSummary | null;
  displaySettings: QdnDisplaySettings;
  loadedResource: LoadedQdnResource;
  onOpenMediaPlayer?: (request: QortiumQdnMediaPlayerRequest) => void;
  onOpenNewTab?: (address: string) => void;
  onOpenInCurrentTab?: (address: string) => void;
  resource: QdnResource;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const onOpenNewTabRef = useRef(onOpenNewTab);
  const onOpenInCurrentTabRef = useRef(onOpenInCurrentTab);
  const onOpenMediaPlayerRef = useRef(onOpenMediaPlayer);

  onOpenNewTabRef.current = onOpenNewTab;
  onOpenInCurrentTabRef.current = onOpenInCurrentTab;
  onOpenMediaPlayerRef.current = onOpenMediaPlayer;
  const isNativeFrame = isNativePlatform();
  const bridgeToken = useMemo(
    () => (isNativeFrame ? createQdnBridgeToken() : ''),
    [isNativeFrame, loadedResource.renderUrl],
  );
  const accountId = account?.id ?? null;
  const isAccountUnlocked = account?.isUnlocked ?? false;
  const frameSrc = useMemo(
    () =>
      isNativeFrame && bridgeToken
        ? buildAndroidQdnBridgeUrl(loadedResource.renderUrl, bridgeToken)
        : loadedResource.renderUrl,
    [bridgeToken, isNativeFrame, loadedResource.renderUrl],
  );

  useEffect(() => {
    postQdnDisplaySettings(frameRef.current?.contentWindow, loadedResource.renderUrl, displaySettings);
  }, [displaySettings, loadedResource.renderUrl]);

  useEffect(() => {
    postQdnSelectedAccountChanged(frameRef.current?.contentWindow, loadedResource.renderUrl);
  }, [accountId, isAccountUnlocked, loadedResource.renderUrl]);

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
        const result = await handleQdnAppRequest(event.data.request, {
          accountId,
          displaySettings,
          onOpenMediaPlayer: (mediaRequest: QortiumQdnMediaPlayerRequest) => {
            onOpenMediaPlayerRef.current?.(mediaRequest);
          },
          onOpenNewTab: (address: string) => {
            onOpenNewTabRef.current?.(address);
          },
          onOpenInCurrentTab: (address: string) => {
            onOpenInCurrentTabRef.current?.(address);
          },
          resourceUrl: resource.displayUrl,
          sessionKey: bridgeToken,
        });

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
  }, [accountId, bridgeToken, displaySettings, isNativeFrame, loadedResource.renderUrl, resource.displayUrl]);

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
      onLoad={() => {
        postQdnDisplaySettings(frameRef.current?.contentWindow, loadedResource.renderUrl, displaySettings);
        postQdnSelectedAccountChanged(frameRef.current?.contentWindow, loadedResource.renderUrl);
      }}
    />
  );
}

function QdnReadyContent({
  loadedResource,
  account,
  displaySettings,
  nodeApiUrl,
  onOpenMediaPlayer,
  onOpenNewTab,
  onOpenInCurrentTab,
  resource,
  suspended,
  tabId,
}: {
  account: QortiumAccountSummary | null;
  displaySettings: QdnDisplaySettings;
  loadedResource: LoadedQdnResource;
  nodeApiUrl: string;
  onOpenMediaPlayer?: (request: QortiumQdnMediaPlayerRequest) => void;
  onOpenNewTab?: (address: string) => void;
  onOpenInCurrentTab?: (address: string) => void;
  resource: QdnResource;
  suspended: boolean;
  tabId: string;
}) {
  if (loadedResource.viewerKind === 'iframe') {
    if (canUseIsolatedQdnViews()) {
      return (
        <QdnIsolatedFrameContent
          account={account}
          displaySettings={displaySettings}
          nodeApiUrl={nodeApiUrl}
          renderUrl={loadedResource.renderUrl}
          resourceUrl={resource.displayUrl}
          suspended={suspended}
          tabId={tabId}
        />
      );
    }

    return (
      <QdnIframeContent
        account={account}
        displaySettings={displaySettings}
        loadedResource={loadedResource}
        onOpenMediaPlayer={onOpenMediaPlayer}
        onOpenNewTab={onOpenNewTab}
        onOpenInCurrentTab={onOpenInCurrentTab}
        resource={resource}
      />
    );
  }

  if (loadedResource.viewerKind === 'image') {
    return (
      <QdnImageContent
        alt={loadedResource.properties?.filename || resource.displayUrl}
        renderUrl={loadedResource.renderUrl}
      />
    );
  }

  if (loadedResource.viewerKind === 'text') {
    return <QdnTextContent loadedResource={loadedResource} resource={resource} />;
  }

  if (loadedResource.viewerKind === 'audio' || loadedResource.viewerKind === 'video') {
    return <QdnMediaContent loadedResource={loadedResource} resource={resource} />;
  }

  if (loadedResource.viewerKind === 'gif-repository') {
    return (
      <QdnGifRepositoryContent
        displaySettings={displaySettings}
        loadedResource={loadedResource}
        nodeApiUrl={nodeApiUrl}
        onOpenNewTab={onOpenNewTab}
        resource={resource}
      />
    );
  }

  if (loadedResource.viewerKind === 'download') {
    return (
      <QdnDetailsContent
        loadedResource={loadedResource}
        message={isNativePlatform() ? t('viewer.readyToOpen') : t('viewer.readyToDownload')}
        resource={resource}
      />
    );
  }

  return (
    <QdnDetailsContent
      loadedResource={loadedResource}
      message={t('viewer.noDedicatedViewer', { service: resource.service })}
      resource={resource}
    />
  );
}

export function QdnViewer({
  account,
  displaySettings,
  nodeApiUrl,
  onOpenMediaPlayer,
  onOpenNewTab,
  onOpenInCurrentTab,
  resource,
  suspended = false,
  tabId,
}: QdnViewerProps) {
  const [retryToken, setRetryToken] = useState(0);
  const [statusHidden, setStatusHidden] = useState(false);
  const statusRegionId = useId();
  const state = useQdnResourceLoader(resource, nodeApiUrl, retryToken, displaySettings);
  const progress = state.phase === 'ready' ? 100 : getStatusProgress(state.status);
  const progressText = getProgressText(state.status);
  const statusLabel = state.phase === 'ready' ? t('qdnStatus.ready') : formatQdnStatus(state.status);

  // Navigating to a different resource re-reveals the status bar so the new
  // URL and its actions are always visible after a load.
  useEffect(() => {
    setStatusHidden(false);
  }, [resource.displayUrl]);

  return (
    <section className="qdn-viewer" aria-label={t('viewer.ariaLabel')}>
      {statusHidden ? (
        <button
          className="qdn-viewer__status-handle"
          type="button"
          aria-expanded={false}
          title={t('viewer.showStatusBar')}
          aria-label={t('viewer.showStatusBar')}
          onClick={() => setStatusHidden(false)}
        >
          <ChevronDown aria-hidden="true" size={16} strokeWidth={2} />
        </button>
      ) : (
        <div className="qdn-viewer__status" id={statusRegionId} aria-live="polite">
          <div className="qdn-viewer__status-main">
            <div className="qdn-viewer__status-text">
              <span className="qdn-viewer__status-label">{statusLabel}</span>
              <span className="qdn-viewer__resource">{resource.displayUrl}</span>
            </div>
            {state.phase === 'ready' ? (
              <div className="qdn-viewer__status-controls">
                <QdnStatusActions
                  loadedResource={state.loadedResource}
                  onOpenNewTab={onOpenNewTab}
                  resource={resource}
                />
                <button
                  className="icon-button qdn-viewer__status-close"
                  type="button"
                  aria-expanded
                  aria-controls={statusRegionId}
                  title={t('viewer.hideStatusBar')}
                  aria-label={t('viewer.hideStatusBar')}
                  onClick={() => setStatusHidden(true)}
                >
                  <X aria-hidden="true" size={18} strokeWidth={2} />
                </button>
              </div>
            ) : null}
          </div>
          {typeof progress === 'number' && state.phase !== 'ready' ? (
            <div className="qdn-viewer__progress" aria-label={t('viewer.progressAriaLabel')}>
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
      )}

      {state.phase === 'ready' ? (
        <QdnReadyContent
          loadedResource={state.loadedResource}
          account={account}
          displaySettings={displaySettings}
          nodeApiUrl={nodeApiUrl}
          onOpenMediaPlayer={onOpenMediaPlayer}
          onOpenNewTab={onOpenNewTab}
          onOpenInCurrentTab={onOpenInCurrentTab}
          resource={resource}
          suspended={suspended}
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
              {t('common.retry')}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
