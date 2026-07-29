import { app, BrowserWindow, ipcMain } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import extract from 'extract-zip';
import { extract as extractTar } from 'tar';
import {
  ensurePreviewApiKey,
  invalidateRunningCoreApiKeyCache,
  readPreviewApiKey,
  readRunningLocalCoreApiKey,
  type RunningCoreApiKeyResult,
} from './local-api-key.js';
import { copyLegacyInstallListsToRuntime } from './core-runtime-files.js';
import { readCoreJarIdentity, type CoreJarIdentity } from './core-jar-identity.js';
import {
  isCoreInstallActive,
  isOnChainCoreInstallActive,
  withCoreInstallLock,
} from './core-install-lock.js';
import {
  compareCoreVersions,
  coreCommitsMatch,
  getCoreSemver,
  getCoreTimestampMs,
} from './core-version.js';
import {
  readCoreUpdateSettings,
  setCoreUpdateSettings,
  type CoreUpdatePolicy,
  type CoreUpdateSettings,
} from './core-update-settings.js';
import { movePath } from './filesystem-move.js';
import { startIfManaged as startI2pdIfManaged, stopIfManaged as stopI2pdIfManaged } from './i2pd-manager.js';
import { selectManagedJavaBinary } from './managed-java-asset.js';
import { readableNodeErrorMessage } from './node-error-body.js';
import { userMessage } from './user-message.js';

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
// Major version Home installs when it provides Java itself. Independent of
// MIN_JAVA_MAJOR_VERSION: any existing Java at or above the minimum keeps
// working; only the Home-managed runtime is installed at (and upgraded to)
// the target.
const MANAGED_JAVA_TARGET_MAJOR_VERSION = 25;
const MANAGED_JAVA_UPGRADE_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const CORE_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CORE_OPERATION_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const DOWNGRADE_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const ADOPTIUM_ASSETS_TIMEOUT_MS = 10_000;
const JAVA_DISTRIBUTION = 'temurin';
const ADOPTIUM_JAVA_ASSETS_API_BASE_URL = 'https://api.adoptium.net/v3/assets/latest';
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

type GithubCommit = {
  commit?: {
    author?: { date?: unknown };
    committer?: { date?: unknown };
  };
  sha?: unknown;
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
      commitTimestamp: string;
      htmlUrl: string;
      name: string;
      publishedAt: string;
      tagName: string;
    };

type AvailableCoreRelease = Extract<CoreReleaseSummary, { available: true }>;

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
  helpersRefreshedFor?: string;
  installPath: string;
  installedAt: string;
  jarBuildTimestamp?: string;
  jarBuildVersion?: string;
  jarCommit?: string;
  jarPath: string;
  jarSemver?: string;
  logPaths: CoreLogPaths;
  modifiedSinceInstall?: boolean;
  name: string;
  originJarBuildVersion?: string;
  originJarCommit?: string;
  previewPath: string;
  reconciledAt?: string;
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
  latestKnownVersion?: string;
  majorVersion: number;
  platform: NodeJS.Platform;
  upgradeCheckedAt?: string;
  version: string;
};

type JavaStatus = {
  autoUpdateEnabled: boolean;
  available: boolean;
  majorVersion: number | null;
  managedJavaTarget: number;
  managedUpgradeAvailable: boolean;
  path: string;
  source: JavaSource;
  updateAvailableVersion: string | null;
  updatePolicy: CoreUpdatePolicy;
  version: string | null;
};

type CoreUpdateAvailability = {
  action: 'available' | 'handled-by-core' | 'installing';
  channel: 'github' | 'on-chain';
  commit?: string;
  githubChannel?: CoreChannel;
  timestamp?: string;
  version: string;
};

type CoreUpdateEngineStatus = {
  available: CoreUpdateAvailability | null;
  checkedAt?: string;
  error?: string;
  helpersOutOfSync: {
    targetTag: string | null;
    version: string;
  } | null;
  javaUpdatePendingRestart?: boolean;
  nodeAutoUpdateMode?: string;
};

type DowngradeConfirmation = {
  expiresAt: string;
  installedVersion: string;
  targetVersion: string;
  token: string;
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
  coreUpdate: CoreUpdateEngineStatus;
  downgradeConfirmation?: DowngradeConfirmation;
  installed: InstalledCore | null;
  java: JavaStatus;
  runtime: CoreRuntimeStatus;
  supported: boolean;
  updateSettings: CoreUpdateSettings;
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
  allowDowngrade?: unknown;
  channel?: unknown;
  downgradeToken?: unknown;
};

class DowngradeConfirmationRequiredError extends Error {
  constructor(
    message: string,
    readonly confirmation: DowngradeConfirmation,
  ) {
    super(message);
    this.name = 'DowngradeConfirmationRequiredError';
  }
}

const downgradeConfirmations = new Map<string, DowngradeConfirmation>();

function mintDowngradeConfirmation(targetVersion: string, installedVersion: string) {
  const now = Date.now();

  for (const [token, confirmation] of downgradeConfirmations) {
    if (Date.parse(confirmation.expiresAt) <= now) {
      downgradeConfirmations.delete(token);
    }
  }

  const confirmation: DowngradeConfirmation = {
    expiresAt: new Date(now + DOWNGRADE_CONFIRMATION_TTL_MS).toISOString(),
    installedVersion,
    targetVersion,
    token: randomBytes(32).toString('hex'),
  };

  downgradeConfirmations.set(confirmation.token, confirmation);
  return confirmation;
}

function consumeDowngradeConfirmation(request: CoreInstallRequest, targetVersion: string) {
  if (request.allowDowngrade !== true || typeof request.downgradeToken !== 'string') {
    return false;
  }

  const confirmation = downgradeConfirmations.get(request.downgradeToken);

  if (!confirmation) {
    return false;
  }

  downgradeConfirmations.delete(request.downgradeToken);
  return confirmation.targetVersion === targetVersion && Date.parse(confirmation.expiresAt) > Date.now();
}

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

