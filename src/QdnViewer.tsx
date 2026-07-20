import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ClipboardCopy, Copy, Download, ExternalLink, File as FileIcon, FolderOpen, Image as ImageIcon, LoaderCircle, Maximize2, Minimize2, RefreshCw, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactEventHandler,
  type ReactNode,
} from 'react';
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
  buildQdnDisplayUrl,
  buildQdnMetadataUrl,
  buildQdnRenderUrl,
  formatByteSize,
  formatQdnStatus,
  getLoadedViewerKind,
  getQdnResourceKey,
  getQdnViewerKind,
  isGalleryImageFilename,
  isRemoteAuthorizationBlockedMessage,
  isTerminalQdnStatus,
} from './qdn';
import { getOpenAppTargetMessage, type QdnAppTargetQuery } from './qdn-app-target';
import type { QdnAppNavigationSnapshot } from './qdn-app-history';
import { appendQdnFragment } from './qdn-fragment';
import { normalizeQdnBridgeNavigationSnapshot } from './qdn-navigation-bridge';
import { marked } from 'marked';
import { compareAppPlatformVersions, getPlatformVersion } from '../electron/app-versioning';
import {
  fetchNativeHttpBlobUrl,
  getQortiumHomeHostInfo,
  handleQdnAppRequest,
  isNativePlatform,
  saveBytesToFile,
} from './platform';
import { ArchiveViewer } from './ArchiveViewer';
import type { HomeSettings } from '../electron/home-settings-bridge';
import type {
  BookmarkManagerMutationRequest,
  BookmarkManagerMutationResult,
  BookmarkManagerSnapshot,
} from '../electron/bookmark-manager-contract';
import {
  QDN_MANAGER_EVENT_KINDS,
  QDN_MANAGER_MESSAGE_TYPES,
  getQdnManagerRevisionEventDetail,
  type QdnManagerRevisions,
} from '../electron/qdn-manager-events';
import { CoreOfflineNotice, isNodeUnavailableMessage } from './CoreOfflineNotice';
import type { CoreManagerState } from './coreManagerState';
import { DocumentViewer, detectDocumentFormat } from './DocumentViewer';
import { FileTree, type FileTreeEntry } from './FileTree';
import { detectContentKind, sniffMagicBytes } from './qdnContentType';
import {
  getAdjacentGalleryFile,
  getGallerySwipeDirection,
  type GalleryNavigationDirection,
} from './qdnGalleryNavigation';
import { getQdnGalleryImageSource } from './qdnGalleryImage';
import {
  isQdnRequestContextCurrent,
  resolveQdnRequestContextActive,
} from './qdnRequestContext';
import { useQdnImageResource } from './useQdnImageResource';

const STATUS_POLL_INTERVAL_MS = 5_000;
const TEXT_PREVIEW_MAX_BYTES = 1_048_576;
const QDN_APP_MANIFEST_MAX_BYTES = 16 * 1024;

type LoadedQdnResource = {
  // The node the resource was loaded from (renderUrl's origin). Kept alongside
  // renderUrl so isolated-view show requests always send a matching pair even
  // after the app-wide selected node has moved on (public-network swaps).
  // Optional only for synthetic entries (archive entry viewer) that never
  // reach the isolated iframe branch.
  nodeApiUrl?: string;
  properties?: QdnResourceProperties;
  renderUrl: string;
  resource?: QdnResource;
  status: QdnResourceStatus;
  viewerKind: QdnViewerKind;
};

// Lets the active content component refine the top-bar actions for what is
// actually on screen (e.g. the selected image inside a GIF repository, or the
// loaded JSON text), without each viewer owning its own copy/download buttons.
type ViewerActionContext = {
  copyText?: string;
  isImage?: boolean;
  isMultiFile?: boolean;
  properties?: QdnResourceProperties;
  resource?: QdnResource;
};

export type SetViewerActionContext = (context: ViewerActionContext) => void;

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

type QdnFrameDisplaySettings = QdnDisplaySettings & {
  appNotifications?: boolean;
  appZoom?: number;
};

type QdnViewerProps = {
  account: QortiumAccountSummary | null;
  appTarget?: QdnAppTargetQuery | null;
  // Core-offline recovery context; omitted by embedded uses (media-player
  // dialog), which then keep the generic error state.
  coreManager?: CoreManagerState;
  displaySettings: QdnFrameDisplaySettings;
  nodeApiUrl: string;
  nodeEpoch?: number;
  nodeMode?: QortiumNodeSettingsMode;
  onAppTargetDelivered?: (target: QdnAppTargetQuery) => void;
  onAppNavigationChange?: (snapshot: QdnAppNavigationSnapshot) => void;
  onAppNavigationControllerChange?: (controller: QdnAppNavigationController | null) => void;
  onAppTitleChange?: (title: string | null) => void;
  onOpenDocumentViewer?: (request: QortiumQdnDocumentViewerRequest) => void;
  onOpenMediaPlayer?: (request: QortiumQdnMediaPlayerRequest) => void;
  onOpenNewTab?: (address: string) => void;
  onOpenInCurrentTab?: (address: string) => void;
  onBookmarksOpen?: (address: string, accountId: string | null) => void;
  getHomeSettings?: () => HomeSettings;
  getBookmarkManagerSnapshot?: () => BookmarkManagerSnapshot;
  managerRevisions?: QdnManagerRevisions;
  onBookmarkManagerMutation?: (
    request: BookmarkManagerMutationRequest,
  ) => Promise<BookmarkManagerMutationResult> | BookmarkManagerMutationResult;
  onHomeSettingsPatch?: (patch: Partial<HomeSettings>) => Promise<HomeSettings> | HomeSettings;
  resource: QdnResource;
  requestContextActive?: boolean;
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

type GalleryState =
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

type QdnAppTitleMessage = {
  bridgeToken?: unknown;
  title?: unknown;
  type?: unknown;
};

// Posted by the Android-injected bridge script whenever the app page's
// document.title changes; the desktop isolated views get the same signal from
// Electron's page-title-updated instead.
function isQdnAppTitleMessage(value: unknown): value is QdnAppTitleMessage {
  return isRecord(value) && value.type === 'qortium:qdn-title';
}

type QdnAppNavigationMessage = {
  activeIndex?: unknown;
  bridgeToken?: unknown;
  entries?: unknown;
  type?: unknown;
};

function isQdnAppNavigationMessage(value: unknown): value is QdnAppNavigationMessage & QdnAppNavigationSnapshot {
  return isRecord(value) &&
    value.type === 'qortium:qdn-navigation' &&
    Number.isInteger(value.activeIndex) &&
    Array.isArray(value.entries) &&
    value.entries.length > 0 &&
    value.entries.length <= 200 &&
    value.entries.every((entry) =>
      isRecord(entry) && Number.isInteger(entry.index) && typeof entry.url === 'string' && entry.url.length <= 2_000,
    );
}

export type QdnAppNavigationController = {
  goToIndex: (index: number) => Promise<boolean>;
};

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

export type QdnBridgeFrameContentProps = {
  account: QortiumAccountSummary | null;
  appTarget?: QdnAppTargetQuery | null;
  displaySettings: QdnFrameDisplaySettings;
  getHomeSettings?: () => HomeSettings;
  getBookmarkManagerSnapshot?: () => BookmarkManagerSnapshot;
  managerRevisions?: QdnManagerRevisions;
  onBookmarkManagerMutation?: (
    request: BookmarkManagerMutationRequest,
  ) => Promise<BookmarkManagerMutationResult> | BookmarkManagerMutationResult;
  onHomeSettingsPatch?: (patch: Partial<HomeSettings>) => Promise<HomeSettings> | HomeSettings;
  onAppTargetDelivered?: (target: QdnAppTargetQuery) => void;
  onAppNavigationChange?: (snapshot: QdnAppNavigationSnapshot) => void;
  onAppNavigationControllerChange?: (controller: QdnAppNavigationController | null) => void;
  onAppTitleChange?: (title: string | null) => void;
  onOpenDocumentViewer?: (request: QortiumQdnDocumentViewerRequest) => void;
  onOpenMediaPlayer?: (request: QortiumQdnMediaPlayerRequest) => void;
  onOpenNewTab?: (address: string) => void;
  onOpenInCurrentTab?: (address: string) => void;
  onBookmarksOpen?: (address: string, accountId: string | null) => void;
  renderUrl: string;
  requestContextActive?: boolean;
  resourceUrl: string;
  suspended?: boolean;
  title?: string;
};

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
    {
      action: 'UI_STYLE_CHANGED',
      requestedHandler: 'UI',
      uiStyle: displaySettings.ui,
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

function postQdnHomeSettingsChanged(
  frameWindow: Window | null | undefined,
  renderUrl: string,
  displaySettings: QdnFrameDisplaySettings,
) {
  if (!frameWindow) return;
  frameWindow.postMessage({
    type: 'qortium:home-settings-changed',
    detail: {
      ...displaySettings,
      appNotifications: displaySettings.appNotifications,
      appZoom: displaySettings.appZoom,
      lang: displaySettings.language,
      uiStyle: displaySettings.ui,
    },
  }, getPostMessageTargetOrigin(renderUrl));
}

function postQdnManagerRevisionChanged(
  frameWindow: Window | null | undefined,
  renderUrl: string,
  managerRevisions: QdnManagerRevisions | undefined,
) {
  if (!frameWindow || !managerRevisions) return;
  const targetOrigin = getPostMessageTargetOrigin(renderUrl);

  for (const kind of QDN_MANAGER_EVENT_KINDS) {
    frameWindow.postMessage({
      type: QDN_MANAGER_MESSAGE_TYPES[kind],
      detail: getQdnManagerRevisionEventDetail(managerRevisions[kind]),
    }, targetOrigin);
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

  return /\.(?:zip|rar)$/i.test(filename) || /\b(?:zip|rar)\b/i.test(mimeType);
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

  return appendQdnFragment(result.renderUrl, resource.fragment);
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

function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: contentType || 'application/octet-stream' });
}

// The clipboard image API only reliably accepts PNG, so non-PNG (and animated)
// images are flattened to a PNG of the first frame via a canvas.
async function blobToPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') {
    return blob;
  }

  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = new Image();

    image.src = objectUrl;
    await image.decode();

    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;

    if (!width || !height) {
      // e.g. an SVG with no intrinsic size — there is nothing to rasterize, so
      // fail clearly rather than copying a blank image to the clipboard.
      throw new Error('Image has no intrinsic size to copy.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Canvas 2D context was not available.');
    }

    context.drawImage(image, 0, 0);

    const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));

    if (!pngBlob) {
      throw new Error('Image could not be converted to PNG.');
    }

    return pngBlob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Copies an image resource to the clipboard. Bytes are fetched through the
// Home bridge (not a direct fetch) so the node API key and CORS are handled in
// the trusted layer and the canvas is never tainted.
async function copyImageResourceToClipboard(resource: QdnResource) {
  const result = await window.qortiumHome.qdn.fetchResourceData({
    service: resource.service,
    name: resource.name,
    identifier: resource.identifier,
    path: resource.path,
  });

  if (result.tooLarge || !result.data) {
    throw new Error('Image is too large to copy to the clipboard.');
  }

  const pngBlob = await blobToPngBlob(base64ToBlob(result.data, result.contentType));

  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
}

function getQdnBridgeResource(resource: QdnResource) {
  return {
    service: resource.service,
    name: resource.name,
    identifier: resource.identifier,
    path: resource.path,
  };
}

function getQdnAppManifestVersion(value: unknown) {
  // The bridge returns parsed JSON when the node labels the manifest as JSON,
  // and the raw text otherwise — accept both.
  let manifest = value;

  if (typeof manifest === 'string') {
    try {
      manifest = JSON.parse(manifest);
    } catch {
      return null;
    }
  }

  if (!isRecord(manifest) || typeof manifest.version !== 'string') {
    return null;
  }

  const version = manifest.version.trim();

  if (version.length > 32) {
    return null;
  }

  return getPlatformVersion(version) ? version : null;
}

