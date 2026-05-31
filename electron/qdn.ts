import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getNodeConnection } from './node-settings.js';
import { getQdnViewContextForWebContents } from './qdn-views.js';

const PREVIEW_API_KEY_PATH = path.join(os.homedir(), 'git', 'qortium', 'preview', 'apikey.txt');
const QDN_APP_DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const QDN_APP_MAX_BYTES_LIMIT = 5 * 1024 * 1024;
const PUBLIC_QDN_SERVICES = new Set([
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
]);

type QdnAuthorizeResourceRequest = {
  identifier?: unknown;
  name?: unknown;
  service?: unknown;
};

type QdnRawResourceRequest = QdnAuthorizeResourceRequest & {
  maxBytes?: unknown;
  path?: unknown;
  suggestedFilename?: unknown;
};

type QdnResourcesSearchRequest = {
  exactMatchNames?: unknown;
  includeMetadata?: unknown;
  includeStatus?: unknown;
  limit?: unknown;
  name?: unknown;
  service?: unknown;
};

type NodeApiRequest = {
  maxBytes?: unknown;
  path?: unknown;
};

type QdnAppRequest = {
  action?: unknown;
  maxBytes?: unknown;
  method?: unknown;
  path?: unknown;
  payload?: unknown;
  [key: string]: unknown;
};

type QdnResourceRequest = {
  identifier?: string;
  name: string;
  path: string;
  service: string;
};

type NodeConnection = Awaited<ReturnType<typeof getNodeConnection>>;

type NodeApiFetchResult = {
  body: string;
  contentLength?: number;
  contentType: string;
  data: unknown;
  headers: Record<string, string>;
  ok: boolean;
  status: number;
  statusText: string;
};

function expandHomePath(filePath: string) {
  if (filePath === '~') {
    return os.homedir();
  }

  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}

function readTrimmedFile(filePath: string) {
  const expandedPath = expandHomePath(filePath);

  if (!existsSync(expandedPath)) {
    return '';
  }

  return readFileSync(expandedPath, 'utf8').trim();
}

