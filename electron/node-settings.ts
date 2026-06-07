import { app, ipcMain } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getManagedCoreRuntimePath, isManagedCoreRuntimeRunning } from './core-manager.js';
import {
  ensurePreviewApiKey,
  readPreviewApiKey,
  readRunningLocalCoreApiKey,
} from './local-api-key.js';

const DEFAULT_LOCAL_NODE_API_URL = 'http://127.0.0.1:24891';
const NODE_SETTINGS_FILE = 'node-settings.json';
const PREVIEWNET_API_PORT = '24891';
const PREVIEWNET_SEED_NODE_API_URLS = [
  'http://146.103.42.59:24891',
  'http://185.207.104.78:24891',
];
const PUBLIC_READ_PROBE_PATH =
  '/arbitrary/resources/search?mode=ALL&limit=1&includestatus=false&includemetadata=false';
const DISCOVERY_TIMEOUT_MS = 5_000;
const DISCOVERY_CACHE_TTL_MS = 5 * 60_000;

type NodeSettingsMode = 'custom' | 'local' | 'network';

type NodeSettings = {
  apiKey: string;
  customUrl: string;
  mode: NodeSettingsMode;
};

type NodeSettingsRequest = {
  apiKey?: unknown;
  customUrl?: unknown;
  mode?: unknown;
};

type DiscoveryCandidate = {
  height: number;
  isSeed: boolean;
  isSynchronizing: boolean;
  nodeApiUrl: string;
  peerCount: number;
  status: unknown;
  supportsPublicReads: boolean;
};

type DiscoveryCache = {
  expiresAt: number;
  nodeApiUrl: string;
};

export type NodeConnection = {
  apiKey?: string;
  mode: NodeSettingsMode;
  nodeApiUrl: string;
};

let discoveryCache: DiscoveryCache | null = null;

function getNetworkRestrictionMessage() {
  return 'The selected Previewnet network node is public read-only and does not expose that endpoint. Use a local Core or trusted custom node for write, admin, or private API workflows.';
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getNodeSettingsPath() {
  return path.join(app.getPath('userData'), NODE_SETTINGS_FILE);
}

function getLocalNodeApiUrl() {
  try {
    return normalizeNodeApiUrl(process.env.QORTIUM_HOME_NODE_API_URL ?? DEFAULT_LOCAL_NODE_API_URL);
  } catch {
    return DEFAULT_LOCAL_NODE_API_URL;
  }
}

function hasExplicitLocalNodeApiUrl() {
  return !!process.env.QORTIUM_HOME_NODE_API_URL?.trim();
}

function normalizeNodeApiUrl(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    throw new Error('Node URL is required.');
  }

  const candidate = /^https?:\/\//i.test(trimmedValue) ? trimmedValue : `http://${trimmedValue}`;
  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    throw new Error('Enter a valid node URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Node URL must use HTTP or HTTPS.');
  }

  if (url.username || url.password) {
    throw new Error('Node URL cannot include a username or password.');
  }

  if (!url.hostname) {
    throw new Error('Node URL must include a host.');
  }

  return url.origin;
}

function getDefaultNodeSettings(): NodeSettings {
  return {
    apiKey: '',
    customUrl: '',
    mode: 'local',
  };
}

function parseStoredNodeSettings(value: unknown): NodeSettings {
  if (!value || typeof value !== 'object') {
    return getDefaultNodeSettings();
  }

  const rawSettings = value as Partial<NodeSettings>;
  const apiKey = getString(rawSettings.apiKey);
  const rawCustomUrl = getString(rawSettings.customUrl);
  let customUrl = '';

  if (rawCustomUrl) {
    try {
      customUrl = normalizeNodeApiUrl(rawCustomUrl);
    } catch {
      customUrl = '';
    }
  }

  const rawMode = (rawSettings as { mode?: unknown }).mode;

  if (rawMode === 'custom' && customUrl) {
    return {
      apiKey,
      customUrl,
      mode: 'custom',
    };
  }

  if (rawMode === 'network') {
    return {
      apiKey: '',
      customUrl,
      mode: 'network',
    };
  }

  if (rawMode === 'local' || rawMode === 'previewnet') {
    return {
      apiKey: rawMode === 'local' ? apiKey : '',
      customUrl,
      mode: 'local',
    };
  }

  return {
    apiKey,
    customUrl,
    mode: 'local',
  };
}

