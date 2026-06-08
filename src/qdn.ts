import type { ResolvedDisplaySettings } from './displaySettings';

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
  ...TEXT_QDN_SERVICES,
  ...DOWNLOAD_QDN_SERVICES,
] as const;

export type QdnService = (typeof PUBLIC_QDN_SERVICES)[number];
export type QdnRenderableService = (typeof RENDERABLE_QDN_SERVICES)[number];
export type QdnViewerKind = 'audio' | 'download' | 'iframe' | 'image' | 'text' | 'unsupported' | 'video';

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

export type QdnDisplaySettings = Pick<ResolvedDisplaySettings, 'language' | 'textSize' | 'theme'>;

export type QdnRoute =
  | QdnExplorerRoute
  | {
      displayUrl: string;
      kind: 'resource';
      resource: QdnResource;
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

export type QdnResourceListItem = {
  created?: number;
  identifier?: string;
  latestSignature?: string;
  metadata?: {
    description?: string;
    title?: string;
  };
  name: string;
  service: QdnService;
  size?: number;
  status?: QdnResourceStatus;
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

  if (TEXT_QDN_SERVICES.includes(service as (typeof TEXT_QDN_SERVICES)[number])) {
    return 'text';
  }

  if (DOWNLOAD_QDN_SERVICES.includes(service as (typeof DOWNLOAD_QDN_SERVICES)[number])) {
    return 'download';
  }

  return 'unsupported';
}

function buildQdnServiceUrl(service: QdnService) {
  return `qdn://${service}`;
}

function buildQdnNameUrl(service: QdnService, name: string) {
  return `${buildQdnServiceUrl(service)}/${encodeURIComponent(name)}`;
}

function buildQdnWildcardNameUrl(name: string) {
  return `qdn://*/${encodeURIComponent(name)}`;
}

export function buildQdnDisplayUrl(resource: Omit<QdnResource, 'displayUrl'>) {
  return `qdn://${resource.service}/${encodeURIComponent(resource.name)}/${encodeURIComponent(
    resource.identifier ?? 'default',
  )}${resource.path ? encodeDisplayPath(resource.path) : ''}`;
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
      message: 'Enter a qdn:// link.',
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
        message: 'Enter a name after qdn://*/.',
      };
    }

    if (hasExtraPath || queryString) {
      return {
        success: false,
        message: 'Wildcard QDN links only support qdn://*/name.',
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
      message: 'Only public QDN services can be browsed right now.',
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

function applyQdnDisplaySettings(queryParams: URLSearchParams, displaySettings: QdnDisplaySettings | undefined) {
  if (!displaySettings) {
    return;
  }

  queryParams.set('theme', displaySettings.theme);
  queryParams.set('lang', displaySettings.language);
  queryParams.set('textSize', displaySettings.textSize);
}

export function buildQdnRenderUrl(resource: QdnResource, nodeApiUrl: string, displaySettings?: QdnDisplaySettings) {
  const { pathOnly, queryString } = splitPathAndQuery(resource.path);
  const encodedPath = encodePath(pathOnly);
  const pathSuffix = encodedPath ? `/${encodedPath}` : '';
  const queryParams = new URLSearchParams(queryString);

  if (resource.identifier) {
    queryParams.set('identifier', resource.identifier);
  }

  applyQdnDisplaySettings(queryParams, displaySettings);

  const renderQueryString = queryParams.toString();

  return `${getNodeApiUrlBase(nodeApiUrl)}/render/${resource.service}/${encodeURIComponent(resource.name)}${pathSuffix}${
    renderQueryString ? `?${renderQueryString}` : ''
  }`;
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

export function formatQdnStatus(status: QdnResourceStatus | undefined) {
  switch (status?.status) {
    case 'BLOCKED':
      return 'Blocked';
    case 'BUILD_FAILED':
      return 'Build failed';
    case 'BUILDING':
      return 'Building';
    case 'DOWNLOADED':
      return 'Downloaded';
    case 'DOWNLOADING':
      return 'Downloading';
    case 'FAILED_TO_DOWNLOAD':
      return 'Download failed';
    case 'MISSING_DATA':
      return 'Waiting for data';
    case 'NOT_PUBLISHED':
      return 'Not published';
    case 'READY':
      return 'Ready';
    case 'REFETCHING':
      return 'Refetching';
    case 'SEARCHING':
      return 'Searching';
    case 'UNSUPPORTED':
      return 'Unsupported';
    default:
      return status?.status ? status.status : 'Checking';
  }
}
