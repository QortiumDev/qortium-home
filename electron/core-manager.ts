import { app, BrowserWindow, ipcMain } from 'electron';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { chmod, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import extract from 'extract-zip';
import { extract as extractTar } from 'tar';
import {
  ensurePreviewApiKey,
  readPreviewApiKey,
  readRunningLocalCoreApiKey,
  type RunningCoreApiKeyResult,
} from './local-api-key.js';
import { copyLegacyInstallListsToRuntime } from './core-runtime-files.js';
import { startIfManaged as startI2pdIfManaged, stopIfManaged as stopI2pdIfManaged } from './i2pd-manager.js';

const CORE_REPOSITORY = 'QortiumDev/qortium-core';
const GITHUB_API_BASE_URL = `https://api.github.com/repos/${CORE_REPOSITORY}`;
const GITHUB_USER_AGENT = 'QortiumHome/1.0';
const MANAGED_CORE_DIR = 'managed-core';
const CORE_DATA_DIR = 'qortium-core';
const CORE_INSTALL_DIR = 'install';
const CORE_RUNTIME_DIR = 'runtime';
const CORE_CHAIN_FILE = 'previewchain.json';
const CURRENT_CORE_FILE = 'current.json';
const CURRENT_JAVA_FILE = 'current-java.json';
const RUNTIME_CHAIN_FILE = 'runtime-chain.json';
const RUNTIME_MIGRATION_BLOCKED_FILE = 'runtime-migration-blocked.json';
const QORTIUM_PREVIEWNET_INITIAL_PEERS = [
  '146.103.42.59:24892',
  '185.207.104.78:24892',
  // Community-operated 24/7 node (unmanaged) - added for bootstrap redundancy.
  '80.241.221.139:24892',
  '3u25ana5e5hvriqqiuh6fcetxezsqm7la276ljtjxaoxt767n4hq.b32.i2p',
  'zqcackxkhjzfbbc6daigc73zqhzdpgwua3mjc7xgn3hwjed5z3ca.b32.i2p',
];
const QORTIUM_PREVIEWNET_INITIAL_DATA_PEERS = [
  '146.103.42.59:24894',
  '185.207.104.78:24894',
  // Community-operated 24/7 node (unmanaged) - added for bootstrap redundancy.
  '80.241.221.139:24894',
  'qhk6g5hl7vqf5fmlgj6knbajtiszotaf2w26fwjapsr75kbz7fma.b32.i2p',
  'hg3seiuul4pcz6a2svatdahzudphbm464vwqcmiejc77kumglwaq.b32.i2p',
];
const LOCAL_CORE_API_URL = 'http://127.0.0.1:24891';
const LOCAL_CORE_STATUS_PATH = '/admin/status';
const LOCAL_CORE_INFO_PATH = '/admin/info';
const START_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 45_000;
const STATUS_TIMEOUT_MS = 2_500;
const POLL_INTERVAL_MS = 2_000;
// After stopping a running core for an in-place update, wait briefly so the OS
// releases file handles on the jar (Windows locks the jar of a running JVM,
// which would otherwise block replacing the install directory).
const FILE_RELEASE_SETTLE_MS = 2_000;
const MIN_JAVA_MAJOR_VERSION = 17;
const JAVA_DISTRIBUTION = 'temurin';
const ADOPTIUM_JAVA_API_BASE_URL = 'https://api.adoptium.net/v3/binary/latest';
const CORE_RUNTIME_DIR_OVERRIDE = process.env.QORTIUM_HOME_CORE_RUNTIME_DIR?.trim();
const RUNTIME_ENTRY_NAMES = [
  'apikey.txt',
  'db-preview',
  'data-preview',
  'i2p',
  'lists',
  'qortium-backup-preview',
  'qortal-backup-preview',
  'qortium.log',
  'run-error.log',
  'run.log',
  'run.pid',
  'settings-preview-local.json',
  'settings-preview-seed-local.json',
  'settings-preview-seed-netcup-local.json',
];
const CHAIN_CONFIG_HASH_EXCLUDED_FIELDS = new Set([
  'checkpoints',
  'featureTriggers',
  'onlineAccountsSignatureV2Height',
  'assetOrderBoundsHeight',
]);

type CoreChannel = 'prerelease' | 'stable';
type JavaArchiveType = 'tar.gz' | 'zip';
type JavaSource = 'managed' | 'missing' | 'system' | 'unsupported';

type JavaPlatform = {
  apiArch: string;
  apiOs: string;
  arch: string;
  archiveType: JavaArchiveType;
  platform: NodeJS.Platform;
};

type GithubAsset = {
  browser_download_url?: unknown;
  digest?: unknown;
  name?: unknown;
  size?: unknown;
};

type GithubRelease = {
  assets?: unknown;
  draft?: unknown;
  html_url?: unknown;
  name?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  tag_name?: unknown;
  target_commitish?: unknown;
};

type CoreReleaseAsset = {
  digest: string | null;
  downloadUrl: string;
  name: string;
  size: number;
};

type DownloadAsset = CoreReleaseAsset;

type DownloadResult = {
  digest: string;
  size: number;
};

type CoreReleaseSummary =
  | {
      available: false;
      channel: CoreChannel;
      message: string;
    }
  | {
      asset: CoreReleaseAsset;
      available: true;
      channel: CoreChannel;
      commit: string;
      htmlUrl: string;
      name: string;
      publishedAt: string;
      tagName: string;
    };

type CoreLogPaths = {
  appLogPath: string;
  launcherLogPath: string;
  windowsErrorLogPath?: string;
};

type InstalledCore = {
  assetName: string;
  assetSize: number;
  channel: CoreChannel;
  digest: string | null;
  downloadUrl: string;
  htmlUrl: string;
  installPath: string;
  installedAt: string;
  jarPath: string;
  logPaths: CoreLogPaths;
  name: string;
  previewPath: string;
  runtimePath: string;
  tagName: string;
};

type ManagedJava = {
  apiArch: string;
  apiOs: string;
  arch: string;
  archiveName: string;
  archiveSize: number;
  archiveType: JavaArchiveType;
  digest: string;
  distribution: string;
  downloadUrl: string;
  installedAt: string;
  installPath: string;
  javaPath: string;
  majorVersion: number;
  platform: NodeJS.Platform;
  version: string;
};

type JavaStatus = {
  available: boolean;
  majorVersion: number | null;
  path: string;
  source: JavaSource;
  version: string | null;
};

type CoreRuntimeOwner = 'external' | 'home' | 'unknown';

type CoreRuntimeBlockedStatus = {
  blockedAt: string;
  currentCoreTagName: string;
  currentNetworkId: string;
  currentPreviewChainSha256: string;
  existingCoreTagName: string;
  existingNetworkId: string;
  existingPreviewChainSha256: string;
  markerPath: string;
  message: string;
  runtimePath: string;
};

type CoreRuntimeStatus = {
  apiKeyPath?: string;
  blocked?: CoreRuntimeBlockedStatus;
  buildVersion?: string;
  jarPath?: string;
  localApiUrl: string;
  owner: CoreRuntimeOwner;
  pid?: number;
  running: boolean;
  runningCommit?: string;
  runningVersion?: string;
  runtimePath?: string;
  settingsPath?: string;
  status: unknown;
};

type CoreStatus = {
  installed: InstalledCore | null;
  java: JavaStatus;
  runtime: CoreRuntimeStatus;
  supported: boolean;
};

type CoreRuntimeChainIdentity = {
  networkId: string;
  previewChainPath: string;
  rawPreviewChainSha256: string;
  previewChainSha256: string;
};

type CoreRuntimeChainMetadata = {
  coreTagName: string;
  networkId: string;
  previewChainSha256: string;
  rawPreviewChainSha256?: string;
  recordedAt: string;
  version: 1;
};

type CoreProgress = {
  action: 'checking' | 'downloading' | 'extracting' | 'idle' | 'starting' | 'stopping';
  kind: 'error' | 'info' | 'success';
  message: string;
  percent?: number;
};

type CoreInstallRequest = {
  channel?: unknown;
};

type RunScriptOptions = {
  stdio?: 'pipe' | 'ignore';
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJsonStringify(entry)).join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

function getCoreBasePath() {
  return path.join(app.getPath('appData'), CORE_DATA_DIR);
}

function getLegacyCoreBasePath() {
  return path.join(app.getPath('userData'), MANAGED_CORE_DIR);
}

function getCoreDownloadsPath() {
  return path.join(getCoreBasePath(), 'downloads');
}

function getCoreInstallPath() {
  return path.join(getCoreBasePath(), CORE_INSTALL_DIR);
}

function getJavaBasePath() {
  return path.join(getCoreBasePath(), 'java');
}

function getLegacyJavaBasePath() {
  return path.join(getLegacyCoreBasePath(), 'java');
}

function getJavaVersionsPath() {
  return path.join(getJavaBasePath(), 'versions');
}

function getCurrentCorePath() {
  return path.join(getCoreBasePath(), CURRENT_CORE_FILE);
}

function getLegacyCurrentCorePath() {
  return path.join(getLegacyCoreBasePath(), CURRENT_CORE_FILE);
}

function getCurrentJavaPath() {
  return path.join(getJavaBasePath(), CURRENT_JAVA_FILE);
}

function getLegacyCurrentJavaPath() {
  return path.join(getLegacyJavaBasePath(), CURRENT_JAVA_FILE);
}

function getCoreRuntimePath() {
  if (CORE_RUNTIME_DIR_OVERRIDE) {
    return path.resolve(CORE_RUNTIME_DIR_OVERRIDE);
  }

  return path.join(getCoreBasePath(), CORE_RUNTIME_DIR);
}

function getCoreLogPaths(runtimePath: string): CoreLogPaths {
  const logPaths: CoreLogPaths = {
    appLogPath: path.join(runtimePath, 'qortium.log'),
    launcherLogPath: path.join(runtimePath, 'run.log'),
  };

  if (process.platform === 'win32') {
    logPaths.windowsErrorLogPath = path.join(runtimePath, 'run-error.log');
  }

  return logPaths;
}

function getRunPidPath(runtimePath: string) {
  return path.join(runtimePath, 'run.pid');
}

function getRuntimeChainPath(runtimePath: string) {
  return path.join(runtimePath, RUNTIME_CHAIN_FILE);
}

function getRuntimeMigrationBlockedPath(runtimePath: string) {
  return path.join(runtimePath, RUNTIME_MIGRATION_BLOCKED_FILE);
}

function normalizeFilesystemPath(value: string) {
  return path.resolve(value);
}

function isPathWithinPath(candidatePath: string, parentPath: string) {
  const relativePath = path.relative(normalizeFilesystemPath(parentPath), normalizeFilesystemPath(candidatePath));

  return relativePath === '' || (!!relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isRunningCoreWithinPath(runningCore: RunningCoreApiKeyResult, parentPath: string) {
  return [runningCore.apiKeyDirectory, runningCore.cwd, runningCore.jarPath, runningCore.settingsPath].some((candidate) =>
    isPathWithinPath(candidate, parentPath),
  );
}

function getRuntimeEntryConflictPath(entryName: string) {
  return path.join(
    getCoreRuntimePath(),
    'migration-conflicts',
    sanitizePathSegment(new Date().toISOString()),
    entryName,
  );
}

async function movePath(sourcePath: string, destinationPath: string) {
  await mkdir(path.dirname(destinationPath), { recursive: true });

  try {
    await rename(sourcePath, destinationPath);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || (error as NodeJS.ErrnoException).code !== 'EXDEV') {
      throw error;
    }

    await cp(sourcePath, destinationPath, { recursive: true });
    await rm(sourcePath, { recursive: true, force: true });
  }
}

async function movePathReplacingDestination(sourcePath: string, destinationPath: string) {
  await rm(destinationPath, { recursive: true, force: true });
  await movePath(sourcePath, destinationPath);
}

async function moveRuntimeEntries(sourcePath: string, destinationPath: string) {
  if (!existsSync(sourcePath) || normalizeFilesystemPath(sourcePath) === normalizeFilesystemPath(destinationPath)) {
    return;
  }

  await mkdir(destinationPath, { recursive: true });

  for (const entryName of RUNTIME_ENTRY_NAMES) {
    const sourceEntryPath = path.join(sourcePath, entryName);

    if (!existsSync(sourceEntryPath)) {
      continue;
    }

    const destinationEntryPath = path.join(destinationPath, entryName);

    if (existsSync(destinationEntryPath)) {
      await movePath(sourceEntryPath, getRuntimeEntryConflictPath(entryName));
      continue;
    }

    await movePath(sourceEntryPath, destinationEntryPath);
  }
}

function mergeBootstrapPeerList(value: unknown, canonicalPeers: string[]) {
  const existingPeers = Array.isArray(value) ? value : [];
  const mergedPeers: unknown[] = [];
  const seenPeers = new Set<string>();
  let changed = !Array.isArray(value);

  for (const peer of existingPeers) {
    if (typeof peer === 'string') {
      if (seenPeers.has(peer)) {
        changed = true;
        continue;
      }

      seenPeers.add(peer);
    }

    mergedPeers.push(peer);
  }

  for (const peer of canonicalPeers) {
    if (!seenPeers.has(peer)) {
      mergedPeers.push(peer);
      seenPeers.add(peer);
      changed = true;
    }
  }

  return { changed, peers: mergedPeers };
}

async function ensureBootstrapPeers(installPath: string) {
  const settingsPath = path.join(installPath, 'preview', 'settings-preview.json');

  if (!existsSync(settingsPath)) {
    console.warn(`Unable to ensure Previewnet bootstrap peers; settings template was not found at ${settingsPath}.`);
    return;
  }

  let parsedSettings: unknown;

  try {
    parsedSettings = JSON.parse(await readFile(settingsPath, 'utf8'));
  } catch (error) {
    console.warn(`Unable to ensure Previewnet bootstrap peers; settings template is not valid JSON at ${settingsPath}.`, error);
    return;
  }

  if (!isObject(parsedSettings)) {
    console.warn(`Unable to ensure Previewnet bootstrap peers; settings template is not an object at ${settingsPath}.`);
    return;
  }

  const settings = parsedSettings as Record<string, unknown>;
  const initialPeers = mergeBootstrapPeerList(settings.initialPeers, QORTIUM_PREVIEWNET_INITIAL_PEERS);
  const initialDataPeers = mergeBootstrapPeerList(
    settings.initialDataPeers,
    QORTIUM_PREVIEWNET_INITIAL_DATA_PEERS,
  );

  if (!initialPeers.changed && !initialDataPeers.changed) {
    return;
  }

  settings.initialPeers = initialPeers.peers;
  settings.initialDataPeers = initialDataPeers.peers;

  try {
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.warn(`Unable to write Previewnet bootstrap peers to ${settingsPath}.`, error);
  }
}

function getCoreCompatiblePreviewChainSha256(parsedChain: Record<string, unknown>) {
  const compatibleChain: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(parsedChain)) {
    if (!CHAIN_CONFIG_HASH_EXCLUDED_FIELDS.has(key)) {
      compatibleChain[key] = value;
    }
  }

  return `sha256:${createHash('sha256').update(canonicalJsonStringify(compatibleChain)).digest('hex')}`;
}

async function readCoreRuntimeChainIdentity(previewPath: string): Promise<CoreRuntimeChainIdentity> {
  const previewChainPath = path.join(previewPath, CORE_CHAIN_FILE);
  let previewChainBytes: Buffer;

  try {
    previewChainBytes = await readFile(previewChainPath);
  } catch {
    throw new Error(`The installed Core release is missing ${CORE_CHAIN_FILE}; runtime chain compatibility cannot be verified.`);
  }

  let networkId = 'unknown';
  let parsedChain: Record<string, unknown>;

  try {
    const parsedPreviewChain: unknown = JSON.parse(previewChainBytes.toString('utf8'));

    if (!isObject(parsedPreviewChain) || Array.isArray(parsedPreviewChain)) {
      throw new Error('Previewnet chain config root is not a JSON object.');
    }

    parsedChain = parsedPreviewChain;
    networkId = getString(parsedChain.networkId) || networkId;
  } catch {
    throw new Error(`The installed Core release has an invalid ${CORE_CHAIN_FILE}; runtime chain compatibility cannot be verified.`);
  }

  return {
    networkId,
    previewChainPath,
    rawPreviewChainSha256: `sha256:${createHash('sha256').update(previewChainBytes).digest('hex')}`,
    previewChainSha256: getCoreCompatiblePreviewChainSha256(parsedChain),
  };
}

function parseRuntimeChainMetadata(value: unknown): CoreRuntimeChainMetadata | null {
  if (!isObject(value)) {
    return null;
  }

  const networkId = getString(value.networkId);
  const previewChainSha256 = getString(value.previewChainSha256);

  if (!networkId || !previewChainSha256) {
    return null;
  }

  return {
    coreTagName: getString(value.coreTagName),
    networkId,
    previewChainSha256,
    rawPreviewChainSha256: getString(value.rawPreviewChainSha256) || undefined,
    recordedAt: getString(value.recordedAt),
    version: 1,
  };
}

async function readRuntimeChainMetadata(runtimePath: string): Promise<CoreRuntimeChainMetadata | null> {
  const metadataPath = getRuntimeChainPath(runtimePath);

  if (!existsSync(metadataPath)) {
    return null;
  }

  let parsedMetadata: unknown;

  try {
    parsedMetadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  } catch {
    throw new Error(`Core runtime chain metadata is invalid at ${metadataPath}.`);
  }

  const metadata = parseRuntimeChainMetadata(parsedMetadata);

  if (!metadata) {
    throw new Error(`Core runtime chain metadata is incomplete at ${metadataPath}.`);
  }

  return metadata;
}

async function writeRuntimeChainMetadata(
  runtimePath: string,
  coreTagName: string,
  identity: CoreRuntimeChainIdentity,
) {
  const metadata: CoreRuntimeChainMetadata = {
    coreTagName,
    networkId: identity.networkId,
    previewChainSha256: identity.previewChainSha256,
    rawPreviewChainSha256: identity.rawPreviewChainSha256,
    recordedAt: new Date().toISOString(),
    version: 1,
  };

  await mkdir(runtimePath, { recursive: true });
  await writeFile(getRuntimeChainPath(runtimePath), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

function isRuntimeChainMetadataMatch(
  metadata: CoreRuntimeChainMetadata,
  identity: CoreRuntimeChainIdentity,
) {
  return metadata.networkId === identity.networkId && metadata.previewChainSha256 === identity.previewChainSha256;
}

function isLegacyRawRuntimeChainMetadataMatch(
  metadata: CoreRuntimeChainMetadata,
  identity: CoreRuntimeChainIdentity,
) {
  return metadata.networkId === identity.networkId && metadata.previewChainSha256 === identity.rawPreviewChainSha256;
}

function getRuntimeChainMismatchMessage(
  metadata: CoreRuntimeChainMetadata,
  coreTagName: string,
  identity: CoreRuntimeChainIdentity,
) {
  return [
    'Qortium Core runtime data was created for a different Previewnet chain configuration.',
    'Home will not reuse the existing database automatically.',
    `Existing runtime: ${metadata.networkId} ${metadata.previewChainSha256}.`,
    `Installed Core ${coreTagName}: ${identity.networkId} ${identity.previewChainSha256}.`,
    'Move or reset the existing Core runtime data before starting this Core release.',
  ].join(' ');
}

async function writeRuntimeMigrationBlocked(
  runtimePath: string,
  metadata: CoreRuntimeChainMetadata,
  coreTagName: string,
  identity: CoreRuntimeChainIdentity,
) {
  const message = getRuntimeChainMismatchMessage(metadata, coreTagName, identity);

  await mkdir(runtimePath, { recursive: true });
  await writeFile(
    getRuntimeMigrationBlockedPath(runtimePath),
    `${JSON.stringify(
      {
        blockedAt: new Date().toISOString(),
        current: {
          coreTagName,
          networkId: identity.networkId,
          previewChainPath: identity.previewChainPath,
          rawPreviewChainSha256: identity.rawPreviewChainSha256,
          previewChainSha256: identity.previewChainSha256,
        },
        existing: metadata,
        message,
        version: 1,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

async function readRuntimeMigrationBlocked(runtimePath: string): Promise<CoreRuntimeBlockedStatus | null> {
  const markerPath = getRuntimeMigrationBlockedPath(runtimePath);

  if (!existsSync(markerPath)) {
    return null;
  }

  try {
    const parsedMarker: unknown = JSON.parse(await readFile(markerPath, 'utf8'));

    if (!isObject(parsedMarker)) {
      return null;
    }

    const current = isObject(parsedMarker.current) ? parsedMarker.current : {};
    const existing = isObject(parsedMarker.existing) ? parsedMarker.existing : {};

    return {
      blockedAt: getString(parsedMarker.blockedAt),
      currentCoreTagName: getString(current.coreTagName),
      currentNetworkId: getString(current.networkId),
      currentPreviewChainSha256: getString(current.previewChainSha256),
      existingCoreTagName: getString(existing.coreTagName),
      existingNetworkId: getString(existing.networkId),
      existingPreviewChainSha256: getString(existing.previewChainSha256),
      markerPath,
      message:
        getString(parsedMarker.message) ||
        'Qortium Core runtime data needs a reset or manual migration before this Core release can use it.',
      runtimePath,
    };
  } catch {
    return {
      blockedAt: '',
      currentCoreTagName: '',
      currentNetworkId: '',
      currentPreviewChainSha256: '',
      existingCoreTagName: '',
      existingNetworkId: '',
      existingPreviewChainSha256: '',
      markerPath,
      message: 'Qortium Core runtime data needs a reset or manual migration before this Core release can use it.',
      runtimePath,
    };
  }
}

async function ensureRuntimeChainCompatible(
  runtimePath: string,
  coreTagName: string,
  identity: CoreRuntimeChainIdentity,
  options: { recordIfMissing?: boolean } = {},
) {
  const metadata = await readRuntimeChainMetadata(runtimePath);

  if (metadata) {
    const matchesCurrentIdentity = isRuntimeChainMetadataMatch(metadata, identity);
    const matchesLegacyRawIdentity = isLegacyRawRuntimeChainMetadataMatch(metadata, identity);

    if (!matchesCurrentIdentity && !matchesLegacyRawIdentity) {
      await writeRuntimeMigrationBlocked(runtimePath, metadata, coreTagName, identity);
      throw new Error(getRuntimeChainMismatchMessage(metadata, coreTagName, identity));
    }

    if (!matchesCurrentIdentity || metadata.rawPreviewChainSha256 !== identity.rawPreviewChainSha256) {
      await writeRuntimeChainMetadata(runtimePath, coreTagName, identity);
    }

    await rm(getRuntimeMigrationBlockedPath(runtimePath), { force: true });
    return;
  }

  if (options.recordIfMissing) {
    await writeRuntimeChainMetadata(runtimePath, coreTagName, identity);
  }

  await rm(getRuntimeMigrationBlockedPath(runtimePath), { force: true });
}

async function ensureInstalledCoreRuntimeChain(
  installedCore: InstalledCore,
  options: { recordIfMissing?: boolean } = {},
) {
  const identity = await readCoreRuntimeChainIdentity(installedCore.previewPath);

  await ensureRuntimeChainCompatible(installedCore.runtimePath, installedCore.tagName, identity, options);

  return identity;
}

function relocateChildPath(sourcePath: string, sourceBasePath: string, destinationBasePath: string) {
  if (!isPathWithinPath(sourcePath, sourceBasePath)) {
    return path.join(destinationBasePath, path.basename(sourcePath));
  }

  return path.join(destinationBasePath, path.relative(sourceBasePath, sourcePath));
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-z0-9._-]/gi, '_') || 'core';
}

function publishProgress(progress: CoreProgress) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('core:progress', progress);
    }
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Core action failed.';
}

function formatCoreLogPathList(logPaths: CoreLogPaths) {
  return [
    `Core log: ${logPaths.appLogPath}`,
    `Launcher log: ${logPaths.launcherLogPath}`,
    logPaths.windowsErrorLogPath ? `Windows error log: ${logPaths.windowsErrorLogPath}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function withCoreLogPaths(message: string, logPaths: CoreLogPaths) {
  return `${message}\n${formatCoreLogPathList(logPaths)}`;
}

async function fetchGithubJson<T>(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': GITHUB_USER_AGENT,
    },
  });

  if (response.status === 404) {
    return null;
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `GitHub request failed with HTTP ${response.status}.`);
  }

  return text ? (JSON.parse(text) as T) : null;
}

function normalizeGithubRelease(value: unknown): GithubRelease | null {
  return isObject(value) ? value : null;
}

function selectReleaseAsset(release: GithubRelease): CoreReleaseAsset | null {
  if (!Array.isArray(release.assets)) {
    return null;
  }

  const assets = release.assets.filter(isObject) as GithubAsset[];
  const selectedAsset =
    assets.find((asset) => getString(asset.name) === 'qortium-preview.zip') ??
    assets.find((asset) => /^qortium.*\.zip$/i.test(getString(asset.name)));

  if (!selectedAsset) {
    return null;
  }

  const name = getString(selectedAsset.name);
  const downloadUrl = getString(selectedAsset.browser_download_url);

  if (!name || !downloadUrl) {
    return null;
  }

  return {
    name,
    downloadUrl,
    digest: getString(selectedAsset.digest) || null,
    size: getNumber(selectedAsset.size),
  };
}

function releaseToSummary(channel: CoreChannel, value: unknown): CoreReleaseSummary {
  const release = normalizeGithubRelease(value);

  if (!release || release.draft === true) {
    return {
      available: false,
      channel,
      message: `No ${channel} release was found.`,
    };
  }

  const tagName = getString(release.tag_name);
  const asset = selectReleaseAsset(release);

  if (!tagName || !asset) {
    return {
      available: false,
      channel,
      message: `The latest ${channel} release does not include a supported Qortium zip asset.`,
    };
  }

  return {
    available: true,
    channel,
    asset,
    commit: getString(release.target_commitish),
    tagName,
    name: getString(release.name) || tagName,
    htmlUrl: getString(release.html_url),
    publishedAt: getString(release.published_at),
  };
}

async function getLatestStableRelease(): Promise<CoreReleaseSummary> {
  const release = await fetchGithubJson<unknown>(`${GITHUB_API_BASE_URL}/releases/latest`);

  return releaseToSummary('stable', release);
}

async function getLatestPrerelease(): Promise<CoreReleaseSummary> {
  const releases = await fetchGithubJson<unknown[]>(`${GITHUB_API_BASE_URL}/releases?per_page=20`);
  const release = Array.isArray(releases)
    ? releases.find((candidate) => {
        const normalizedCandidate = normalizeGithubRelease(candidate);

        return normalizedCandidate?.draft !== true && normalizedCandidate?.prerelease === true;
      })
    : null;

  return releaseToSummary('prerelease', release);
}

async function checkReleases() {
  publishProgress({
    action: 'checking',
    kind: 'info',
    message: 'Checking Qortium Core releases.',
  });

  const [stable, prerelease] = await Promise.all([
    getLatestStableRelease().catch((error): CoreReleaseSummary => ({
      available: false,
      channel: 'stable',
      message: getErrorMessage(error),
    })),
    getLatestPrerelease().catch((error): CoreReleaseSummary => ({
      available: false,
      channel: 'prerelease',
      message: getErrorMessage(error),
    })),
  ]);

  publishProgress({
    action: 'idle',
    kind: 'success',
    message: 'Release check complete.',
  });

  return {
    stable,
    prerelease,
  };
}

function parseInstalledCore(value: unknown, fallbackRuntimePath = getCoreRuntimePath()): InstalledCore | null {
  if (!isObject(value)) {
    return null;
  }

  const installedCore = value as Partial<InstalledCore>;
  const installPath = getString(installedCore.installPath);
  const previewPath = getString(installedCore.previewPath);
  const jarPath = getString(installedCore.jarPath);
  const tagName = getString(installedCore.tagName);
  const runtimePath = getString(installedCore.runtimePath) || fallbackRuntimePath;

  if (!installPath || !previewPath || !jarPath || !tagName) {
    return null;
  }

  return {
    assetName: getString(installedCore.assetName),
    assetSize: getNumber(installedCore.assetSize),
    channel: installedCore.channel === 'stable' ? 'stable' : 'prerelease',
    digest: getString(installedCore.digest) || null,
    downloadUrl: getString(installedCore.downloadUrl),
    htmlUrl: getString(installedCore.htmlUrl),
    installPath,
    installedAt: getString(installedCore.installedAt),
    jarPath,
    logPaths: getCoreLogPaths(runtimePath),
    name: getString(installedCore.name) || tagName,
    previewPath,
    runtimePath,
    tagName,
  };
}

async function readInstalledCoreMetadata(
  currentCorePath = getCurrentCorePath(),
  fallbackRuntimePath = getCoreRuntimePath(),
): Promise<InstalledCore | null> {
  try {
    const parsedCore: unknown = JSON.parse(await readFile(currentCorePath, 'utf8'));
    const installedCore = parseInstalledCore(parsedCore, fallbackRuntimePath);

    if (
      installedCore &&
      existsSync(installedCore.installPath) &&
      existsSync(installedCore.previewPath) &&
      existsSync(installedCore.jarPath)
    ) {
      return installedCore;
    }
  } catch {
    return null;
  }

  return null;
}

async function readInstalledCore(): Promise<InstalledCore | null> {
  await ensureCoreLayout();

  return await readInstalledCoreMetadata();
}

export async function getManagedCorePreviewPath() {
  return (await readInstalledCore())?.previewPath ?? null;
}

export async function getManagedCoreRuntimePath() {
  return (await readInstalledCore())?.runtimePath ?? null;
}

function isPidRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'EPERM'
    );
  }
}

