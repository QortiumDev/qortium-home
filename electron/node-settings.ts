import { app, ipcMain } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  getManagedCoreRuntimePath,
  isManagedCoreRuntimeRunning,
  scheduleManagedCoreUpdateCheck,
} from './core-manager.js';
import { withCoreInstallLockForNetwork } from './core-install-lock.js';
import { QORTIUM_CORE_DESCRIPTOR } from './core-network-descriptor.js';
import { userMessage } from './user-message.js';
import {
  ensurePreviewApiKey,
  readPreviewApiKey,
  readRunningLocalCoreApiKey,
} from './local-api-key.js';
import { isNodeApiKeyTransportSafe, normalizeNodeApiUrl } from './node-api-url.js';
import { ensureNodeCa, nodeFetch, resolveNodeTlsTrust } from './node-tls.js';
import {
  isFullySyncedQortiumStatus as isSyncedStatus,
  isUsableQortiumPublicNode as isUsableDiscoveryCandidate,
  QORTIUM_PUBLIC_NODE_API_URLS,
  rankQortiumPublicNodes as rankDiscoveryCandidates,
} from './qortium-public-node-policy.js';
import {
  confirmNodeCertificate,
  forgetNodeCertificate,
  getNodeCertificateStatus,
} from './node-cert-confirmation.js';
import { readableNodeErrorMessage } from './node-error-body.js';
import { chooseResolvedLocalSettingsWrite } from './node-settings-write-policy.js';
import { assertShellWindowSender } from './shell-window-sender.js';

const CERTIFICATE_SENDER_REFUSAL =
  'Node certificate requests are only accepted from a Home window.';
const DEFAULT_LOCAL_NODE_API_URL = 'https://127.0.0.1:24891';
const NODE_DISCOVERY_CACHE_FILE = 'node-discovery-cache.json';
const NODE_SETTINGS_FILE = 'node-settings.json';
const nodeSettingsChangeListeners = new Set<() => void>();
const PUBLIC_READ_PROBE_PATH =
  '/arbitrary/resources/search?mode=ALL&limit=1&includestatus=false&includemetadata=false';
const DISCOVERY_TIMEOUT_MS = 5_000;
const DISCOVERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const DISCOVERY_CACHE_MAX_ENTRIES = 24;
const MANAGED_CORE_SETTINGS_FILE = 'settings-preview-local.json';

export type NodeSettingsMode = 'custom' | 'disabled' | 'local' | 'network';

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
  isSynced: boolean;
  isSynchronizing: boolean;
  latencyMs: number;
  nodeApiUrl: string;
  peerCount: number;
  status: unknown;
  syncBlocksRemaining: number | null;
  syncPercent: number | null;
  syncPhase: string;
  supportsPublicReads: boolean;
};

type DiscoveryCache = {
  entries: DiscoveryCacheEntry[];
};

type DiscoveryCacheEntry = {
  failureCount: number;
  firstGoodAt: number;
  height: number;
  isSeed: boolean;
  lastFailedAt: number | null;
  lastGoodAt: number;
  nodeApiUrl: string;
  peerCount: number;
};

type DiscoveryProbeResult = {
  candidate: DiscoveryCandidate | null;
  nodeApiUrl: string;
};

type CoreTransportSettings = {
  allowedTransports: string[] | null;
  i2pSamHost: string;
  i2pSamPort: number;
  i2pChainKeyFile: string;
  i2pDataKeyFile: string;
  i2pEmbeddedRouter: boolean;
};

type CoreTransportStatusSnapshot = {
  chainPeers: unknown[];
  coreRunning: boolean;
  dataPeers: unknown[];
  settings: CoreTransportSettings;
  source: 'live-node' | 'managed-runtime';
};

let selectedPublicNodeApiUrl: string | null = null;

export type NodeConnection = {
  apiKey?: string;
  mode: NodeSettingsMode;
  nodeApiUrl: string;
};

function nodeDisabledError() {
  return Object.assign(new Error('Qortium access is disabled.'), {
    code: 'NODE_DISABLED',
  });
}

function getNetworkRestrictionMessage() {
  return 'The selected Qortium Public node is read-only and does not expose that endpoint. Use a local Core or trusted custom node for write, admin, or private API workflows.';
}