function readNodeApiKey() {
  const explicitApiKey = process.env.QORTIUM_HOME_NODE_API_KEY?.trim();

  if (explicitApiKey) {
    return explicitApiKey;
  }

  const explicitApiKeyPath = process.env.QORTIUM_HOME_NODE_API_KEY_PATH?.trim();

  if (explicitApiKeyPath) {
    const explicitPathKey = readTrimmedFile(explicitApiKeyPath);

    if (explicitPathKey) {
      return explicitPathKey;
    }
  }

  return readTrimmedFile(PREVIEW_API_KEY_PATH);
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getRequestPayload(request: QdnAppRequest) {
  return isRecord(request.payload) ? request.payload : request;
}

function getRequestValue(request: QdnAppRequest, key: string) {
  const payload = getRequestPayload(request);

  return payload[key] ?? request[key];
}

function getRequiredRequestString(request: QdnAppRequest, key: string, label: string) {
  const value = getString(getRequestValue(request, key));

  if (!value) {
    throw new Error(`${label} is required.`);
  }

  return value;
}

function getAuthorizeRequest(value: QdnAuthorizeResourceRequest) {
  const service = getString(value.service).toUpperCase();
  const name = getString(value.name);
  const identifier = getString(value.identifier);

  if (!PUBLIC_QDN_SERVICES.has(service)) {
    throw new Error('Only public QDN resources can be loaded right now.');
  }

  if (!name) {
    throw new Error('QDN resource name is required.');
  }

  return {
    service,
    name,
    identifier: identifier || undefined,
  };
}

function getService(value: unknown) {
  const service = getString(value).toUpperCase();

  if (!service) {
    return '';
  }

  if (!PUBLIC_QDN_SERVICES.has(service)) {
    throw new Error('Only public QDN services can be browsed right now.');
  }

  return service;
}

function getRawResourceRequest(value: QdnRawResourceRequest) {
  return {
    ...getAuthorizeRequest(value),
    path: getString(value.path),
  };
}

function splitPathAndQuery(resourcePath: string) {
  const queryIndex = resourcePath.indexOf('?');

  if (queryIndex === -1) {
    return {
      pathOnly: resourcePath,
      queryString: '',
    };
  }

  return {
    pathOnly: resourcePath.slice(0, queryIndex),
    queryString: resourcePath.slice(queryIndex + 1),
  };
}

function buildRawResourceUrl(resource: QdnResourceRequest, nodeApiUrl: string, attachment = false) {
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

  return `${nodeApiUrl}/arbitrary/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}${
    rawQueryString ? `?${rawQueryString}` : ''
  }`;
}

function getContentLength(response: Response) {
  const rawLength = response.headers.get('content-length');

  if (!rawLength) {
    return undefined;
  }

  const contentLength = Number(rawLength);

  return Number.isFinite(contentLength) ? contentLength : undefined;
}

function sanitizeFilename(value: string) {
  const sanitized = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();

  return sanitized.slice(0, 180) || 'qdn-resource';
}

function getSuggestedFilename(request: QdnRawResourceRequest, resource: QdnResourceRequest) {
  const requestedFilename = getString(request.suggestedFilename);

  if (requestedFilename) {
    return sanitizeFilename(requestedFilename);
  }

  return sanitizeFilename(`${resource.service}_${resource.name}_${resource.identifier ?? 'default'}`);
}

function getAppPath(name: Parameters<typeof app.getPath>[0]) {
  try {
    return app.getPath(name);
  } catch {
    return '';
  }
}

function getDefaultDownloadPath(filename: string) {
  const documentsPath = getAppPath('documents');
  const homePath = getAppPath('home');
  const basePath = documentsPath && existsSync(documentsPath) ? documentsPath : homePath;

  return path.join(basePath || process.cwd(), filename);
}

function getNodeApiPath(value: unknown, nodeApiUrl: string) {
  const apiPath = getString(value);

  if (!apiPath.startsWith('/') || apiPath.startsWith('//')) {
    throw new Error('Node API paths must start with /.');
  }

  if (/[\x00-\x1F]/.test(apiPath)) {
    throw new Error('Node API path contains invalid control characters.');
  }

  const url = new URL(apiPath, nodeApiUrl);

  return `${url.pathname}${url.search}`;
}

function getNodeUnavailableMessage(nodeApiUrl: string) {
  return `Qortium node is unavailable at ${nodeApiUrl}.`;
}

function getNetworkRestrictionMessage() {
  return 'The selected Previewnet network node is public read-only and does not expose that endpoint. Use a local Core or trusted custom node for write, admin, or private API workflows.';
}

function getNodeApiKey() {
  const apiKey = readNodeApiKey();

  if (!apiKey) {
    throw new Error('Qortium node API key was not found.');
  }

  return apiKey;
}

async function fetchNode(pathname: string, options: RequestInit = {}, nodeApiUrl: string) {
  let response: Response;

  try {
    response = await fetch(`${nodeApiUrl}${pathname}`, options);
  } catch {
    throw new Error(getNodeUnavailableMessage(nodeApiUrl));
  }

  return response;
}

async function fetchConfiguredNode(pathname: string, options: RequestInit = {}) {
  const connection = await getNodeConnection();

  try {
    return {
      connection,
      response: await fetchNode(pathname, options, connection.nodeApiUrl),
    };
  } catch (error) {
    if (connection.mode !== 'network') {
      throw error;
    }

    const retryConnection = await getNodeConnection(true);

    if (retryConnection.nodeApiUrl === connection.nodeApiUrl) {
      throw error;
    }

    return {
      connection: retryConnection,
      response: await fetchNode(pathname, options, retryConnection.nodeApiUrl),
    };
  }
}

async function fetchRawResource(
  resource: QdnResourceRequest,
  connection: NodeConnection,
  attachment = false,
) {
  const headers: Record<string, string> = {};

  if (connection.mode !== 'network') {
    headers['X-API-KEY'] = getNodeApiKey();
  }

  const response = await fetchNode(
    buildRawResourceUrl(resource, connection.nodeApiUrl, attachment).replace(connection.nodeApiUrl, ''),
    {
      headers,
    },
    connection.nodeApiUrl,
  );

  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(
      response.status === 403 && connection.mode === 'network'
        ? getNetworkRestrictionMessage()
        : message || `QDN raw resource request failed with HTTP ${response.status}.`,
    );
  }

  return response;
}

async function fetchConfiguredRawResource(resource: QdnResourceRequest, attachment = false) {
  const connection = await getNodeConnection();

  try {
    return await fetchRawResource(resource, connection, attachment);
  } catch (error) {
    if (connection.mode !== 'network') {
      throw error;
    }

    const retryConnection = await getNodeConnection(true);

    if (retryConnection.nodeApiUrl === connection.nodeApiUrl) {
      throw error;
    }

    return await fetchRawResource(resource, retryConnection, attachment);
  }
}