// Waits until a process has actually exited (and therefore released its file
// handles/locks), polling up to timeoutMs. The local Core API stops answering
// well before the JVM finishes shutting down, so an API-based "stopped" check is
// not enough before replacing the install files (notably on Windows, where the
// running jar stays locked until the process exits). Returns true if it exited.
async function waitForPidExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return !isPidRunning(pid);
}

export async function isManagedCoreRuntimeRunning() {
  const installedCore = await readInstalledCore();

  if (!installedCore) {
    return false;
  }

  return await isInstalledCoreRunning(installedCore);
}

// True when a managed Core is running AND its node has I2P enabled — i.e. the
// managed i2pd router *should* be up to serve Core's fallback transport. Used to
// reconcile the router with Core (on Home launch / quit) so i2pd's lifetime
// tracks Core's, not Home's window.
export async function isManagedCoreUsingI2p(): Promise<boolean> {
  const installedCore = await readInstalledCore();

  if (!installedCore || !(await isInstalledCoreRunning(installedCore))) {
    return false;
  }

  return await isCoreI2pEnabled(installedCore.runtimePath);
}

async function writeInstalledCore(installedCore: InstalledCore) {
  await mkdir(getCoreBasePath(), { recursive: true });
  await writeFile(getCurrentCorePath(), `${JSON.stringify(installedCore, null, 2)}\n`, 'utf8');
}