function networkRestrictionError() {
  return Object.assign(new Error(getNetworkRestrictionMessage()), { code: 'PUBLIC_NODE_READ_ONLY' });
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getNodeSettingsPath() {
  return path.join(app.getPath('userData'), NODE_SETTINGS_FILE);
}

function getNodeDiscoveryCachePath() {
  return path.join(app.getPath('userData'), NODE_DISCOVERY_CACHE_FILE);
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

  if (rawMode === 'disabled') {
    return {
      apiKey: '',
      customUrl,
      mode: 'disabled',
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
  selectedPublicNodeApiUrl = null;
}

function writeResolvedLocalApiKey(
  expected: NodeSettings,
  resolved: NodeSettings,
) {
  const current = readNodeSettings();
  const selected = chooseResolvedLocalSettingsWrite(
    current,
    expected,
    resolved,
  );

  if (selected === resolved) {
    writeNodeSettings(resolved);
  }

  return selected;
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
  if (settings.mode === 'network' || settings.mode === 'disabled') {
    return '';
  }

  return getNodeApiKeyOverride() || settings.apiKey;
}

async function ensureNodeTls(nodeApiUrl: string, apiKey: string | null) {
  await ensureNodeCa(nodeApiUrl, apiKey);
}

// The API key never leaves this machine for a node whose certificate has not
// been confirmed. The TLS layer already refuses that connection, so this is the
// second half of the same rule rather than the only one: the key is not even
// handed to the code that would send it.
function getSendableNodeApiKey(settings: NodeSettings, nodeApiUrl: string) {
  const apiKey = getConfiguredNodeApiKey(settings);

  if (!apiKey || !isNodeApiKeyTransportSafe(nodeApiUrl)) {
    return '';
  }

  return resolveNodeTlsTrust(nodeApiUrl).kind === 'unconfirmed' ? '' : apiKey;
}

function assertNodeCertificateConfirmed(nodeApiUrl: string) {
  const trust = resolveNodeTlsTrust(nodeApiUrl);

  if (trust.kind === 'unconfirmed') {
    throw new Error(trust.reason);
  }
}

async function resolveLocalApiKey(
  settings: NodeSettings,
  expected: NodeSettings = settings,
): Promise<NodeSettings> {
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

      return writeResolvedLocalApiKey(expected, resolvedSettings);
    }

    if (managedRuntimeRunning && managedCoreApiKey && managedCoreApiKey.apiKey !== settings.apiKey) {
      const resolvedSettings = {
        ...settings,
        apiKey: managedCoreApiKey.apiKey,
      };

      return writeResolvedLocalApiKey(expected, resolvedSettings);
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

      return writeResolvedLocalApiKey(expected, resolvedSettings);
    }

    return settings;
  }

  if (runningCoreApiKey) {
    const resolvedSettings = {
      ...settings,
      apiKey: runningCoreApiKey.apiKey,
    };

    return writeResolvedLocalApiKey(expected, resolvedSettings);
  }

  if (!runtimePath || !managedRuntimeRunning || !managedCoreApiKey?.apiKey) {
    return settings;
  }

  const resolvedSettings = {
    ...settings,
    apiKey: managedCoreApiKey.apiKey,
  };

  return writeResolvedLocalApiKey(expected, resolvedSettings);
}

function normalizeNodeSettingsRequest(value: NodeSettingsRequest): NodeSettings {
  if (!value || typeof value !== 'object') {
    throw new Error('Node settings are required.');
  }

  if (
    value.mode !== 'disabled' &&
    value.mode !== 'local' &&
    value.mode !== 'network' &&
    value.mode !== 'custom'
  ) {
    throw new Error('Choose Disabled, Local, Public, or Custom.');
  }

  const rawCustomUrl = getString(value.customUrl);
  const customUrl = rawCustomUrl ? normalizeNodeApiUrl(rawCustomUrl) : '';
  const apiKey = value.mode === 'network' || value.mode === 'disabled' ? '' : getString(value.apiKey);

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
  if (settings.mode === 'disabled') {
    return '';
  }
  if (settings.mode === 'custom' && settings.customUrl) {
    return settings.customUrl;
  }

  if (settings.mode === 'network') {
    return QORTIUM_PUBLIC_NODE_API_URLS[0];
  }

  return getLocalNodeApiUrl();
}

function normalizeCandidateNodeApiUrl(value: string) {
  return new URL(normalizeNodeApiUrl(value)).origin;
}

function isQortiumPublicNodeApiUrl(nodeApiUrl: string) {
  try {
    const normalizedNodeApiUrl = normalizeCandidateNodeApiUrl(nodeApiUrl);

    return QORTIUM_PUBLIC_NODE_API_URLS.map(normalizeCandidateNodeApiUrl).includes(
      normalizedNodeApiUrl,
    );
  } catch {
    return false;
  }
}

function createDiscoveryCacheEntry(candidate: DiscoveryCandidate, existing?: DiscoveryCacheEntry): DiscoveryCacheEntry {
  const now = Date.now();

  return {
    failureCount: 0,
    firstGoodAt: existing?.firstGoodAt ?? now,
    height: candidate.height,
    isSeed: candidate.isSeed,
    lastFailedAt: null,
    lastGoodAt: now,
    nodeApiUrl: normalizeCandidateNodeApiUrl(candidate.nodeApiUrl),
    peerCount: candidate.peerCount,
  };
}

function parseDiscoveryCacheEntry(value: unknown): DiscoveryCacheEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const entry = value as Partial<DiscoveryCacheEntry>;

  if (typeof entry.nodeApiUrl !== 'string' || typeof entry.lastGoodAt !== 'number') {
    return null;
  }

  try {
    return {
      failureCount: Math.max(0, getNumber(entry.failureCount)),
      firstGoodAt: getNumber(entry.firstGoodAt) || entry.lastGoodAt,
      height: getNumber(entry.height),
      isSeed: getBoolean(entry.isSeed),
      lastFailedAt: typeof entry.lastFailedAt === 'number' && Number.isFinite(entry.lastFailedAt) ? entry.lastFailedAt : null,
      lastGoodAt: entry.lastGoodAt,
      nodeApiUrl: normalizeCandidateNodeApiUrl(entry.nodeApiUrl),
      peerCount: getNumber(entry.peerCount),
    };
  } catch {
    return null;
  }
}

