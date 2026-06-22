import type { ResolvedDisplaySettings } from './displaySettings';
import { detectContentKind } from './qdnContentType';
import { t, type TranslationKey } from './i18n';

const BYTE_UNIT_KEYS: readonly TranslationKey[] = [
  'common.unit.kb',
  'common.unit.mb',
  'common.unit.gb',
  'common.unit.tb',
];

export const PUBLIC_QDN_SERVICES = [
  'APP',
  'WEBSITE',
  'IMAGE',
  'THUMBNAIL',
  'QCHAT_IMAGE',
  'VIDEO',
  'AUDIO',
  'VOICE',
  'PODCAST',
  'DOCUMENT',
  'FILE',
  'FILES',
  'JSON',
  'METADATA',
  'BLOG',
  'BLOG_POST',
  'BLOG_COMMENT',
  'LIST',
  'PLAYLIST',
  'GIT_REPOSITORY',
  'GIF_REPOSITORY',
  'IMAGE_GALLERY',
  'STORE',
  'PRODUCT',
  'OFFER',
  'COUPON',
  'CODE',
  'PLUGIN',
  'EXTENSION',
  'GAME',
  'ITEM',
  'NFT',
  'DATABASE',
  'SNAPSHOT',
  'COMMENT',
  'CHAIN_COMMENT',
  'CHAIN_DATA',
  'ATTACHMENT',
  'MAIL',
  'MESSAGE',
] as const;

const IFRAME_QDN_SERVICES = ['APP', 'WEBSITE'] as const;
const IMAGE_QDN_SERVICES = ['IMAGE', 'THUMBNAIL', 'QCHAT_IMAGE'] as const;
const AUDIO_QDN_SERVICES = ['AUDIO', 'VOICE', 'PODCAST'] as const;
const VIDEO_QDN_SERVICES = ['VIDEO'] as const;
// Multi-file image collections. GIF_REPOSITORY (gifs only) and IMAGE_GALLERY
// (the broader image set added in Core v1.1.0) share the same gallery viewer.
const GALLERY_QDN_SERVICES = ['GIF_REPOSITORY', 'IMAGE_GALLERY'] as const;
const TEXT_QDN_SERVICES = [
  'JSON',
  'METADATA',
  'BLOG',
  'BLOG_POST',
  'BLOG_COMMENT',
  'LIST',
  'CODE',
  'COMMENT',
  'CHAIN_COMMENT',
  'MESSAGE',
] as const;
const DOWNLOAD_QDN_SERVICES = ['DOCUMENT', 'FILE', 'FILES', 'ATTACHMENT'] as const;
const RENDERABLE_QDN_SERVICES = [
  ...IFRAME_QDN_SERVICES,
  ...IMAGE_QDN_SERVICES,
  ...AUDIO_QDN_SERVICES,
  ...VIDEO_QDN_SERVICES,
  ...GALLERY_QDN_SERVICES,
  ...TEXT_QDN_SERVICES,
  ...DOWNLOAD_QDN_SERVICES,
] as const;

export type QdnService = (typeof PUBLIC_QDN_SERVICES)[number];
export type QdnRenderableService = (typeof RENDERABLE_QDN_SERVICES)[number];
export type QdnViewerKind =
  | 'archive'
  | 'audio'
  | 'code'
  | 'csv'
  | 'document'
  | 'download'
  | 'gif-repository'
  | 'html'
  | 'iframe'
  | 'image'
  | 'json'
  | 'markdown'
  | 'text'
  | 'unsupported'
  | 'video';

export type QdnExplorerRoute =
  | {
      displayUrl: string;
      kind: 'services';
    }
  | {
      displayUrl: string;
      kind: 'service';
      service: QdnService;
    }
  | {
      displayUrl: string;
      kind: 'name-services';
      name: string;
    }
  | {
      displayUrl: string;
      kind: 'name';
      name: string;
      service: QdnService;
    };

export type QdnResource = {
  displayUrl: string;
  identifier?: string;
  name: string;
  path: string;
  service: QdnService;
};