function getRawRuntimePath(value: unknown) {
  return isObject(value) ? getString((value as { runtimePath?: unknown }).runtimePath) : '';
}

function relocateInstalledCore(installedCore: InstalledCore, sourceInstallPath: string): InstalledCore {
  const installPath = getCoreInstallPath();
  const runtimePath = getCoreRuntimePath();

  return {
    ...installedCore,
    installPath,
    jarPath: relocateChildPath(installedCore.jarPath, sourceInstallPath, installPath),
    logPaths: getCoreLogPaths(runtimePath),
    previewPath: relocateChildPath(installedCore.previewPath, sourceInstallPath, installPath),
    runtimePath,
  };
}

function relocateInstalledJava(installedJava: ManagedJava, sourceJavaBasePath: string): ManagedJava {
  const javaBasePath = getJavaBasePath();

  return {
    ...installedJava,
    installPath: relocateChildPath(installedJava.installPath, sourceJavaBasePath, javaBasePath),
    javaPath: relocateChildPath(installedJava.javaPath, sourceJavaBasePath, javaBasePath),
  };
}

async function stopLegacyInstalledCore(installedCore: InstalledCore, runtimePath: string) {
  const stopScript = getStopScript(installedCore.previewPath);

  if (!existsSync(stopScript)) {
    throw new Error(
      withCoreLogPaths(
        `The legacy Core release is running but its preview stop script was not found at ${stopScript}.`,
        getCoreLogPaths(runtimePath),
      ),
    );
  }

  publishProgress({
    action: 'stopping',
    kind: 'info',
    message: 'Stopping the old Home-created Qortium Core before migration.',
    percent: 5,
  });

  try {
    await runScript(stopScript, [`--runtime-dir=${runtimePath}`], installedCore.previewPath);
    await waitForRuntimeState(false, STOP_TIMEOUT_MS, 'stopping');
  } catch (error) {
    throw new Error(withCoreLogPaths(getErrorMessage(error), getCoreLogPaths(runtimePath)));
  }
}