function parseDiscoveryCache(value: unknown): DiscoveryCache {
  if (!value || typeof value !== 'object') {
    return { entries: [] };
  }

  const cache = value as Partial<DiscoveryCache & { expiresAt: number; nodeApiUrl: string }>;

  if (Array.isArray(cache.entries)) {
    return {
      entries: cache.entries
        .map(parseDiscoveryCacheEntry)
        .filter((entry): entry is DiscoveryCacheEntry => !!entry),
    };
  }

  if (typeof cache.nodeApiUrl === 'string' && typeof cache.expiresAt === 'number' && cache.expiresAt > Date.now()) {
    try {
      return {
        entries: [
          {
            failureCount: 0,
            firstGoodAt: Date.now(),
            height: 0,
            isSeed: isQortiumPublicNodeApiUrl(cache.nodeApiUrl),
            lastFailedAt: null,
            lastGoodAt: Date.now(),
            nodeApiUrl: normalizeCandidateNodeApiUrl(cache.nodeApiUrl),
            peerCount: 0,
          },
        ],
      };
    } catch {
      return { entries: [] };
    }
  }

  return { entries: [] };
}

function readDiscoveryCache() {
  try {
    const parsedCache: unknown = JSON.parse(readFileSync(getNodeDiscoveryCachePath(), 'utf8'));
    const cutoff = Date.now() - DISCOVERY_CACHE_MAX_AGE_MS;

    return parseDiscoveryCache(parsedCache).entries
      .filter(
        (entry) =>
          entry.lastGoodAt >= cutoff &&
          isQortiumPublicNodeApiUrl(entry.nodeApiUrl),
      )
      .sort((first, second) => second.lastGoodAt - first.lastGoodAt);
  } catch {
    return [];
  }
}