async function writeFileAtomically(destinationPath: string, contents: string | Buffer) {
  const temporaryPath = `${destinationPath}.qortium-home-${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}.tmp`;

  try {
    await writeFile(temporaryPath, contents);
    await rename(temporaryPath, destinationPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function persistReconciledCoreMetadata(
  currentCorePath: string,
  installedCore: InstalledCore,
  identity: CoreJarIdentity,
  modifiedSinceInstall: boolean,
  reconciledAt: string,
) {
  if (isCoreInstallActive()) {
    return;
  }

  try {
    const latestRaw: unknown = JSON.parse(await readFile(currentCorePath, 'utf8'));
    const latestCore = parseInstalledCore(latestRaw);

    // An install may have replaced current.json since this status read began.
    // Only reconcile the exact install snapshot we inspected, and preserve all
    // other fields from the latest on-disk object.
    if (
      !latestCore ||
      latestCore.installedAt !== installedCore.installedAt ||
      latestCore.installPath !== installedCore.installPath ||
      latestCore.jarPath !== installedCore.jarPath ||
      latestCore.tagName !== installedCore.tagName ||
      isCoreInstallActive()
    ) {
      return;
    }

    const identityFields = Object.fromEntries(
      Object.entries(getJarIdentityFields(identity)).filter(([, value]) => value !== undefined),
    );
    const reconciledMetadata = {
      ...(isObject(latestRaw) ? latestRaw : {}),
      ...identityFields,
      modifiedSinceInstall,
      reconciledAt: latestCore.reconciledAt ?? reconciledAt,
    };

    if (isCoreInstallActive()) {
      return;
    }

    await writeFileAtomically(currentCorePath, `${JSON.stringify(reconciledMetadata, null, 2)}\n`);
  } catch {
    // Status reads remain best-effort; a later read will reconcile again.
  }
}

async function ensureBootstrapPeers(installPath: string, options: { strict?: boolean } = {}) {
  const settingsPath = path.join(installPath, 'preview', 'settings-preview.json');

  if (!existsSync(settingsPath)) {
    const message = `Unable to ensure Previewnet bootstrap peers; settings template was not found at ${settingsPath}.`;

    if (options.strict) {
      throw new Error(userMessage('core.error.helpersInvalidRelease'));
    }

    console.warn(message);
    return;
  }

  let parsedSettings: unknown;

  try {
    parsedSettings = JSON.parse(await readFile(settingsPath, 'utf8'));
  } catch (error) {
    if (options.strict) {
      throw new Error(userMessage('core.error.helpersInvalidRelease'));
    }

    console.warn(`Unable to ensure Previewnet bootstrap peers; settings template is not valid JSON at ${settingsPath}.`, error);
    return;
  }

  if (!isObject(parsedSettings)) {
    const message = `Unable to ensure Previewnet bootstrap peers; settings template is not an object at ${settingsPath}.`;

    if (options.strict) {
      throw new Error(userMessage('core.error.helpersInvalidRelease'));
    }

    console.warn(message);
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
    await writeFileAtomically(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  } catch (error) {
    if (options.strict) {
      throw new Error(userMessage('core.error.helpersInvalidRelease'));
    }

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
    commitTimestamp: '',
    tagName,
    name: getString(release.name) || tagName,
    htmlUrl: getString(release.html_url),
    publishedAt: getString(release.published_at),
  };
}

async function resolveReleaseCommit(summary: CoreReleaseSummary): Promise<CoreReleaseSummary> {
  if (!summary.available) {
    return summary;
  }

  try {
    const commit = await fetchGithubJson<GithubCommit>(
      `${GITHUB_API_BASE_URL}/commits/${encodeURIComponent(summary.tagName)}`,
    );
    const commitTimestamp = getString(commit?.commit?.committer?.date) || getString(commit?.commit?.author?.date);

    return {
      ...summary,
      commit: getString(commit?.sha) || summary.commit,
      commitTimestamp,
    };
  } catch {
    return summary;
  }
}

async function getLatestStableRelease(): Promise<CoreReleaseSummary> {
  const release = await fetchGithubJson<unknown>(`${GITHUB_API_BASE_URL}/releases/latest`);

  return await resolveReleaseCommit(releaseToSummary('stable', release));
}

async function getLatestPrerelease(): Promise<CoreReleaseSummary> {
  const releases = await fetchGithubJson<unknown[]>(`${GITHUB_API_BASE_URL}/releases?per_page=20`);
  const release = Array.isArray(releases)
    ? releases.find((candidate) => {
        const normalizedCandidate = normalizeGithubRelease(candidate);

        return normalizedCandidate?.draft !== true && normalizedCandidate?.prerelease === true;
      })
    : null;

  return await resolveReleaseCommit(releaseToSummary('prerelease', release));
}

async function getReleaseMatchingCoreVersion(semver: string): Promise<AvailableCoreRelease | null> {
  const releases = await fetchGithubJson<unknown[]>(`${GITHUB_API_BASE_URL}/releases?per_page=100`);
  const normalizedReleases = (Array.isArray(releases) ? releases : [])
    .map(normalizeGithubRelease)
    .filter((release): release is GithubRelease => !!release && release.draft !== true);

  for (const tagName of [`v${semver}`, semver]) {
    const release = normalizedReleases.find((candidate) => getString(candidate.tag_name) === tagName);

    if (!release) {
      continue;
    }

    const summary = releaseToSummary(release.prerelease === true ? 'prerelease' : 'stable', release);

    if (summary.available) {
      return summary;
    }
  }

  for (const tagName of [`v${semver}`, semver]) {
    const release = normalizeGithubRelease(
      await fetchGithubJson<unknown>(
        `${GITHUB_API_BASE_URL}/releases/tags/${encodeURIComponent(tagName)}`,
      ),
    );

    if (!release || release.draft === true || getString(release.tag_name) !== tagName) {
      continue;
    }

    const summary = releaseToSummary(release.prerelease === true ? 'prerelease' : 'stable', release);

    if (summary.available) {
      return summary;
    }
  }

  return null;
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
    helpersRefreshedFor: getString(installedCore.helpersRefreshedFor) || undefined,
    installPath,
    installedAt: getString(installedCore.installedAt),
    jarBuildTimestamp: getString(installedCore.jarBuildTimestamp) || undefined,
    jarBuildVersion: getString(installedCore.jarBuildVersion) || undefined,
    jarCommit: getString(installedCore.jarCommit) || undefined,
    jarPath,
    jarSemver: getString(installedCore.jarSemver) || undefined,
    logPaths: getCoreLogPaths(runtimePath),
    modifiedSinceInstall: installedCore.modifiedSinceInstall === true,
    name: getString(installedCore.name) || tagName,
    originJarBuildVersion: getString(installedCore.originJarBuildVersion) || undefined,
    originJarCommit: getString(installedCore.originJarCommit) || undefined,
    previewPath,
    reconciledAt: getString(installedCore.reconciledAt) || undefined,
    runtimePath,
    tagName,
  };
}

function getJarIdentityFields(identity: CoreJarIdentity | null) {
  return identity
    ? {
        jarBuildTimestamp: identity.buildTimestamp || undefined,
        jarBuildVersion: identity.buildVersion,
        jarCommit: identity.commit || undefined,
        jarSemver: identity.semver,
      }
    : {};
}

function isInstalledJarModified(installedCore: InstalledCore, identity: CoreJarIdentity) {
  const tagSemver = getCoreSemver(installedCore.tagName);

  if (!tagSemver || identity.semver !== tagSemver) {
    return true;
  }

  if (installedCore.originJarBuildVersion) {
    return installedCore.originJarBuildVersion !== identity.buildVersion;
  }

  if (installedCore.originJarCommit && identity.commit) {
    return !coreCommitsMatch(installedCore.originJarCommit, identity.commit);
  }

  return false;
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
      const identity = await readCoreJarIdentity(installedCore.jarPath);

      if (!identity) {
        return installedCore;
      }

      const modifiedSinceInstall = isInstalledJarModified(installedCore, identity);
      const reconciledCore: InstalledCore = {
        ...installedCore,
        ...getJarIdentityFields(identity),
        modifiedSinceInstall,
      };
      const identityChanged =
        installedCore.jarBuildVersion !== identity.buildVersion ||
        installedCore.jarBuildTimestamp !== (identity.buildTimestamp || undefined) ||
        (identity.commit && !coreCommitsMatch(installedCore.jarCommit, identity.commit));

      if (
        (modifiedSinceInstall && !installedCore.reconciledAt) ||
        (identityChanged && (modifiedSinceInstall || !!installedCore.reconciledAt))
      ) {
        reconciledCore.reconciledAt = installedCore.reconciledAt ?? new Date().toISOString();
        await persistReconciledCoreMetadata(
          currentCorePath,
          installedCore,
          identity,
          modifiedSinceInstall,
          reconciledCore.reconciledAt,
        );
      }

      return reconciledCore;
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

export function scheduleManagedCoreUpdateCheck() {
  setTimeout(() => {
    void runCoreUpdateEngine();
  }, 1_000).unref();
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
  await writeFileAtomically(getCurrentCorePath(), `${JSON.stringify(installedCore, null, 2)}\n`);
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
  await cleanupStaleCoreOperationDirectories();
  await migrateLegacyJavaLayout();
  await migrateLegacyCoreLayout();
  const installedCore = await readInstalledCoreMetadata();

  await migrateRootRuntimeEntriesIfSafe(installedCore);

  if (installedCore) {
    await ensureInstalledCoreRuntimeChain(installedCore, { recordIfMissing: true });
  }
}

async function cleanupStaleCoreOperationDirectories() {
  const cutoffMs = Date.now() - CORE_OPERATION_STALE_MS;
  const entries = await readdir(getCoreBasePath(), { withFileTypes: true }).catch(() => []);

  await Promise.all(
    entries.map(async (entry) => {
      if (
        !entry.isDirectory() ||
        (!entry.name.startsWith('_helpers-backup-') && !entry.name.startsWith('_install-staging-'))
      ) {
        return;
      }

      const entryPath = path.join(getCoreBasePath(), entry.name);
      const entryStat = await stat(entryPath).catch(() => null);

      if (entryStat && entryStat.mtimeMs < cutoffMs) {
        await rm(entryPath, { recursive: true, force: true }).catch(() => {});
      }
    }),
  );
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
  const upgradeCheckedAt = getString(managedJava.upgradeCheckedAt);
  const latestKnownVersion = getString(managedJava.latestKnownVersion);

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
    ...(latestKnownVersion ? { latestKnownVersion } : {}),
    majorVersion,
    platform: platform || process.platform,
    ...(upgradeCheckedAt ? { upgradeCheckedAt } : {}),
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

// Tolerates both `java -version` strings ("25.0.3") and Adoptium version
// strings ("25.0.3+9-LTS"): everything from the first build/pre-release
// separator on is ignored.
function parseJavaVersionNumbers(version: string) {
  const release = version.split(/[+_-]/)[0] ?? '';

  return release
    .split('.')
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

function isNewerJavaVersion(candidate: string, installed: string) {
  const candidateNumbers = parseJavaVersionNumbers(candidate);
  const installedNumbers = parseJavaVersionNumbers(installed);
  const length = Math.max(candidateNumbers.length, installedNumbers.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (candidateNumbers[index] ?? 0) - (installedNumbers[index] ?? 0);

    if (difference !== 0) {
      return difference > 0;
    }
  }

  return false;
}

// Single source for both the managed-runtime download and the "is a newer
// runtime out?" check, so the version Home advertises is always one it can
// actually install: a package Adoptium publishes without a usable checksum is
// not offered, because it would be refused at install time anyway.
async function fetchLatestManagedJavaBinary(javaPlatform: JavaPlatform) {
  const url =
    `${ADOPTIUM_JAVA_ASSETS_API_BASE_URL}/${MANAGED_JAVA_TARGET_MAJOR_VERSION}/hotspot` +
    `?architecture=${javaPlatform.apiArch}&image_type=jre&os=${javaPlatform.apiOs}&vendor=eclipse`;

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(ADOPTIUM_ASSETS_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    return selectManagedJavaBinary(await response.json(), {
      apiArch: javaPlatform.apiArch,
      apiOs: javaPlatform.apiOs,
      archiveExtension: getJavaArchiveExtension(javaPlatform.archiveType),
    });
  } catch {
    return null;
  }
}

function isManagedJavaUpdateAvailable(installedJava: ManagedJava) {
  if (installedJava.majorVersion < MANAGED_JAVA_TARGET_MAJOR_VERSION) {
    return true;
  }

  return (
    !!installedJava.latestKnownVersion &&
    isNewerJavaVersion(installedJava.latestKnownVersion, installedJava.version)
  );
}

// Refreshes what we know about newer managed-runtime versions (persisted in
// the install metadata so status reads never wait on the network). Throttled;
// the check stamp is written before fetching so an offline machine retries
// weekly instead of on every call.
async function refreshManagedJavaUpdateInfo(installedJava: ManagedJava): Promise<ManagedJava> {
  const lastCheckedAt = Date.parse(installedJava.upgradeCheckedAt ?? '');

  if (Number.isFinite(lastCheckedAt) && Date.now() - lastCheckedAt < MANAGED_JAVA_UPGRADE_CHECK_INTERVAL_MS) {
    return installedJava;
  }

  let refreshed: ManagedJava = { ...installedJava, upgradeCheckedAt: new Date().toISOString() };

  await writeInstalledJava(refreshed);

  const javaPlatform = getJavaPlatform();
  const latestVersion = javaPlatform ? (await fetchLatestManagedJavaBinary(javaPlatform))?.version : null;

  if (latestVersion) {
    refreshed = { ...refreshed, latestKnownVersion: latestVersion };
    await writeInstalledJava(refreshed);
  }

  return refreshed;
}

let managedJavaRefreshInFlight = false;

function scheduleManagedJavaUpdateRefresh(installedJava: ManagedJava) {
  if (managedJavaRefreshInFlight) {
    return;
  }

  managedJavaRefreshInFlight = true;
  void refreshManagedJavaUpdateInfo(installedJava)
    .then((refreshed) => {
      if (
        refreshed.latestKnownVersion !== installedJava.latestKnownVersion ||
        refreshed.upgradeCheckedAt !== installedJava.upgradeCheckedAt
      ) {
        void publishCoreStatus();
      }
    })
    .catch(() => {})
    .finally(() => {
      managedJavaRefreshInFlight = false;
    });
}

// Opt-in (update-settings.json, off by default): updates the Home-managed JRE —
// an older major to the target, or a security refresh within it. Without a
// refresh path, managed runtimes stay frozen at whatever version was first
// downloaded. Best-effort — callers must be able to proceed on the existing
// runtime.
async function maybeUpgradeManagedJava(options: { throwOnError?: boolean } = {}) {
  try {
    if ((await readCoreUpdateSettings()).javaUpdatePolicy !== 'install') {
      return;
    }

    let installedJava = await readInstalledJavaMetadata();

    if (!installedJava) {
      return;
    }

    installedJava = await refreshManagedJavaUpdateInfo(installedJava);

    if (!isManagedJavaUpdateAvailable(installedJava)) {
      return;
    }

    await installJava();
  } catch (error) {
    if (options.throwOnError) {
      throw error;
    }

    console.warn('Unable to update the managed Java runtime; continuing with the existing one.', error);
  }
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
        autoUpdateEnabled: false,
        available: false,
        majorVersion: null,
        managedJavaTarget: MANAGED_JAVA_TARGET_MAJOR_VERSION,
        managedUpgradeAvailable: false,
        path: command,
        source,
        updateAvailableVersion: null,
        updatePolicy: 'off',
        version: null,
      });
    });
    child.on('close', () => {
      const output = Buffer.concat(chunks).toString();
      const version = /(?:java|openjdk) version\s+"([^"]+)"/i.exec(output)?.[1] ?? null;
      const majorVersion = version ? parseJavaMajorVersion(version) : null;

      resolve({
        autoUpdateEnabled: false,
        available: typeof majorVersion === 'number' && majorVersion >= MIN_JAVA_MAJOR_VERSION,
        majorVersion,
        managedJavaTarget: MANAGED_JAVA_TARGET_MAJOR_VERSION,
        managedUpgradeAvailable: false,
        path: command,
        source,
        updateAvailableVersion: null,
        updatePolicy: 'off',
        version,
      });
    });
  });
}