async function migrateLegacyJavaLayout() {
  const installedJava = await readInstalledJavaMetadata();

  if (installedJava || !existsSync(getLegacyCurrentJavaPath())) {
    return;
  }

  const legacyJava = await readInstalledJavaMetadata(getLegacyCurrentJavaPath());

  if (!legacyJava || !existsSync(getLegacyJavaBasePath())) {
    return;
  }

  if (!existsSync(getJavaBasePath())) {
    await movePath(getLegacyJavaBasePath(), getJavaBasePath());
  }

  const migratedJava = relocateInstalledJava(legacyJava, getLegacyJavaBasePath());

  if (existsSync(migratedJava.installPath) && existsSync(migratedJava.javaPath)) {
    await writeInstalledJava(migratedJava);
  }
}

async function cleanupLegacyCoreBaseIfMigrated() {
  const legacyCoreBasePath = getLegacyCoreBasePath();

  if (!existsSync(legacyCoreBasePath) || !(await readInstalledCoreMetadata())) {
    return;
  }

  const runningCore = readRunningLocalCoreApiKey();

  if (runningCore && isRunningCoreWithinPath(runningCore, legacyCoreBasePath)) {
    return;
  }

  await rm(legacyCoreBasePath, { recursive: true, force: true });
}

async function migrateLegacyCoreLayout() {
  const installedCore = await readInstalledCoreMetadata();
  const legacyCoreBasePath = getLegacyCoreBasePath();

  if (!existsSync(legacyCoreBasePath)) {
    return;
  }

  if (installedCore) {
    await cleanupLegacyCoreBaseIfMigrated();
    return;
  }

  let parsedLegacyCore: unknown;

  try {
    parsedLegacyCore = JSON.parse(await readFile(getLegacyCurrentCorePath(), 'utf8'));
  } catch {
    return;
  }

  const legacyCore = parseInstalledCore(parsedLegacyCore, getCoreRuntimePath());

  if (!legacyCore) {
    return;
  }

  const legacyRuntimePath = getRawRuntimePath(parsedLegacyCore) || legacyCore.previewPath;
  const runningCore = readRunningLocalCoreApiKey();
  const legacyRuntimePid = await readRuntimePid(legacyRuntimePath);

  if (
    (runningCore && isRunningCoreWithinPath(runningCore, legacyCoreBasePath)) ||
    (legacyRuntimePid !== null && isPidRunning(legacyRuntimePid))
  ) {
    await stopLegacyInstalledCore(legacyCore, legacyRuntimePath);
  }

  const sourceInstallPath = legacyCore.installPath;
  const migratedCore = relocateInstalledCore(legacyCore, sourceInstallPath);
  const runtimeIdentity = await readCoreRuntimeChainIdentity(legacyCore.previewPath);

  await ensureRuntimeChainCompatible(migratedCore.runtimePath, migratedCore.tagName, runtimeIdentity);

  await movePathReplacingDestination(sourceInstallPath, migratedCore.installPath);
  await ensureBootstrapPeers(migratedCore.installPath);
  await chmodPreviewScripts(migratedCore.previewPath);
  await moveRuntimeEntries(getCoreBasePath(), migratedCore.runtimePath);
  await moveRuntimeEntries(legacyRuntimePath, migratedCore.runtimePath);
  await moveRuntimeEntries(migratedCore.previewPath, migratedCore.runtimePath);
  await writeInstalledCore(migratedCore);
  await ensureRuntimeChainCompatible(migratedCore.runtimePath, migratedCore.tagName, runtimeIdentity, {
    recordIfMissing: true,
  });

  if (await readInstalledCoreMetadata()) {
    await cleanupLegacyCoreBaseIfMigrated();
  }
}