function writeDiscoveryCache(probeResults: DiscoveryProbeResult[]) {
  const entriesByUrl = new Map(readDiscoveryCache().map((entry) => [entry.nodeApiUrl, entry]));

  for (const { candidate, nodeApiUrl } of probeResults) {
    const normalizedUrl = normalizeCandidateNodeApiUrl(nodeApiUrl);
    const existingEntry = entriesByUrl.get(normalizedUrl);

    if (candidate && isUsableDiscoveryCandidate(candidate)) {
      entriesByUrl.set(normalizedUrl, createDiscoveryCacheEntry(candidate, existingEntry));
    } else if (existingEntry) {
      entriesByUrl.set(normalizedUrl, {
        ...existingEntry,
        failureCount: existingEntry.failureCount + 1,
        lastFailedAt: Date.now(),
      });
    }
  }

  const entries = [...entriesByUrl.values()]
    .sort((first, second) => {
      if (first.lastGoodAt !== second.lastGoodAt) {
        return second.lastGoodAt - first.lastGoodAt;
      }

      return first.failureCount - second.failureCount;
    })
    .slice(0, DISCOVERY_CACHE_MAX_ENTRIES);

  const cachePath = getNodeDiscoveryCachePath();
  mkdirSync(path.dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, `${JSON.stringify({ entries }, null, 2)}\n`, 'utf8');
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

function getStatusSyncPhase(status: unknown) {
  if (!status || typeof status !== 'object') {
    return '';
  }

  const syncPhase = (status as { syncPhase?: unknown }).syncPhase;

  return typeof syncPhase === 'string' ? syncPhase.trim().toUpperCase() : '';
}

function getStatusSyncPercent(status: unknown) {
  if (!status || typeof status !== 'object') {
    return null;
  }

  const syncPercent = (status as { syncPercent?: unknown }).syncPercent;

  return typeof syncPercent === 'number' && Number.isFinite(syncPercent) ? syncPercent : null;
}

function getStatusSyncBlocksRemaining(status: unknown) {
  if (!status || typeof status !== 'object') {
    return null;
  }

  const syncBlocksRemaining = (status as { syncBlocksRemaining?: unknown }).syncBlocksRemaining;

  return typeof syncBlocksRemaining === 'number' && Number.isFinite(syncBlocksRemaining)
    ? syncBlocksRemaining
    : null;
}

async function fetchWithTimeout(url: string) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), DISCOVERY_TIMEOUT_MS);

  try {
    return await nodeFetch(url, {
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timeout);
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
  const startedAt = Date.now();

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
      isSeed: isQortiumPublicNodeApiUrl(nodeApiUrl),
      isSynced: isSyncedStatus(status),
      isSynchronizing: getStatusIsSynchronizing(status),
      latencyMs: Date.now() - startedAt,
      peerCount: getStatusPeerCount(status),
      syncBlocksRemaining: getStatusSyncBlocksRemaining(status),
      syncPercent: getStatusSyncPercent(status),
      syncPhase: getStatusSyncPhase(status),
      supportsPublicReads: await probePublicReadAccess(nodeApiUrl),
    };
  } catch {
    return null;
  }
}

async function discoverQortiumPublicNode(forceRefresh = false): Promise<DiscoveryCandidate> {
  if (!forceRefresh && selectedPublicNodeApiUrl) {
    const selectedCandidate = await probeNodeCandidate(selectedPublicNodeApiUrl);
    const selectedProbeResult = {
      nodeApiUrl: selectedPublicNodeApiUrl,
      candidate: selectedCandidate,
    };

    writeDiscoveryCache([selectedProbeResult]);

    if (selectedCandidate && isUsableDiscoveryCandidate(selectedCandidate)) {
      return selectedCandidate;
    }

    selectedPublicNodeApiUrl = null;
  }

  const candidateUrls = QORTIUM_PUBLIC_NODE_API_URLS.map(normalizeCandidateNodeApiUrl);
  const probeResults = await Promise.all(
    candidateUrls.map(async (nodeApiUrl) => ({
      nodeApiUrl,
      candidate: await probeNodeCandidate(nodeApiUrl),
    })),
  );
  const candidates = probeResults
    .map((result) => result.candidate)
    .filter((candidate): candidate is DiscoveryCandidate => !!candidate);
  const selectedCandidate = rankDiscoveryCandidates(candidates.filter(isUsableDiscoveryCandidate))[0];

  if (!selectedCandidate) {
    writeDiscoveryCache(probeResults);
    throw new Error('No reachable synchronized Qortium Public node was found.');
  }

  selectedPublicNodeApiUrl = selectedCandidate.nodeApiUrl;
  writeDiscoveryCache(probeResults);

  return selectedCandidate;
}

async function resolveNodeApiUrl(settings: NodeSettings, forceDiscoveryRefresh = false) {
  if (settings.mode === 'disabled') {
    throw nodeDisabledError();
  }
  if (settings.mode === 'custom' && settings.customUrl) {
    return settings.customUrl;
  }

  if (settings.mode === 'network') {
    return (await discoverQortiumPublicNode(forceDiscoveryRefresh)).nodeApiUrl;
  }

  return getLocalNodeApiUrl();
}