function useQdnAppManifestVersion(resource: QdnResource, shouldLoad: boolean) {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const resourceKey = `${resource.service}:${resource.name}:${resource.identifier ?? 'default'}`;
  const manifestResource = useMemo(
    () => ({ ...resource, path: 'qortium-app.json' }),
    [resource.identifier, resource.name, resource.service],
  );

  useEffect(() => {
    const abortController = new AbortController();

    setAppVersion(null);

    if (!shouldLoad || (resource.service !== 'APP' && resource.service !== 'WEBSITE')) {
      return () => abortController.abort();
    }

    async function loadManifest() {
      try {
        const data = await handleQdnAppRequest({
          action: 'FETCH_QDN_RESOURCE',
          ...getQdnBridgeResource(manifestResource),
          maxBytes: QDN_APP_MANIFEST_MAX_BYTES,
        });

        if (!abortController.signal.aborted) {
          setAppVersion(getQdnAppManifestVersion(data));
        }
      } catch {
        // A missing or malformed manifest simply leaves the resource unversioned.
      }
    }

    void loadManifest();

    return () => abortController.abort();
  }, [manifestResource, resourceKey, shouldLoad]);

  return appVersion;
}

function QdnAppCompatibilityBadge({ appVersion }: { appVersion: string | null }) {
  if (!appVersion) {
    return null;
  }

  const hostInfo = getQortiumHomeHostInfo();
  const comparison = compareAppPlatformVersions(appVersion, hostInfo.hostVersion);
  const appPlatformVersion = getPlatformVersion(appVersion);

  if (comparison === null || !appPlatformVersion) {
    return null;
  }

  const compatible = comparison <= 0;
  const label = compatible
    ? t('viewer.appVersion.compatible', { version: appVersion })
    : t('viewer.appVersion.needsHome', { version: appPlatformVersion });

  return (
    <span
      className={`qdn-viewer__app-version-badge qdn-viewer__app-version-badge--${
        compatible ? 'compatible' : 'needs-home'
      }`}
      title={label}
    >
      {label}
    </span>
  );
}

async function loadResourceStatus(resource: QdnResource, build: boolean, signal: AbortSignal) {
  throwIfAborted(signal);
  const data = await handleQdnAppRequest({
    action: 'GET_QDN_RESOURCE_STATUS',
    ...getQdnBridgeResource(resource),
    build,
  });
  throwIfAborted(signal);

  return data as QdnResourceStatus;
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

function isQdnResourceMetadata(value: unknown): value is QdnResourceMetadata {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.description === undefined || typeof value.description === 'string') &&
    (value.entryPoint === undefined || typeof value.entryPoint === 'string') &&
    (value.files === undefined ||
      (Array.isArray(value.files) && value.files.every((file) => typeof file === 'string'))) &&
    (value.mimeType === undefined || typeof value.mimeType === 'string') &&
    (value.title === undefined || typeof value.title === 'string')
  );
}

async function loadResourceProperties(resource: QdnResource, signal: AbortSignal) {
  try {
    throwIfAborted(signal);
    const data = await handleQdnAppRequest({
      action: 'GET_QDN_RESOURCE_PROPERTIES',
      ...getQdnBridgeResource(resource),
    });
    throwIfAborted(signal);

    if (!isQdnResourceProperties(data)) {
      throw new Error('QDN properties response did not match the expected shape.');
    }

    return data;
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
    return responseContentType && responseContentType !== 'application/octet-stream' ? responseContentType : '';
  }

  return mimeType || responseContentType || 'application/octet-stream';
}

function isSafeMetadataFilePath(value: string) {
  const normalized = value.trim();

  return !!normalized && !normalized.includes('\\') && !normalized.split('/').some((segment) => !segment);
}

function getPreferredMediaFile(metadata: QdnResourceMetadata | undefined, viewerKind: QdnViewerKind) {
  if (viewerKind !== 'audio' && viewerKind !== 'video') {
    return '';
  }

  const candidates = [
    ...(metadata?.entryPoint ? [metadata.entryPoint] : []),
    ...(metadata?.files ?? []),
  ];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const file = candidate.trim();
    if (!isSafeMetadataFilePath(file) || seen.has(file)) {
      continue;
    }

    seen.add(file);

    if (detectContentKind(file) === viewerKind) {
      return file;
    }
  }

  return '';
}

// When extension + mimeType leave a resource classified as a bare download,
// peek at the leading bytes to recover a renderable kind (an image/PDF/audio file
// published with no extension and an octet-stream mimeType). Reads only the first
// response chunk and aborts, so it costs ~nothing. Desktop only — CapacitorHttp on
// Android does not expose a streaming body to read a prefix from.
async function sniffRenderUrlKind(
  renderUrl: string,
  signal: AbortSignal,
): Promise<QdnViewerKind | null> {
  if (isNativePlatform()) {
    return null;
  }

  try {
    const response = await fetch(renderUrl, { signal });

    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return null;
    }

    const reader = response.body.getReader();
    const { value } = await reader.read();
    await reader.cancel();

    return value && value.length > 0 ? sniffMagicBytes(value) : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    return null;
  }
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

  // The repository browser navigates between files under one resource by changing
  // only the path. Keying the loader on the repo identity (ignoring the path)
  // keeps the view mounted during file navigation instead of reloading — the live
  // `resource` prop still flows to the content, so the selected file updates. For
  // every other service the key is the full resource key (path-sensitive).
  const reloadKey = useMemo(
    () =>
      getQdnViewerKind(resource.service) === 'repository'
        ? `${resource.service}:${resource.name}:${resource.identifier ?? 'default'}`
        : resourceKey,
    [resource.service, resource.name, resource.identifier, resourceKey],
  );

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
        throwIfAborted(abortController.signal);
        await handleQdnAppRequest({
          action: 'FETCH_QDN_RESOURCE',
          ...getQdnBridgeResource(resource),
          maxBytes: 1,
        });
        throwIfAborted(abortController.signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
      }
    }

    async function setReadyState(status: QdnResourceStatus) {
      let activeResource = resource;
      let properties = await loadResourceProperties(activeResource, abortController.signal);
      let viewerKind = getLoadedViewerKind(activeResource, properties);
      let directRenderUrl = buildQdnRenderUrl(activeResource, nodeApiUrl, displaySettings);

      if ((viewerKind === 'audio' || viewerKind === 'video') && !activeResource.path) {
        const metadata = await loadResourceMetadata(activeResource, nodeApiUrl, abortController.signal);
        const mediaFile = getPreferredMediaFile(metadata, viewerKind);

        if (mediaFile) {
          activeResource = getQdnResourceWithPath(activeResource, mediaFile);
          const mediaProperties = await loadResourceProperties(activeResource, abortController.signal);
          properties = {
            ...mediaProperties,
            filename: mediaProperties?.filename || pathBasename(mediaFile),
          };
          viewerKind = getLoadedViewerKind(activeResource, properties);
          directRenderUrl = buildQdnRenderUrl(activeResource, nodeApiUrl, displaySettings);
        }
      }

      // Inconclusive descriptive signals (no extension, octet-stream mime) leave a
      // single-file resource as a bare download — try recovering a renderable kind
      // from its magic bytes. FILES is multi-file, so it is excluded.
      if ((viewerKind === 'download' || viewerKind === 'unsupported') && activeResource.service !== 'FILES') {
        const sniffed = await sniffRenderUrlKind(directRenderUrl, abortController.signal);
        if (sniffed) {
          viewerKind = sniffed;
        }
      }
      const useArchiveRenderUrl = shouldUseArchiveRenderUrl(activeResource, properties, viewerKind);
      const useBlobRenderUrl = shouldUseBlobRenderUrl(viewerKind);
      let renderUrl = directRenderUrl;

      if (useArchiveRenderUrl) {
        renderUrl = await prepareArchiveRenderUrl(activeResource);
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
          nodeApiUrl,
          properties,
          renderUrl,
          resource: activeResource,
          status,
          viewerKind,
        },
      });
    }

    async function pollStatus(build: boolean) {
      try {
        const status = await loadResourceStatus(resource, build, abortController.signal);

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
    // `resource`/`resourceKey` are intentionally omitted: `reloadKey` already
    // captures every change that must trigger a reload, while collapsing path-only
    // repository navigation into a single key so the view does not flash/reload.
    // `nodeApiUrl` is likewise omitted: a public-network node swap must not
    // reload an open app/page (users lose their place in Chat etc.). The node
    // is captured per load; runtime qdnRequest/API calls already re-resolve the
    // node per request in the main process, and a reload/retry (retryToken,
    // reloadKey, or the tab reload remount) picks up the latest node.
  }, [reloadKey, retryToken]);

  return state;
}

function CopyButton({
  className,
  compact,
  disabled,
  label,
  textVariant,
  value,
}: {
  className?: string;
  compact?: boolean;
  disabled?: boolean;
  label: string;
  textVariant?: boolean;
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
      {textVariant ? (
        <ClipboardCopy aria-hidden="true" size={18} strokeWidth={2} />
      ) : (
        <Copy aria-hidden="true" size={18} strokeWidth={2} />
      )}
      <span className="button__label">{buttonLabel}</span>
    </button>
  );
}