async function migrateRootRuntimeEntriesIfSafe(installedCore: InstalledCore | null) {
  const runningCore = readRunningLocalCoreApiKey();

  if (
    runningCore &&
    isPathWithinPath(runningCore.apiKeyDirectory, getCoreBasePath()) &&
    !isPathWithinPath(runningCore.apiKeyDirectory, getCoreRuntimePath())
  ) {
    return;
  }

  const runtimeIdentity = installedCore ? await ensureInstalledCoreRuntimeChain(installedCore) : null;

  await moveRuntimeEntries(getCoreBasePath(), getCoreRuntimePath());

  if (installedCore && runtimeIdentity) {
    await ensureRuntimeChainCompatible(installedCore.runtimePath, installedCore.tagName, runtimeIdentity, {
      recordIfMissing: true,
    });
  }
}

let coreLayoutMigrationPromise: Promise<void> | null = null;

async function migrateCoreLayout() {
  await mkdir(getCoreBasePath(), { recursive: true });
  await migrateLegacyJavaLayout();
  await migrateLegacyCoreLayout();
  const installedCore = await readInstalledCoreMetadata();

  await migrateRootRuntimeEntriesIfSafe(installedCore);

  if (installedCore) {
    await ensureInstalledCoreRuntimeChain(installedCore, { recordIfMissing: true });
  }
}

async function ensureCoreLayout() {
  if (!coreLayoutMigrationPromise) {
    coreLayoutMigrationPromise = migrateCoreLayout().catch((error) => {
      coreLayoutMigrationPromise = null;
      throw error;
    });
  }

  await coreLayoutMigrationPromise;
}

function getJavaPlatform(): JavaPlatform | null {
  const platform = process.platform;
  const arch = process.arch;
  const apiOs = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'windows' : platform;
  const apiArch = arch === 'arm64' ? 'aarch64' : arch;

  if (platform === 'win32' && arch === 'x64') {
    return {
      apiArch,
      apiOs,
      arch,
      archiveType: 'zip',
      platform,
    };
  }

  if ((platform === 'linux' || platform === 'darwin') && (arch === 'x64' || arch === 'arm64')) {
    return {
      apiArch,
      apiOs,
      arch,
      archiveType: 'tar.gz',
      platform,
    };
  }

  return null;
}

function getJavaArchiveExtension(archiveType: JavaArchiveType) {
  return archiveType === 'zip' ? 'zip' : 'tar.gz';
}

function getJavaDownloadUrl(javaPlatform: JavaPlatform) {
  return `${ADOPTIUM_JAVA_API_BASE_URL}/${MIN_JAVA_MAJOR_VERSION}/ga/${javaPlatform.apiOs}/${javaPlatform.apiArch}/jre/hotspot/normal/eclipse`;
}

function parseInstalledJava(value: unknown): ManagedJava | null {
  if (!isObject(value)) {
    return null;
  }

  const managedJava = value as Partial<ManagedJava>;
  const installPath = getString(managedJava.installPath);
  const javaPath = getString(managedJava.javaPath);
  const version = getString(managedJava.version);
  const majorVersion = getNumber(managedJava.majorVersion);

  if (!installPath || !javaPath || !version || majorVersion < MIN_JAVA_MAJOR_VERSION) {
    return null;
  }

  const archiveType = managedJava.archiveType === 'zip' ? 'zip' : 'tar.gz';
  const platform = getString(managedJava.platform) as NodeJS.Platform;

  return {
    apiArch: getString(managedJava.apiArch),
    apiOs: getString(managedJava.apiOs),
    arch: getString(managedJava.arch),
    archiveName: getString(managedJava.archiveName),
    archiveSize: getNumber(managedJava.archiveSize),
    archiveType,
    digest: getString(managedJava.digest),
    distribution: getString(managedJava.distribution) || JAVA_DISTRIBUTION,
    downloadUrl: getString(managedJava.downloadUrl),
    installedAt: getString(managedJava.installedAt),
    installPath,
    javaPath,
    majorVersion,
    platform: platform || process.platform,
    version,
  };
}

async function readInstalledJavaMetadata(currentJavaPath = getCurrentJavaPath()): Promise<ManagedJava | null> {
  try {
    const parsedJava: unknown = JSON.parse(await readFile(currentJavaPath, 'utf8'));
    const installedJava = parseInstalledJava(parsedJava);

    if (installedJava && existsSync(installedJava.installPath) && existsSync(installedJava.javaPath)) {
      return installedJava;
    }
  } catch {
    return null;
  }

  return null;
}

async function readInstalledJava(): Promise<ManagedJava | null> {
  await ensureCoreLayout();

  return await readInstalledJavaMetadata();
}

async function writeInstalledJava(installedJava: ManagedJava) {
  await mkdir(getJavaBasePath(), { recursive: true });
  await writeFile(getCurrentJavaPath(), `${JSON.stringify(installedJava, null, 2)}\n`, 'utf8');
}

function parseJavaMajorVersion(version: string) {
  const [first, second] = version.split('.');
  const majorVersion = first === '1' ? Number(second) : Number(first);

  return Number.isFinite(majorVersion) ? majorVersion : null;
}

function detectJavaVersion(command = 'java', source: JavaSource = 'system'): Promise<JavaStatus> {
  return new Promise((resolve) => {
    const useShell = command === 'java' && process.platform === 'win32';
    const child = spawn(command, ['-version'], {
      shell: useShell,
      windowsHide: true,
    });
    const chunks: Buffer[] = [];

    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', () => {
      resolve({
        available: false,
        majorVersion: null,
        path: command,
        source,
        version: null,
      });
    });
    child.on('close', () => {
      const output = Buffer.concat(chunks).toString();
      const version = /(?:java|openjdk) version\s+"([^"]+)"/i.exec(output)?.[1] ?? null;
      const majorVersion = version ? parseJavaMajorVersion(version) : null;

      resolve({
        available: typeof majorVersion === 'number' && majorVersion >= MIN_JAVA_MAJOR_VERSION,
        majorVersion,
        path: command,
        source,
        version,
      });
    });
  });
}

async function getJavaStatus(options: { ensureLayout?: boolean } = {}): Promise<JavaStatus> {
  const installedJava =
    options.ensureLayout === false ? await readInstalledJavaMetadata() : await readInstalledJava();
  let managedStatus: JavaStatus | null = null;

  if (installedJava) {
    managedStatus = await detectJavaVersion(installedJava.javaPath, 'managed');

    if (managedStatus.available) {
      return managedStatus;
    }
  }

  const systemJava = await detectJavaVersion('java', 'system');

  if (systemJava.available) {
    return systemJava;
  }

  if (managedStatus?.version) {
    return {
      ...managedStatus,
      source: 'unsupported',
    };
  }

  return {
    ...systemJava,
    source: systemJava.version ? 'unsupported' : 'missing',
  };
}

function getJavaRuntimeEnv(java: JavaStatus) {
  if (java.source !== 'managed' || !java.path) {
    return undefined;
  }

  const javaBinPath = path.dirname(java.path);

  return {
    ...process.env,
    JAVA_HOME: path.dirname(javaBinPath),
    PATH: `${javaBinPath}${path.delimiter}${process.env.PATH ?? ''}`,
  };
}

function parseCoreBuildVersion(buildVersion: string): { commit?: string; version?: string } {
  // e.g. "qortium-1.0.0-0368587" -> { version: "1.0.0", commit: "0368587" }
  const match = buildVersion.match(/-([0-9]+\.[0-9]+\.[0-9]+(?:[-.][0-9A-Za-z.]+)?)-([0-9a-fA-F]{6,40})$/);

  if (match) {
    return { commit: match[2], version: match[1] };
  }

  return {};
}

async function fetchCoreBuildInfo(
  signal: AbortSignal,
): Promise<{ buildVersion?: string; runningCommit?: string; runningVersion?: string }> {
  try {
    const response = await fetch(`${LOCAL_CORE_API_URL}${LOCAL_CORE_INFO_PATH}`, { signal });

    if (!response.ok) {
      return {};
    }

    const info: unknown = await response.json();

    if (!isObject(info)) {
      return {};
    }

    const buildVersion = getString(info.buildVersion);

    if (!buildVersion) {
      return {};
    }

    const parsed = parseCoreBuildVersion(buildVersion);

    return { buildVersion, runningCommit: parsed.commit, runningVersion: parsed.version };
  } catch {
    return {};
  }
}