async function authorizeResource(
  service: string,
  name: string,
  identifier: string | undefined,
  apiKey: string,
  nodeApiUrl: string,
) {
  const identifierPath = identifier ? `/${encodeURIComponent(identifier)}` : '';
  const response = await fetchNode(
    `/render/authorize/${service}/${encodeURIComponent(name)}${identifierPath}`,
    {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
      },
    },
    nodeApiUrl,
  );

  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(message || `QDN authorization failed with HTTP ${response.status}.`);
  }
}

function buildResourcesSearchPath(request: QdnResourcesSearchRequest) {
  const service = getService(request.service);
  const name = getString(request.name);
  const limit = Math.max(0, Math.floor(getNumber(request.limit) ?? 0));
  const queryParams = new URLSearchParams({
    mode: 'ALL',
    limit: String(limit),
    includestatus: String(getBoolean(request.includeStatus) ?? true),
    includemetadata: String(getBoolean(request.includeMetadata) ?? true),
  });

  if (service) {
    queryParams.set('service', service);
  }

  if (name) {
    queryParams.set('name', name);
    queryParams.set('exactmatchnames', String(getBoolean(request.exactMatchNames) ?? true));
  }

  return `/arbitrary/resources/search?${queryParams.toString()}`;
}

function getQdnAppMaxBytes(value: unknown) {
  const maxBytes = Math.floor(getNumber(value) ?? QDN_APP_DEFAULT_MAX_BYTES);

  return Math.max(0, Math.min(maxBytes, QDN_APP_MAX_BYTES_LIMIT));
}

function getReadOnlyMethod(value: unknown) {
  const method = getString(value).toUpperCase() || 'GET';

  if (method !== 'GET' && method !== 'HEAD') {
    throw new Error('QDN app node API requests only support GET and HEAD right now.');
  }

  return method;
}

function getHeaders(response: Response) {
  const headers: Record<string, string> = {};

  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return headers;
}

function parseResponseData(body: string, contentType: string) {
  const normalizedContentType = contentType.toLowerCase();

  if (!body) {
    return null;
  }

  if (
    normalizedContentType.includes('json') ||
    body.trimStart().startsWith('{') ||
    body.trimStart().startsWith('[')
  ) {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return body;
    }
  }

  return body;
}