// A copyable image resource → clipboard, with the same transient feedback as CopyButton.
function CopyImageButton({ compact, resource }: { compact?: boolean; resource: QdnResource }) {
  const [copyState, setCopyState] = useState<'copied' | 'copying' | 'error' | 'idle'>('idle');
  const label = t('viewer.copyImage');
  const buttonLabel =
    copyState === 'copied' ? t('common.copied') : copyState === 'error' ? t('common.copyFailed') : label;

  useEffect(() => {
    if (copyState !== 'copied' && copyState !== 'error') {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setCopyState('idle'), 1_600);

    return () => window.clearTimeout(timeoutId);
  }, [copyState]);

  return (
    <button
      className={`button button--secondary${compact ? ' button--compact' : ''}`}
      type="button"
      disabled={copyState === 'copying'}
      title={compact ? label : undefined}
      aria-label={compact ? label : undefined}
      onClick={async () => {
        setCopyState('copying');

        try {
          await copyImageResourceToClipboard(resource);
          setCopyState('copied');
        } catch {
          setCopyState('error');
        }
      }}
    >
      <ImageIcon aria-hidden="true" size={18} strokeWidth={2} />
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

// Multi-file resources (APP/WEBSITE, a whole GIF repository or image gallery) are
// served by the node as a single zip archive, so they save with a .zip name.
function getMultiFileDownloadName(resource: QdnResource) {
  const base = resource.name || resource.service || 'qdn-resource';

  return `${base}.zip`;
}

function QdnDownloadButton({
  compact,
  multiFile,
  properties,
  resource,
}: {
  compact?: boolean;
  multiFile?: boolean;
  properties?: QdnResourceProperties;
  resource: QdnResource;
}) {
  const [downloadState, setDownloadState] = useState<'error' | 'idle' | 'saved' | 'saving'>('idle');
  // After a successful download, keep a persistent affordance (cleared only when
  // the view reloads): desktop reveals the saved file in the file manager,
  // Android opens it. This stops the same file from being re-downloaded by
  // accident; reload the tab to download again.
  const [savedAffordance, setSavedAffordance] = useState<
    { mode: 'open' | 'reveal'; label: string; path: string } | null
  >(null);
  // Multi-file resources save as a single archive, so the action makes the
  // .zip outcome explicit (e.g. "Download (zip)").
  const suggestedFilename = multiFile
    ? getMultiFileDownloadName(resource)
    : getSuggestedResourceFilename(resource, properties);
  const actionLabel = `${t('common.download')}${multiFile ? ' (zip)' : ''}`;
  const buttonLabel =
    downloadState === 'saving'
      ? t('common.saving')
      : downloadState === 'saved'
        ? t('viewer.download.saved')
        : downloadState === 'error'
          ? t('viewer.download.saveFailed')
          : actionLabel;

  useEffect(() => {
    if (downloadState !== 'saved' && downloadState !== 'error') {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setDownloadState('idle'), 1_800);

    return () => window.clearTimeout(timeoutId);
  }, [downloadState]);

  // After a successful save, show an icon-only affordance: desktop reveals the
  // file in the file manager (FolderOpen); Android opens the saved file (no
  // folder-reveal exists on Android).
  if (savedAffordance) {
    const isReveal = savedAffordance.mode === 'reveal';
    const affordanceLabel = isReveal
      ? t('common.revealItem', { target: savedAffordance.label })
      : t('common.openItem', { target: savedAffordance.label });

    return (
      <button
        className={`button qdn-viewer__action-button${compact ? ' button--compact' : ''}`}
        type="button"
        title={affordanceLabel}
        aria-label={affordanceLabel}
        onClick={() => {
          if (isReveal) {
            void window.qortiumHome.system?.revealPath(savedAffordance.path);
          } else {
            void window.qortiumHome.qdn.openDownloadedResource?.({ uri: savedAffordance.path });
          }
        }}
      >
        {isReveal ? (
          <FolderOpen aria-hidden="true" size={18} strokeWidth={2} />
        ) : (
          <FileIcon aria-hidden="true" size={18} strokeWidth={2} />
        )}
      </button>
    );
  }

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
            suggestedFilename,
            multiFile,
          });

          if (result.canceled) {
            setDownloadState('idle');
            return;
          }

          // Swap to a persistent post-download affordance: desktop reveals the
          // saved file in the file manager; Android opens it (Android has no
          // folder-reveal). Anything else falls through to a transient "Saved".
          const savedLabel = result.fileName ?? suggestedFilename;

          if (!isNativePlatform() && result.filePath && window.qortiumHome.system?.revealPath) {
            setSavedAffordance({ mode: 'reveal', label: savedLabel, path: result.filePath });
            setDownloadState('idle');
            return;
          }

          if (isNativePlatform() && result.filePath && window.qortiumHome.qdn.openDownloadedResource) {
            setSavedAffordance({ mode: 'open', label: savedLabel, path: result.filePath });
            setDownloadState('idle');
            return;
          }

          setDownloadState('saved');
        } catch {
          setDownloadState('error');
        }
      }}
    >
      {downloadState === 'saving' ? (
        <LoaderCircle aria-hidden="true" className="button__spinner" size={18} strokeWidth={2} />
      ) : (
        <Download aria-hidden="true" size={18} strokeWidth={2} />
      )}
      <span className="button__label">{buttonLabel}</span>
    </button>
  );
}

function QdnOpenWithSystemPlayerButton({
  properties,
  resource,
}: {
  properties?: QdnResourceProperties;
  resource: QdnResource;
}) {
  const [openState, setOpenState] = useState<'error' | 'idle' | 'opening' | 'opened'>('idle');
  const suggestedFilename = getSuggestedResourceFilename(resource, properties);
  const actionLabel = t('viewer.media.openExternal');
  const buttonLabel =
    openState === 'opening'
      ? t('viewer.download.opening')
      : openState === 'opened'
        ? t('viewer.download.opened')
        : openState === 'error'
          ? t('viewer.download.openFailed')
          : actionLabel;

  useEffect(() => {
    if (openState !== 'opened' && openState !== 'error') {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setOpenState('idle'), 1_800);

    return () => window.clearTimeout(timeoutId);
  }, [openState]);

  return (
    <button
      className="button button--primary qdn-viewer__media-open"
      type="button"
      disabled={openState === 'opening'}
      onClick={async () => {
        setOpenState('opening');

        try {
          if (isNativePlatform() && window.qortiumHome.qdn.openResourceExternally) {
            await window.qortiumHome.qdn.openResourceExternally({
              service: resource.service,
              name: resource.name,
              identifier: resource.identifier,
              mimeType: properties?.mimeType,
              path: resource.path,
              suggestedFilename,
            });
            setOpenState('opened');
            return;
          }

          const result = await window.qortiumHome.qdn.downloadResource({
            service: resource.service,
            name: resource.name,
            identifier: resource.identifier,
            path: resource.path,
            suggestedFilename,
          });

          if (result.canceled) {
            setOpenState('idle');
            return;
          }

          if (isNativePlatform() && result.filePath && window.qortiumHome.qdn.openDownloadedResource) {
            await window.qortiumHome.qdn.openDownloadedResource({
              uri: result.filePath,
              mimeType: properties?.mimeType,
            });
            setOpenState('opened');
            return;
          }

          if (!isNativePlatform() && result.filePath && window.qortiumHome.system?.openPath) {
            await window.qortiumHome.system.openPath(result.filePath);
            setOpenState('opened');
            return;
          }

          setOpenState('opened');
        } catch {
          setOpenState('error');
        }
      }}
    >
      {openState === 'opening' ? (
        <LoaderCircle aria-hidden="true" className="button__spinner" size={18} strokeWidth={2} />
      ) : (
        <ExternalLink aria-hidden="true" size={18} strokeWidth={2} />
      )}
      <span className="button__label">{buttonLabel}</span>
    </button>
  );
}

function QdnStatusActions({
  copyText,
  isImage,
  isMultiFile,
  properties,
  resource,
}: {
  copyText?: string;
  isImage?: boolean;
  isMultiFile?: boolean;
  properties?: QdnResourceProperties;
  resource: QdnResource;
}) {
  return (
    <div className="qdn-viewer__status-actions">
      <CopyButton compact label={t('viewer.copyQdnUrl')} value={resource.displayUrl} />
      {typeof copyText === 'string' ? (
        <CopyButton compact textVariant label={t('viewer.copyText')} value={copyText} />
      ) : null}
      {isImage ? <CopyImageButton compact resource={resource} /> : null}
      <QdnDownloadButton compact multiFile={isMultiFile} properties={properties} resource={resource} />
    </div>
  );
}

// An already-extracted in-memory source (an archive entry) to render instead of
// fetching the resource text from the node.
type TextEntrySource = {
  bytes: Uint8Array;
};