async function fetchLocalCoreStatus(): Promise<CoreRuntimeStatus> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), STATUS_TIMEOUT_MS);

  try {
    const response = await fetch(`${LOCAL_CORE_API_URL}${LOCAL_CORE_STATUS_PATH}`, {
      signal: abortController.signal,
    });
    const text = await response.text();

    if (!response.ok) {
      return {
        localApiUrl: LOCAL_CORE_API_URL,
        owner: 'unknown',
        running: false,
        status: text,
      };
    }

    const buildInfo = await fetchCoreBuildInfo(abortController.signal);

    return {
      ...buildInfo,
      localApiUrl: LOCAL_CORE_API_URL,
      owner: 'unknown',
      running: true,
      status: text ? (JSON.parse(text) as unknown) : null,
    };
  } catch {
    return {
      localApiUrl: LOCAL_CORE_API_URL,
      owner: 'unknown',
      running: false,
      status: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readRuntimePid(runtimePath: string) {
  try {
    const pid = Number((await readFile(getRunPidPath(runtimePath), 'utf8')).trim());

    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function readInstalledCoreRuntimePid(installedCore: InstalledCore) {
  return await readRuntimePid(installedCore.runtimePath);
}

async function isInstalledCoreRuntimeRunning(installedCore: InstalledCore) {
  const pid = await readInstalledCoreRuntimePid(installedCore);

  return pid !== null && isPidRunning(pid);
}

// True when a live Home-managed Core process is detectable via the live-process
// scan (the same scanner the UI status path uses), independent of run.pid. This
// is the resilient fallback for a stale run.pid: Core's run.pid is only written
// by start.sh at launch, and a Core that relaunches its JVM without going back
// through start.sh — notably /admin/restart, which enabling I2P triggers — leaves
// run.pid pointing at the old, now-dead pid while a new live node runs under a
// different, unrecorded pid. The scan resolves the live process's own jar / api-key
// directory and confirms it lives inside our managed install/runtime paths.
// readRunningLocalCoreApiKey() is Linux-only, so this is a no-op (returns false)
// on macOS/Windows — there the pid-file check above remains the only signal.
function isInstalledCoreRunningViaProcessScan(installedCore: InstalledCore) {
  const runningCore = readRunningLocalCoreApiKey();

  if (!runningCore) {
    return false;
  }

  return (
    isRunningCoreWithinPath(runningCore, getCoreRuntimePath()) ||
    isRunningCoreWithinPath(runningCore, getCoreInstallPath()) ||
    isRunningCoreWithinPath(runningCore, installedCore.runtimePath) ||
    isRunningCoreWithinPath(runningCore, installedCore.installPath)
  );
}

// Robust "is this managed Core running?" — prefers the cheap run.pid check, then
// falls back to the live-process scan so a stale run.pid can't make a genuinely
// running Core look stopped (which would strand its managed i2pd fallback).
async function isInstalledCoreRunning(installedCore: InstalledCore) {
  return (
    (await isInstalledCoreRuntimeRunning(installedCore)) ||
    isInstalledCoreRunningViaProcessScan(installedCore)
  );
}

async function resolveRuntimeStatusOwner(
  runtime: CoreRuntimeStatus,
  installedCore: InstalledCore | null,
): Promise<CoreRuntimeStatus> {
  if (!runtime.running) {
    return runtime;
  }

  const runningCore = readRunningLocalCoreApiKey();

  if (runningCore) {
    // A core is Home-owned when it runs out of our managed install/runtime
    // directories. Comparing against the managed base paths (not only the
    // recorded install metadata) keeps ownership correct even when the install
    // metadata or jar has since been removed while the core keeps running.
    const isHomeManaged =
      isPathWithinPath(runningCore.apiKeyDirectory, getCoreRuntimePath()) ||
      isPathWithinPath(runningCore.jarPath, getCoreInstallPath()) ||
      (installedCore !== null &&
        (isPathWithinPath(runningCore.apiKeyDirectory, installedCore.runtimePath) ||
          isPathWithinPath(runningCore.jarPath, installedCore.installPath)));

    return {
      ...runtime,
      apiKeyPath: runningCore.path,
      jarPath: runningCore.jarPath,
      owner: isHomeManaged ? 'home' : 'external',
      pid: runningCore.pid,
      runtimePath: runningCore.apiKeyDirectory,
      settingsPath: runningCore.settingsPath,
    };
  }

  if (installedCore && (await isInstalledCoreRuntimeRunning(installedCore))) {
    return {
      ...runtime,
      owner: 'home',
      pid: (await readInstalledCoreRuntimePid(installedCore)) ?? undefined,
      runtimePath: installedCore.runtimePath,
    };
  }

  // We deliberately do NOT fall back to "a recorded run.pid is alive" here: pids
  // are reused, and on platforms without readRunningLocalCoreApiKey() (Windows /
  // macOS) that would let an unrelated process be mistaken for a Home-owned core
  // and killed. Ownership stays 'unknown' (so stopCore refuses) unless it can be
  // positively confirmed above. The jar-deleted-but-running case is still handled
  // on Linux, where readRunningLocalCoreApiKey() resolves the live process's own
  // jar path into our managed install directory.
  return runtime;
}

async function getStatus(): Promise<CoreStatus> {
  let blockedRuntime: CoreRuntimeBlockedStatus | null = null;

  try {
    await ensureCoreLayout();
  } catch (error) {
    blockedRuntime = await readRuntimeMigrationBlocked(getCoreRuntimePath());

    if (!blockedRuntime) {
      throw error;
    }
  }

  const [installed, java, runtime] = await Promise.all([
    readInstalledCoreMetadata(),
    getJavaStatus({ ensureLayout: !blockedRuntime }),
    fetchLocalCoreStatus(),
  ]);
  const resolvedRuntime = await resolveRuntimeStatusOwner(runtime, installed);
  const runtimeBlocked = blockedRuntime ?? (await readRuntimeMigrationBlocked(getCoreRuntimePath()));

  return {
    supported: process.platform === 'linux' || process.platform === 'darwin' || process.platform === 'win32',
    installed,
    java,
    runtime: runtimeBlocked
      ? {
          ...resolvedRuntime,
          blocked: runtimeBlocked,
          runtimePath: runtimeBlocked.runtimePath,
        }
      : resolvedRuntime,
  };
}

async function downloadFile(
  asset: DownloadAsset,
  destinationPath: string,
  description = 'Core asset',
): Promise<DownloadResult> {
  const response = await fetch(asset.downloadUrl, {
    headers: {
      Accept: 'application/octet-stream,*/*',
      'User-Agent': GITHUB_USER_AGENT,
    },
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');

    throw new Error(text || `${description} download failed with HTTP ${response.status}.`);
  }

  const totalBytes = Number(response.headers.get('content-length')) || asset.size;
  const hash = createHash('sha256');
  let receivedBytes = 0;
  const progressStream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      hash.update(chunk);

      publishProgress({
        action: 'downloading',
        kind: 'info',
        message: `Downloading ${asset.name}.`,
        percent: totalBytes ? Math.floor((receivedBytes / totalBytes) * 100) : undefined,
      });
      callback(null, chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    progressStream,
    createWriteStream(destinationPath),
  );

  const digest = `sha256:${hash.digest('hex')}`;

  if (asset.digest && asset.digest !== digest) {
    await rm(destinationPath, { force: true });
    throw new Error(`Downloaded ${description} did not match the expected asset digest.`);
  }

  return {
    digest,
    size: totalBytes || receivedBytes,
  };
}

async function findExtractedCorePaths(versionPath: string) {
  const candidates = [versionPath];
  const entries = await readdir(versionPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      candidates.push(path.join(versionPath, entry.name));
    }
  }

  for (const candidate of candidates) {
    const jarPath = path.join(candidate, 'qortium.jar');
    const previewPath = path.join(candidate, 'preview');

    if (existsSync(jarPath) && existsSync(previewPath)) {
      return {
        installPath: candidate,
        jarPath,
        previewPath,
      };
    }
  }

  throw new Error('Installed Core release did not contain qortium.jar and preview scripts.');
}

async function chmodPreviewScripts(previewPath: string) {
  if (process.platform === 'win32') {
    return;
  }

  for (const scriptName of ['reset.sh', 'start.sh', 'status.sh', 'stop.sh']) {
    const scriptPath = path.join(previewPath, scriptName);

    if (existsSync(scriptPath)) {
      await chmod(scriptPath, 0o755);
    }
  }
}

async function findJavaExecutable(installPath: string) {
  const executableName = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [
    path.join(installPath, 'bin', executableName),
    path.join(installPath, 'Contents', 'Home', 'bin', executableName),
  ];

  const entries = await readdir(installPath, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const childPath = path.join(installPath, entry.name);

      candidates.push(
        path.join(childPath, 'bin', executableName),
        path.join(childPath, 'Contents', 'Home', 'bin', executableName),
      );
    }
  }

  const javaPath = candidates.find((candidate) => existsSync(candidate));

  if (!javaPath) {
    throw new Error('Installed Java runtime did not contain a java executable.');
  }

  return javaPath;
}

async function chmodJavaExecutable(javaPath: string) {
  if (process.platform !== 'win32') {
    await chmod(javaPath, 0o755);
  }
}

async function extractJavaArchive(
  archiveType: JavaArchiveType,
  downloadPath: string,
  destinationPath: string,
) {
  if (archiveType === 'zip') {
    await extract(downloadPath, { dir: destinationPath });
    return;
  }

  await extractTar({
    cwd: destinationPath,
    file: downloadPath,
  });
}

async function installJava() {
  await ensureCoreLayout();

  const javaPlatform = getJavaPlatform();

  if (!javaPlatform) {
    throw new Error(`Managed Java is not available for ${process.platform}/${process.arch}.`);
  }

  const archiveExtension = getJavaArchiveExtension(javaPlatform.archiveType);
  const archiveName = `${JAVA_DISTRIBUTION}-${MIN_JAVA_MAJOR_VERSION}-${javaPlatform.apiOs}-${javaPlatform.apiArch}.${archiveExtension}`;
  const archive: DownloadAsset = {
    digest: null,
    downloadUrl: getJavaDownloadUrl(javaPlatform),
    name: archiveName,
    size: 0,
  };
  const downloadPath = path.join(getCoreDownloadsPath(), archiveName);
  const stagingPath = path.join(
    getJavaVersionsPath(),
    sanitizePathSegment(`_staging-${Date.now()}-${javaPlatform.platform}-${javaPlatform.arch}`),
  );

  await mkdir(getCoreDownloadsPath(), { recursive: true });
  await mkdir(getJavaVersionsPath(), { recursive: true });
  await rm(stagingPath, { recursive: true, force: true });
  await mkdir(stagingPath, { recursive: true });

  try {
    const download = await downloadFile(archive, downloadPath, 'Java runtime');

    publishProgress({
      action: 'extracting',
      kind: 'info',
      message: 'Extracting Java runtime.',
      percent: 0,
    });
    await extractJavaArchive(javaPlatform.archiveType, downloadPath, stagingPath);

    const stagingJavaPath = await findJavaExecutable(stagingPath);

    await chmodJavaExecutable(stagingJavaPath);

    const javaStatus = await detectJavaVersion(stagingJavaPath, 'managed');

    if (!javaStatus.available || !javaStatus.version || !javaStatus.majorVersion) {
      throw new Error('Downloaded Java runtime is not Java 17 or newer.');
    }

    const finalPath = path.join(
      getJavaVersionsPath(),
      sanitizePathSegment(
        `${JAVA_DISTRIBUTION}-${MIN_JAVA_MAJOR_VERSION}-${javaStatus.version}-${javaPlatform.platform}-${javaPlatform.arch}`,
      ),
    );

    await rm(finalPath, { recursive: true, force: true });
    await rename(stagingPath, finalPath);

    const javaPath = await findJavaExecutable(finalPath);

    await chmodJavaExecutable(javaPath);
    await writeInstalledJava({
      apiArch: javaPlatform.apiArch,
      apiOs: javaPlatform.apiOs,
      arch: javaPlatform.arch,
      archiveName,
      archiveSize: download.size,
      archiveType: javaPlatform.archiveType,
      digest: download.digest,
      distribution: JAVA_DISTRIBUTION,
      downloadUrl: archive.downloadUrl,
      installedAt: new Date().toISOString(),
      installPath: finalPath,
      javaPath,
      majorVersion: javaStatus.majorVersion,
      platform: javaPlatform.platform,
      version: javaStatus.version,
    });

    publishProgress({
      action: 'idle',
      kind: 'success',
      message: `Installed Java ${javaStatus.version}.`,
      percent: 100,
    });

    return await getStatus();
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(downloadPath, { force: true });
  }
}

function normalizeInstallRequest(request: CoreInstallRequest): CoreChannel {
  if (request.channel === 'stable' || request.channel === 'prerelease') {
    return request.channel;
  }

  return 'prerelease';
}

async function installCore(request: CoreInstallRequest) {
  await ensureCoreLayout();

  const channel = normalizeInstallRequest(request);
  const releases = await checkReleases();
  const release = releases[channel];

  if (!release.available) {
    throw new Error(release.message);
  }

  const existingCore = await readInstalledCoreMetadata();

  if (existingCore?.tagName === release.tagName) {
    await copyLegacyInstallListsToRuntime(existingCore.previewPath, existingCore.runtimePath);
    return await getStatus();
  }

  // If Home is currently running this core, update in place by stopping it
  // before replacing the files and restarting it afterwards. This keeps the
  // download/extract phase running concurrently with the live core and avoids
  // the Windows file lock that blocks replacing the jar of a running JVM.
  // Only do the in-place stop -> replace -> restart dance when there is a known,
  // valid existing install (existingCore !== null): we then have a previous
  // version to fall back to and restart if the update fails. A running core with
  // no/incomplete install metadata is left running and updated without the dance.
  const runtimeBefore = await resolveRuntimeStatusOwner(await fetchLocalCoreStatus(), existingCore);
  const restartAfterInstall = runtimeBefore.running && runtimeBefore.owner === 'home' && existingCore !== null;
  const ownedPid = restartAfterInstall
    ? runtimeBefore.pid ?? (await readRuntimePid(runtimeBefore.runtimePath ?? getCoreRuntimePath()))
    : null;

  const stagingPath = path.join(
    getCoreBasePath(),
    sanitizePathSegment(`_install-staging-${Date.now()}-${release.tagName}`),
  );
  const downloadPath = path.join(
    getCoreDownloadsPath(),
    `${sanitizePathSegment(release.tagName)}-${sanitizePathSegment(release.asset.name)}`,
  );
  // When updating in place we move the current install aside to this backup
  // first, install into the (now empty) target, and only delete the backup on
  // success. If anything fails we restore it, so a failed update never destroys
  // a working install.
  const backupPath = path.join(getCoreBasePath(), sanitizePathSegment(`_install-backup-${Date.now()}`));
  let backupInUse = false;

  await mkdir(getCoreDownloadsPath(), { recursive: true });
  await rm(stagingPath, { recursive: true, force: true });
  await mkdir(stagingPath, { recursive: true });

  try {
    await downloadFile(release.asset, downloadPath);

    publishProgress({
      action: 'extracting',
      kind: 'info',
      message: `Extracting ${release.asset.name}.`,
      percent: 0,
    });
    await extract(downloadPath, { dir: stagingPath });

    const extractedCorePaths = await findExtractedCorePaths(stagingPath);
    const runtimeIdentity = await readCoreRuntimeChainIdentity(extractedCorePaths.previewPath);

    await ensureRuntimeChainCompatible(getCoreRuntimePath(), release.tagName, runtimeIdentity);

    const installPath = getCoreInstallPath();

    if (restartAfterInstall) {
      await stopCore({ quiet: true });

      // Wait for the process to actually exit (not just the API to go quiet) so
      // the OS releases the jar lock before we touch the install directory.
      if (ownedPid !== null) {
        await waitForPidExit(ownedPid, STOP_TIMEOUT_MS);
      }

      await new Promise((resolve) => setTimeout(resolve, FILE_RELEASE_SETTLE_MS));

      await copyLegacyInstallListsToRuntime(existingCore.previewPath, existingCore.runtimePath);

      // Move the working install aside instead of deleting it up front.
      await rm(backupPath, { recursive: true, force: true });

      if (existsSync(installPath)) {
        await movePath(installPath, backupPath);
        backupInUse = true;
      }
    } else if (existingCore) {
      await copyLegacyInstallListsToRuntime(existingCore.previewPath, existingCore.runtimePath);
    }

    await movePathReplacingDestination(extractedCorePaths.installPath, installPath);
    await ensureBootstrapPeers(installPath);
    const previewPath = path.join(
      installPath,
      path.relative(extractedCorePaths.installPath, extractedCorePaths.previewPath),
    );
    const jarPath = path.join(
      installPath,
      path.relative(extractedCorePaths.installPath, extractedCorePaths.jarPath),
    );

    await chmodPreviewScripts(previewPath);

    const installedCore: InstalledCore = {
      assetName: release.asset.name,
      assetSize: release.asset.size,
      channel: release.channel,
      digest: release.asset.digest,
      downloadUrl: release.asset.downloadUrl,
      htmlUrl: release.htmlUrl,
      installPath,
      installedAt: new Date().toISOString(),
      jarPath,
      logPaths: getCoreLogPaths(getCoreRuntimePath()),
      name: release.name,
      previewPath,
      runtimePath: getCoreRuntimePath(),
      tagName: release.tagName,
    };

    await writeInstalledCore(installedCore);
    await ensureRuntimeChainCompatible(installedCore.runtimePath, installedCore.tagName, runtimeIdentity, {
      recordIfMissing: true,
    });

    if (restartAfterInstall) {
      await startCore({ quiet: true });
    }
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });

    // Restore the previous install we moved aside, so the core has a valid
    // version to fall back to (and to restart).
    if (backupInUse && existsSync(backupPath)) {
      try {
        await movePathReplacingDestination(backupPath, getCoreInstallPath());
        await ensureBootstrapPeers(getCoreInstallPath());
        backupInUse = false;
      } catch {
        // leave the backup in place for manual recovery
      }
    }

    if (restartAfterInstall) {
      // Best effort: bring the previous (now restored) version back up.
      try {
        await startCore({ quiet: true });
      } catch {
        // leave the core stopped if it cannot be restarted
      }
    }

    throw error;
  } finally {
    await rm(downloadPath, { force: true });
    await rm(stagingPath, { recursive: true, force: true });
    // On success the backup holds the old version and can be discarded; on a
    // restored failure it was already moved back (backupInUse=false here).
    if (backupInUse) {
      await rm(backupPath, { recursive: true, force: true });
    }
  }

  publishProgress({
    action: 'idle',
    kind: 'success',
    message: restartAfterInstall
      ? `Updated and restarted Qortium Core ${release.tagName}.`
      : `Installed Qortium Core ${release.tagName}.`,
    percent: 100,
  });

  return await getStatus();
}

function quoteWindowsCommandArg(arg: string) {
  const escaped = arg
    .replace(/(\\*)"/g, (_match, backslashes: string) => `${backslashes}${backslashes}\\"`)
    .replace(/(\\+)$/g, (_match, backslashes: string) => `${backslashes}${backslashes}`);

  return `"${escaped}"`;
}

async function runScript(
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
  options: RunScriptOptions = {},
) {
  return new Promise<void>((resolve, reject) => {
    let output = '';
    const ignoreStdio = options.stdio === 'ignore';
    const child =
      process.platform === 'win32'
        ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${command}" ${args.map(quoteWindowsCommandArg).join(' ')}"`], {
            cwd,
            env,
            ...(ignoreStdio ? { stdio: 'ignore' as const } : {}),
            windowsHide: true,
            windowsVerbatimArguments: true,
          })
        : spawn(command, args, {
            cwd,
            env,
            ...(ignoreStdio ? { stdio: 'ignore' as const } : {}),
            windowsHide: true,
          });

    if (!ignoreStdio) {
      child.stdout!.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr!.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
    }

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          ignoreStdio
            ? `${path.basename(command)} exited with code ${code}.`
            : output.trim() || `${path.basename(command)} exited with code ${code}.`,
        ),
      );
    });
  });
}