function readNodeSettings(): NodeSettings {
  try {
    const parsedSettings: unknown = JSON.parse(readFileSync(getNodeSettingsPath(), 'utf8'));

    return parseStoredNodeSettings(parsedSettings);
  } catch {
    return getDefaultNodeSettings();
  }
}

function writeNodeSettings(settings: NodeSettings) {
  const settingsPath = getNodeSettingsPath();

  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

function expandHomePath(value: string) {
  const trimmedValue = value.trim();

  if (trimmedValue === '~') {
    return app.getPath('home');
  }

  if (trimmedValue.startsWith('~/') || trimmedValue.startsWith('~\\')) {
    return path.join(app.getPath('home'), trimmedValue.slice(2));
  }

  return trimmedValue;
}

function readTrimmedFile(filePath: string) {
  try {
    return readFileSync(expandHomePath(filePath), 'utf8').trim();
  } catch {
    return '';
  }
}

function getNodeApiKeyOverride() {
  const explicitApiKey = process.env.QORTIUM_HOME_NODE_API_KEY?.trim();

  if (explicitApiKey) {
    return explicitApiKey;
  }

  const explicitApiKeyPath = process.env.QORTIUM_HOME_NODE_API_KEY_PATH?.trim();

  if (explicitApiKeyPath) {
    return readTrimmedFile(explicitApiKeyPath);
  }

  return '';
}

function getConfiguredNodeApiKey(settings: NodeSettings) {
  if (settings.mode === 'network') {
    return '';
  }

  return getNodeApiKeyOverride() || settings.apiKey;
}

async function resolveLocalApiKey(settings: NodeSettings): Promise<NodeSettings> {
  if (settings.mode !== 'local' || hasExplicitLocalNodeApiUrl()) {
    return settings;
  }

  const runtimePath = await getManagedCoreRuntimePath();
  const runningCoreApiKey = readRunningLocalCoreApiKey();
  const managedRuntimeRunning = await isManagedCoreRuntimeRunning();
  const existingManagedCoreApiKey = runtimePath ? readPreviewApiKey(runtimePath) : null;
  const managedCoreApiKey =
    existingManagedCoreApiKey ??
    (runtimePath && (managedRuntimeRunning || !settings.apiKey) ? ensurePreviewApiKey(runtimePath) : null);

  if (settings.apiKey) {
    if (runningCoreApiKey && runningCoreApiKey.apiKey !== settings.apiKey) {
      const resolvedSettings = {
        ...settings,
        apiKey: runningCoreApiKey.apiKey,
      };

      writeNodeSettings(resolvedSettings);

      return resolvedSettings;
    }

    if (managedRuntimeRunning && managedCoreApiKey && managedCoreApiKey.apiKey !== settings.apiKey) {
      const resolvedSettings = {
        ...settings,
        apiKey: managedCoreApiKey.apiKey,
      };

      writeNodeSettings(resolvedSettings);

      return resolvedSettings;
    }

    if (
      managedCoreApiKey?.apiKey === settings.apiKey &&
      !managedRuntimeRunning &&
      (!runningCoreApiKey || runningCoreApiKey.apiKey !== settings.apiKey)
    ) {
      const resolvedSettings = {
        ...settings,
        apiKey: '',
      };

      writeNodeSettings(resolvedSettings);

      return resolvedSettings;
    }

    return settings;
  }

  if (runningCoreApiKey) {
    const resolvedSettings = {
      ...settings,
      apiKey: runningCoreApiKey.apiKey,
    };

    writeNodeSettings(resolvedSettings);

    return resolvedSettings;
  }

  if (!runtimePath || !managedRuntimeRunning || !managedCoreApiKey?.apiKey) {
    return settings;
  }

  const resolvedSettings = {
    ...settings,
    apiKey: managedCoreApiKey.apiKey,
  };

  writeNodeSettings(resolvedSettings);

  return resolvedSettings;
}

function normalizeNodeSettingsRequest(value: NodeSettingsRequest): NodeSettings {
  if (!value || typeof value !== 'object') {
    throw new Error('Node settings are required.');
  }

  if (value.mode !== 'local' && value.mode !== 'network' && value.mode !== 'custom') {
    throw new Error('Choose the local node, Previewnet network, or a custom node.');
  }

  const rawCustomUrl = getString(value.customUrl);
  const customUrl = rawCustomUrl ? normalizeNodeApiUrl(rawCustomUrl) : '';
  const apiKey = value.mode === 'network' ? '' : getString(value.apiKey);

  if (value.mode === 'custom' && !customUrl) {
    throw new Error('Custom node URL is required.');
  }

  return {
    apiKey,
    customUrl,
    mode: value.mode,
  };
}

function getFallbackNodeApiUrl(settings: NodeSettings) {
  if (settings.mode === 'custom' && settings.customUrl) {
    return settings.customUrl;
  }

  if (settings.mode === 'network') {
    return PREVIEWNET_SEED_NODE_API_URLS[0];
  }

  return getLocalNodeApiUrl();
}

function normalizeCandidateNodeApiUrl(value: string) {
  const normalizedUrl = new URL(normalizeNodeApiUrl(value));

  normalizedUrl.port = PREVIEWNET_API_PORT;

  return normalizedUrl.origin;
}

function isPreviewnetSeedNodeApiUrl(nodeApiUrl: string) {
  try {
    const normalizedNodeApiUrl = normalizeCandidateNodeApiUrl(nodeApiUrl);

    return PREVIEWNET_SEED_NODE_API_URLS.map(normalizeCandidateNodeApiUrl).includes(
      normalizedNodeApiUrl,
    );
  } catch {
    return false;
  }
}

function peerAddressToNodeApiUrl(value: unknown) {
  const address = getString(value);

  if (!address) {
    return null;
  }

  try {
    const candidate = /^https?:\/\//i.test(address) ? address : `http://${address}`;
    const url = new URL(candidate);

    if (!url.hostname) {
      return null;
    }

    url.protocol = 'http:';
    url.username = '';
    url.password = '';
    url.port = PREVIEWNET_API_PORT;
    url.pathname = '';
    url.search = '';
    url.hash = '';

    return url.origin;
  } catch {
    return null;
  }
}

function getKnownPeerAddress(value: unknown) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return getString((value as { address?: unknown }).address);
}