async function readTextPreview({
  entrySource,
  loadedResource,
  resource,
}: {
  entrySource?: TextEntrySource;
  loadedResource: LoadedQdnResource;
  resource: QdnResource;
}): Promise<TextPreviewState> {
  const knownSize = entrySource ? entrySource.bytes.length : loadedResource.properties?.size;

  if (typeof knownSize === 'number' && knownSize > TEXT_PREVIEW_MAX_BYTES) {
    return {
      phase: 'too-large',
      message: t('viewer.preview.tooLargeWithSize', { size: formatByteSize(knownSize), limit: formatTextPreviewLimit() }),
    };
  }

  // Archive entries are decoded locally from their bytes; node-hosted resources go
  // through the bridge. Everything downstream (JSON formatting, the label, and the
  // per-kind viewers) is source-agnostic.
  const result = entrySource
    ? { content: new TextDecoder().decode(entrySource.bytes), contentType: '', tooLarge: false, contentLength: 0 }
    : await window.qortiumHome.qdn.fetchResourceText({
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
  entrySource,
  loadedResource,
  onActionContextChange,
  resource,
}: {
  entrySource?: TextEntrySource;
  loadedResource: LoadedQdnResource;
  onActionContextChange: SetViewerActionContext;
  resource: QdnResource;
}) {
  const [state, setState] = useState<TextPreviewState>({
    phase: 'loading',
  });

  // Surface the loaded text as a "Copy text" action in the top bar.
  useEffect(() => {
    onActionContextChange(state.phase === 'ready' ? { copyText: state.content } : {});

    return () => onActionContextChange({});
  }, [onActionContextChange, state]);

  useEffect(() => {
    let isDisposed = false;

    setState({
      phase: 'loading',
    });

    async function loadTextPreview() {
      try {
        const nextState = await readTextPreview({
          entrySource,
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
  }, [entrySource, loadedResource, resource]);

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

// Shared loader for the text-backed preview viewers (code / csv / json). Fetches
// the resource text once and exposes the same loading/ready/too-large/error state
// machine that QdnTextContent uses inline.
function useTextPreviewState(
  loadedResource: LoadedQdnResource,
  resource: QdnResource,
  entrySource?: TextEntrySource,
): TextPreviewState {
  const [state, setState] = useState<TextPreviewState>({ phase: 'loading' });

  useEffect(() => {
    let isDisposed = false;

    setState({ phase: 'loading' });

    async function load() {
      try {
        const nextState = await readTextPreview({ entrySource, loadedResource, resource });

        if (!isDisposed) {
          setState(nextState);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        if (!isDisposed) {
          setState({ phase: 'error', message: formatError(error) });
        }
      }
    }

    void load();

    return () => {
      isDisposed = true;
    };
  }, [entrySource, loadedResource, resource]);

  return state;
}

// Shared chrome (toolbar + loading/too-large/error states) for the text-backed
// preview viewers. `children` is rendered only in the ready state.
function QdnPreviewShell({
  className,
  label,
  loadedResource,
  resource,
  state,
  children,
}: {
  className: string;
  label: string;
  loadedResource: LoadedQdnResource;
  resource: QdnResource;
  state: TextPreviewState;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <div className="qdn-viewer__text-toolbar">
        <span className="qdn-viewer__type-label">{label}</span>
      </div>

      {state.phase === 'loading' ? (
        <div className="qdn-viewer__empty qdn-viewer__empty--loading">
          <p className="qdn-viewer__message">{t('viewer.preview.loading')}</p>
        </div>
      ) : null}

      {state.phase === 'ready' ? children : null}

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

// Syntax-highlighted source viewer. highlight.js is loaded lazily (only when a
// code resource is opened) and runs purely as a string transform — the resulting
// markup is static tokens, never executed.
function QdnCodeContent({
  entrySource,
  loadedResource,
  onActionContextChange,
  resource,
}: {
  entrySource?: TextEntrySource;
  loadedResource: LoadedQdnResource;
  onActionContextChange: SetViewerActionContext;
  resource: QdnResource;
}) {
  const state = useTextPreviewState(loadedResource, resource, entrySource);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  useEffect(() => {
    onActionContextChange(state.phase === 'ready' ? { copyText: state.content } : {});

    return () => onActionContextChange({});
  }, [onActionContextChange, state]);

  useEffect(() => {
    if (state.phase !== 'ready') {
      setHighlighted(null);
      return;
    }

    let isDisposed = false;

    async function highlight() {
      try {
        const { default: hljs } = await import('highlight.js');
        const result = hljs.highlightAuto(state.phase === 'ready' ? state.content : '');

        if (!isDisposed) {
          setHighlighted(result.value);
        }
      } catch {
        if (!isDisposed) {
          setHighlighted(null);
        }
      }
    }

    void highlight();

    return () => {
      isDisposed = true;
    };
  }, [state]);

  const rawContent = state.phase === 'ready' ? state.content : '';

  return (
    <QdnPreviewShell
      className="qdn-viewer__text"
      label={t('viewer.type.code')}
      loadedResource={loadedResource}
      resource={resource}
      state={state}
    >
      <pre className="qdn-viewer__text-content hljs">
        {highlighted !== null ? (
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <code>{rawContent}</code>
        )}
      </pre>
    </QdnPreviewShell>
  );
}

// Minimal RFC-4180-ish CSV parser: handles quoted fields, embedded commas,
// newlines, and "" escapes. Good enough for previewing published CSV data.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.length > 1 || (r[0] ?? '').length > 0);
}

const CSV_MAX_ROWS = 2000;

// Tabular CSV viewer — first row as headers, remaining rows in a table.
function QdnCsvContent({
  entrySource,
  loadedResource,
  onActionContextChange,
  resource,
}: {
  entrySource?: TextEntrySource;
  loadedResource: LoadedQdnResource;
  onActionContextChange: SetViewerActionContext;
  resource: QdnResource;
}) {
  const state = useTextPreviewState(loadedResource, resource, entrySource);

  useEffect(() => {
    onActionContextChange(state.phase === 'ready' ? { copyText: state.content } : {});

    return () => onActionContextChange({});
  }, [onActionContextChange, state]);

  const rows = useMemo(
    () => (state.phase === 'ready' ? parseCsv(state.content) : []),
    [state],
  );

  const header = rows[0] ?? [];
  const body = rows.slice(1, CSV_MAX_ROWS + 1);
  const truncated = rows.length - 1 > CSV_MAX_ROWS;

  return (
    <QdnPreviewShell
      className="qdn-viewer__text"
      label={t('viewer.type.csv')}
      loadedResource={loadedResource}
      resource={resource}
      state={state}
    >
      <div className="qdn-viewer__csv-scroll">
        <table className="qdn-viewer__csv-table">
          {header.length > 0 ? (
            <thead>
              <tr>
                {header.map((cell, index) => (
                  <th key={index}>{cell}</th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {body.map((cells, rowIndex) => (
              <tr key={rowIndex}>
                {cells.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {truncated ? (
          <p className="qdn-viewer__csv-truncated">{t('viewer.csv.truncated', { limit: String(CSV_MAX_ROWS) })}</p>
        ) : null}
      </div>
    </QdnPreviewShell>
  );
}

// One node of the collapsible JSON tree.
function JsonTreeNode({ name, value, depth }: { name: string | null; value: unknown; depth: number }) {
  const isObject = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(depth < 1);

  if (!isObject) {
    return (
      <div className="qdn-json__row" style={{ paddingLeft: `${depth * 14}px` }}>
        {name !== null ? <span className="qdn-json__key">{name}: </span> : null}
        <span className={`qdn-json__value qdn-json__value--${value === null ? 'null' : typeof value}`}>
          {value === null ? 'null' : typeof value === 'string' ? `"${value}"` : String(value)}
        </span>
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);
  const summary = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;

  return (
    <div className="qdn-json__node">
      <button
        className="qdn-json__toggle"
        type="button"
        style={{ paddingLeft: `${depth * 14}px` }}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="qdn-json__caret">{open ? '▾' : '▸'}</span>
        {name !== null ? <span className="qdn-json__key">{name}: </span> : null}
        <span className="qdn-json__summary">{summary}</span>
      </button>
      {open
        ? entries.map(([key, child]) => (
            <JsonTreeNode key={key} name={key} value={child} depth={depth + 1} />
          ))
        : null}
    </div>
  );
}

// Collapsible JSON tree viewer; falls back to the raw text on a parse failure.
function QdnJsonContent({
  entrySource,
  loadedResource,
  onActionContextChange,
  resource,
}: {
  entrySource?: TextEntrySource;
  loadedResource: LoadedQdnResource;
  onActionContextChange: SetViewerActionContext;
  resource: QdnResource;
}) {
  const state = useTextPreviewState(loadedResource, resource, entrySource);

  useEffect(() => {
    onActionContextChange(state.phase === 'ready' ? { copyText: state.content } : {});

    return () => onActionContextChange({});
  }, [onActionContextChange, state]);

  const parsed = useMemo(() => {
    if (state.phase !== 'ready') {
      return { ok: false as const };
    }
    try {
      return { ok: true as const, value: JSON.parse(state.content) as unknown };
    } catch {
      return { ok: false as const };
    }
  }, [state]);

  return (
    <QdnPreviewShell
      className="qdn-viewer__text"
      label={t('viewer.type.json')}
      loadedResource={loadedResource}
      resource={resource}
      state={state}
    >
      {parsed.ok ? (
        <div className="qdn-viewer__json">
          <JsonTreeNode name={null} value={parsed.value} depth={0} />
        </div>
      ) : (
        <pre className="qdn-viewer__text-content">
          <code>{state.phase === 'ready' ? state.content : ''}</code>
        </pre>
      )}
    </QdnPreviewShell>
  );
}

// Wrap rendered HTML (compiled markdown, or a raw HTML document) in a minimal,
// theme-aware page shell. Inlined into the iframe srcDoc below.
function buildRichTextSrcDoc(bodyHtml: string, isRawHtmlDocument: boolean) {
  if (isRawHtmlDocument) {
    return bodyHtml;
  }

  return [
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>',
    ':root{color-scheme:light dark}',
    'body{margin:0;padding:16px 20px;font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;',
    'color:#1a1a1a;background:#fff;word-wrap:break-word;overflow-wrap:break-word}',
    '@media (prefers-color-scheme:dark){body{color:#e6e6e6;background:#161616}a{color:#7db4ff}}',
    'img,video,canvas,svg{max-width:100%;height:auto}',
    'pre{white-space:pre-wrap;background:rgba(127,127,127,.12);padding:12px;border-radius:6px;overflow:auto}',
    'code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
    'pre code{background:none;padding:0}',
    'table{border-collapse:collapse}td,th{border:1px solid rgba(127,127,127,.4);padding:6px 10px}',
    'blockquote{margin:0;padding:0 0 0 14px;border-left:3px solid rgba(127,127,127,.4);color:inherit;opacity:.85}',
    '</style></head><body>',
    bodyHtml,
    '</body></html>',
  ].join('');
}

// Renders markdown or HTML resources inline. The compiled/raw HTML is injected
// into an iframe via `srcDoc` with a maximally restrictive `sandbox` attribute:
// no `allow-scripts` and no `allow-same-origin`, so scripts and inline handlers in
// the content cannot execute or reach the privileged app context. This makes the
// preview XSS-safe by construction — untrusted publisher content can render images
// and CSS but never run code.
function QdnRichTextContent({
  entrySource,
  kind,
  loadedResource,
  onActionContextChange,
  resource,
}: {
  entrySource?: TextEntrySource;
  kind: 'html' | 'markdown';
  loadedResource: LoadedQdnResource;
  onActionContextChange: SetViewerActionContext;
  resource: QdnResource;
}) {
  const [state, setState] = useState<TextPreviewState>({ phase: 'loading' });

  useEffect(() => {
    onActionContextChange(state.phase === 'ready' ? { copyText: state.content } : {});

    return () => onActionContextChange({});
  }, [onActionContextChange, state]);

  useEffect(() => {
    let isDisposed = false;

    setState({ phase: 'loading' });

    async function loadSource() {
      try {
        const nextState = await readTextPreview({ entrySource, loadedResource, resource });

        if (!isDisposed) {
          setState(nextState);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        if (!isDisposed) {
          setState({ phase: 'error', message: formatError(error) });
        }
      }
    }

    void loadSource();

    return () => {
      isDisposed = true;
    };
  }, [entrySource, loadedResource, resource]);

  const srcDoc = useMemo(() => {
    if (state.phase !== 'ready') {
      return '';
    }

    if (kind === 'markdown') {
      const html = marked.parse(state.content, { async: false, gfm: true }) as string;
      return buildRichTextSrcDoc(html, false);
    }

    return buildRichTextSrcDoc(state.content, true);
  }, [kind, state]);

  const typeLabel = kind === 'markdown' ? t('viewer.type.markdown') : t('viewer.type.html');

  return (
    <div className="qdn-viewer__richtext">
      <div className="qdn-viewer__text-toolbar">
        <span className="qdn-viewer__type-label">{typeLabel}</span>
      </div>

      {state.phase === 'loading' ? (
        <div className="qdn-viewer__empty qdn-viewer__empty--loading">
          <p className="qdn-viewer__message">{t('viewer.preview.loading')}</p>
        </div>
      ) : null}

      {state.phase === 'ready' ? (
        <iframe
          className="qdn-viewer__richtext-frame"
          sandbox=""
          srcDoc={srcDoc}
          title={loadedResource.properties?.filename || resource.displayUrl}
        />
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

// Routes PDF / EPUB / CBZ resources (resolved by content type, regardless of the
// publishing service) to the modal DocumentViewer. The reader itself is heavy and
// lazy-loaded, so this branch surfaces a prominent entry point rather than
// mounting it inline.
function QdnDocumentContent({
  loadedResource,
  onOpenDocumentViewer,
  resource,
}: {
  loadedResource: LoadedQdnResource;
  onOpenDocumentViewer?: (request: QortiumQdnDocumentViewerRequest) => void;
  resource: QdnResource;
}) {
  const docFormat = detectDocumentFormat(
    loadedResource.properties?.filename,
    loadedResource.properties?.mimeType,
  );

  return (
    <div className="qdn-viewer__empty qdn-viewer__empty--ready">
      <div className="qdn-viewer__details">
        <p className="qdn-viewer__message">{t('viewer.readyToRead')}</p>
        {docFormat !== 'unsupported' && onOpenDocumentViewer ? (
          <div className="qdn-viewer__doc-open-wrap">
            <button
              className="button button--primary"
              type="button"
              onClick={() =>
                onOpenDocumentViewer({
                  identifier: resource.identifier ?? null,
                  name: resource.name,
                  path: resource.path || null,
                  service: resource.service,
                  filename: loadedResource.properties?.filename ?? null,
                  mimeType: loadedResource.properties?.mimeType ?? null,
                })
              }
            >
              {t('docViewer.openIn')}
            </button>
          </div>
        ) : null}
        <QdnResourceDetailList loadedResource={loadedResource} resource={resource} />
      </div>
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
  const [isFilled, setIsFilled] = useState(false);
  const isVideo = loadedResource.viewerKind === 'video';
  const showFilled = isVideo && isFilled;
  const showExternalOpen = !!mediaError || isVideo;

  // A new media source starts in the default fit-to-space layout.
  useEffect(() => {
    setIsFilled(false);
  }, [loadedResource.renderUrl]);

  return (
    <div
      className={`qdn-viewer__media qdn-viewer__media--${isVideo ? 'video' : 'audio'}${
        showFilled ? ' qdn-viewer__media--filled' : ''
      }`}
    >
      <div className="qdn-viewer__media-stage">
        {isVideo ? (
          <>
            <button
              className="qdn-viewer__media-fill-toggle"
              type="button"
              aria-pressed={isFilled}
              title={isFilled ? t('viewer.video.exitFill') : t('viewer.video.fill')}
              aria-label={isFilled ? t('viewer.video.exitFill') : t('viewer.video.fill')}
              onClick={() => setIsFilled((value) => !value)}
            >
              {isFilled ? (
                <Minimize2 aria-hidden="true" size={18} strokeWidth={2} />
              ) : (
                <Maximize2 aria-hidden="true" size={18} strokeWidth={2} />
              )}
            </button>
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
          </>
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

      {showFilled ? null : (
        <div className="qdn-viewer__details qdn-viewer__media-details">
          {mediaError ? <p className="qdn-viewer__message qdn-viewer__message--error">{mediaError.message}</p> : null}
          {showExternalOpen ? (
            <div className="qdn-viewer__media-actions">
              <QdnOpenWithSystemPlayerButton properties={loadedResource.properties} resource={resource} />
            </div>
          ) : null}
          <QdnResourceDetailList loadedResource={loadedResource} resource={resource} />
        </div>
      )}
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

// Renders one already-extracted archive entry (in-memory bytes) using the same
// per-kind viewers as node-hosted resources. The content kind is resolved from the
// entry filename; media kinds get a transient object-URL (revoked on unmount),
// text-family kinds decode locally via entrySource, and documents (pdf/epub/cbz)
// open the in-place DocumentViewer. Nested archives are handled by ArchiveViewer
// itself, so they never reach here.
// Where an entry's bytes come from: an already-extracted in-memory buffer (archive
// entry) or a node-served sub-resource fetched by path (repository file). Media and
// documents render directly from the node URL/path in 'node' mode; only 'bytes'
// mode needs a transient object-URL and an in-memory text source.
export type EntryViewerSource =
  | { kind: 'bytes'; bytes: Uint8Array }
  | { kind: 'node'; renderUrl: string };

export function QdnEntryContent({
  displaySettings,
  filename,
  onActionContextChange,
  onBack,
  resource,
  source,
}: {
  displaySettings: QdnDisplaySettings;
  filename: string;
  onActionContextChange: SetViewerActionContext;
  onBack: () => void;
  resource: QdnResource;
  source: EntryViewerSource;
}) {
  const kind = detectContentKind(filename) ?? 'download';

  const sourceBytes = source.kind === 'bytes' ? source.bytes : null;
  const nodeRenderUrl = source.kind === 'node' ? source.renderUrl : null;
  const isMedia = kind === 'image' || kind === 'audio' || kind === 'video';
  const needsObjectUrl = isMedia && sourceBytes !== null;

  // For in-memory media, create the blob URL in an effect (not useMemo) so it is
  // allocated exactly once per lifecycle and always revoked on change/unmount —
  // useMemo can be double-invoked (StrictMode) or discarded, leaking the URL.
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!needsObjectUrl || !sourceBytes) {
      setObjectUrl(null);
      return;
    }

    const url = URL.createObjectURL(new Blob([sourceBytes as BlobPart]));
    setObjectUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [sourceBytes, needsObjectUrl]);

  // The URL media viewers render from: the in-memory blob URL, or the node path URL.
  const mediaUrl = sourceBytes ? objectUrl ?? '' : nodeRenderUrl ?? '';

  const loadedResource = useMemo<LoadedQdnResource>(
    () => ({
      properties: { filename, ...(sourceBytes ? { size: sourceBytes.length } : {}) },
      renderUrl: mediaUrl,
      status: {},
      viewerKind: kind,
    }),
    [filename, sourceBytes, mediaUrl, kind],
  );

  // In 'node' mode there is no in-memory source — the text viewers fetch the file
  // by resource.path through the bridge (?filepath=), exactly like a normal resource.
  const entrySource = useMemo<TextEntrySource | undefined>(
    () => (sourceBytes ? { bytes: sourceBytes } : undefined),
    [sourceBytes],
  );

  switch (kind) {
    case 'image':
      return <QdnImageContent alt={filename} renderUrl={mediaUrl} />;
    case 'audio':
    case 'video':
      return <QdnMediaContent loadedResource={loadedResource} resource={resource} />;
    case 'document':
      return (
        <DocumentViewer
          bytes={sourceBytes ?? undefined}
          displaySettings={displaySettings}
          onDismiss={onBack}
          resource={resource}
        />
      );
    case 'markdown':
    case 'html':
      return (
        <QdnRichTextContent
          entrySource={entrySource}
          kind={kind}
          loadedResource={loadedResource}
          onActionContextChange={onActionContextChange}
          resource={resource}
        />
      );
    case 'code':
      return (
        <QdnCodeContent
          entrySource={entrySource}
          loadedResource={loadedResource}
          onActionContextChange={onActionContextChange}
          resource={resource}
        />
      );
    case 'csv':
      return (
        <QdnCsvContent
          entrySource={entrySource}
          loadedResource={loadedResource}
          onActionContextChange={onActionContextChange}
          resource={resource}
        />
      );
    case 'json':
      return (
        <QdnJsonContent
          entrySource={entrySource}
          loadedResource={loadedResource}
          onActionContextChange={onActionContextChange}
          resource={resource}
        />
      );
    case 'text':
      return (
        <QdnTextContent
          entrySource={entrySource}
          loadedResource={loadedResource}
          onActionContextChange={onActionContextChange}
          resource={resource}
        />
      );
    default:
      return (
        <div className="qdn-viewer__empty qdn-viewer__empty--ready">
          <div className="qdn-viewer__details">
            <p className="qdn-viewer__message">{t('archive.entryNotPreviewable')}</p>
          </div>
        </div>
      );
  }
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

type QdnGalleryImageProps = {
  alt: string;
  className: string;
  displaySettings: QdnDisplaySettings;
  eager?: boolean;
  nodeApiUrl: string;
  nodeEpoch: number;
  onLoad?: ReactEventHandler<HTMLImageElement>;
  resource: QdnResource;
  style?: CSSProperties;
};

function QdnGalleryImage({
  alt,
  className,
  displaySettings,
  eager = false,
  nodeApiUrl,
  nodeEpoch,
  onLoad,
  resource,
  style,
}: QdnGalleryImageProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const isNative = isNativePlatform();
  const [shouldLoad, setShouldLoad] = useState(eager || !isNative);
  const stableResource = useMemo(
    () => resource,
    [resource.displayUrl, resource.identifier, resource.name, resource.path, resource.service],
  );

  useEffect(() => {
    if (eager || !isNative) {
      setShouldLoad(true);
      return undefined;
    }

    const element = imageRef.current;

    if (!element || typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: '320px' },
    );

    observer.observe(element.parentElement ?? element);
    return () => observer.disconnect();
  }, [eager, isNative, resource.displayUrl]);

  const source = useMemo(
    () => getQdnGalleryImageSource(stableResource, nodeApiUrl, displaySettings, isNative, shouldLoad),
    [displaySettings, isNative, nodeApiUrl, shouldLoad, stableResource],
  );
  const resolved = useQdnImageResource(
    source.kind === 'bridge' ? source.resource : null,
    nodeApiUrl,
    nodeEpoch,
  );
  const src = source.kind === 'direct' ? source.url : resolved.url ?? undefined;

  return (
    <img
      ref={imageRef}
      alt={alt}
      className={className}
      data-qdn-image-state={source.kind === 'direct' ? 'ready' : resolved.state}
      loading={eager ? 'eager' : 'lazy'}
      src={src}
      style={style}
      onLoad={onLoad}
    />
  );
}

function QdnImageButton({
  alt,
  className,
  galleryImage,
  isActualSize = false,
  onClick,
  pressed,
  src,
  title,
}: {
  alt: string;
  className: string;
  galleryImage?: Omit<QdnGalleryImageProps, 'alt' | 'className' | 'onLoad' | 'style'>;
  isActualSize?: boolean;
  onClick: () => void;
  pressed?: boolean;
  src?: string;
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
  }, [galleryImage?.resource.displayUrl, src]);

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
      {galleryImage ? (
        <QdnGalleryImage
          {...galleryImage}
          alt={alt}
          className={`qdn-viewer__image qdn-viewer__image--${isActualSize ? 'actual' : 'fit'}`}
          style={fittedSize}
          onLoad={(event) => {
            setNaturalSize({
              height: event.currentTarget.naturalHeight,
              width: event.currentTarget.naturalWidth,
            });
          }}
        />
      ) : (
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
      )}
    </button>
  );
}

function isGalleryFile(value: string) {
  const normalized = value.trim();

  return (
    !!normalized &&
    !normalized.includes('\\') &&
    !normalized.split('/').some((segment) => !segment) &&
    isGalleryImageFilename(normalized)
  );
}

function getSortedGalleryFiles(metadata: QdnResourceMetadata | undefined) {
  return (metadata?.files ?? [])
    .filter(isGalleryFile)
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

const REPOSITORY_FILE_MAX_BYTES = 100 * 1024 * 1024;

function pathBasename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function isNestedArchivePath(path: string): boolean {
  return /\.(zip|rar)$/i.test(path);
}

function entryBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Pick the file a repository opens to: an explicit metadata entryPoint if present,
// otherwise a top-level README; falls back to the tree when neither exists.
type RepositoryState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; files: string[] };

// Browses a GIT_REPOSITORY (a multi-file, node-served QDN resource) as a
// collapsible file tree, previewing each file in place with the matching content
// viewer. Unlike the archive browser there is no in-memory extraction: every file
// is fetched by path (?filepath=) the same way the gallery fetches images.
function QdnRepositoryContent({
  displaySettings,
  nodeApiUrl,
  onActionContextChange,
  onOpenInCurrentTab,
  resource,
}: {
  displaySettings: QdnDisplaySettings;
  nodeApiUrl: string;
  onActionContextChange: SetViewerActionContext;
  onOpenInCurrentTab?: (address: string) => void;
  resource: QdnResource;
}) {
  const [state, setState] = useState<RepositoryState>({ phase: 'loading' });
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // The open file is driven by the resource path (the bit after the identifier in
  // the qdn:// URL), so file selection is reflected in the address bar and any
  // file can be deep-linked. When no current-tab navigator is available we keep a
  // local fallback so the browser still works in isolation.
  const routePath = useMemo(() => {
    const raw = resource.path ?? '';
    return raw.split('?')[0]?.replace(/^\/+/, '') ?? '';
  }, [resource.path]);
  const [fallbackPath, setFallbackPath] = useState(routePath);
  const canNavigate = typeof onOpenInCurrentTab === 'function';
  const selectedPath = canNavigate ? routePath : fallbackPath;

  // Loading the file list depends only on the repository identity, not the open
  // file, so navigating between files does not refetch the tree.
  const repoIdentityKey = `${resource.service}:${resource.name}:${resource.identifier ?? 'default'}`;

  function openFile(path: string) {
    if (onOpenInCurrentTab) {
      onOpenInCurrentTab(getQdnResourceWithPath(resource, path).displayUrl);
    } else {
      setFallbackPath(path);
    }
  }

  function closeFile() {
    if (onOpenInCurrentTab) {
      onOpenInCurrentTab(getQdnResourceWithPath(resource, '').displayUrl);
    } else {
      setFallbackPath('');
    }
  }

  useEffect(() => {
    const abortController = new AbortController();
    let isDisposed = false;
    setState({ phase: 'loading' });

    async function loadList() {
      try {
        const metadata = await loadResourceMetadata(resource, nodeApiUrl, abortController.signal);
        const files = (metadata?.files ?? [])
          .slice()
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

        if (isDisposed) {
          return;
        }

        setState({ phase: 'ready', files });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        if (!isDisposed) {
          setState({ phase: 'error', message: formatError(error) });
        }
      }
    }

    void loadList();

    return () => {
      isDisposed = true;
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeApiUrl, repoIdentityKey]);

  const fileTreeEntries = useMemo<FileTreeEntry[]>(
    () => (state.phase === 'ready' ? state.files.map((path) => ({ path, dir: false })) : []),
    [state],
  );

  // At the file tree, the top-bar download targets the whole repository (a zip).
  // When a file is open its own viewer owns the action context (copy text, etc.);
  // we deliberately avoid a clearing cleanup here so we don't race that child's
  // setup. Returning to the tree re-asserts the multi-file context after the
  // child viewer unmounts and clears it.
  useEffect(() => {
    if (!selectedPath) {
      onActionContextChange({ isMultiFile: true });
    }
  }, [onActionContextChange, selectedPath]);

  // The selected sub-file resource must keep a stable identity across renders.
  // getQdnResourceWithPath() allocates a fresh object, and the entry viewers key
  // their fetch effects on `resource`; recomputing it every render (combined with
  // onActionContextChange re-rendering this component) would spin an infinite
  // fetch/render loop that exhausts memory.
  const selectedSub = useMemo(
    () => (selectedPath ? getQdnResourceWithPath(resource, selectedPath) : null),
    [resource, selectedPath],
  );

  async function downloadPath(path: string) {
    setDownloadError(null);
    try {
      const sub = getQdnResourceWithPath(resource, path);
      const result = await window.qortiumHome.qdn.fetchResourceData({
        identifier: sub.identifier,
        maxBytes: REPOSITORY_FILE_MAX_BYTES,
        name: sub.name,
        path: sub.path || undefined,
        service: sub.service,
      });

      if (result.tooLarge) {
        const limit = `${Math.round(REPOSITORY_FILE_MAX_BYTES / (1024 * 1024))} MB`;
        setDownloadError(t('docViewer.tooLarge', { limit }));
        return;
      }

      await saveBytesToFile(pathBasename(path), entryBase64ToBytes(result.data));
    } catch {
      setDownloadError(t('archive.downloadFailed'));
    }
  }

  if (state.phase === 'loading') {
    return (
      <div className="qdn-archive">
        <div className="qdn-viewer__empty qdn-viewer__empty--loading">
          <p className="qdn-viewer__message">{t('viewer.loadingResource')}</p>
        </div>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="qdn-archive">
        <div className="qdn-viewer__empty qdn-viewer__empty--error">
          <p className="qdn-viewer__message">{state.message}</p>
        </div>
      </div>
    );
  }

  if (selectedPath && selectedSub) {
    const back = closeFile;
    const sub = selectedSub;
    const filename = pathBasename(selectedPath);

    return (
      <div className="qdn-archive">
        <div className="qdn-archive__bar">
          <button className="button button--ghost qdn-archive__back" type="button" onClick={back}>
            <ArrowLeft size={16} aria-hidden="true" />
            {t('archive.back')}
          </button>
          <span className="qdn-archive__crumb" title={selectedPath}>
            {selectedPath}
          </span>
        </div>
        <div className="qdn-archive__entry">
          {isNestedArchivePath(filename) ? (
            <ArchiveViewer
              displaySettings={displaySettings}
              onActionContextChange={onActionContextChange}
              resource={sub}
            />
          ) : (
            <QdnEntryContent
              displaySettings={displaySettings}
              filename={filename}
              onActionContextChange={onActionContextChange}
              onBack={back}
              resource={sub}
              source={{ kind: 'node', renderUrl: buildQdnRenderUrl(sub, nodeApiUrl, displaySettings) }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="qdn-archive">
      <div className="qdn-archive__bar">
        <span className="qdn-viewer__type-label">{t('repository.title')}</span>
        {downloadError ? (
          <span className="qdn-archive__count qdn-viewer__message--error">{downloadError}</span>
        ) : (
          <span className="qdn-archive__count">{t('archive.fileCount', { count: String(state.files.length) })}</span>
        )}
      </div>
      {state.files.length === 0 ? (
        <div className="qdn-viewer__empty qdn-viewer__empty--ready">
          <p className="qdn-viewer__message">{t('repository.empty')}</p>
        </div>
      ) : (
        <FileTree entries={fileTreeEntries} onOpen={openFile} onDownload={downloadPath} />
      )}
    </div>
  );
}

function QdnGalleryContent({
  displaySettings,
  loadedResource,
  nodeApiUrl,
  nodeEpoch,
  onActionContextChange,
  onOpenNewTab,
  resource,
}: {
  displaySettings: QdnDisplaySettings;
  loadedResource: LoadedQdnResource;
  nodeApiUrl: string;
  nodeEpoch: number;
  onActionContextChange: SetViewerActionContext;
  onOpenNewTab?: (address: string) => void;
  resource: QdnResource;
}) {
  const [state, setState] = useState<GalleryState>({
    phase: 'loading',
  });
  const [selectedFile, setSelectedFile] = useState('');
  const galleryPointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressImageClickRef = useRef(false);

  const navigateGallery = (direction: GalleryNavigationDirection) => {
    if (state.phase !== 'ready') return;
    setSelectedFile((currentFile) => getAdjacentGalleryFile(state.files, currentFile, direction) ?? currentFile);
  };

  // Make the top-bar copy/download target what is on screen: the whole
  // repository (a zip) in the gallery, or the selected image when one is open.
  useEffect(() => {
    if (state.phase !== 'ready' || state.files.length === 0) {
      onActionContextChange({});
    } else if (selectedFile) {
      onActionContextChange({ isImage: true, resource: getQdnResourceWithPath(resource, selectedFile) });
    } else {
      onActionContextChange({ isMultiFile: true });
    }

    return () => onActionContextChange({});
  }, [onActionContextChange, resource, selectedFile, state]);

  useEffect(() => {
    const abortController = new AbortController();
    let isDisposed = false;

    async function loadGalleryList() {
      setState({
        phase: 'loading',
      });

      try {
        const metadata = await loadResourceMetadata(resource, nodeApiUrl, abortController.signal);
        const files = getSortedGalleryFiles(metadata);

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

    void loadGalleryList();

    return () => {
      isDisposed = true;
      abortController.abort();
    };
  }, [nodeApiUrl, resource]);

  useEffect(() => {
    if (state.phase !== 'ready' || !selectedFile) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
      ) return;

      const direction = event.key === 'ArrowLeft'
        ? 'previous'
        : event.key === 'ArrowRight'
          ? 'next'
          : null;
      if (!direction || !getAdjacentGalleryFile(state.files, selectedFile, direction)) return;

      event.preventDefault();
      navigateGallery(direction);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFile, state]);

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
    const previousFile = getAdjacentGalleryFile(state.files, selectedFile, 'previous');
    const nextFile = getAdjacentGalleryFile(state.files, selectedFile, 'next');

    return (
      <div className="qdn-viewer__gif-single">
        <div
          className="qdn-viewer__gallery-stage"
          onPointerCancel={() => {
            galleryPointerStartRef.current = null;
            suppressImageClickRef.current = false;
          }}
          onPointerDown={(event) => {
            if (!event.isPrimary) return;
            galleryPointerStartRef.current = { x: event.clientX, y: event.clientY };
            suppressImageClickRef.current = false;
          }}
          onPointerUp={(event) => {
            const start = galleryPointerStartRef.current;
            galleryPointerStartRef.current = null;
            if (!start || !event.isPrimary) return;
            const direction = getGallerySwipeDirection(event.clientX - start.x, event.clientY - start.y);
            if (!direction) return;
            suppressImageClickRef.current = true;
            navigateGallery(direction);
          }}
        >
          <QdnImageButton
            alt={selectedFile}
            className="qdn-viewer__gif-single-button"
            galleryImage={{
              displaySettings,
              eager: true,
              nodeApiUrl,
              nodeEpoch,
              resource: selectedResource,
            }}
            title={t('common.back')}
            onClick={() => {
              if (suppressImageClickRef.current) {
                suppressImageClickRef.current = false;
                return;
              }
              setSelectedFile('');
            }}
          />
          <button
            aria-label={t('docViewer.prevPage')}
            className="qdn-viewer__gallery-nav qdn-viewer__gallery-nav--previous"
            disabled={!previousFile}
            title={t('docViewer.prevPage')}
            type="button"
            onClick={() => navigateGallery('previous')}
          >
            <ChevronLeft aria-hidden="true" size={28} strokeWidth={2} />
          </button>
          <button
            aria-label={t('docViewer.nextPage')}
            className="qdn-viewer__gallery-nav qdn-viewer__gallery-nav--next"
            disabled={!nextFile}
            title={t('docViewer.nextPage')}
            type="button"
            onClick={() => navigateGallery('next')}
          >
            <ChevronRight aria-hidden="true" size={28} strokeWidth={2} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="qdn-viewer__gif-repository">
      <div className="qdn-viewer__gif-grid">
        {state.files.map((file) => {
          const fileResource = getQdnResourceWithPath(resource, file);

          return (
            <figure className="qdn-viewer__gif-card" key={file}>
              <button
                aria-label={t('common.openItem', { target: file })}
                className="qdn-viewer__gif-frame"
                title={t('common.openItem', { target: file })}
                type="button"
                onClick={() => setSelectedFile(file)}
              >
                <QdnGalleryImage
                  className="qdn-viewer__gif-image"
                  alt={file}
                  displaySettings={displaySettings}
                  nodeApiUrl={nodeApiUrl}
                  nodeEpoch={nodeEpoch}
                  resource={fileResource}
                />
              </button>
              <figcaption className="qdn-viewer__gif-caption">
                <a
                  className="qdn-viewer__gif-link"
                  href={fileResource.displayUrl}
                  onClick={(event) => {
                    event.preventDefault();
                    onOpenNewTab?.(fileResource.displayUrl);
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
  appTarget,
  displaySettings,
  managerRevisions,
  nodeApiUrl,
  onAppTargetDelivered,
  renderUrl,
  resourceUrl,
  suspended,
  tabId,
}: {
  account: QortiumAccountSummary | null;
  appTarget?: QdnAppTargetQuery | null;
  displaySettings: QdnDisplaySettings;
  managerRevisions?: QdnManagerRevisions;
  nodeApiUrl: string;
  onAppTargetDelivered?: (target: QdnAppTargetQuery) => void;
  renderUrl: string;
  resourceUrl: string;
  suspended: boolean;
  tabId: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastBoundsRef = useRef<QortiumQdnViewBounds | null>(null);
  const deliveredAppTargetRef = useRef<QdnAppTargetQuery | null>(null);
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
          managerRevisions,
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

  useEffect(() => {
    const qdnViews = window.qortiumHome.qdnViews;

    if (!qdnViews || suspended || !managerRevisions) {
      return;
    }

    void qdnViews.updateManagerRevisions({ tabId, managerRevisions }).catch((error) => {
      console.warn('Unable to update isolated QDN view manager revisions.', error);
    });
  }, [managerRevisions?.bookmarkManager, managerRevisions?.notificationManager, suspended, tabId]);

  useEffect(() => {
    const qdnViews = window.qortiumHome.qdnViews;

    if (!qdnViews || suspended || !appTarget || deliveredAppTargetRef.current === appTarget) {
      return;
    }

    deliveredAppTargetRef.current = appTarget;
    void qdnViews.postMessage({ tabId, message: getOpenAppTargetMessage(appTarget) })
      .then(() => onAppTargetDelivered?.(appTarget))
      .catch((error) => {
        deliveredAppTargetRef.current = null;
        console.warn('Unable to deliver QDN app target.', error);
      });
  }, [appTarget, onAppTargetDelivered, suspended, tabId]);

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

export function QdnBridgeFrameContent({
  account,
  appTarget,
  displaySettings,
  getHomeSettings,
  getBookmarkManagerSnapshot,
  managerRevisions,
  onBookmarkManagerMutation,
  onHomeSettingsPatch,
  onAppTargetDelivered,
  onAppNavigationChange,
  onAppNavigationControllerChange,
  onAppTitleChange,
  onOpenDocumentViewer,
  onOpenMediaPlayer,
  onOpenNewTab,
  onOpenInCurrentTab,
  onBookmarksOpen,
  renderUrl,
  requestContextActive,
  resourceUrl,
  suspended = false,
  title = resourceUrl,
}: QdnBridgeFrameContentProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const appTargetRef = useRef(appTarget);
  const deliveredAppTargetRef = useRef<QdnAppTargetQuery | null>(null);
  const frameLoadedRef = useRef(false);
  const onOpenNewTabRef = useRef(onOpenNewTab);
  const onOpenInCurrentTabRef = useRef(onOpenInCurrentTab);
  const onBookmarksOpenRef = useRef(onBookmarksOpen);
  const onOpenMediaPlayerRef = useRef(onOpenMediaPlayer);
  const onOpenDocumentViewerRef = useRef(onOpenDocumentViewer);
  const onAppNavigationChangeRef = useRef(onAppNavigationChange);
  const onAppTitleChangeRef = useRef(onAppTitleChange);
  const getHomeSettingsRef = useRef(getHomeSettings);
  const getBookmarkManagerSnapshotRef = useRef(getBookmarkManagerSnapshot);
  const onHomeSettingsPatchRef = useRef(onHomeSettingsPatch);
  const onBookmarkManagerMutationRef = useRef(onBookmarkManagerMutation);
  const suspendedFrameRef = useRef(suspended);
  const requestContextActiveRef = useRef(resolveQdnRequestContextActive(requestContextActive, suspended));

  onOpenNewTabRef.current = onOpenNewTab;
  onOpenInCurrentTabRef.current = onOpenInCurrentTab;
  onBookmarksOpenRef.current = onBookmarksOpen;
  onOpenMediaPlayerRef.current = onOpenMediaPlayer;
  onOpenDocumentViewerRef.current = onOpenDocumentViewer;
  onAppNavigationChangeRef.current = onAppNavigationChange;
  onAppTitleChangeRef.current = onAppTitleChange;
  getHomeSettingsRef.current = getHomeSettings;
  getBookmarkManagerSnapshotRef.current = getBookmarkManagerSnapshot;
  onHomeSettingsPatchRef.current = onHomeSettingsPatch;
  onBookmarkManagerMutationRef.current = onBookmarkManagerMutation;
  appTargetRef.current = appTarget;
  suspendedFrameRef.current = suspended;
  requestContextActiveRef.current = resolveQdnRequestContextActive(requestContextActive, suspended);
  const isNativeFrame = isNativePlatform();
  const bridgeToken = useMemo(
    () => (isNativeFrame ? createQdnBridgeToken() : ''),
    [isNativeFrame, renderUrl],
  );
  const accountId = account?.id ?? null;
  const isAccountUnlocked = account?.isUnlocked ?? false;
  const frameSrc = useMemo(
    () =>
      isNativeFrame && bridgeToken
        ? buildAndroidQdnBridgeUrl(renderUrl, bridgeToken)
        : renderUrl,
    [bridgeToken, isNativeFrame, renderUrl],
  );
  const appZoom = typeof displaySettings.appZoom === 'number' && Number.isFinite(displaySettings.appZoom)
    ? displaySettings.appZoom
    : 100;
  const shouldScaleFrame = !window.qortiumHome.zoom && appZoom !== 100;
  const frameScale = appZoom / 100;
  const frameStyle = shouldScaleFrame
    ? {
        width: `calc(100% * ${100 / appZoom})`,
        height: `calc(100% * ${100 / appZoom})`,
        transform: `scale(${frameScale})`,
        transformOrigin: '0 0',
      }
    : undefined;

  useEffect(() => {
    if (!isNativeFrame || !onAppNavigationControllerChange) {
      return undefined;
    }

    const controller: QdnAppNavigationController = {
      goToIndex: async (index) => {
        const frameWindow = frameRef.current?.contentWindow;

        if (!frameWindow || !Number.isInteger(index) || index < 0) {
          return false;
        }

        frameWindow.postMessage({
          type: 'qortium:qdn-navigation-command',
          bridgeToken,
          index,
        }, getPostMessageTargetOrigin(renderUrl));
        return true;
      },
    };

    onAppNavigationControllerChange(controller);
    return () => onAppNavigationControllerChange(null);
  }, [bridgeToken, isNativeFrame, onAppNavigationControllerChange, renderUrl]);

  useEffect(() => {
    postQdnDisplaySettings(frameRef.current?.contentWindow, renderUrl, displaySettings);
    postQdnHomeSettingsChanged(frameRef.current?.contentWindow, renderUrl, displaySettings);
  }, [displaySettings, renderUrl]);

  useEffect(() => {
    postQdnManagerRevisionChanged(frameRef.current?.contentWindow, renderUrl, managerRevisions);
  }, [managerRevisions?.bookmarkManager, managerRevisions?.notificationManager, renderUrl]);

  useEffect(() => {
    postQdnSelectedAccountChanged(frameRef.current?.contentWindow, renderUrl);
  }, [accountId, isAccountUnlocked, renderUrl]);

  function deliverAppTarget() {
    const target = appTargetRef.current;

    if (!frameLoadedRef.current || !target || deliveredAppTargetRef.current === target) {
      return;
    }

    const frameWindow = frameRef.current?.contentWindow;

    if (frameWindow) {
      deliveredAppTargetRef.current = target;
      frameWindow.postMessage(getOpenAppTargetMessage(target), getPostMessageTargetOrigin(renderUrl));
      onAppTargetDelivered?.(target);
    }
  }

  useEffect(() => {
    frameLoadedRef.current = false;
    deliveredAppTargetRef.current = null;
  }, [renderUrl]);

  useEffect(() => {
    deliverAppTarget();
  }, [appTarget, renderUrl]);

  useEffect(() => {
    if (!isNativeFrame) {
      return undefined;
    }

    const allowedOrigin = new URL(renderUrl).origin;

    let active = true;

    async function handleMessage(event: MessageEvent) {
      const frameWindow = frameRef.current?.contentWindow;

      if (!frameWindow || event.source !== frameWindow || event.origin !== allowedOrigin) {
        return;
      }

      if (isQdnAppTitleMessage(event.data)) {
        if (event.data.bridgeToken === bridgeToken) {
          onAppTitleChangeRef.current?.(
            typeof event.data.title === 'string' ? event.data.title : null,
          );
        }

        return;
      }

      if (isQdnAppNavigationMessage(event.data)) {
        if (event.data.bridgeToken === bridgeToken) {
          const snapshot = normalizeQdnBridgeNavigationSnapshot({
            activeIndex: event.data.activeIndex,
            entries: event.data.entries,
          }, renderUrl);

          if (snapshot) {
            onAppNavigationChangeRef.current?.(snapshot);
          }
        }

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
          getHomeSettings: getHomeSettingsRef.current,
          getBookmarkManagerSnapshot: getBookmarkManagerSnapshotRef.current,
          applyHomeSettingsPatch: onHomeSettingsPatchRef.current,
          applyBookmarkManagerMutation: onBookmarkManagerMutationRef.current,
          isCurrent: () =>
            isQdnRequestContextCurrent(
              active,
              requestContextActiveRef.current,
              frameWindow,
              frameRef.current?.contentWindow,
            ),
          isViewFocused: () =>
            !suspendedFrameRef.current && document.visibilityState === 'visible',
          onOpenDocumentViewer: (docRequest: QortiumQdnDocumentViewerRequest) => {
            onOpenDocumentViewerRef.current?.(docRequest);
          },
          onOpenMediaPlayer: (mediaRequest: QortiumQdnMediaPlayerRequest) => {
            onOpenMediaPlayerRef.current?.(mediaRequest);
          },
          onOpenNewTab: (address: string) => {
            onOpenNewTabRef.current?.(address);
          },
          onOpenInCurrentTab: (address: string) => {
            onOpenInCurrentTabRef.current?.(address);
          },
          onBookmarksOpen: (address: string, accountId: string | null) => {
            onBookmarksOpenRef.current?.(address, accountId);
          },
          resourceUrl,
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
        const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;

        frameWindow.postMessage(
          {
            bridgeToken,
            error: {
              error: message,
              message,
              ...(code ? { code } : {}),
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
      active = false;
      window.removeEventListener('message', handleMessage);
    };
  }, [accountId, bridgeToken, displaySettings, isNativeFrame, renderUrl, resourceUrl]);

  const frame = (
    <iframe
      className="qdn-viewer__frame"
      key={frameSrc}
      ref={frameRef}
      title={title}
      src={frameSrc}
      referrerPolicy="no-referrer"
      style={frameStyle}
      sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals"
      allow="fullscreen; clipboard-read; clipboard-write; screen-wake-lock"
      onLoad={() => {
        frameLoadedRef.current = true;
        postQdnDisplaySettings(frameRef.current?.contentWindow, renderUrl, displaySettings);
        postQdnHomeSettingsChanged(frameRef.current?.contentWindow, renderUrl, displaySettings);
        postQdnManagerRevisionChanged(frameRef.current?.contentWindow, renderUrl, managerRevisions);
        postQdnSelectedAccountChanged(frameRef.current?.contentWindow, renderUrl);
        deliverAppTarget();
      }}
    />
  );

  if (!shouldScaleFrame) {
    return frame;
  }

  return <div className="qdn-viewer__frame-scale-wrap">{frame}</div>;
}

function QdnIframeContent({
  account,
  appTarget,
  displaySettings,
  getHomeSettings,
  getBookmarkManagerSnapshot,
  managerRevisions,
  loadedResource,
  onAppTargetDelivered,
  onAppNavigationChange,
  onAppNavigationControllerChange,
  onAppTitleChange,
  onOpenDocumentViewer,
  onOpenMediaPlayer,
  onOpenNewTab,
  onOpenInCurrentTab,
  onBookmarksOpen,
  onHomeSettingsPatch,
  onBookmarkManagerMutation,
  resource,
  requestContextActive,
  suspended,
}: {
  account: QortiumAccountSummary | null;
  appTarget?: QdnAppTargetQuery | null;
  displaySettings: QdnFrameDisplaySettings;
  getHomeSettings?: () => HomeSettings;
  getBookmarkManagerSnapshot?: () => BookmarkManagerSnapshot;
  managerRevisions?: QdnManagerRevisions;
  loadedResource: LoadedQdnResource;
  onAppTargetDelivered?: (target: QdnAppTargetQuery) => void;
  onAppNavigationChange?: (snapshot: QdnAppNavigationSnapshot) => void;
  onAppNavigationControllerChange?: (controller: QdnAppNavigationController | null) => void;
  onAppTitleChange?: (title: string | null) => void;
  onOpenDocumentViewer?: (request: QortiumQdnDocumentViewerRequest) => void;
  onOpenMediaPlayer?: (request: QortiumQdnMediaPlayerRequest) => void;
  onOpenNewTab?: (address: string) => void;
  onOpenInCurrentTab?: (address: string) => void;
  onBookmarksOpen?: (address: string, accountId: string | null) => void;
  onHomeSettingsPatch?: (patch: Partial<HomeSettings>) => Promise<HomeSettings> | HomeSettings;
  onBookmarkManagerMutation?: (
    request: BookmarkManagerMutationRequest,
  ) => Promise<BookmarkManagerMutationResult> | BookmarkManagerMutationResult;
  resource: QdnResource;
  requestContextActive?: boolean;
  suspended?: boolean;
}) {
  return (
    <QdnBridgeFrameContent
      account={account}
      appTarget={appTarget}
      displaySettings={displaySettings}
      getHomeSettings={getHomeSettings}
      getBookmarkManagerSnapshot={getBookmarkManagerSnapshot}
      managerRevisions={managerRevisions}
      onAppTargetDelivered={onAppTargetDelivered}
      onAppNavigationChange={onAppNavigationChange}
      onAppNavigationControllerChange={onAppNavigationControllerChange}
      onAppTitleChange={onAppTitleChange}
      onOpenDocumentViewer={onOpenDocumentViewer}
      onOpenMediaPlayer={onOpenMediaPlayer}
      onOpenNewTab={onOpenNewTab}
      onOpenInCurrentTab={onOpenInCurrentTab}
      onBookmarksOpen={onBookmarksOpen}
      onHomeSettingsPatch={onHomeSettingsPatch}
      onBookmarkManagerMutation={onBookmarkManagerMutation}
      renderUrl={loadedResource.renderUrl}
      requestContextActive={requestContextActive}
      resourceUrl={resource.displayUrl}
      suspended={suspended}
    />
  );
}

function QdnReadyContent({
  loadedResource,
  account,
  appTarget,
  displaySettings,
  getHomeSettings,
  getBookmarkManagerSnapshot,
  managerRevisions,
  nodeApiUrl,
  nodeEpoch,
  onAppTargetDelivered,
  onActionContextChange,
  onAppNavigationChange,
  onAppNavigationControllerChange,
  onAppTitleChange,
  onOpenDocumentViewer,
  onOpenMediaPlayer,
  onOpenNewTab,
  onOpenInCurrentTab,
  onBookmarksOpen,
  onHomeSettingsPatch,
  onBookmarkManagerMutation,
  resource,
  requestContextActive,
  suspended,
  tabId,
}: {
  account: QortiumAccountSummary | null;
  appTarget?: QdnAppTargetQuery | null;
  displaySettings: QdnFrameDisplaySettings;
  getHomeSettings?: () => HomeSettings;
  getBookmarkManagerSnapshot?: () => BookmarkManagerSnapshot;
  managerRevisions?: QdnManagerRevisions;
  loadedResource: LoadedQdnResource;
  nodeApiUrl: string;
  nodeEpoch: number;
  onAppTargetDelivered?: (target: QdnAppTargetQuery) => void;
  onActionContextChange: SetViewerActionContext;
  onAppNavigationChange?: (snapshot: QdnAppNavigationSnapshot) => void;
  onAppNavigationControllerChange?: (controller: QdnAppNavigationController | null) => void;
  onAppTitleChange?: (title: string | null) => void;
  onOpenDocumentViewer?: (request: QortiumQdnDocumentViewerRequest) => void;
  onOpenMediaPlayer?: (request: QortiumQdnMediaPlayerRequest) => void;
  onOpenNewTab?: (address: string) => void;
  onOpenInCurrentTab?: (address: string) => void;
  onBookmarksOpen?: (address: string, accountId: string | null) => void;
  onHomeSettingsPatch?: (patch: Partial<HomeSettings>) => Promise<HomeSettings> | HomeSettings;
  onBookmarkManagerMutation?: (
    request: BookmarkManagerMutationRequest,
  ) => Promise<BookmarkManagerMutationResult> | BookmarkManagerMutationResult;
  resource: QdnResource;
  requestContextActive: boolean;
  suspended: boolean;
  tabId: string;
}) {
  const activeResource = loadedResource.resource ?? resource;

  if (loadedResource.viewerKind === 'iframe') {
    if (canUseIsolatedQdnViews()) {
      // Isolated desktop views report app titles from the main process
      // ('qdn-views:app-title-changed'), so no title callback is threaded here.
      return (
        <QdnIsolatedFrameContent
          account={account}
          appTarget={appTarget}
          displaySettings={displaySettings}
          managerRevisions={managerRevisions}
          nodeApiUrl={loadedResource.nodeApiUrl ?? nodeApiUrl}
          onAppTargetDelivered={onAppTargetDelivered}
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
        appTarget={appTarget}
        displaySettings={displaySettings}
        getHomeSettings={getHomeSettings}
        getBookmarkManagerSnapshot={getBookmarkManagerSnapshot}
        managerRevisions={managerRevisions}
        loadedResource={loadedResource}
        onAppTargetDelivered={onAppTargetDelivered}
        onAppNavigationChange={onAppNavigationChange}
        onAppNavigationControllerChange={onAppNavigationControllerChange}
        onAppTitleChange={onAppTitleChange}
        onOpenDocumentViewer={onOpenDocumentViewer}
        onOpenMediaPlayer={onOpenMediaPlayer}
        onOpenNewTab={onOpenNewTab}
        onOpenInCurrentTab={onOpenInCurrentTab}
        onBookmarksOpen={onBookmarksOpen}
        onHomeSettingsPatch={onHomeSettingsPatch}
        onBookmarkManagerMutation={onBookmarkManagerMutation}
        resource={resource}
        requestContextActive={requestContextActive}
        suspended={suspended}
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
    return (
      <QdnTextContent
        loadedResource={loadedResource}
        onActionContextChange={onActionContextChange}
        resource={resource}
      />
    );
  }

  if (loadedResource.viewerKind === 'code') {
    return (
      <QdnCodeContent
        loadedResource={loadedResource}
        onActionContextChange={onActionContextChange}
        resource={resource}
      />
    );
  }

  if (loadedResource.viewerKind === 'csv') {
    return (
      <QdnCsvContent
        loadedResource={loadedResource}
        onActionContextChange={onActionContextChange}
        resource={resource}
      />
    );
  }

  if (loadedResource.viewerKind === 'json') {
    return (
      <QdnJsonContent
        loadedResource={loadedResource}
        onActionContextChange={onActionContextChange}
        resource={resource}
      />
    );
  }

  if (loadedResource.viewerKind === 'audio' || loadedResource.viewerKind === 'video') {
    return <QdnMediaContent loadedResource={loadedResource} resource={activeResource} />;
  }

  if (loadedResource.viewerKind === 'gif-repository') {
    return (
      <QdnGalleryContent
        displaySettings={displaySettings}
        loadedResource={loadedResource}
        nodeApiUrl={nodeApiUrl}
        nodeEpoch={nodeEpoch}
        onActionContextChange={onActionContextChange}
        onOpenNewTab={onOpenNewTab}
        resource={resource}
      />
    );
  }

  if (loadedResource.viewerKind === 'markdown' || loadedResource.viewerKind === 'html') {
    return (
      <QdnRichTextContent
        kind={loadedResource.viewerKind}
        loadedResource={loadedResource}
        onActionContextChange={onActionContextChange}
        resource={resource}
      />
    );
  }

  if (loadedResource.viewerKind === 'archive') {
    return (
      <ArchiveViewer
        displaySettings={displaySettings}
        onActionContextChange={onActionContextChange}
        resource={resource}
      />
    );
  }

  if (loadedResource.viewerKind === 'repository') {
    return (
      <QdnRepositoryContent
        displaySettings={displaySettings}
        nodeApiUrl={nodeApiUrl}
        onActionContextChange={onActionContextChange}
        onOpenInCurrentTab={onOpenInCurrentTab}
        resource={resource}
      />
    );
  }

  if (loadedResource.viewerKind === 'document') {
    return (
      <QdnDocumentContent
        loadedResource={loadedResource}
        onOpenDocumentViewer={onOpenDocumentViewer}
        resource={resource}
      />
    );
  }

  if (loadedResource.viewerKind === 'download') {
    const docFormat = detectDocumentFormat(
      loadedResource.properties?.filename,
      loadedResource.properties?.mimeType,
    );
    return (
      <>
        <QdnDetailsContent
          loadedResource={loadedResource}
          message={isNativePlatform() ? t('viewer.readyToOpen') : t('viewer.readyToDownload')}
          resource={resource}
        />
        {docFormat !== 'unsupported' && onOpenDocumentViewer && (
          <div className="qdn-viewer__doc-open-wrap">
            <button
              className="button"
              type="button"
              onClick={() =>
                onOpenDocumentViewer({
                  identifier: resource.identifier ?? null,
                  name: resource.name,
                  path: resource.path || null,
                  service: resource.service,
                  filename: loadedResource.properties?.filename ?? null,
                  mimeType: loadedResource.properties?.mimeType ?? null,
                })
              }
            >
              {t('docViewer.openIn')}
            </button>
          </div>
        )}
      </>
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
  appTarget,
  displaySettings,
  nodeApiUrl,
  coreManager,
  nodeEpoch,
  nodeMode,
  onAppTargetDelivered,
  onAppNavigationChange,
  onAppNavigationControllerChange,
  onAppTitleChange,
  onOpenDocumentViewer,
  onOpenMediaPlayer,
  onOpenNewTab,
  onOpenInCurrentTab,
  onBookmarksOpen,
  getHomeSettings,
  getBookmarkManagerSnapshot,
  managerRevisions,
  onBookmarkManagerMutation,
  onHomeSettingsPatch,
  resource,
  requestContextActive,
  suspended = false,
  tabId,
}: QdnViewerProps) {
  const isRequestContextActive = resolveQdnRequestContextActive(requestContextActive, suspended);
  const [retryToken, setRetryToken] = useState(0);
  const [statusHidden, setStatusHidden] = useState(false);
  const [actionContext, setActionContext] = useState<ViewerActionContext>({});
  const statusRegionId = useId();
  const state = useQdnResourceLoader(resource, nodeApiUrl, retryToken, displaySettings);
  const appVersion = useQdnAppManifestVersion(resource, state.phase === 'ready');
  const progress = state.phase === 'ready' ? 100 : getStatusProgress(state.status);
  const progressText = getProgressText(state.status);
  const statusLabel = state.phase === 'ready' ? t('qdnStatus.ready') : formatQdnStatus(state.status);
  const remoteAuthorizationBlocked =
    state.phase === 'error' && isRemoteAuthorizationBlockedMessage(state.message);

  // Navigating to a different resource re-reveals the status bar so the new
  // URL and its actions are always visible while it loads.
  useEffect(() => {
    setStatusHidden(false);
  }, [resource.displayUrl]);

  // Once the resource is ready the progress bar has nothing left to report, so
  // collapse the status bar to give the content the full view. The user can
  // re-open it with the handle to reach the status actions.
  useEffect(() => {
    if (state.phase === 'ready') {
      setStatusHidden(true);
    }
  }, [state.phase]);

  return (
    <section className="qdn-viewer" aria-label={t('viewer.ariaLabel')}>
      {statusHidden ? (
        <button
          className={`qdn-viewer__status-handle${appVersion ? ' qdn-viewer__status-handle--with-badge' : ''}`}
          type="button"
          aria-expanded={false}
          title={t('viewer.showStatusBar')}
          aria-label={t('viewer.showStatusBar')}
          onClick={() => setStatusHidden(false)}
        >
          <ChevronDown aria-hidden="true" size={16} strokeWidth={2} />
          <QdnAppCompatibilityBadge appVersion={appVersion} />
        </button>
      ) : (
        <div className="qdn-viewer__status" id={statusRegionId} aria-live="polite">
          <div className="qdn-viewer__status-main">
            <div className="qdn-viewer__status-text">
              <span className="qdn-viewer__status-label">{statusLabel}</span>
              <QdnAppCompatibilityBadge appVersion={appVersion} />
              <span className="qdn-viewer__resource">{resource.displayUrl}</span>
            </div>
            {state.phase === 'ready' ? (
              <div className="qdn-viewer__status-controls">
                <QdnStatusActions
                  copyText={actionContext.copyText}
                  isImage={actionContext.isImage ?? state.loadedResource.viewerKind === 'image'}
                  isMultiFile={actionContext.isMultiFile ?? state.loadedResource.viewerKind === 'iframe'}
                  properties={actionContext.resource ? actionContext.properties : state.loadedResource.properties}
                  resource={actionContext.resource ?? state.loadedResource.resource ?? resource}
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

      {state.phase === 'error' && coreManager && nodeMode && isNodeUnavailableMessage(state.message) ? (
        <div className="qdn-viewer__empty qdn-viewer__empty--error">
          <CoreOfflineNotice
            coreManager={coreManager}
            nodeEpoch={nodeEpoch ?? 0}
            nodeMode={nodeMode}
            onRetry={() => setRetryToken((currentToken) => currentToken + 1)}
          />
        </div>
      ) : state.phase === 'ready' ? (
        <QdnReadyContent
          loadedResource={state.loadedResource}
          account={account}
          appTarget={appTarget}
          displaySettings={displaySettings}
          getHomeSettings={getHomeSettings}
          getBookmarkManagerSnapshot={getBookmarkManagerSnapshot}
          managerRevisions={managerRevisions}
          nodeApiUrl={nodeApiUrl}
          nodeEpoch={nodeEpoch ?? 0}
          onAppTargetDelivered={onAppTargetDelivered}
          onActionContextChange={setActionContext}
          onAppNavigationChange={onAppNavigationChange}
          onAppNavigationControllerChange={onAppNavigationControllerChange}
          onAppTitleChange={onAppTitleChange}
          onOpenDocumentViewer={onOpenDocumentViewer}
          onOpenMediaPlayer={onOpenMediaPlayer}
          onOpenNewTab={onOpenNewTab}
          onOpenInCurrentTab={onOpenInCurrentTab}
          onBookmarksOpen={onBookmarksOpen}
          onHomeSettingsPatch={onHomeSettingsPatch}
          onBookmarkManagerMutation={onBookmarkManagerMutation}
          resource={resource}
          requestContextActive={isRequestContextActive}
          suspended={suspended}
          tabId={tabId}
        />
      ) : (
        <div className={`qdn-viewer__empty qdn-viewer__empty--${state.phase}`}>
          <p className="qdn-viewer__message">
            {remoteAuthorizationBlocked ? t('viewer.remoteAuthBlocked') : state.message}
          </p>
          {remoteAuthorizationBlocked ? (
            <p className="core-offline__detail">{t('viewer.remoteAuthBlockedHint')}</p>
          ) : null}
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