async function waitForRuntimeState(running: boolean, timeoutMs: number, action: CoreProgress['action']) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const runtime = await fetchLocalCoreStatus();

    if (runtime.running === running) {
      return runtime;
    }

    publishProgress({
      action,
      kind: 'info',
      message: running ? 'Waiting for local Core API.' : 'Waiting for local Core to stop.',
      percent: Math.min(95, Math.floor(((Date.now() - startedAt) / timeoutMs) * 100)),
    });
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(running ? 'Timed out waiting for local Core API.' : 'Timed out waiting for Core to stop.');
}

function getStartScript(previewPath: string) {
  return process.platform === 'win32'
    ? path.join(previewPath, 'start.bat')
    : path.join(previewPath, 'start.sh');
}

function getStopScript(previewPath: string) {
  return process.platform === 'win32'
    ? path.join(previewPath, 'stop.bat')
    : path.join(previewPath, 'stop.sh');
}

// Whether the managed Core has I2P enabled, read from its on-disk participant
// settings (Core isn't running yet at this point). A null/empty/absent
// allowedTransports means Core's default ["IP","I2P"] — I2P enabled. Defaults to
// true on any uncertainty so we never suppress the fallback by accident; only a
// list that positively excludes I2P (e.g. ["IP"]) returns false.
async function isCoreI2pEnabled(runtimePath: string): Promise<boolean> {
  try {
    const raw = await readFile(path.join(runtimePath, 'settings-preview-local.json'), 'utf8');
    const parsed = JSON.parse(raw) as { allowedTransports?: unknown };
    const list = parsed.allowedTransports;

    if (!Array.isArray(list) || list.length === 0) {
      return true;
    }

    return list.some((entry) => typeof entry === 'string' && entry.trim().toUpperCase() === 'I2P');
  } catch {
    return true;
  }
}