export type QdnDisplaySettings = Pick<ResolvedDisplaySettings, 'language' | 'textSize' | 'theme' | 'accent'>;

export type QdnPreview = {
  renderUrl: string;
  service: QdnService;
  sourceKind: 'directory' | 'file';
  sourceName: string;
  sourcePath: string;
};

export type QdnRoute =
  | QdnExplorerRoute
  | {
      displayUrl: string;
      kind: 'resource';
      resource: QdnResource;
    }
  | {
      displayUrl: string;
      kind: 'preview';
      preview: QdnPreview;
    };

export type QdnResourceStatus = {
  description?: string;
  id?: string;
  localChunkCount?: number;
  percentLoaded?: number;
  status?: string;
  title?: string;
  totalChunkCount?: number;
};

export type QdnResourceProperties = {
  filename?: string;
  mimeType?: string;
  size?: number;
};

export type QdnResourceMetadata = {
  description?: string;
  entryPoint?: string;
  files?: string[];
  mimeType?: string;
  title?: string;
};

export type QdnResourceListItem = {
  created?: number;
  identifier?: string;
  latestSignature?: string;
  metadata?: {
    description?: string;
    files?: string[];
    mimeType?: string;
    title?: string;
  };
  name: string;
  service: QdnService;
  size?: number;
  status?: QdnResourceStatus;
  updated?: number;
};