async function getJavaStatus(options: { ensureLayout?: boolean } = {}): Promise<JavaStatus> {
  const installedJava =
    options.ensureLayout === false ? await readInstalledJavaMetadata() : await readInstalledJava();
  const updatePolicy = (await readCoreUpdateSettings()).javaUpdatePolicy;
  const autoUpdateEnabled = updatePolicy === 'install';
  let managedStatus: JavaStatus | null = null;

  if (installedJava) {
    managedStatus = await detectJavaVersion(installedJava.javaPath, 'managed');

    if (managedStatus.available) {
      // Fire-and-forget: availability below reads only persisted metadata, so
      // a fresh check result shows up on a later status poll.
      scheduleManagedJavaUpdateRefresh(installedJava);

      const managedUpgradeAvailable = isManagedJavaUpdateAvailable(installedJava);

      return {
        ...managedStatus,
        autoUpdateEnabled,
        managedUpgradeAvailable,
        updateAvailableVersion: managedUpgradeAvailable
          ? installedJava.latestKnownVersion ?? String(MANAGED_JAVA_TARGET_MAJOR_VERSION)
          : null,
        updatePolicy,
      };
    }
  }

  const systemJava = await detectJavaVersion('java', 'system');

  if (systemJava.available) {
    // A supported system Java is never replaced, but when it trails the
    // managed target the UI can offer installing a Home-managed runtime
    // alongside it (managed installs are preferred once present).
    return {
      ...systemJava,
      autoUpdateEnabled,
      managedUpgradeAvailable: (systemJava.majorVersion ?? 0) < MANAGED_JAVA_TARGET_MAJOR_VERSION,
      updateAvailableVersion: null,
      updatePolicy,
    };
  }

  if (managedStatus?.version) {
    return {
      ...managedStatus,
      autoUpdateEnabled,
      source: 'unsupported',
      updatePolicy,
    };
  }

  return {
    ...systemJava,
    autoUpdateEnabled,
    source: systemJava.version ? 'unsupported' : 'missing',
    updatePolicy,
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

type OnChainUpdateStatus = Record<string, unknown>;

type GithubUpdateCandidate = {
  autoInstall: boolean;
  channel: 'github';
  commit: string;
  commitTimeMs: number | null;
  githubChannel: CoreChannel;
  release: Extract<CoreReleaseSummary, { available: true }>;
  version: string;
};

type OnChainUpdateCandidate = {
  autoInstall: boolean;
  channel: 'on-chain';
  commit: string;
  commitTimeMs: number;
  status: OnChainUpdateStatus;
  version: string;
};

type CoreUpdateCandidate = GithubUpdateCandidate | OnChainUpdateCandidate;

let coreUpdateEngineStatus: CoreUpdateEngineStatus = { available: null, helpersOutOfSync: null };
let coreUpdateEnginePromise: Promise<void> | null = null;
let coreUpdateEngineRerunPromise: Promise<void> | null = null;
let coreUpdateInterval: NodeJS.Timeout | null = null;

function getManagedCoreApiKey(installedCore: InstalledCore) {
  return (
    readRunningLocalCoreApiKey()?.apiKey ??
    readPreviewApiKey(installedCore.runtimePath)?.apiKey ??
    readPreviewApiKey(getCoreRuntimePath())?.apiKey ??
    null
  );
}

async function requestManagedCoreUpdate(installedCore: InstalledCore, method: 'GET' | 'POST') {
  const apiKey = getManagedCoreApiKey(installedCore);

  if (!apiKey) {
    throw new Error(userMessage('core.error.onChainStatusUnavailable'));
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), STATUS_TIMEOUT_MS);

  try {
    const response = await fetch(`${LOCAL_CORE_API_URL}/admin/update`, {
      headers: { 'X-API-KEY': apiKey },
      method,
      signal: abortController.signal,
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        readableNodeErrorMessage(
          text,
          userMessage('core.error.onChainHttp', { status: response.status }),
        ),
      );
    }

    const status: unknown = text ? JSON.parse(text) : {};

    return isObject(status) ? status : {};
  } finally {
    clearTimeout(timeout);
  }
}

function getOnChainAutoUpdateMode(status: OnChainUpdateStatus | null) {
  return getString(status?.autoUpdateMode).toUpperCase();
}

function getGithubUpdateCandidate(
  release: CoreReleaseSummary,
  installedCore: InstalledCore,
): GithubUpdateCandidate | null {
  const commitTimeMs = release.available ? getCoreTimestampMs(release.commitTimestamp) : null;
  const installedTimestamp = getCoreTimestampMs(installedCore.jarBuildTimestamp);
  const releaseCommitIsResolved = release.available && /^[0-9a-f]{40}$/i.test(release.commit);

  if (
    !release.available ||
    compareCoreVersions(release.tagName, installedCore.jarSemver ?? installedCore.tagName) !== 1 ||
    (releaseCommitIsResolved &&
      !!installedCore.jarCommit &&
      coreCommitsMatch(release.commit, installedCore.jarCommit)) ||
    (commitTimeMs !== null && installedTimestamp !== null && commitTimeMs <= installedTimestamp)
  ) {
    return null;
  }

  return {
    autoInstall: commitTimeMs !== null,
    channel: 'github',
    commit: release.commit,
    commitTimeMs,
    githubChannel: release.channel,
    release,
    version: release.tagName,
  };
}

function getOnChainUpdateCandidate(
  status: OnChainUpdateStatus | null,
  installedCore: InstalledCore,
): OnChainUpdateCandidate | null {
  const updateTimestamp = getCoreTimestampMs(
    typeof status?.updateTimestamp === 'number' || typeof status?.updateTimestamp === 'string'
      ? status.updateTimestamp
      : null,
  );
  const installedTimestamp = getCoreTimestampMs(installedCore.jarBuildTimestamp);
  const approvalStatus = getString(status?.manifestApprovalStatus).toUpperCase();
  const commit = getString(status?.commitHash);

  if (
    status?.updateAvailable !== true ||
    approvalStatus !== 'APPROVED' ||
    updateTimestamp === null ||
    (!!commit && !!installedCore.jarCommit && coreCommitsMatch(commit, installedCore.jarCommit)) ||
    (installedTimestamp !== null && updateTimestamp <= installedTimestamp)
  ) {
    return null;
  }

  return {
    autoInstall: installedTimestamp !== null,
    channel: 'on-chain',
    commit,
    commitTimeMs: updateTimestamp,
    status,
    version: commit ? commit.slice(0, 8) : new Date(updateTimestamp).toISOString(),
  };
}

function selectCoreUpdateCandidate(
  github: GithubUpdateCandidate | null,
  onChain: OnChainUpdateCandidate | null,
) {
  if (!github) {
    return onChain;
  }

  if (!onChain) {
    return github;
  }

  if (github.commitTimeMs === null) {
    return onChain;
  }

  return onChain.commitTimeMs >= github.commitTimeMs ? onChain : github;
}

function toCoreUpdateAvailability(
  candidate: CoreUpdateCandidate,
  action: CoreUpdateAvailability['action'] = 'available',
): CoreUpdateAvailability {
  return {
    action,
    channel: candidate.channel,
    commit: candidate.commit || undefined,
    githubChannel: candidate.channel === 'github' ? candidate.githubChannel : undefined,
    timestamp:
      candidate.commitTimeMs === null ? undefined : new Date(candidate.commitTimeMs).toISOString(),
    version: candidate.version,
  };
}

async function runCoreUpdateEnginePass() {
  const updateSettings = await readCoreUpdateSettings();
  const checkedAt = new Date().toISOString();
  const errors: string[] = [];
  let installedCore = await readInstalledCore();
  let installedJava = await readInstalledJavaMetadata();
  const shouldCheckForCoreUpdates = !!installedCore && updateSettings.coreUpdatePolicy !== 'off';

  if (installedJava) {
    installedJava = await refreshManagedJavaUpdateInfo(installedJava);
  }

  let javaUpdatePendingRestart =
    updateSettings.javaUpdatePolicy === 'install' &&
    !!installedJava &&
    isManagedJavaUpdateAvailable(installedJava);
  const runtime =
    shouldCheckForCoreUpdates || javaUpdatePendingRestart
      ? await resolveRuntimeStatusOwner(await fetchLocalCoreStatus(), installedCore)
      : null;

  if (javaUpdatePendingRestart && !runtime?.running) {
    try {
      await maybeUpgradeManagedJava({ throwOnError: true });
      javaUpdatePendingRestart = false;
    } catch (error) {
      console.warn('Unable to update the managed Java runtime during the Core update policy check.', error);
      errors.push(getErrorMessage(error));
    }
  }

  if (!installedCore) {
    coreUpdateEngineStatus = {
      available: null,
      checkedAt,
      error: errors.length > 0 ? errors.join(' ') : undefined,
      helpersOutOfSync: null,
      javaUpdatePendingRestart,
    };
    return;
  }

  const installedChannel = installedCore.channel;
  const shouldCheckHelpers =
    installedCore.modifiedSinceInstall === true &&
    !!installedCore.jarSemver &&
    !wereHelpersRefreshedForCoreVersion(installedCore);
  const githubReleasePromise =
    shouldCheckForCoreUpdates
      ? installedCore.channel === 'stable'
        ? getLatestStableRelease()
        : getLatestPrerelease()
      : Promise.resolve<CoreReleaseSummary>({
          available: false,
          channel: installedChannel,
          message: 'Core update checks are off.',
        });
  const onChainStatusPromise =
    shouldCheckForCoreUpdates && runtime?.running && runtime.owner === 'home'
      ? requestManagedCoreUpdate(installedCore, 'GET')
      : Promise.resolve<OnChainUpdateStatus | null>(null);
  const helperReleasePromise = shouldCheckHelpers
    ? getReleaseMatchingCoreVersion(installedCore.jarSemver ?? '')
    : Promise.resolve<AvailableCoreRelease | null>(null);
  let helperLookupCompleted = true;
  const [githubRelease, onChainStatus, helperRelease] = await Promise.all([
    githubReleasePromise.catch((error): CoreReleaseSummary => {
      console.warn('Unable to check the configured GitHub Core release channel.', error);
      errors.push(getErrorMessage(error));
      return {
        available: false,
        channel: installedChannel,
        message: getErrorMessage(error),
      };
    }),
    onChainStatusPromise.catch((error) => {
      console.warn('Unable to check the managed Core on-chain update channel.', error);
      errors.push(getErrorMessage(error));
      return null;
    }),
    helperReleasePromise.catch((error) => {
      console.warn('Unable to find support files for the installed Core jar.', error);
      errors.push(getErrorMessage(error));
      helperLookupCompleted = false;
      return null;
    }),
  ]);
  const nodeAutoUpdateMode = getOnChainAutoUpdateMode(onChainStatus);
  let candidate = selectCoreUpdateCandidate(
    getGithubUpdateCandidate(githubRelease, installedCore),
    getOnChainUpdateCandidate(onChainStatus, installedCore),
  );
  let onChainInstallActive =
    candidate?.channel === 'on-chain' && isOnChainCoreInstallActive(candidate.status);

  coreUpdateEngineStatus = {
    available: candidate
      ? toCoreUpdateAvailability(
          candidate,
          candidate.channel === 'on-chain' && nodeAutoUpdateMode === 'INSTALL'
            ? 'handled-by-core'
            : onChainInstallActive
              ? 'installing'
              : 'available',
        )
      : null,
    checkedAt,
    error: errors.length > 0 ? errors.join(' ') : undefined,
    helpersOutOfSync:
      shouldCheckHelpers && helperLookupCompleted
        ? {
            targetTag: helperRelease?.tagName ?? null,
            version: installedCore.jarSemver ?? '',
          }
        : null,
    javaUpdatePendingRestart,
    nodeAutoUpdateMode: nodeAutoUpdateMode || undefined,
  };

  if (
    shouldCheckHelpers &&
    helperRelease &&
    updateSettings.coreUpdatePolicy === 'install'
  ) {
    await withCoreInstallLock('helpers', () => refreshCoreHelpersUnlocked(helperRelease));
    installedCore = (await readInstalledCore()) ?? installedCore;
    candidate = selectCoreUpdateCandidate(
      getGithubUpdateCandidate(githubRelease, installedCore),
      getOnChainUpdateCandidate(onChainStatus, installedCore),
    );
    onChainInstallActive =
      candidate?.channel === 'on-chain' && isOnChainCoreInstallActive(candidate.status);
  }

  if (!candidate || !candidate.autoInstall || updateSettings.coreUpdatePolicy !== 'install') {
    return;
  }

  if (candidate.channel === 'on-chain') {
    if (nodeAutoUpdateMode === 'INSTALL' || onChainInstallActive) {
      return;
    }

    coreUpdateEngineStatus.available = toCoreUpdateAvailability(candidate, 'installing');
    await withCoreInstallLock('on-chain', () => requestManagedCoreUpdate(installedCore, 'POST'));
    return;
  }

  coreUpdateEngineStatus.available = toCoreUpdateAvailability(candidate, 'installing');
  await installCore({ channel: candidate.githubChannel });
  coreUpdateEngineStatus = {
    available: null,
    checkedAt: new Date().toISOString(),
    error: errors.length > 0 ? errors.join(' ') : undefined,
    helpersOutOfSync: null,
    javaUpdatePendingRestart,
    nodeAutoUpdateMode: nodeAutoUpdateMode || undefined,
  };
}

async function publishCoreStatus() {
  const status = await getStatus();

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('core:status', status);
    }
  }
}