async function startCore(options: { quiet?: boolean } = {}) {
  const installedCore = await readInstalledCore();

  if (!installedCore) {
    throw new Error('Install Qortium Core before starting it.');
  }

  const java = await getJavaStatus();

  if (!java.available) {
    throw new Error('Java 17 or newer is required before Qortium Core can start.');
  }

  const currentRuntime = await resolveRuntimeStatusOwner(await fetchLocalCoreStatus(), installedCore);

  if (currentRuntime.running) {
    return await getStatus();
  }

  await ensureInstalledCoreRuntimeChain(installedCore, { recordIfMissing: true });

  // Bring up the managed I2P router (if installed) before Core, so its SAM bridge
  // is ready when Core looks for it. Best-effort — never blocks Core startup.
  // Skip it when the node has I2P disabled (IP-only): no point running a router
  // Core won't use.
  if (await isCoreI2pEnabled(installedCore.runtimePath)) {
    await startI2pdIfManaged();
  }

  const startScript = getStartScript(installedCore.previewPath);

  if (!existsSync(startScript)) {
    throw new Error(
      withCoreLogPaths(
        `The installed Core release is missing its preview start script at ${startScript}.`,
        installedCore.logPaths,
      ),
    );
  }

  publishProgress({
    action: 'starting',
    kind: 'info',
    message: 'Starting Qortium Core.',
    percent: 5,
  });
  try {
    ensurePreviewApiKey(installedCore.runtimePath);
    await runScript(
      startScript,
      ['--participant', `--runtime-dir=${installedCore.runtimePath}`],
      installedCore.previewPath,
      getJavaRuntimeEnv(java),
      // This only covers fd 0/1/2; closing fd >= 3 belongs in Core's start.sh.
      { stdio: 'ignore' },
    );
    await waitForRuntimeState(true, START_TIMEOUT_MS, 'starting');
  } catch (error) {
    throw new Error(withCoreLogPaths(getErrorMessage(error), installedCore.logPaths));
  }

  if (!options.quiet) {
    publishProgress({
      action: 'idle',
      kind: 'success',
      message: 'Qortium Core is running.',
      percent: 100,
    });
  }

  return await getStatus();
}

async function stopCoreByPid(pid: number) {
  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGKILL'];

  for (const signal of signals) {
    if (!isPidRunning(pid)) {
      return;
    }

    try {
      process.kill(pid, signal);
    } catch {
      return;
    }

    const deadline = Date.now() + 5_000;

    while (Date.now() < deadline && isPidRunning(pid)) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

// Stop a Core that Home did not start, through its own admin API (GET /admin/stop),
// authenticated with the running node's API key. Used when the local Core was
// launched outside Home, so the user isn't stuck having to stop it by hand.
async function stopCoreViaApi(installedCore: InstalledCore | null) {
  // Resolve the running node's API key. Prefer introspecting the live process
  // (works on Linux); fall back to the managed runtime's apikey.txt so a
  // Home-managed core whose ownership can't be confirmed — e.g. on macOS, where
  // process introspection isn't available — can still be stopped.
  const apiKey =
    readRunningLocalCoreApiKey()?.apiKey ??
    readPreviewApiKey(getCoreRuntimePath())?.apiKey ??
    (installedCore ? readPreviewApiKey(installedCore.runtimePath)?.apiKey : null) ??
    null;

  if (!apiKey) {
    throw new Error(
      "Could not read the running Core's API key to stop it. Stop it from where it was started.",
    );
  }

  const response = await fetch(`${LOCAL_CORE_API_URL}/admin/stop`, {
    headers: { 'X-API-KEY': apiKey },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Core stop request failed with HTTP ${response.status}.`);
  }
}

async function stopCore(options: { quiet?: boolean } = {}) {
  const installedCore = await readInstalledCore();
  const currentRuntime = await resolveRuntimeStatusOwner(await fetchLocalCoreStatus(), installedCore);

  if (!currentRuntime.running) {
    return await getStatus();
  }

  const logPaths = installedCore?.logPaths ?? getCoreLogPaths(getCoreRuntimePath());
  const stopScript = installedCore ? getStopScript(installedCore.previewPath) : null;
  const isHomeOwned = currentRuntime.owner === 'home';

  publishProgress({
    action: 'stopping',
    kind: 'info',
    message: 'Stopping Qortium Core.',
    percent: 5,
  });
  try {
    if (isHomeOwned && installedCore && stopScript && existsSync(stopScript)) {
      await runScript(
        stopScript,
        [`--runtime-dir=${installedCore.runtimePath}`],
        installedCore.previewPath,
        getJavaRuntimeEnv(await getJavaStatus()),
      );
    } else if (isHomeOwned) {
      // The install files are gone (e.g. the jar was deleted) but the core is
      // still running: terminate the recorded process directly so the user is
      // not stuck with a running-but-unmanageable core.
      const pid =
        currentRuntime.pid ?? (await readRuntimePid(currentRuntime.runtimePath ?? getCoreRuntimePath())) ?? null;

      if (pid === null) {
        throw new Error('Could not determine the running Qortium Core process to stop.');
      }

      await stopCoreByPid(pid);
    } else {
      // Core was started outside Home, or Home can't confirm ownership (e.g. on
      // macOS). Stop it through its own admin API rather than refusing.
      await stopCoreViaApi(installedCore);
    }

    await waitForRuntimeState(false, STOP_TIMEOUT_MS, 'stopping');
  } catch (error) {
    throw new Error(withCoreLogPaths(getErrorMessage(error), logPaths));
  }

  // Stop the router we started alongside Core (no-op for an external router).
  await stopI2pdIfManaged();

  if (!options.quiet) {
    publishProgress({
      action: 'idle',
      kind: 'success',
      message: 'Qortium Core is stopped.',
      percent: 100,
    });
  }

  return await getStatus();
}

export function registerCoreManagerIpcHandlers() {
  ipcMain.handle('core:checkReleases', () => checkReleases());
  ipcMain.handle('core:getStatus', () => getStatus());
  ipcMain.handle('core:install', (_event, request: CoreInstallRequest = {}) => installCore(request));
  ipcMain.handle('core:installJava', () => installJava());
  ipcMain.handle('core:start', () => startCore());
  ipcMain.handle('core:stop', () => stopCore());
}