type QdnParseResult =
  | {
      route: QdnRoute;
      success: true;
    }
  | {
      message: string;
      success: false;
    };

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function encodePath(path: string) {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function splitPathAndQuery(path: string) {
  const queryIndex = path.indexOf('?');

  if (queryIndex === -1) {
    return {
      pathOnly: path,
      queryString: '',
    };
  }

  return {
    pathOnly: path.slice(0, queryIndex),
    queryString: path.slice(queryIndex + 1),
  };
}

function encodeDisplayPath(path: string) {
  if (!path) {
    return '/';
  }

  return path.startsWith('?') ? `/${path}` : `/${path}`;
}

function getNodeApiUrlBase(nodeApiUrl: string) {
  return nodeApiUrl.replace(/\/+$/, '');
}

export function isQdnService(value: string): value is QdnService {
  return PUBLIC_QDN_SERVICES.includes(value as QdnService);
}

// Core marks its encrypted services with a `_PRIVATE` suffix (APP_PRIVATE,
// IMAGE_GALLERY_PRIVATE, ...). Home cannot decrypt these yet, so it recognizes
// them only to show a clear "not supported" message instead of treating the
// address as an unknown service.
export function isPrivateQdnService(value: string) {
  return /^[A-Z0-9_]+_PRIVATE$/.test(value);
}

export function isQdnRenderableService(value: QdnService): value is QdnRenderableService {
  return RENDERABLE_QDN_SERVICES.includes(value as QdnRenderableService);
}

export function getQdnViewerKind(service: QdnService): QdnViewerKind {
  if (IFRAME_QDN_SERVICES.includes(service as (typeof IFRAME_QDN_SERVICES)[number])) {
    return 'iframe';
  }

  if (IMAGE_QDN_SERVICES.includes(service as (typeof IMAGE_QDN_SERVICES)[number])) {
    return 'image';
  }

  if (AUDIO_QDN_SERVICES.includes(service as (typeof AUDIO_QDN_SERVICES)[number])) {
    return 'audio';
  }

  if (VIDEO_QDN_SERVICES.includes(service as (typeof VIDEO_QDN_SERVICES)[number])) {
    return 'video';
  }

  // Both gallery services (GIF_REPOSITORY, IMAGE_GALLERY) use the same multi-file
  // gallery viewer; the 'gif-repository' kind name is kept for back-compat.
  if (GALLERY_QDN_SERVICES.includes(service as (typeof GALLERY_QDN_SERVICES)[number])) {
    return 'gif-repository';
  }

  if (TEXT_QDN_SERVICES.includes(service as (typeof TEXT_QDN_SERVICES)[number])) {
    return 'text';
  }

  if (DOWNLOAD_QDN_SERVICES.includes(service as (typeof DOWNLOAD_QDN_SERVICES)[number])) {
    return 'download';
  }

  return 'unsupported';
}

// Image extensions accepted inside a gallery resource. Mirrors the mime types
// Core's IMAGE_GALLERY service validates (and is a superset of GIF_REPOSITORY).
export function isGalleryImageFilename(value: string) {
  return /\.(?:png|jpe?g|gif|webp|bmp|avif|tiff?)$/i.test(value.split('?')[0] ?? '');
}

// Resolves the viewer kind once a resource is loaded. This refines the
// service-only classification from getQdnViewerKind: a gallery resource
// (GIF_REPOSITORY / IMAGE_GALLERY) that points at a single image file (via path
// or properties) renders as that single image rather than the gallery grid.
export function getLoadedViewerKind(
  resource: QdnResource,
  properties: QdnResourceProperties | undefined,
): QdnViewerKind {
  if (
    GALLERY_QDN_SERVICES.includes(resource.service as (typeof GALLERY_QDN_SERVICES)[number]) &&
    ((properties?.filename && isGalleryImageFilename(properties.filename)) ||
      isGalleryImageFilename(resource.path))
  ) {
    return 'image';
  }

  // Container-shape services (APP/WEBSITE iframes, multi-file galleries) are
  // routed by service — their bytes are an archive, not a single renderable file.
  // For everything else, the resolved *content type* of the single file wins over
  // the publisher-chosen service, so an image published as DOCUMENT (or a PDF
  // published as FILE, etc.) still renders correctly. Falls back to service-based
  // routing when no content signal is available.
  if (
    !IFRAME_QDN_SERVICES.includes(resource.service as (typeof IFRAME_QDN_SERVICES)[number]) &&
    !GALLERY_QDN_SERVICES.includes(resource.service as (typeof GALLERY_QDN_SERVICES)[number])
  ) {
    const contentKind = detectContentKind(properties?.filename, properties?.mimeType);
    if (contentKind) {
      return contentKind;
    }

    // Service-name hints for data services whose single file usually has no
    // extension and no reliable mimeType: the JSON service is JSON (tree viewer),
    // the CODE service is source (highlighted). Content detection above still
    // wins when the bytes say otherwise (e.g. a markdown file under CODE).
    if (resource.service === 'JSON') {
      return 'json';
    }
    if (resource.service === 'CODE') {
      return 'code';
    }
  }

  return getQdnViewerKind(resource.service);
}

export function buildQdnServiceUrl(service: QdnService) {
  return `qdn://${service}`;
}

export function buildQdnNameUrl(service: QdnService, name: string) {
  return `${buildQdnServiceUrl(service)}/${encodeURIComponent(name)}`;
}

export function buildQdnWildcardNameUrl(name: string) {
  return `qdn://*/${encodeURIComponent(name)}`;
}

export function buildQdnDisplayUrl(resource: Omit<QdnResource, 'displayUrl'>) {
  return `qdn://${resource.service}/${encodeURIComponent(resource.name)}/${encodeURIComponent(
    resource.identifier ?? 'default',
  )}${resource.path ? encodeDisplayPath(resource.path) : ''}`;
}

// Which segment of an in-progress qdn:// address the caret is sitting in, so the
// address bar can offer suggestions for it.
export type QdnDraftContext =
  | { kind: 'service'; prefix: string }
  | { kind: 'name'; prefix: string; service: QdnService }
  | { kind: 'identifier'; name: string; prefix: string; service: QdnService }
  | { kind: 'wildcard-name'; prefix: string };

// Lightweight parser for an address the user is still typing (caret assumed at
// the end). Unlike parseQdnUrl it never errors; it reports the segment under the
// caret. Returns null when the value isn't a qdn:// address or the caret has
// moved past the suggestible segments (e.g. into a file path).
export function parseQdnAddressDraft(value: string): QdnDraftContext | null {
  const input = value.trimStart();

  if (!/^qdn:\/\//i.test(input)) {
    return null;
  }

  const rest = input.replace(/^qdn:\/\//i, '');

  // No slash yet → still typing the service. A leading '*' is the wildcard form,
  // which only becomes suggestible once the user adds the "*/" separator.
  if (!rest.includes('/')) {
    if (rest.startsWith('*')) {
      return null;
    }

    return { kind: 'service', prefix: rest.trim() };
  }

  const segments = rest.split('/');
  const first = segments[0];

  if (first === '*') {
    if (segments.length === 2) {
      return { kind: 'wildcard-name', prefix: segments[1].trim() };
    }

    return null;
  }

  const service = first.toUpperCase();

  if (!isQdnService(service)) {
    return null;
  }

  if (segments.length === 2) {
    return { kind: 'name', service, prefix: segments[1].trim() };
  }

  if (segments.length === 3) {
    const name = segments[1].trim();

    if (!name) {
      return null;
    }

    return { kind: 'identifier', service, name, prefix: segments[2].trim() };
  }

  return null;
}

// Narrow the untyped /arbitrary/resources/search response to valid list items.
export function readQdnResourceListItems(data: unknown): QdnResourceListItem[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.filter((item): item is QdnResourceListItem => {
    if (!item || typeof item !== 'object') {
      return false;
    }

    const candidate = item as Partial<QdnResourceListItem>;

    return (
      typeof candidate.name === 'string' &&
      typeof candidate.service === 'string' &&
      isQdnService(candidate.service) &&
      (candidate.identifier === undefined || typeof candidate.identifier === 'string')
    );
  });
}

// Pull the registered-name strings out of the untyped /names/search response.
export function readQdnRegisteredNames(data: unknown): string[] {
  if (!Array.isArray(data)) {
    return [];
  }

  const names: string[] = [];

  for (const item of data) {
    if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
      names.push((item as { name: string }).name);
    }
  }

  return names;
}

export function parseQdnUrl(value: string): QdnParseResult {
  const input = value.trim();

  if (!input) {
    return {
      success: true,
      route: {
        kind: 'services',
        displayUrl: 'qdn://',
      },
    };
  }

  if (!/^qdn:\/\//i.test(input)) {
    return {
      success: false,
      message: t('address.error.enterQdnLink'),
    };
  }

  const withoutProtocol = input.replace(/^qdn:\/\/?/i, '').trim();

  if (!/[^/]/.test(withoutProtocol)) {
    return {
      success: true,
      route: {
        kind: 'services',
        displayUrl: 'qdn://',
      },
    };
  }

  const queryIndex = withoutProtocol.indexOf('?');
  const basePart = queryIndex === -1 ? withoutProtocol : withoutProtocol.slice(0, queryIndex);
  const queryString = queryIndex === -1 ? '' : withoutProtocol.slice(queryIndex + 1);
  const parts = basePart.replace(/^\/+/, '').split('/');
  const service = decodeSegment(parts.shift() ?? '').toUpperCase();

  if (service === '*') {
    const name = decodeSegment(parts.shift() ?? '').trim();
    const hasExtraPath = parts.some((part) => part.trim());

    if (!name) {
      return {
        success: false,
        message: t('address.error.nameAfterWildcard'),
      };
    }

    if (hasExtraPath || queryString) {
      return {
        success: false,
        message: t('address.error.wildcardFormat'),
      };
    }

    return {
      success: true,
      route: {
        kind: 'name-services',
        name,
        displayUrl: buildQdnWildcardNameUrl(name),
      },
    };
  }

  if (!isQdnService(service)) {
    return {
      success: false,
      message: isPrivateQdnService(service)
        ? t('address.error.privateServicesNotSupported')
        : t('address.error.publicServicesOnly'),
    };
  }

  const name = decodeSegment(parts.shift() ?? '').trim();

  if (!name) {
    return {
      success: true,
      route: {
        kind: 'service',
        service,
        displayUrl: buildQdnServiceUrl(service),
      },
    };
  }

  const queryParams = new URLSearchParams(queryString);
  const queryIdentifier = queryParams.get('identifier')?.trim() || '';

  if (queryIdentifier) {
    queryParams.delete('identifier');
  }

  let identifier = queryIdentifier || decodeSegment(parts.shift() ?? '').trim();

  if (!identifier) {
    return {
      success: true,
      route: {
        kind: 'name',
        service,
        name,
        displayUrl: buildQdnNameUrl(service, name),
      },
    };
  }

  if (identifier.toLowerCase() === 'default') {
    identifier = '';
  }

  const pathOnly = parts.map(decodeSegment).join('/').replace(/^\/+/, '');
  const remainingQueryString = queryParams.toString();
  const path = `${pathOnly}${remainingQueryString ? `?${remainingQueryString}` : ''}`;
  const resource = {
    service,
    name,
    identifier: identifier || undefined,
    path,
  } satisfies Omit<QdnResource, 'displayUrl'>;

  return {
    success: true,
    route: {
      kind: 'resource',
      displayUrl: buildQdnDisplayUrl(resource),
      resource: {
        ...resource,
        displayUrl: buildQdnDisplayUrl(resource),
      },
    },
  };
}

export function getQdnResourceKey(resource: QdnResource) {
  return `${resource.service}:${resource.name}:${resource.identifier ?? 'default'}:${resource.path}`;
}

export function buildQdnStatusUrl(resource: QdnResource, nodeApiUrl: string, build = false) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const query = build ? '?build=true' : '';

  return `${getNodeApiUrlBase(nodeApiUrl)}/arbitrary/resource/status/${resource.service}/${encodeURIComponent(
    resource.name,
  )}${identifierPath}${query}`;
}