function runCoreUpdateEngine() {
  if (coreUpdateEnginePromise) {
    return coreUpdateEnginePromise;
  }

  coreUpdateEnginePromise = (async () => {
    try {
      await runCoreUpdateEnginePass();
    } catch (error) {
      console.warn('Qortium Core update policy check failed.', error);
      coreUpdateEngineStatus = {
        ...coreUpdateEngineStatus,
        available:
          coreUpdateEngineStatus.available?.action === 'installing'
            ? { ...coreUpdateEngineStatus.available, action: 'available' }
            : coreUpdateEngineStatus.available,
        checkedAt: new Date().toISOString(),
        error: getErrorMessage(error),
      };
    }

    await publishCoreStatus().catch((error) => {
      console.warn('Unable to publish Qortium Core update status.', error);
    });
  })().finally(() => {
    coreUpdateEnginePromise = null;
  });

  return coreUpdateEnginePromise;
}

function runCoreUpdateEngineAfterPolicyChange() {
  if (!coreUpdateEnginePromise) {
    return runCoreUpdateEngine();
  }

  if (!coreUpdateEngineRerunPromise) {
    coreUpdateEngineRerunPromise = coreUpdateEnginePromise
      .then(() => runCoreUpdateEngine())
      .finally(() => {
        coreUpdateEngineRerunPromise = null;
      });
  }

  return coreUpdateEngineRerunPromise;
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

  const [installed, java, runtime, updateSettings] = await Promise.all([
    readInstalledCoreMetadata(),
    getJavaStatus({ ensureLayout: !blockedRuntime }),
    fetchLocalCoreStatus(),
    readCoreUpdateSettings(),
  ]);
  const resolvedRuntime = await resolveRuntimeStatusOwner(runtime, installed);
  const runtimeBlocked = blockedRuntime ?? (await readRuntimeMigrationBlocked(getCoreRuntimePath()));

  return {
    coreUpdate: coreUpdateEngineStatus,
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
    updateSettings,
  };
}