function getStatusHeight(status: unknown) {
  if (!status || typeof status !== 'object') {
    return 0;
  }

  const height = (status as { height?: unknown }).height;

  return typeof height === 'number' && Number.isFinite(height) ? height : 0;
}

function getStatusPeerCount(status: unknown) {
  if (!status || typeof status !== 'object') {
    return 0;
  }

  const statusObject = status as {
    numberOfConnections?: unknown;
    numberOfDataConnections?: unknown;
  };
  const chainPeers =
    typeof statusObject.numberOfConnections === 'number' ? statusObject.numberOfConnections : 0;
  const dataPeers =
    typeof statusObject.numberOfDataConnections === 'number' ? statusObject.numberOfDataConnections : 0;

  return chainPeers + dataPeers;
}

function getStatusIsSynchronizing(status: unknown) {
  if (!status || typeof status !== 'object') {
    return true;
  }

  const isSynchronizing = (status as { isSynchronizing?: unknown }).isSynchronizing;

  return typeof isSynchronizing === 'boolean' ? isSynchronizing : true;
}

async function fetchWithTimeout(url: string) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), DISCOVERY_TIMEOUT_MS);

  try {
    return await fetch(url, {
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchKnownPeerNodeApiUrls(seedNodeApiUrl: string) {
  try {
    const response = await fetchWithTimeout(`${seedNodeApiUrl}/peers/known`);

    if (!response.ok) {
      return [];
    }

    const data: unknown = await response.json();

    if (!Array.isArray(data)) {
      return [];
    }

    return data
      .map(getKnownPeerAddress)
      .map(peerAddressToNodeApiUrl)
      .filter((nodeApiUrl): nodeApiUrl is string => !!nodeApiUrl);
  } catch {
    return [];
  }
}

async function probePublicReadAccess(nodeApiUrl: string) {
  try {
    const response = await fetchWithTimeout(`${nodeApiUrl}${PUBLIC_READ_PROBE_PATH}`);

    return response.ok;
  } catch {
    return false;
  }
}

async function probeNodeCandidate(nodeApiUrl: string): Promise<DiscoveryCandidate | null> {
  try {
    const response = await fetchWithTimeout(`${nodeApiUrl}/admin/status`);

    if (!response.ok) {
      return null;
    }

    const status: unknown = await response.json();

    return {
      nodeApiUrl,
      status,
      height: getStatusHeight(status),
      isSeed: isPreviewnetSeedNodeApiUrl(nodeApiUrl),
      isSynchronizing: getStatusIsSynchronizing(status),
      peerCount: getStatusPeerCount(status),
      supportsPublicReads: await probePublicReadAccess(nodeApiUrl),
    };
  } catch {
    return null;
  }
}

function rankDiscoveryCandidates(candidates: DiscoveryCandidate[]) {
  return [...candidates].sort((first, second) => {
    if (first.supportsPublicReads !== second.supportsPublicReads) {
      return first.supportsPublicReads ? -1 : 1;
    }

    if (first.isSeed !== second.isSeed) {
      return first.isSeed ? 1 : -1;
    }

    if (first.isSynchronizing !== second.isSynchronizing) {
      return first.isSynchronizing ? 1 : -1;
    }

    if (first.height !== second.height) {
      return second.height - first.height;
    }

    return second.peerCount - first.peerCount;
  });
}

async function discoverPreviewnetNode(forceRefresh = false): Promise<DiscoveryCandidate> {
  if (!forceRefresh && discoveryCache && discoveryCache.expiresAt > Date.now()) {
    const cachedCandidate = await probeNodeCandidate(discoveryCache.nodeApiUrl);

    if (cachedCandidate?.supportsPublicReads) {
      return cachedCandidate;
    }
  }

  const candidateUrls = new Set(PREVIEWNET_SEED_NODE_API_URLS.map(normalizeCandidateNodeApiUrl));
  const knownPeerResults = await Promise.all(
    PREVIEWNET_SEED_NODE_API_URLS.map(fetchKnownPeerNodeApiUrls),
  );

  for (const peerNodeApiUrls of knownPeerResults) {
    for (const peerNodeApiUrl of peerNodeApiUrls) {
      candidateUrls.add(peerNodeApiUrl);
    }
  }

  const candidates = (
    await Promise.all([...candidateUrls].map((nodeApiUrl) => probeNodeCandidate(nodeApiUrl)))
  ).filter((candidate): candidate is DiscoveryCandidate => !!candidate);
  const selectedCandidate = rankDiscoveryCandidates(candidates)[0];

  if (!selectedCandidate) {
    throw new Error('No reachable Previewnet node was found.');
  }

  discoveryCache = {
    nodeApiUrl: selectedCandidate.nodeApiUrl,
    expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
  };

  return selectedCandidate;
}

async function resolveNodeApiUrl(settings: NodeSettings, forceDiscoveryRefresh = false) {
  if (settings.mode === 'custom' && settings.customUrl) {
    return settings.customUrl;
  }

  if (settings.mode === 'network') {
    return (await discoverPreviewnetNode(forceDiscoveryRefresh)).nodeApiUrl;
  }

  return getLocalNodeApiUrl();
}

async function getNodeSettingsSnapshot(settings = readNodeSettings()) {
  settings = await resolveLocalApiKey(settings);

  let nodeApiUrl = getFallbackNodeApiUrl(settings);

  try {
    nodeApiUrl = await resolveNodeApiUrl(settings);
  } catch {
    nodeApiUrl = getFallbackNodeApiUrl(settings);
  }

  return {
    ...settings,
    localUrl: getLocalNodeApiUrl(),
    networkModeAvailable: true,
    networkSeedUrls: PREVIEWNET_SEED_NODE_API_URLS,
    nodeApiUrl,
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to reach the configured node.';
}

function getProtectedNodeApiKey(settings: NodeSettings) {
  const apiKey = getConfiguredNodeApiKey(settings);

  if (!apiKey) {
    if (settings.mode === 'local') {
      throw new Error('Install or start Qortium Core, or save the local node API key to check approved on-chain Core updates.');
    }

    if (settings.mode === 'custom') {
      throw new Error('Save the custom node API key to check approved on-chain Core updates.');
    }

    throw new Error('Qortium node API key was not found.');
  }

  return apiKey;
}

export function isInvalidApiKeyResponse(response: Response, text: string) {
  if (response.status === 401 || response.status === 403) {
    return true;
  }

  if (text.toLowerCase().includes('api key invalid')) {
    return true;
  }

  try {
    const parsedError: unknown = JSON.parse(text);

    return !!parsedError && typeof parsedError === 'object' && Number((parsedError as { error?: unknown }).error) === 4;
  } catch {
    return false;
  }
}

async function refreshLocalApiKey(settings: NodeSettings) {
  if (settings.mode !== 'local' || hasExplicitLocalNodeApiUrl()) {
    return settings;
  }

  const refreshedSettings = await resolveLocalApiKey({
    ...settings,
    apiKey: '',
  });

  if (!refreshedSettings.apiKey && settings.apiKey) {
    writeNodeSettings(refreshedSettings);
  }

  return refreshedSettings;
}

export async function refreshNodeConnectionApiKey(connection: NodeConnection): Promise<NodeConnection | null> {
  if (connection.mode !== 'local' || hasExplicitLocalNodeApiUrl()) {
    return null;
  }

  const refreshedSettings = await refreshLocalApiKey(readNodeSettings());
  const refreshedConnection = {
    apiKey: getConfiguredNodeApiKey(refreshedSettings),
    mode: refreshedSettings.mode,
    nodeApiUrl: await resolveNodeApiUrl(refreshedSettings),
  };

  if (
    refreshedConnection.mode !== 'local' ||
    !refreshedConnection.apiKey ||
    refreshedConnection.apiKey === connection.apiKey
  ) {
    return null;
  }

  return refreshedConnection;
}

async function fetchProtectedNodeResponse(
  settings: NodeSettings,
  pathname: string,
  method: 'GET' | 'POST',
) {
  const nodeApiUrl = await resolveNodeApiUrl(settings);
  const apiKey = getProtectedNodeApiKey(settings);
  let response: Response;

  try {
    response = await fetch(`${nodeApiUrl}${pathname}`, {
      method,
      headers: {
        Accept: 'application/json',
        'X-API-KEY': apiKey,
      },
    });
  } catch {
    throw new Error(`Qortium node is unavailable at ${nodeApiUrl}.`);
  }

  return {
    nodeApiUrl,
    response,
    text: await response.text(),
  };
}

async function requestProtectedNodeJson(
  settings: NodeSettings,
  pathname: string,
  method: 'GET' | 'POST',
  fallbackMessage: string,
) {
  if (settings.mode === 'network') {
    throw new Error(getNetworkRestrictionMessage());
  }

  const resolvedSettings = await resolveLocalApiKey(settings);
  let result = await fetchProtectedNodeResponse(resolvedSettings, pathname, method);

  if (
    !result.response.ok &&
    resolvedSettings.mode === 'local' &&
    isInvalidApiKeyResponse(result.response, result.text)
  ) {
    const refreshedSettings = await refreshLocalApiKey(resolvedSettings);

    if (refreshedSettings.apiKey && refreshedSettings.apiKey !== resolvedSettings.apiKey) {
      result = await fetchProtectedNodeResponse(refreshedSettings, pathname, method);
    }
  }

  if (!result.response.ok) {
    throw new Error(result.text || fallbackMessage);
  }

  return result.text ? (JSON.parse(result.text) as unknown) : null;
}

async function fetchNodeStatus(nodeApiUrl: string) {
  let response: Response;

  try {
    response = await fetch(`${nodeApiUrl}/admin/status`);
  } catch {
    throw new Error(`Qortium node is unavailable at ${nodeApiUrl}.`);
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `Node status request failed with HTTP ${response.status}.`);
  }

  return text ? (JSON.parse(text) as unknown) : null;
}

async function testNodeSettings(settings: NodeSettings) {
  let nodeApiUrl = getFallbackNodeApiUrl(settings);

  try {
    nodeApiUrl = await resolveNodeApiUrl(settings);

    return {
      ok: true,
      nodeApiUrl,
      status: await fetchNodeStatus(nodeApiUrl),
    };
  } catch (error) {
    if (settings.mode === 'network') {
      try {
        nodeApiUrl = await resolveNodeApiUrl(settings, true);

        return {
          ok: true,
          nodeApiUrl,
          status: await fetchNodeStatus(nodeApiUrl),
        };
      } catch (retryError) {
        return {
          ok: false,
          nodeApiUrl,
          message: getErrorMessage(retryError),
        };
      }
    }

    return {
      ok: false,
      nodeApiUrl,
      message: getErrorMessage(error),
    };
  }
}

function checkCoreUpdateStatus() {
  return requestProtectedNodeJson(
    readNodeSettings(),
    '/admin/update',
    'GET',
    'Core on-chain update check failed.',
  );
}

function installCoreUpdate() {
  return requestProtectedNodeJson(
    readNodeSettings(),
    '/admin/update',
    'POST',
    'Core on-chain update install request failed.',
  );
}

export async function getNodeConnection(forceDiscoveryRefresh = false): Promise<NodeConnection> {
  const settings = await resolveLocalApiKey(readNodeSettings());

  return {
    apiKey: getConfiguredNodeApiKey(settings),
    mode: settings.mode,
    nodeApiUrl: await resolveNodeApiUrl(settings, forceDiscoveryRefresh),
  };
}

export async function getNodeApiUrl(forceDiscoveryRefresh = false) {
  return (await getNodeConnection(forceDiscoveryRefresh)).nodeApiUrl;
}

export function registerNodeSettingsIpcHandlers() {
  ipcMain.handle('node:getSettings', () => getNodeSettingsSnapshot());

  ipcMain.handle('node:checkCoreUpdate', () => {
    return checkCoreUpdateStatus();
  });

  ipcMain.handle('node:installCoreUpdate', () => {
    return installCoreUpdate();
  });

  ipcMain.handle('node:saveSettings', async (_event, request: NodeSettingsRequest) => {
    const settings = normalizeNodeSettingsRequest(request);

    writeNodeSettings(settings);

    return await getNodeSettingsSnapshot(settings);
  });

  ipcMain.handle('node:testConnection', (_event, request: NodeSettingsRequest) => {
    return testNodeSettings(normalizeNodeSettingsRequest(request));
  });

  ipcMain.handle('node:getStatus', () => {
    return testNodeSettings(readNodeSettings());
  });
}