export function buildQdnDownloadUrl(resource: QdnResource, nodeApiUrl: string) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';

  return `${getNodeApiUrlBase(nodeApiUrl)}/arbitrary/${resource.service}/${encodeURIComponent(
    resource.name,
  )}${identifierPath}?async=true`;
}

export function buildQdnRawResourceUrl(resource: QdnResource, nodeApiUrl: string, attachment = false) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const { pathOnly, queryString } = splitPathAndQuery(resource.path);
  const queryParams = new URLSearchParams(queryString);

  if (pathOnly) {
    queryParams.set('filepath', pathOnly);
  }

  if (attachment) {
    queryParams.set('attachment', 'true');
  }

  const rawQueryString = queryParams.toString();

  return `${getNodeApiUrlBase(nodeApiUrl)}/arbitrary/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}${
    rawQueryString ? `?${rawQueryString}` : ''
  }`;
}

export function buildQdnResourcesSearchUrl(
  route: Extract<QdnExplorerRoute, { kind: 'service' | 'name' | 'name-services' }>,
  nodeApiUrl: string,
) {
  const queryParams = new URLSearchParams({
    mode: 'ALL',
    limit: '0',
    includestatus: 'true',
    includemetadata: 'true',
  });

  if (route.kind !== 'name-services') {
    queryParams.set('service', route.service);
  }

  if (route.kind === 'name' || route.kind === 'name-services') {
    queryParams.set('name', route.name);
    queryParams.set('exactmatchnames', 'true');
  }

  return `${getNodeApiUrlBase(nodeApiUrl)}/arbitrary/resources/search?${queryParams.toString()}`;
}