async function downloadFile(
  asset: DownloadAsset,
  destinationPath: string,
  description = 'Core asset',
  progressMessage?: string,
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
        message: progressMessage ?? `Downloading ${asset.name}.`,
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

function isReleaseForCoreSemver(release: AvailableCoreRelease, semver: string) {
  return release.tagName === `v${semver}` || release.tagName === semver;
}

function wereHelpersRefreshedForCoreVersion(installedCore: InstalledCore) {
  return (
    !!installedCore.jarSemver &&
    getCoreSemver(installedCore.helpersRefreshedFor) === installedCore.jarSemver
  );
}

async function listReleaseHelperFiles(
  installPath: string,
  currentPath = installPath,
): Promise<Array<{ relativePath: string; sourcePath: string }>> {
  const files: Array<{ relativePath: string; sourcePath: string }> = [];
  const entries = await readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(currentPath, entry.name);
    const relativePath = path.relative(installPath, sourcePath);
    const [topLevelEntry = ''] = relativePath.split(path.sep);

    if (topLevelEntry.toLowerCase() === CORE_RUNTIME_DIR || entry.name.toLowerCase() === 'qortium.jar') {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await listReleaseHelperFiles(installPath, sourcePath)));
      continue;
    }

    if (!entry.isFile()) {
      throw new Error(userMessage('core.error.helpersInvalidRelease'));
    }

    files.push({ relativePath, sourcePath });
  }

  return files;
}