async function readNodeApiResponse(
  response: Response,
  connection: NodeConnection,
  maxBytes: number,
  readBody = true,
): Promise<NodeApiFetchResult> {
  const contentLength = getContentLength(response);
  const contentType = response.headers.get('content-type') ?? '';
  const headers = getHeaders(response);

  if (maxBytes > 0 && typeof contentLength === 'number' && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Node API response exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  const rawBody = readBody ? await response.text() : '';
  const body =
    response.status === 403 && connection.mode === 'network'
      ? getNetworkRestrictionMessage()
      : rawBody;
  const bodyLength = Buffer.byteLength(body, 'utf8');

  if (maxBytes > 0 && bodyLength > maxBytes) {
    throw new Error(`Node API response exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  return {
    body,
    contentLength: contentLength ?? bodyLength,
    contentType,
    data: parseResponseData(body, contentType),
    headers,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  };
}

async function fetchConfiguredNodeApi(
  apiPath: string,
  maxBytes: number,
  method: 'GET' | 'HEAD' = 'GET',
) {
  const { connection, response } = await fetchConfiguredNode(apiPath, { method });

  return readNodeApiResponse(response, connection, maxBytes, method !== 'HEAD');
}

async function fetchNodeApiPayload(apiPath: string, request: QdnAppRequest) {
  const result = await fetchConfiguredNodeApi(
    apiPath,
    getQdnAppMaxBytes(getRequestValue(request, 'maxBytes')),
  );

  if (!result.ok) {
    throw new Error(result.body || `Qortium node request failed with HTTP ${result.status}.`);
  }

  return result.data;
}

function getQdnAppResourceRequest(request: QdnAppRequest) {
  const service = getService(getRequestValue(request, 'service'));
  const name = getString(getRequestValue(request, 'name'));
  const identifier = getString(getRequestValue(request, 'identifier'));
  const resourcePath = getString(getRequestValue(request, 'path')) || getString(getRequestValue(request, 'filepath'));

  if (!service) {
    throw new Error('QDN resource service is required.');
  }

  if (!name) {
    throw new Error('QDN resource name is required.');
  }

  return {
    service,
    name,
    identifier: identifier || undefined,
    path: resourcePath,
  };
}

function getEncodedResourcePath(resourcePath: string) {
  return resourcePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildQdnResourceStatusPath(request: QdnAppRequest) {
  const resource = getQdnAppResourceRequest(request);
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  if (typeof getBoolean(getRequestValue(request, 'build')) === 'boolean') {
    queryParams.set('build', String(getBoolean(getRequestValue(request, 'build'))));
  }

  const queryString = queryParams.toString();

  return `/arbitrary/resource/status/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}${
    queryString ? `?${queryString}` : ''
  }`;
}

function buildQdnResourcePropertiesPath(request: QdnAppRequest) {
  const resource = getQdnAppResourceRequest(request);

  return `/arbitrary/resource/properties/${resource.service}/${encodeURIComponent(resource.name)}/${encodeURIComponent(
    resource.identifier ?? 'default',
  )}`;
}

function buildQdnResourceMetadataPath(request: QdnAppRequest) {
  const resource = getQdnAppResourceRequest(request);

  return `/arbitrary/metadata/${resource.service}/${encodeURIComponent(resource.name)}/${encodeURIComponent(
    resource.identifier ?? 'default',
  )}`;
}

function buildFetchQdnResourcePath(request: QdnAppRequest) {
  const resource = getQdnAppResourceRequest(request);
  const queryParams = new URLSearchParams();

  if (resource.path) {
    queryParams.set('filepath', resource.path);
  }

  for (const key of ['encoding', 'rebuild', 'async']) {
    const value = getRequestValue(request, key);

    if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
      queryParams.set(key, String(value));
    }
  }

  const queryString = queryParams.toString();

  return `/arbitrary/${resource.service}/${encodeURIComponent(resource.name)}${
    resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : ''
  }${queryString ? `?${queryString}` : ''}`;
}

function appendQueryValue(queryParams: URLSearchParams, key: string, value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) {
      appendQueryValue(queryParams, key, item);
    }

    return;
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    queryParams.append(key, String(value));
    return;
  }

  const stringValue = getString(value);

  if (stringValue) {
    queryParams.append(key, stringValue);
  }
}

function buildQdnResourcesPath(request: QdnAppRequest, pathBase: string) {
  const queryParams = new URLSearchParams();
  const queryFields: Record<string, string> = {
    default: 'default',
    description: 'description',
    exactMatchNames: 'exactmatchnames',
    excludeBlocked: 'excludeblocked',
    followedOnly: 'followedonly',
    identifier: 'identifier',
    includeMetadata: 'includemetadata',
    includeStatus: 'includestatus',
    keywords: 'keywords',
    limit: 'limit',
    mode: 'mode',
    name: 'name',
    nameListFilter: 'namefilter',
    names: 'name',
    offset: 'offset',
    prefix: 'prefix',
    query: 'query',
    reverse: 'reverse',
    service: 'service',
    title: 'title',
  };

  for (const [requestKey, queryKey] of Object.entries(queryFields)) {
    appendQueryValue(queryParams, queryKey, getRequestValue(request, requestKey));
  }

  const queryString = queryParams.toString();

  return `${pathBase}${queryString ? `?${queryString}` : ''}`;
}

async function getQdnResourceUrl(request: QdnAppRequest) {
  const resource = getQdnAppResourceRequest(request);
  const status = await fetchNodeApiPayload(buildQdnResourceStatusPath(request), request);

  if (
    !isRecord(status) ||
    !status.status ||
    status.status === 'NOT_PUBLISHED'
  ) {
    throw new Error('Resource does not exist.');
  }

  const connection = await getNodeConnection();
  const { pathOnly, queryString } = splitPathAndQuery(resource.path);
  const encodedPath = getEncodedResourcePath(pathOnly);
  const queryParams = new URLSearchParams(queryString);

  if (resource.identifier) {
    queryParams.set('identifier', resource.identifier);
  }

  const renderQueryString = queryParams.toString();

  return `${connection.nodeApiUrl}/render/${resource.service}/${encodeURIComponent(resource.name)}${
    encodedPath ? `/${encodedPath}` : ''
  }${renderQueryString ? `?${renderQueryString}` : ''}`;
}

async function handleQdnAppRequest(value: unknown) {
  const request: QdnAppRequest =
    typeof value === 'string'
      ? { action: 'GET_NODE_API', path: value }
      : isRecord(value)
        ? value
        : {};
  const action = getString(request.action).toUpperCase();

  if (!action && getString(request.path)) {
    return handleQdnAppRequest({ ...request, action: 'GET_NODE_API' });
  }

  switch (action) {
    case 'GET_API':
    case 'GET_NODE_API':
    case 'FETCH_NODE_API': {
      const apiPath = getNodeApiPath(getRequestValue(request, 'path'), 'http://127.0.0.1');
      const method = getReadOnlyMethod(getRequestValue(request, 'method'));

      return fetchConfiguredNodeApi(apiPath, getQdnAppMaxBytes(getRequestValue(request, 'maxBytes')), method);
    }

    case 'GET_NODE_INFO':
      return fetchNodeApiPayload('/admin/info', request);

    case 'GET_NODE_STATUS':
      return fetchNodeApiPayload('/admin/status', request);

    case 'GET_ACCOUNT_DATA':
      return fetchNodeApiPayload(
        `/addresses/${encodeURIComponent(getRequiredRequestString(request, 'address', 'Address'))}`,
        request,
      );

    case 'GET_ACCOUNT_NAMES':
      return fetchNodeApiPayload(
        `/names/address/${encodeURIComponent(getRequiredRequestString(request, 'address', 'Address'))}`,
        request,
      );

    case 'GET_BALANCE':
      return fetchNodeApiPayload(
        `/addresses/balance/${encodeURIComponent(getRequiredRequestString(request, 'address', 'Address'))}`,
        request,
      );

    case 'GET_NAME_DATA':
      return fetchNodeApiPayload(
        `/names/${encodeURIComponent(getRequiredRequestString(request, 'name', 'Name'))}`,
        request,
      );

    case 'GET_QDN_RESOURCE_METADATA':
      return fetchNodeApiPayload(buildQdnResourceMetadataPath(request), request);

    case 'GET_QDN_RESOURCE_PROPERTIES':
      return fetchNodeApiPayload(buildQdnResourcePropertiesPath(request), request);

    case 'GET_QDN_RESOURCE_STATUS':
      return fetchNodeApiPayload(buildQdnResourceStatusPath(request), request);

    case 'GET_QDN_RESOURCE_URL':
      return getQdnResourceUrl(request);

    case 'FETCH_QDN_RESOURCE':
      return fetchNodeApiPayload(buildFetchQdnResourcePath(request), request);

    case 'LIST_QDN_RESOURCES':
      return fetchNodeApiPayload(buildQdnResourcesPath(request, '/arbitrary/resources'), request);

    case 'SEARCH_QDN_RESOURCES':
      return fetchNodeApiPayload(buildQdnResourcesPath(request, '/arbitrary/resources/search'), request);

    case 'IS_USING_PUBLIC_NODE': {
      const connection = await getNodeConnection();

      return connection.mode === 'network';
    }

    case 'WHICH_UI':
      return 'QORTIUM_HOME_ELECTRON';

    case 'SHOW_ACTIONS':
      return [
        'FETCH_NODE_API',
        'FETCH_QDN_RESOURCE',
        'GET_ACCOUNT_DATA',
        'GET_ACCOUNT_NAMES',
        'GET_API',
        'GET_BALANCE',
        'GET_NAME_DATA',
        'GET_NODE_API',
        'GET_NODE_INFO',
        'GET_NODE_STATUS',
        'GET_QDN_RESOURCE_METADATA',
        'GET_QDN_RESOURCE_PROPERTIES',
        'GET_QDN_RESOURCE_STATUS',
        'GET_QDN_RESOURCE_URL',
        'IS_USING_PUBLIC_NODE',
        'LIST_QDN_RESOURCES',
        'SEARCH_QDN_RESOURCES',
        'WHICH_UI',
      ];

    default:
      throw new Error(`${action || 'This'} QDN app request is not supported yet.`);
  }
}

export function registerQdnIpcHandlers() {
  ipcMain.handle('qdn-app:request', async (event, request: unknown) => {
    if (!getQdnViewContextForWebContents(event.sender)) {
      throw new Error('QDN app requests are only available to isolated QDN app views.');
    }

    return handleQdnAppRequest(request);
  });

  ipcMain.handle('qdn:authorizeResource', async (_event, request: QdnAuthorizeResourceRequest) => {
    const { service, name, identifier } = getAuthorizeRequest(request);
    const connection = await getNodeConnection();

    if (connection.mode === 'network') {
      return {
        authorized: true,
        nodeApiUrl: connection.nodeApiUrl,
      };
    }

    const apiKey = getNodeApiKey();

    await authorizeResource(service, name, undefined, apiKey, connection.nodeApiUrl);

    if (identifier) {
      await authorizeResource(service, name, identifier, apiKey, connection.nodeApiUrl);
    }

    return {
      authorized: true,
      nodeApiUrl: connection.nodeApiUrl,
    };
  });

  ipcMain.handle('qdn:listResources', async (_event, request: QdnResourcesSearchRequest) => {
    const { connection, response } = await fetchConfiguredNode(buildResourcesSearchPath(request));
    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        response.status === 403 && connection.mode === 'network'
          ? getNetworkRestrictionMessage()
          : text || `Qortium node request failed with HTTP ${response.status}.`,
      );
    }

    return text ? (JSON.parse(text) as unknown) : null;
  });

  ipcMain.handle('qdn:fetchNodeApi', async (_event, request: NodeApiRequest) => {
    const apiPath = getNodeApiPath(request.path, 'http://127.0.0.1');
    const maxBytes = Math.max(0, Math.floor(getNumber(request.maxBytes) ?? 0));
    const { connection, response } = await fetchConfiguredNode(apiPath);
    const contentLength = getContentLength(response);
    const contentType = response.headers.get('content-type') ?? '';

    if (maxBytes > 0 && typeof contentLength === 'number' && contentLength > maxBytes) {
      await response.body?.cancel();

      return {
        contentLength,
        contentType,
        status: response.status,
        statusText: response.statusText,
        tooLarge: true,
      };
    }

    const rawBody = await response.text();
    const body =
      response.status === 403 && connection.mode === 'network'
        ? getNetworkRestrictionMessage()
        : rawBody;
    const bodyLength = Buffer.byteLength(body, 'utf8');

    if (maxBytes > 0 && bodyLength > maxBytes) {
      return {
        contentLength: bodyLength,
        contentType,
        status: response.status,
        statusText: response.statusText,
        tooLarge: true,
      };
    }

    return {
      body,
      contentLength: contentLength ?? bodyLength,
      contentType,
      status: response.status,
      statusText: response.statusText,
      tooLarge: false,
    };
  });

  ipcMain.handle('qdn:fetchResourceText', async (_event, request: QdnRawResourceRequest) => {
    const resource = getRawResourceRequest(request);
    const maxBytes = Math.max(0, Math.floor(getNumber(request.maxBytes) ?? 0));
    const response = await fetchConfiguredRawResource(resource);
    const contentLength = getContentLength(response);
    const contentType = response.headers.get('content-type') ?? '';

    if (maxBytes > 0 && typeof contentLength === 'number' && contentLength > maxBytes) {
      await response.body?.cancel();

      return {
        contentLength,
        contentType,
        tooLarge: true,
      };
    }

    const content = await response.text();

    if (maxBytes > 0 && Buffer.byteLength(content, 'utf8') > maxBytes) {
      return {
        contentLength: Buffer.byteLength(content, 'utf8'),
        contentType,
        tooLarge: true,
      };
    }

    return {
      content,
      contentLength,
      contentType,
      tooLarge: false,
    };
  });

  ipcMain.handle('qdn:downloadResource', async (event, request: QdnRawResourceRequest) => {
    const resource = getRawResourceRequest(request);
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const saveDialogOptions = {
      title: 'Save QDN Resource',
      defaultPath: getDefaultDownloadPath(getSuggestedFilename(request, resource)),
    };
    const result = parentWindow
      ? await dialog.showSaveDialog(parentWindow, saveDialogOptions)
      : await dialog.showSaveDialog(saveDialogOptions);

    if (result.canceled || !result.filePath) {
      return {
        canceled: true,
      };
    }

    const response = await fetchConfiguredRawResource(resource, true);
    const content = Buffer.from(await response.arrayBuffer());
    writeFileSync(result.filePath, content);

    return {
      canceled: false,
      filePath: result.filePath,
    };
  });
}