export function buildQdnServiceAvailabilitySearchUrl(service: QdnService, nodeApiUrl: string) {
  const queryParams = new URLSearchParams({
    service,
    mode: 'ALL',
    limit: '1',
    includestatus: 'false',
    includemetadata: 'false',
  });

  return `${getNodeApiUrlBase(nodeApiUrl)}/arbitrary/resources/search?${queryParams.toString()}`;
}

export function buildQdnResourcePropertiesUrl(resource: QdnResource, nodeApiUrl: string) {
  return `${getNodeApiUrlBase(nodeApiUrl)}/arbitrary/resource/properties/${resource.service}/${encodeURIComponent(
    resource.name,
  )}/${encodeURIComponent(resource.identifier ?? 'default')}`;
}

export function buildQdnMetadataUrl(resource: QdnResource, nodeApiUrl: string) {
  return `${getNodeApiUrlBase(nodeApiUrl)}/arbitrary/metadata/${resource.service}/${encodeURIComponent(
    resource.name,
  )}/${encodeURIComponent(resource.identifier ?? 'default')}`;
}

function applyQdnDisplaySettings(queryParams: URLSearchParams, displaySettings: QdnDisplaySettings | undefined) {
  if (!displaySettings) {
    return;
  }

  queryParams.set('theme', displaySettings.theme);
  queryParams.set('lang', displaySettings.language);
  queryParams.set('textSize', displaySettings.textSize);
  queryParams.set('accent', displaySettings.accent);
}