async function replaceHelperFileAtomically(
  sourcePath: string,
  destinationPath: string,
  operationId: string,
) {
  if (!isPathWithinPath(destinationPath, getCoreInstallPath())) {
    throw new Error(userMessage('core.error.helpersInvalidRelease'));
  }

  let existingParentPath = path.dirname(destinationPath);

  while (!existsSync(existingParentPath)) {
    const parentPath = path.dirname(existingParentPath);

    if (parentPath === existingParentPath) {
      throw new Error(userMessage('core.error.helpersInvalidRelease'));
    }

    existingParentPath = parentPath;
  }

  const [realInstallPath, realParentPath] = await Promise.all([
    realpath(getCoreInstallPath()),
    realpath(existingParentPath),
  ]);

  if (!isPathWithinPath(realParentPath, realInstallPath)) {
    throw new Error(userMessage('core.error.helpersInvalidRelease'));
  }

  await mkdir(path.dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.qortium-home-${operationId}.tmp`;

  try {
    await copyFile(sourcePath, temporaryPath);
    await rename(temporaryPath, destinationPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function refreshCoreHelpersUnlocked(expectedRelease?: AvailableCoreRelease) {
  await ensureCoreLayout();

  const installedCore = await readInstalledCoreMetadata();

  if (
    !installedCore?.modifiedSinceInstall ||
    !installedCore.jarSemver ||
    wereHelpersRefreshedForCoreVersion(installedCore)
  ) {
    coreUpdateEngineStatus = {
      ...coreUpdateEngineStatus,
      helpersOutOfSync: null,
    };
    return await getStatus();
  }

  const jarIdentityBefore = await readCoreJarIdentity(installedCore.jarPath);

  if (!jarIdentityBefore) {
    throw new Error(userMessage('core.error.helpersJarIdentityUnavailable'));
  }

  const release =
    expectedRelease && isReleaseForCoreSemver(expectedRelease, jarIdentityBefore.semver)
      ? expectedRelease
      : await getReleaseMatchingCoreVersion(jarIdentityBefore.semver);

  if (!release) {
    throw new Error(
      userMessage('core.error.helpersReleaseUnavailable', { version: jarIdentityBefore.semver }),
    );
  }

  const operationId = sanitizePathSegment(`${process.pid}-${Date.now()}-${release.tagName}`);
  const stagingPath = path.join(getCoreBasePath(), `_helpers-staging-${operationId}`);
  const backupPath = path.join(getCoreBasePath(), `_helpers-backup-${operationId}`);
  const downloadPath = path.join(
    getCoreDownloadsPath(),
    `_helpers-${operationId}-${sanitizePathSegment(release.asset.name)}`,
  );

  await mkdir(getCoreDownloadsPath(), { recursive: true });
  await rm(stagingPath, { recursive: true, force: true });
  await mkdir(stagingPath, { recursive: true });
  await rm(backupPath, { recursive: true, force: true });

  let refreshSucceeded = false;
  let rollbackFailed = false;

  try {
    const download = await downloadFile(
      release.asset,
      downloadPath,
      'Core asset',
      userMessage('core.helpersDownloading', { name: release.asset.name }),
    );

    publishProgress({
      action: 'extracting',
      kind: 'info',
      message: userMessage('core.helpersExtracting', { name: release.asset.name }),
      percent: 0,
    });
    await extract(downloadPath, { dir: stagingPath });

    const extractedCorePaths = await findExtractedCorePaths(stagingPath);
    const helperFiles = await listReleaseHelperFiles(extractedCorePaths.installPath);

    if (helperFiles.length === 0) {
      throw new Error(userMessage('core.error.helpersInvalidRelease'));
    }

    const helperBackups: Array<{
      backupFilePath: string | null;
      destinationPath: string;
    }> = [];

    // Stage a complete rollback set before touching the managed install. Files
    // absent from the old set are recorded too, so rollback removes additions.
    await mkdir(backupPath, { recursive: true });
    for (const helperFile of helperFiles) {
      const destinationPath = path.join(installedCore.installPath, helperFile.relativePath);
      const backupFilePath = existsSync(destinationPath)
        ? path.join(backupPath, helperFile.relativePath)
        : null;

      if (backupFilePath) {
        await mkdir(path.dirname(backupFilePath), { recursive: true });
        await copyFile(destinationPath, backupFilePath);
      }

      helperBackups.push({ backupFilePath, destinationPath });
    }

    try {
      for (const [index, helperFile] of helperFiles.entries()) {
        await replaceHelperFileAtomically(
          helperFile.sourcePath,
          helperBackups[index].destinationPath,
          operationId,
        );
      }

      await ensureBootstrapPeers(installedCore.installPath, { strict: true });
      await chmodPreviewScripts(installedCore.previewPath);

      const jarIdentityAfter = await readCoreJarIdentity(installedCore.jarPath);

      if (!jarIdentityAfter || jarIdentityAfter.buildVersion !== jarIdentityBefore.buildVersion) {
        throw new Error(userMessage('core.error.helpersJarChanged'));
      }

      await writeInstalledCore({
        ...installedCore,
        assetName: release.asset.name,
        assetSize: download.size,
        channel: installedCore.channel,
        digest: download.digest,
        downloadUrl: release.asset.downloadUrl,
        helpersRefreshedFor: release.tagName,
        htmlUrl: release.htmlUrl,
        ...getJarIdentityFields(jarIdentityAfter),
        modifiedSinceInstall: false,
        name: release.name,
        originJarBuildVersion: jarIdentityAfter.buildVersion,
        originJarCommit: jarIdentityAfter.commit || undefined,
        reconciledAt: new Date().toISOString(),
        tagName: release.tagName,
      });
      refreshSucceeded = true;
    } catch (error) {
      console.warn('Core support-file refresh failed; restoring the previous helper set.', error);

      for (const [index, backup] of [...helperBackups].reverse().entries()) {
        try {
          if (backup.backupFilePath) {
            await replaceHelperFileAtomically(
              backup.backupFilePath,
              backup.destinationPath,
              `${operationId}-rollback-${index}`,
            );
          } else {
            await rm(backup.destinationPath, { force: true });
          }
        } catch (restoreError) {
          console.warn(`Unable to restore Core support file ${backup.destinationPath}.`, restoreError);
          rollbackFailed = true;
        }
      }

      throw error;
    }

    coreUpdateEngineStatus = {
      ...coreUpdateEngineStatus,
      checkedAt: new Date().toISOString(),
      helpersOutOfSync: null,
    };

    publishProgress({
      action: 'idle',
      kind: 'success',
      message: userMessage('core.helpersRefreshed', { version: release.tagName }),
      percent: 100,
    });

    return await getStatus();
  } finally {
    await rm(downloadPath, { force: true });
    await rm(stagingPath, { recursive: true, force: true });
    if (refreshSucceeded || !rollbackFailed) {
      await rm(backupPath, { recursive: true, force: true });
    }
  }
}

async function refreshCoreHelpers() {
  return await withCoreInstallLock('helpers', () => refreshCoreHelpersUnlocked());
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

  // The managed runtime ends up as JAVA_HOME for Core, so it is only ever
  // installed from an Adoptium record that names both the package and its
  // sha256. No checksum means no install, rather than an unverified one.
  const javaBinary = await fetchLatestManagedJavaBinary(javaPlatform);

  if (!javaBinary) {
    throw new Error(
      `Adoptium did not publish a verifiable Java ${MANAGED_JAVA_TARGET_MAJOR_VERSION} runtime for ` +
        `${javaPlatform.apiOs}/${javaPlatform.apiArch}. Home will not install a runtime it cannot verify.`,
    );
  }

  const previousJava = await readInstalledJavaMetadata();
  const archiveExtension = getJavaArchiveExtension(javaPlatform.archiveType);
  const archiveName = `${JAVA_DISTRIBUTION}-${MANAGED_JAVA_TARGET_MAJOR_VERSION}-${javaPlatform.apiOs}-${javaPlatform.apiArch}.${archiveExtension}`;
  const archive: DownloadAsset = {
    digest: javaBinary.checksum,
    downloadUrl: javaBinary.downloadUrl,
    name: archiveName,
    size: javaBinary.size,
  };
  const downloadPath = path.join(getCoreDownloadsPath(), archiveName);
  const stagingPath = path.join(
    getJavaVersionsPath(),
    sanitizePathSegment(`_staging-${Date.now()}-${javaPlatform.platform}-${javaPlatform.arch}`),
  );

  await mkdir(getCoreDownloadsPath(), { recursive: true });
  await mkdir(getJavaVersionsPath(), { recursive: true });

  // Staging dirs only survive a crashed install; sweep them before creating
  // this run's (uniquely named) one.
  const versionEntries = await readdir(getJavaVersionsPath(), { withFileTypes: true }).catch(() => []);

  for (const entry of versionEntries) {
    if (entry.isDirectory() && entry.name.startsWith('_staging-')) {
      await rm(path.join(getJavaVersionsPath(), entry.name), { recursive: true, force: true }).catch(() => {});
    }
  }

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
      throw new Error(`Downloaded Java runtime is not Java ${MIN_JAVA_MAJOR_VERSION} or newer.`);
    }

    const finalPath = path.join(
      getJavaVersionsPath(),
      sanitizePathSegment(
        `${JAVA_DISTRIBUTION}-${MANAGED_JAVA_TARGET_MAJOR_VERSION}-${javaStatus.version}-${javaPlatform.platform}-${javaPlatform.arch}`,
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
      upgradeCheckedAt: new Date().toISOString(),
      version: javaStatus.version,
    });

    // Retire the runtime this install replaced. Best-effort: on Windows a
    // recently-stopped JVM can still hold locks on its own install dir.
    if (previousJava && previousJava.installPath !== finalPath) {
      await rm(previousJava.installPath, { recursive: true, force: true }).catch(() => {});
    }

    coreUpdateEngineStatus = {
      ...coreUpdateEngineStatus,
      javaUpdatePendingRestart: false,
    };

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

async function ensureOnChainInstallIdle(runtime: CoreRuntimeStatus, installedCore: InstalledCore | null) {
  if (!runtime.running || runtime.owner !== 'home' || !installedCore) {
    return;
  }

  const apiKey = getManagedCoreApiKey(installedCore);

  if (!apiKey) {
    throw new Error(userMessage('core.error.onChainStatusUnavailable'));
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), STATUS_TIMEOUT_MS);

    try {
      const response = await fetch(`${LOCAL_CORE_API_URL}/admin/update`, {
        headers: { 'X-API-KEY': apiKey },
        signal: abortController.signal,
      });
      const text = await response.text();

      if (!response.ok) {
        throw new Error(
          readableNodeErrorMessage(
            text,
            userMessage('core.error.onChainHttp', { status: response.status }),
          ),
        );
      }

      const status: unknown = text ? JSON.parse(text) : null;

      if (isOnChainCoreInstallActive(status)) {
        throw new Error(userMessage('core.error.onChainInstallActive'));
      }

      return;
    } catch (error) {
      if (error instanceof Error && error.message === userMessage('core.error.onChainInstallActive')) {
        throw error;
      }

      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`${userMessage('core.error.onChainIdleCheckFailed')} ${getErrorMessage(lastError)}`);
}

async function installCoreUnlocked(request: CoreInstallRequest) {
  await ensureCoreLayout();

  const channel = normalizeInstallRequest(request);
  const releases = await checkReleases();
  const release = releases[channel];

  if (!release.available) {
    throw new Error(release.message);
  }

  const existingCore = await readInstalledCoreMetadata();
  const versionComparison = existingCore
    ? compareCoreVersions(release.tagName, existingCore.jarSemver ?? existingCore.tagName)
    : null;
  const sameVersion = existingCore
    ? existingCore.jarSemver
      ? versionComparison === 0
      : release.tagName === existingCore.tagName
    : false;

  if (
    versionComparison !== null &&
    versionComparison < 0 &&
    !consumeDowngradeConfirmation(request, release.tagName)
  ) {
    const installedVersion = existingCore?.jarBuildVersion ?? existingCore?.jarSemver ?? '';

    throw new DowngradeConfirmationRequiredError(
      userMessage('core.error.downgradeConfirmationRequired', {
        installed: installedVersion,
        release: release.tagName,
      }),
      mintDowngradeConfirmation(release.tagName, installedVersion),
    );
  }

  const releaseHasResolvedCommit = /^[0-9a-f]{40}$/i.test(release.commit);
  const equalVersionDifferentCommit =
    sameVersion &&
    (!releaseHasResolvedCommit ||
      !existingCore?.jarCommit ||
      !coreCommitsMatch(release.commit, existingCore.jarCommit));

  if (
    existingCore &&
    sameVersion &&
    !existingCore.modifiedSinceInstall &&
    !equalVersionDifferentCommit
  ) {
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
  if (runtimeBefore.running && runtimeBefore.owner === 'home' && existingCore !== null) {
    await ensureOnChainInstallIdle(runtimeBefore, existingCore);
  }
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
        await movePath(installPath, backupPath, { retryWindowsBusy: true });
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
    const jarIdentity = await readCoreJarIdentity(jarPath);

    await chmodPreviewScripts(previewPath);

    const installedCore: InstalledCore = {
      assetName: release.asset.name,
      assetSize: release.asset.size,
      channel: release.channel,
      digest: release.asset.digest,
      downloadUrl: release.asset.downloadUrl,
      helpersRefreshedFor: release.tagName,
      htmlUrl: release.htmlUrl,
      installPath,
      installedAt: new Date().toISOString(),
      ...getJarIdentityFields(jarIdentity),
      jarPath,
      logPaths: getCoreLogPaths(getCoreRuntimePath()),
      name: release.name,
      originJarBuildVersion: jarIdentity?.buildVersion,
      originJarCommit: jarIdentity?.commit || undefined,
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

  coreUpdateEngineStatus = {
    ...coreUpdateEngineStatus,
    available: null,
    checkedAt: new Date().toISOString(),
    error: undefined,
  };

  return await getStatus();
}

async function installCore(request: CoreInstallRequest) {
  return await withCoreInstallLock('github', () => installCoreUnlocked(request));
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
  // The running-core key cache must not serve pre-start state while the core
  // comes up (and start-guards below need fresh data).
  invalidateRunningCoreApiKeyCache();

  const installedCore = await readInstalledCore();

  if (!installedCore) {
    throw new Error('Install Qortium Core before starting it.');
  }

  const currentRuntime = await resolveRuntimeStatusOwner(await fetchLocalCoreStatus(), installedCore);

  if (currentRuntime.running) {
    void runCoreUpdateEngine();
    return await getStatus();
  }

  // The core is confirmed stopped here, so a managed-runtime swap cannot pull
  // the JRE out from under a running JVM.
  await maybeUpgradeManagedJava();

  const java = await getJavaStatus();

  if (!java.available) {
    throw new Error(`Java ${MIN_JAVA_MAJOR_VERSION} or newer is required before Qortium Core can start.`);
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

  void runCoreUpdateEngine();

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
  invalidateRunningCoreApiKeyCache();

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
  ipcMain.handle('core:install', async (_event, request: CoreInstallRequest = {}) => {
    try {
      return await installCore(request);
    } catch (error) {
      if (error instanceof DowngradeConfirmationRequiredError) {
        return {
          ...(await getStatus()),
          downgradeConfirmation: error.confirmation,
        };
      }

      throw error;
    }
  });
  ipcMain.handle('core:installJava', () => installJava());
  ipcMain.handle('core:refreshHelpers', () => refreshCoreHelpers());
  ipcMain.handle('core:setJavaAutoUpdate', async (_event, enabled: unknown) => {
    await setCoreUpdateSettings({ javaUpdatePolicy: enabled === true ? 'install' : 'off' });
    await runCoreUpdateEngineAfterPolicyChange();
    return await getStatus();
  });
  ipcMain.handle('core:setUpdatePolicy', async (_event, request: unknown) => {
    await setCoreUpdateSettings(isObject(request) ? request : {});
    await runCoreUpdateEngineAfterPolicyChange();
    return await getStatus();
  });
  ipcMain.handle('core:start', () => startCore());
  ipcMain.handle('core:stop', () => stopCore());

  if (!coreUpdateInterval) {
    coreUpdateInterval = setInterval(() => {
      void runCoreUpdateEngine();
    }, CORE_UPDATE_CHECK_INTERVAL_MS);
    coreUpdateInterval.unref();
    setTimeout(() => {
      void runCoreUpdateEngine();
    }, 0).unref();
  }
}