async function getNodeSettingsSnapshot(settings = readNodeSettings()) {
  settings = await resolveLocalApiKey(settings);

  if (settings.mode === 'disabled') {
    return {
      ...settings,
      customAuthenticated: false,
      localUrl: getLocalNodeApiUrl(),
      networkModeAvailable: true,
      networkSeedUrls: QORTIUM_PUBLIC_NODE_API_URLS,
      nodeApiUrl: '',
    };
  }

  let nodeApiUrl = getFallbackNodeApiUrl(settings);

  try {
    nodeApiUrl = await resolveNodeApiUrl(settings);
  } catch {
    nodeApiUrl = getFallbackNodeApiUrl(settings);
  }

  await ensureNodeTls(nodeApiUrl, getConfiguredNodeApiKey(settings) || null);

  return {
    ...settings,
    customAuthenticated: settings.mode === 'custom' && !!settings.apiKey,
    localUrl: getLocalNodeApiUrl(),
    networkModeAvailable: true,
    networkSeedUrls: QORTIUM_PUBLIC_NODE_API_URLS,
    nodeApiUrl,
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to reach the configured node.';
}

function getProtectedNodeApiKey(settings: NodeSettings, nodeApiUrl: string) {
  const apiKey = getConfiguredNodeApiKey(settings);

  if (apiKey && !isNodeApiKeyTransportSafe(nodeApiUrl)) {
    throw new Error(
      'Home will not send an API key to a remote node over plaintext HTTP. Use HTTPS and confirm its certificate, or connect through loopback.',
    );
  }

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

  const refreshedSettings = await resolveLocalApiKey(
    {
      ...settings,
      apiKey: '',
    },
    settings,
  );

  if (!refreshedSettings.apiKey && settings.apiKey) {
    return writeResolvedLocalApiKey(settings, refreshedSettings);
  }

  return refreshedSettings;
}

export async function refreshNodeConnectionApiKey(connection: NodeConnection): Promise<NodeConnection | null> {
  if (connection.mode !== 'local' || hasExplicitLocalNodeApiUrl()) {
    return null;
  }

  const refreshedSettings = await refreshLocalApiKey(readNodeSettings());
  const refreshedNodeApiUrl = await resolveNodeApiUrl(refreshedSettings);
  const refreshedConnection = {
    apiKey: getSendableNodeApiKey(refreshedSettings, refreshedNodeApiUrl),
    mode: refreshedSettings.mode,
    nodeApiUrl: refreshedNodeApiUrl,
  };

  await ensureNodeTls(refreshedConnection.nodeApiUrl, refreshedConnection.apiKey || null);

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
  method: 'GET' | 'PATCH' | 'POST',
  body?: string,
) {
  const nodeApiUrl = await resolveNodeApiUrl(settings);

  assertNodeCertificateConfirmed(nodeApiUrl);

  const apiKey = getProtectedNodeApiKey(settings, nodeApiUrl);
  let response: Response;

  await ensureNodeTls(nodeApiUrl, apiKey);

  try {
    response = await nodeFetch(`${nodeApiUrl}${pathname}`, {
      method,
      headers: {
        Accept: 'application/json',
        'X-API-KEY': apiKey,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body,
    });
  } catch (error) {
    const detail =
      error instanceof Error && error.message.trim()
        ? `: ${error.message}`
        : '';
    throw new Error(`Qortium node is unavailable at ${nodeApiUrl}${detail}.`);
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
  method: 'GET' | 'PATCH' | 'POST',
  fallbackMessage: string,
  body?: string,
) {
  if (settings.mode === 'network') {
    throw networkRestrictionError();
  }

  const resolvedSettings = await resolveLocalApiKey(settings);
  let result = await fetchProtectedNodeResponse(resolvedSettings, pathname, method, body);

  if (
    !result.response.ok &&
    resolvedSettings.mode === 'local' &&
    isInvalidApiKeyResponse(result.response, result.text)
  ) {
    const refreshedSettings = await refreshLocalApiKey(resolvedSettings);

    if (refreshedSettings.apiKey && refreshedSettings.apiKey !== resolvedSettings.apiKey) {
      result = await fetchProtectedNodeResponse(refreshedSettings, pathname, method, body);
    }
  }

  if (!result.response.ok) {
    throw new Error(readableNodeErrorMessage(result.text, fallbackMessage));
  }

  return result.text ? (JSON.parse(result.text) as unknown) : null;
}

async function fetchNodeStatus(nodeApiUrl: string, apiKey: string | null = null) {
  let response: Response;

  await ensureNodeTls(nodeApiUrl, apiKey);

  try {
    response = await nodeFetch(`${nodeApiUrl}/admin/status`);
  } catch (error) {
    const detail =
      error instanceof Error && error.message.trim()
        ? `: ${error.message}`
        : '';
    throw new Error(`Qortium node is unavailable at ${nodeApiUrl}${detail}.`);
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(readableNodeErrorMessage(text, `Node status request failed with HTTP ${response.status}.`));
  }

  return text ? (JSON.parse(text) as unknown) : null;
}

async function fetchOpenNodeJson(pathname: string, nodeApiUrl: string) {
  try {
    const response = await nodeFetch(`${nodeApiUrl}${pathname}`, {
      headers: {
        Accept: 'application/json',
      },
    });
    const text = await response.text();

    if (!response.ok) {
      return null;
    }

    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

function getAllowedTransports(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : null;
}

function normalizeTransportSettings(value: Record<string, unknown>): CoreTransportSettings {
  return {
    allowedTransports: getAllowedTransports(value.allowedTransports),
    i2pSamHost: getString(value.i2pSamHost) || '127.0.0.1',
    i2pSamPort: getNumber(value.i2pSamPort) || 7656,
    i2pChainKeyFile: getString(value.i2pChainKeyFile),
    i2pDataKeyFile: getString(value.i2pDataKeyFile),
    i2pEmbeddedRouter: getBoolean(value.i2pEmbeddedRouter),
  };
}

async function getLiveTransportStatus(settings: NodeSettings): Promise<CoreTransportStatusSnapshot | null> {
  const nodeApiUrl = await resolveNodeApiUrl(settings);
  await ensureNodeTls(nodeApiUrl, getConfiguredNodeApiKey(settings) || null);

  const rawSettings = await fetchOpenNodeJson('/admin/settings', nodeApiUrl);

  if (!isRecord(rawSettings)) {
    return null;
  }

  const chainPeers = await fetchOpenNodeJson('/peers', nodeApiUrl);
  const dataPeers = await fetchOpenNodeJson('/peers/data', nodeApiUrl);

  return {
    chainPeers: Array.isArray(chainPeers) ? chainPeers : [],
    coreRunning: true,
    dataPeers: Array.isArray(dataPeers) ? dataPeers : [],
    settings: normalizeTransportSettings(rawSettings),
    source: 'live-node',
  };
}

function getManagedCoreSettingsPath(runtimePath: string) {
  return path.join(runtimePath, MANAGED_CORE_SETTINGS_FILE);
}

function readManagedCoreSettings(runtimePath: string) {
  const settingsPath = getManagedCoreSettingsPath(runtimePath);
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    throw new Error(`Managed Core transport settings were not found at ${settingsPath}. Start Core once or reinstall the managed Core runtime before changing transport mode while Core is stopped.`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Managed Core transport settings at ${settingsPath} are not valid JSON settings.`);
  }

  return { parsed, settingsPath };
}

async function getManagedRuntimeTransportStatus(): Promise<CoreTransportStatusSnapshot | null> {
  if (hasExplicitLocalNodeApiUrl() || (await isManagedCoreRuntimeRunning())) {
    return null;
  }

  const runtimePath = await getManagedCoreRuntimePath();

  if (!runtimePath) {
    return null;
  }

  const { parsed } = readManagedCoreSettings(runtimePath);

  return {
    chainPeers: [],
    coreRunning: false,
    dataPeers: [],
    settings: normalizeTransportSettings(parsed),
    source: 'managed-runtime',
  };
}

async function getTransportStatus(): Promise<CoreTransportStatusSnapshot | null> {
  const settings = await resolveLocalApiKey(readNodeSettings());

  try {
    const liveStatus = await getLiveTransportStatus(settings);

    if (liveStatus) {
      return liveStatus;
    }
  } catch {
    // Fall through to the stopped managed-Core file path where appropriate.
  }

  if (settings.mode !== 'local') {
    return null;
  }

  try {
    return await getManagedRuntimeTransportStatus();
  } catch {
    return null;
  }
}

async function testNodeSettings(settings: NodeSettings) {
  if (settings.mode === 'disabled') {
    return {
      disabled: true,
      ok: false,
      nodeApiUrl: '',
      message: 'Qortium access is disabled.',
    };
  }
  const resolvedSettings = await resolveLocalApiKey(settings);
  const apiKey = getConfiguredNodeApiKey(resolvedSettings) || null;
  let nodeApiUrl = getFallbackNodeApiUrl(resolvedSettings);

  try {
    nodeApiUrl = await resolveNodeApiUrl(resolvedSettings);
    // Said plainly here rather than as a TLS failure: the node is reachable, it
    // is the certificate that has not been confirmed yet.
    assertNodeCertificateConfirmed(nodeApiUrl);
    await ensureNodeTls(nodeApiUrl, apiKey);

    return {
      ok: true,
      nodeApiUrl,
      status: await fetchNodeStatus(nodeApiUrl, apiKey),
    };
  } catch (error) {
    if (resolvedSettings.mode === 'network') {
      try {
        nodeApiUrl = await resolveNodeApiUrl(resolvedSettings, true);
        await ensureNodeTls(nodeApiUrl, apiKey);

        return {
          ok: true,
          nodeApiUrl,
          status: await fetchNodeStatus(nodeApiUrl, apiKey),
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
    userMessage('core.error.onChainCheckFailed'),
  );
}

async function installCoreUpdate() {
  const status = await withCoreInstallLockForNetwork(
    QORTIUM_CORE_DESCRIPTOR.id,
    'on-chain',
    async () => {
      const settings = readNodeSettings();
      const status = await requestProtectedNodeJson(
        settings,
        '/admin/update',
        'GET',
        userMessage('core.error.onChainCheckFailed'),
      );

      if (
        status &&
        typeof status === 'object' &&
        String((status as { autoUpdateMode?: unknown }).autoUpdateMode).toUpperCase() === 'INSTALL'
      ) {
        return status;
      }

      return await requestProtectedNodeJson(
        settings,
        '/admin/update',
        'POST',
        userMessage('core.error.onChainInstallFailed'),
      );
    },
  );

  scheduleManagedCoreUpdateCheck();
  return status;
}

async function enableApiDocumentation() {
  const settings = readNodeSettings();
  const updateResult = (await requestProtectedNodeJson(
    settings,
    '/admin/settings',
    'PATCH',
    'Node settings update request failed.',
    JSON.stringify({ apiDocumentationEnabled: true }),
  )) as { saved?: unknown } | null;

  if (updateResult && updateResult.saved === false) {
    throw new Error('The node declined the settings update.');
  }

  await requestProtectedNodeJson(
    settings,
    '/admin/restart',
    'GET',
    'Node restart request failed.',
  );
}

// Accepts only the transports Core understands today, normalized like Core does
// (trim/upper, dedupe). Rejects an empty result so we never disable all transports.
function sanitizeAllowedTransports(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Allowed transports must be a list.');
  }

  const normalized: string[] = [];

  for (const entry of value) {
    const transport = typeof entry === 'string' ? entry.trim().toUpperCase() : '';

    if ((transport === 'IP' || transport === 'I2P') && !normalized.includes(transport)) {
      normalized.push(transport);
    }
  }

  if (normalized.length === 0) {
    throw new Error('Allowed transports must include IP or I2P.');
  }

  return normalized;
}

async function setAllowedTransports(transports: unknown) {
  const allowedTransports = sanitizeAllowedTransports(transports);
  const settings = readNodeSettings();

  if (
    settings.mode === 'local' &&
    !hasExplicitLocalNodeApiUrl() &&
    !(await isManagedCoreRuntimeRunning())
  ) {
    const runtimePath = await getManagedCoreRuntimePath();

    if (!runtimePath) {
      throw new Error('Install Qortium Core before changing the stopped managed Core transport mode.');
    }

    const { parsed, settingsPath } = readManagedCoreSettings(runtimePath);

    writeFileSync(settingsPath, `${JSON.stringify({ ...parsed, allowedTransports }, null, 2)}\n`, 'utf8');
    return;
  }

  const updateResult = (await requestProtectedNodeJson(
    settings,
    '/admin/settings',
    'PATCH',
    'Node settings update request failed.',
    JSON.stringify({ allowedTransports }),
  )) as { saved?: unknown } | null;

  if (updateResult && updateResult.saved === false) {
    throw new Error('The node declined the settings update.');
  }

  // allowedTransports is restart-required: persisted now, effective after restart.
  await requestProtectedNodeJson(
    settings,
    '/admin/restart',
    'GET',
    'Node restart request failed.',
  );
}

export async function getNodeConnection(forceDiscoveryRefresh = false): Promise<NodeConnection> {
  const settings = await resolveLocalApiKey(readNodeSettings());
  const nodeApiUrl = await resolveNodeApiUrl(settings, forceDiscoveryRefresh);
  const apiKey = getSendableNodeApiKey(settings, nodeApiUrl);

  await ensureNodeTls(nodeApiUrl, apiKey || null);

  return {
    apiKey,
    mode: settings.mode,
    nodeApiUrl,
  };
}

export async function getNodeApiUrl(forceDiscoveryRefresh = false) {
  return (await getNodeConnection(forceDiscoveryRefresh)).nodeApiUrl;
}

export async function getNodeSettingsForHomeV2() {
  return getNodeSettingsSnapshot();
}

export async function getNodeStatusForHomeV2() {
  return testNodeSettings(readNodeSettings());
}

export async function getLocalNodeStatusForHomeV2() {
  const current = readNodeSettings();
  return testNodeSettings({ ...current, mode: 'local' });
}

export async function saveNodeModeForHomeV2(
  mode: 'custom' | 'disabled' | 'local' | 'public',
) {
  const current = readNodeSettings();
  const settings = normalizeNodeSettingsRequest({
    apiKey: current.apiKey,
    customUrl: current.customUrl,
    mode: mode === 'public' ? 'network' : mode,
  });
  writeNodeSettings(settings);
  nodeSettingsChangeListeners.forEach((listener) => listener());
  return getNodeSettingsSnapshot(settings);
}

export async function saveNodeCustomUrlForHomeV2(customUrl: string) {
  const current = readNodeSettings();
  const normalizedUrl = normalizeNodeApiUrl(customUrl);
  if (!isNodeApiKeyTransportSafe(normalizedUrl)) {
    throw new Error('Remote custom nodes must use HTTPS.');
  }
  const settings = normalizeNodeSettingsRequest({
    apiKey: current.apiKey,
    customUrl: normalizedUrl,
    mode: 'custom',
  });
  writeNodeSettings(settings);
  nodeSettingsChangeListeners.forEach((listener) => listener());
  return getNodeSettingsSnapshot(settings);
}

export function onNodeSettingsChanged(listener: () => void) {
  nodeSettingsChangeListeners.add(listener);
  return () => {
    nodeSettingsChangeListeners.delete(listener);
  };
}

export function registerNodeSettingsIpcHandlers() {
  ipcMain.handle('node:hasStoredSettings', () => existsSync(getNodeSettingsPath()));

  ipcMain.handle('node:getSettings', () => getNodeSettingsSnapshot());

  ipcMain.handle('node:getTransportStatus', () => {
    return getTransportStatus();
  });

  ipcMain.handle('node:checkCoreUpdate', () => {
    return checkCoreUpdateStatus();
  });

  ipcMain.handle('node:installCoreUpdate', () => {
    return installCoreUpdate();
  });

  ipcMain.handle('node:enableApiDocumentation', () => {
    return enableApiDocumentation();
  });

  ipcMain.handle('node:setAllowedTransports', (_event, transports: unknown) => {
    return setAllowedTransports(transports);
  });

  ipcMain.handle('node:saveSettings', async (_event, request: NodeSettingsRequest) => {
    const settings = normalizeNodeSettingsRequest(request);

    writeNodeSettings(settings);
    nodeSettingsChangeListeners.forEach((listener) => listener());

    return await getNodeSettingsSnapshot(settings);
  });

  ipcMain.handle('node:testConnection', (_event, request: NodeSettingsRequest) => {
    return testNodeSettings(normalizeNodeSettingsRequest(request));
  });

  ipcMain.handle('node:getStatus', () => {
    return testNodeSettings(readNodeSettings());
  });

  // Certificate trust is decided in Home's own settings UI: the preload only
  // exposes these to the shell, but a compromised renderer is not bound by its
  // preload, so the sender is re-checked here like the QDN role store does.
  ipcMain.handle('node:getCertificateStatus', (event, nodeApiUrl: unknown) => {
    assertShellWindowSender(event.sender, CERTIFICATE_SENDER_REFUSAL);
    return getNodeCertificateStatus(normalizeNodeApiUrl(getString(nodeApiUrl)));
  });

  ipcMain.handle(
    'node:confirmCertificate',
    (event, nodeApiUrl: unknown, fingerprint: unknown) => {
      assertShellWindowSender(event.sender, CERTIFICATE_SENDER_REFUSAL);
      return confirmNodeCertificate(normalizeNodeApiUrl(getString(nodeApiUrl)), fingerprint);
    },
  );

  ipcMain.handle('node:forgetCertificate', (event, nodeApiUrl: unknown) => {
    assertShellWindowSender(event.sender, CERTIFICATE_SENDER_REFUSAL);
    return forgetNodeCertificate(normalizeNodeApiUrl(getString(nodeApiUrl)));
  });
}