export function buildQdnRenderUrl(resource: QdnResource, nodeApiUrl: string, displaySettings?: QdnDisplaySettings) {
  const { pathOnly, queryString } = splitPathAndQuery(resource.path);
  const encodedPath = encodePath(pathOnly);
  const identifierSegment = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const pathSuffix = encodedPath ? `/${encodedPath}` : '';
  const queryParams = new URLSearchParams(queryString);

  applyQdnDisplaySettings(queryParams, displaySettings);

  const renderQueryString = queryParams.toString();

  return `${getNodeApiUrlBase(nodeApiUrl)}/render/${resource.service}/${encodeURIComponent(
    resource.name,
  )}${identifierSegment}${pathSuffix}${renderQueryString ? `?${renderQueryString}` : ''}`;
}

export function isTerminalQdnStatus(status: string | undefined) {
  return (
    status === 'BLOCKED' ||
    status === 'BUILD_FAILED' ||
    status === 'FAILED_TO_DOWNLOAD' ||
    status === 'NOT_PUBLISHED' ||
    status === 'UNSUPPORTED'
  );
}

export function getQdnItemIdentifier(item: Pick<QdnResourceListItem, 'identifier'>) {
  return item.identifier || 'default';
}

export function buildQdnRouteFromListItem(item: QdnResourceListItem): QdnRoute {
  const resource = {
    service: item.service,
    name: item.name,
    identifier: item.identifier || undefined,
    path: '',
  } satisfies Omit<QdnResource, 'displayUrl'>;
  const displayUrl = buildQdnDisplayUrl(resource);

  return {
    kind: 'resource',
    displayUrl,
    resource: {
      ...resource,
      displayUrl,
    },
  };
}

export function buildQdnPreviewRoute(preview: QdnPreview): QdnRoute {
  return {
    kind: 'preview',
    displayUrl: `qdn://preview/${preview.service}/${encodeURIComponent(preview.sourceName)}`,
    preview,
  };
}

export function formatByteSize(bytes: number | undefined) {
  if (typeof bytes !== 'number') {
    return '';
  }

  if (bytes < 1024) {
    return t('common.unit.bytes', { count: bytes.toLocaleString() });
  }

  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < BYTE_UNIT_KEYS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return t(BYTE_UNIT_KEYS[unitIndex], { value: value.toLocaleString(undefined, { maximumFractionDigits: 1 }) });
}

export function formatQdnStatus(status: QdnResourceStatus | undefined) {
  switch (status?.status) {
    case 'BLOCKED':
      return t('qdnStatus.blocked');
    case 'BUILD_FAILED':
      return t('qdnStatus.buildFailed');
    case 'BUILDING':
      return t('qdnStatus.building');
    case 'DOWNLOADED':
      return t('qdnStatus.downloaded');
    case 'DOWNLOADING':
      return t('qdnStatus.downloading');
    case 'FAILED_TO_DOWNLOAD':
      return t('qdnStatus.downloadFailed');
    case 'MISSING_DATA':
      return t('qdnStatus.waitingForData');
    case 'NOT_PUBLISHED':
      return t('qdnStatus.notPublished');
    case 'READY':
      return t('qdnStatus.ready');
    case 'REFETCHING':
      return t('qdnStatus.refetching');
    case 'SEARCHING':
      return t('qdnStatus.searching');
    case 'UNSUPPORTED':
      return t('qdnStatus.unsupported');
    default:
      return status?.status ? status.status : t('qdnStatus.checking');
  }
}
