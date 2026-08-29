import { app, BrowserWindow, ipcMain } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { extractZipSafely } from './safe-zip-extraction.js';
import { extract as extractTar } from 'tar';
import {
  ensurePreviewApiKey,
  invalidateRunningCoreApiKeyCache,
  readPreviewApiKey,
  readRunningLocalCoreApiKey,
  type RunningCoreApiKeyResult,
} from './local-api-key.js';
import {
  mirrorRuntimeRewardNodeIdentityToPreview,
  preserveLegacyCoreRuntimeFiles,
  preserveLegacyRewardNodeIdentity,
} from './core-runtime-files.js';
import { readCoreJarIdentity, type CoreJarIdentity } from './core-jar-identity.js';
import {
  isCoreInstallActiveForNetwork,
  isOnChainCoreInstallActive,
  withCoreInstallLockForNetwork,
} from './core-install-lock.js';
import { runCoreInstallTransaction } from './core-install-transaction.js';
import { NetworkManagerEntryRegistry } from './core-manager-entry-registry.js';
import { CoreManagerStateRegistry } from './core-manager-state.js';
import { resolveCoreNativeObserverPath } from './core-native-observer-path.js';
import { observeCoreListenerOwners } from './core-listener-owner.js';
import { observeCurrentUserQortalProcesses } from './core-process-observation.js';
import { downloadVerifiedCoreAsset } from './core-verified-download.js';
import { sameManagedJavaGeneration } from './managed-java-generation.js';
import {
  sameQortiumCoreRelease,
  selectFirstQortiumCoreRelease,
  selectQortiumCoreRelease,
  type QortiumCoreReleaseAsset,
} from './qortium-release-policy.js';
import {
  compareCoreVersions,
  coreCommitsMatch,
  getCoreSemver,
  getCoreTimestampMs,
} from './core-version.js';
import {
  parseQortiumTransportSettingsJson,
  QORTIUM_TRANSPORT_SETTINGS_MAX_BYTES,
  updateQortiumTransportSettings,
  type QortiumSettingsObject,
  type QortiumTransportMode,
  type QortiumTransportModeState,
} from './qortium-transport-mode.js';
import { isApprovedQortiumTransportManagedTarget } from './qortium-transport-runtime-authority.js';
import {
  readCoreUpdateSettings,
  setCoreUpdateSettings,
  type CoreUpdatePolicy,
  type CoreUpdateSettings,
} from './core-update-settings.js';
import { movePath } from './filesystem-move.js';
import { startIfManaged as startI2pdIfManaged, stopIfManaged as stopI2pdIfManaged } from './i2pd-manager.js';
import { selectManagedJavaBinary } from './managed-java-asset.js';
import type { QortalCoreManager } from './qortal-core-manager.js';
import {
  createProductionQortalCoreManager,
  type QortalCoreRuntimeOperations,
} from './qortal-core-runtime.js';
import {
  observeMacosCoreListenerOwners,
  observeMacosQortalProcesses,
} from './macos-core-observation.js';
import {
  observeWindowsCoreListenerOwners,
  observeWindowsQortalProcesses,
  readWindowsSecureFile,
} from './windows-core-observation.js';
import { resolveVerifiedOpenJdkJava } from './qortal-java-launch.js';
import { resolveQortalAdoptedInstallRecordPath } from './qortal-install-source.js';
import { resolveQortalManagedInstallPaths } from './qortal-managed-install.js';
import { probeProductionQortalExternalInstallCollision } from './home-v2-qortal-maintenance-discovery.js';
import { readableNodeErrorMessage } from './node-error-body.js';
import { userMessage } from './user-message.js';
import {
  prepareManagedLongLivedCommand,
  sanitizeManagedChildEnvironment,
} from './managed-child-process.js';
import {
  QORTIUM_CORE_DESCRIPTOR,
  QORTAL_CORE_DESCRIPTOR,
  getCoreGithubCommitUrl,
  getCoreGithubLatestReleaseUrl,
  getCoreGithubReleasesUrl,
  getCoreGithubTaggedReleaseUrl,
  getCoreHelperScriptPaths,
  getCoreHelperStartArguments,
  getCoreHelperStopArguments,
  resolveCoreDescriptorPaths,
  type CoreNetworkDescriptor,
  type CoreNetworkId,
} from './core-network-descriptor.js';

// E1 starts with one fully described Qortium instance. Compatibility exports
// remain Qortium wrappers, while the keyed manager registry below fails closed
// for networks that do not yet have a production descriptor and pipeline.
const CORE_DESCRIPTOR = QORTIUM_CORE_DESCRIPTOR;
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
const CORE_RUNTIME_DIR_OVERRIDE = CORE_DESCRIPTOR.storage.runtimeOverrideEnvironmentVariable
  ? process.env[CORE_DESCRIPTOR.storage.runtimeOverrideEnvironmentVariable]?.trim()
  : undefined;
const CHAIN_CONFIG_HASH_EXCLUDED_FIELDS = new Set<string>(
  CORE_DESCRIPTOR.chain.kind === 'file'
    ? CORE_DESCRIPTOR.chain.compatibilityHashExcludedFields
    : [],
);

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

type CoreReleaseAsset = QortiumCoreReleaseAsset;

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
  expectedTag?: unknown;
  mode?: unknown;
};

type InternalCoreInstallRequest = CoreInstallRequest & {
  activationLease?: () => Promise<void | (() => void)>;
  preDownloadGuard?: () => Promise<void>;
  skipCompletionStatus?: boolean;
  skipLayoutMigration?: boolean;
};

type HomeV2AutomaticCoreInstallRequest = Readonly<{
  activationLease: () => Promise<void | (() => void)>;
  channel: 'prerelease' | 'stable';
  expectedTag: string;
  preDownloadGuard: () => Promise<void>;
}>;

class DowngradeConfirmationRequiredError extends Error {
  constructor(
    message: string,
    readonly confirmation: DowngradeConfirmation,
  ) {
    super(message);
    this.name = 'DowngradeConfirmationRequiredError';
  }
}

const coreManagerStates = new CoreManagerStateRegistry<
  CoreNetworkId,
  CoreUpdateEngineStatus,
  DowngradeConfirmation
>(() => ({ available: null, helpersOutOfSync: null }));

function getCoreManagerState(descriptor: CoreNetworkDescriptor = CORE_DESCRIPTOR) {
  return coreManagerStates.forNetwork(descriptor.id);
}

function mintDowngradeConfirmation(targetVersion: string, installedVersion: string) {
  const now = Date.now();

  const confirmation: DowngradeConfirmation = {
    expiresAt: new Date(now + DOWNGRADE_CONFIRMATION_TTL_MS).toISOString(),
    installedVersion,
    targetVersion,
    token: randomBytes(32).toString('hex'),
  };

  coreManagerStates.storeDowngradeConfirmation(CORE_DESCRIPTOR.id, confirmation, now);
  return confirmation;
}

function consumeDowngradeConfirmation(request: CoreInstallRequest, targetVersion: string) {
  if (request.allowDowngrade !== true || typeof request.downgradeToken !== 'string') {
    return false;
  }

  return coreManagerStates.consumeDowngradeConfirmation(
    CORE_DESCRIPTOR.id,
    request.downgradeToken,
    targetVersion,
  );
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

function getCoreDescriptorPaths() {
  return resolveCoreDescriptorPaths(CORE_DESCRIPTOR, {
    appDataPath: app.getPath('appData'),
    runtimeOverride: CORE_RUNTIME_DIR_OVERRIDE,
    userDataPath: app.getPath('userData'),
  });
}

function getCoreBasePath() {
  return getCoreDescriptorPaths().basePath;
}

function getLegacyCoreBasePath() {
  const legacyBasePath = getCoreDescriptorPaths().legacyBasePath;

  if (!legacyBasePath) {
    throw new Error(`${CORE_DESCRIPTOR.label} Core has no legacy storage layout.`);
  }

  return legacyBasePath;
}

function getCoreDownloadsPath() {
  return getCoreDescriptorPaths().downloadsPath;
}

function getCoreInstallPath() {
  return getCoreDescriptorPaths().installPath;
}

function getJavaBasePath() {
  return getCoreDescriptorPaths().javaBasePath;
}

function getLegacyJavaBasePath() {
  const legacyJavaBasePath = getCoreDescriptorPaths().legacyJavaBasePath;

  if (!legacyJavaBasePath) {
    throw new Error(`${CORE_DESCRIPTOR.label} Core has no legacy Java layout.`);
  }

  return legacyJavaBasePath;
}

function getJavaVersionsPath() {
  return getCoreDescriptorPaths().javaVersionsPath;
}

function getCurrentCorePath() {
  return getCoreDescriptorPaths().currentCorePath;
}

function getLegacyCurrentCorePath() {
  const legacyCurrentCorePath = getCoreDescriptorPaths().legacyCurrentCorePath;

  if (!legacyCurrentCorePath) {
    throw new Error(`${CORE_DESCRIPTOR.label} Core has no legacy metadata path.`);
  }

  return legacyCurrentCorePath;
}

function getCurrentJavaPath() {
  return getCoreDescriptorPaths().currentJavaPath;
}

function getLegacyCurrentJavaPath() {
  const legacyCurrentJavaPath = getCoreDescriptorPaths().legacyCurrentJavaPath;

  if (!legacyCurrentJavaPath) {
    throw new Error(`${CORE_DESCRIPTOR.label} Core has no legacy Java metadata path.`);
  }

  return legacyCurrentJavaPath;
}

function getCoreRuntimePath() {
  return getCoreDescriptorPaths().runtimePath;
}

function getCoreLogPaths(runtimePath: string): CoreLogPaths {
  const logPaths: CoreLogPaths = {
    appLogPath: path.join(runtimePath, CORE_DESCRIPTOR.storage.logFileName),
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
  return path.join(runtimePath, CORE_DESCRIPTOR.storage.runtimeChainFileName);
}

function getRuntimeMigrationBlockedPath(runtimePath: string) {
  return path.join(runtimePath, CORE_DESCRIPTOR.storage.runtimeMigrationBlockedFileName);
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
  await rm(destinationPath, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
  await movePath(sourcePath, destinationPath, { retryWindowsBusy: true });
}

async function moveRuntimeEntries(sourcePath: string, destinationPath: string) {
  if (!existsSync(sourcePath) || normalizeFilesystemPath(sourcePath) === normalizeFilesystemPath(destinationPath)) {
    return;
  }

  await mkdir(destinationPath, { recursive: true });

  for (const entryName of CORE_DESCRIPTOR.storage.runtimeEntryNames) {
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
  if (isCoreInstallActiveForNetwork(CORE_DESCRIPTOR.id)) {
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
      isCoreInstallActiveForNetwork(CORE_DESCRIPTOR.id)
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

    if (isCoreInstallActiveForNetwork(CORE_DESCRIPTOR.id)) {
      return;
    }

    await writeFileAtomically(currentCorePath, `${JSON.stringify(reconciledMetadata, null, 2)}\n`);
  } catch {
    // Status reads remain best-effort; a later read will reconcile again.
  }
}

async function ensureBootstrapPeers(installPath: string, options: { strict?: boolean } = {}) {
  if (CORE_DESCRIPTOR.bootstrap.kind !== 'peer-injection') {
    return;
  }

  const settingsPath = path.join(installPath, CORE_DESCRIPTOR.bootstrap.settingsRelativePath);

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
  const initialPeers = mergeBootstrapPeerList(
    settings.initialPeers,
    [...CORE_DESCRIPTOR.bootstrap.initialPeers],
  );
  const initialDataPeers = mergeBootstrapPeerList(
    settings.initialDataPeers,
    [...CORE_DESCRIPTOR.bootstrap.initialDataPeers],
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
  if (CORE_DESCRIPTOR.chain.kind !== 'file') {
    throw new Error(`${CORE_DESCRIPTOR.label} Core does not use a chain identity file.`);
  }

  const previewChainPath = path.join(previewPath, CORE_DESCRIPTOR.chain.fileName);
  let previewChainBytes: Buffer;

  try {
    previewChainBytes = await readFile(previewChainPath);
  } catch {
    throw new Error(
      `The installed Core release is missing ${CORE_DESCRIPTOR.chain.fileName}; runtime chain compatibility cannot be verified.`,
    );
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
    throw new Error(
      `The installed Core release has an invalid ${CORE_DESCRIPTOR.chain.fileName}; runtime chain compatibility cannot be verified.`,
    );
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

function getRuntimeChainMismatchMessage(
  metadata: CoreRuntimeChainMetadata,
  coreTagName: string,
  identity: CoreRuntimeChainIdentity,
) {
  return [
    'Qortium Core runtime data was created for a different network.',
    'Home will not reuse the existing database automatically.',
    `Existing runtime: ${metadata.networkId} ${metadata.previewChainSha256}.`,
    `Installed Core ${coreTagName}: ${identity.networkId} ${identity.previewChainSha256}.`,
    'Use runtime data from the installed network or reset this Core runtime before starting the release.',
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

    // Core owns validation of its repository and consensus configuration. Home
    // only prevents accidentally mixing clearly different networks here. A
    // release can legitimately change Core's chain-config fingerprint (or the
    // fingerprint algorithm itself) without invalidating the existing runtime,
    // so same-network metadata is refreshed instead of blocking every action.
    if (metadata.networkId !== identity.networkId) {
      await writeRuntimeMigrationBlocked(runtimePath, metadata, coreTagName, identity);
      throw new Error(getRuntimeChainMismatchMessage(metadata, coreTagName, identity));
    }

    if (
      !matchesCurrentIdentity ||
      metadata.rawPreviewChainSha256 !== identity.rawPreviewChainSha256 ||
      metadata.coreTagName !== coreTagName
    ) {
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

  await ensureRuntimeChainCompatible(
    installedCore.runtimePath,
    getInstalledCoreRuntimeLabel(installedCore),
    identity,
    options,
  );

  return identity;
}

function getInstalledCoreRuntimeLabel(installedCore: InstalledCore) {
  const buildVersion = installedCore.jarBuildVersion?.trim().replace(/^qortium-/i, '');

  if (installedCore.modifiedSinceInstall && buildVersion) {
    return buildVersion.startsWith('v') ? buildVersion : `v${buildVersion}`;
  }

  return installedCore.tagName;
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

let legacyCoreManagerRendererEventsEnabled = true;

export function disableLegacyCoreManagerRendererEvents() {
  legacyCoreManagerRendererEventsEnabled = false;
}

/**
 * Home 2's progress subscriber.
 *
 * Deliberately a callback rather than a second broadcast from here. The 1.x
 * path below sprays `core:progress` at EVERY BrowserWindow; Home 2 sends only
 * to authorized Home windows through home-v2-authorized-senders, and that
 * module must not be imported into core-manager (it would close an import
 * cycle). So the bridge registers itself and owns its own envelope.
 */
let homeV2CoreProgressListener: ((progress: CoreProgress) => void) | null = null;

export function setHomeV2CoreProgressListener(
  listener: ((progress: CoreProgress) => void) | null,
) {
  homeV2CoreProgressListener = listener;
}

function publishProgress(progress: CoreProgress) {
  // Home 2 first, and NOT behind the legacy flag: disabling the 1.x renderer
  // events is exactly what Home 2 does at startup, and it must not take its
  // own progress with it.
  if (homeV2CoreProgressListener) {
    try {
      homeV2CoreProgressListener(progress);
    } catch {
      // A broken subscriber must never break an install.
    }
  }
  if (!legacyCoreManagerRendererEventsEnabled) return;
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
      'User-Agent': CORE_DESCRIPTOR.github.userAgent,
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

function releaseToSummary(channel: CoreChannel, value: unknown): CoreReleaseSummary {
  const release = selectQortiumCoreRelease(value, channel);

  if (!release) {
    return {
      available: false,
      channel,
      message: `No ${channel} release was found.`,
    };
  }

  return {
    available: true,
    channel,
    asset: release.asset,
    commit: release.commit,
    commitTimestamp: '',
    tagName: release.tagName,
    name: release.name,
    htmlUrl: release.htmlUrl,
    publishedAt: release.publishedAt,
  };
}

async function resolveReleaseCommit(summary: CoreReleaseSummary): Promise<CoreReleaseSummary> {
  if (!summary.available) {
    return summary;
  }

  try {
    const commit = await fetchGithubJson<GithubCommit>(
      getCoreGithubCommitUrl(CORE_DESCRIPTOR, summary.tagName),
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
  const release = await fetchGithubJson<unknown>(
    getCoreGithubLatestReleaseUrl(CORE_DESCRIPTOR),
  );

  return await resolveReleaseCommit(releaseToSummary('stable', release));
}

async function getLatestPrerelease(): Promise<CoreReleaseSummary> {
  if (CORE_DESCRIPTOR.releaseChannels.kind !== 'github-stable-and-prerelease') {
    return {
      available: false,
      channel: 'prerelease',
      message: `No prerelease channel is configured for ${CORE_DESCRIPTOR.label} Core.`,
    };
  }

  const releases = await fetchGithubJson<unknown[]>(
    getCoreGithubReleasesUrl(
      CORE_DESCRIPTOR,
      CORE_DESCRIPTOR.releaseChannels.prereleasePageSize,
    ),
  );
  const selected = selectFirstQortiumCoreRelease(releases, 'prerelease');
  if (selected) return await resolveReleaseCommit({
    ...selected,
    available: true,
    commitTimestamp: '',
  });

  return releaseToSummary('prerelease', null);
}

async function getReleaseMatchingCoreVersion(semver: string): Promise<AvailableCoreRelease | null> {
  const matchingReleasePageSize =
    CORE_DESCRIPTOR.releaseChannels.kind === 'github-stable-and-prerelease'
      ? CORE_DESCRIPTOR.releaseChannels.matchingReleasePageSize
      : 100;
  const releases = await fetchGithubJson<unknown[]>(
    getCoreGithubReleasesUrl(CORE_DESCRIPTOR, matchingReleasePageSize),
  );
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
        getCoreGithubTaggedReleaseUrl(CORE_DESCRIPTOR, tagName),
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

async function assertQortiumReleaseUnchanged(release: AvailableCoreRelease) {
  const refreshed = releaseToSummary(
    release.channel,
    await fetchGithubJson<unknown>(
      getCoreGithubTaggedReleaseUrl(CORE_DESCRIPTOR, release.tagName),
    ),
  );

  if (!refreshed.available || !sameQortiumCoreRelease(release, refreshed)) {
    throw new Error(
      'The selected Qortium Core release changed before download. Check releases again before installing.',
    );
  }

  if (/^[0-9a-f]{40}$/i.test(release.commit)) {
    const commit = await fetchGithubJson<GithubCommit>(
      getCoreGithubCommitUrl(CORE_DESCRIPTOR, release.tagName),
    );
    const refreshedCommit = getString(commit?.sha);
    if (!/^[0-9a-f]{40}$/i.test(refreshedCommit) ||
      refreshedCommit.toLowerCase() !== release.commit.toLowerCase()) {
      throw new Error(
        'The selected Qortium Core release commit changed before download. Check releases again before installing.',
      );
    }
  }
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

// Automatic Home 2 discovery must never enter layout migration or reconcile
// installed metadata: either action can mutate shared runtime files. A stale
// record is safe here because strict installation revalidates the live JAR and
// generation again before download and activation.
async function readInstalledCoreMetadataForHomeV2UpdateDiscovery(): Promise<InstalledCore | null> {
  try {
    const parsedCore: unknown = JSON.parse(await readFile(getCurrentCorePath(), 'utf8'));
    const installedCore = parseInstalledCore(parsedCore, getCoreRuntimePath());
    return installedCore &&
      existsSync(installedCore.installPath) &&
      existsSync(installedCore.previewPath) &&
      existsSync(installedCore.jarPath)
      ? installedCore
      : null;
  } catch {
    return null;
  }
}

async function readInstalledCore(): Promise<InstalledCore | null> {
  await ensureCoreLayout();

  return await readInstalledCoreMetadata();
}

async function getQortiumManagedCorePreviewPath() {
  return (await readInstalledCore())?.previewPath ?? null;
}

async function getQortiumManagedCoreRuntimePath() {
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

async function isQortiumManagedCoreRuntimeRunning() {
  const installedCore = await readInstalledCore();

  if (!installedCore) {
    return false;
  }

  return await isInstalledCoreRunning(installedCore);
}

function scheduleQortiumManagedCoreUpdateCheck() {
  setTimeout(() => {
    void runCoreUpdateEngine();
  }, 1_000).unref();
}

// True when a managed Core is running AND its node has I2P enabled — i.e. the
// managed i2pd router *should* be up to serve Core's fallback transport. Used to
// reconcile the router with Core (on Home launch / quit) so i2pd's lifetime
// tracks Core's, not Home's window.
async function isQortiumManagedCoreUsingI2p(): Promise<boolean> {
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
    await runScript(
      stopScript,
      getCoreHelperStopArguments(CORE_DESCRIPTOR, runtimePath),
      installedCore.previewPath,
    );
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

  const sourceInstallPath = legacyCore.installPath;
  const migratedCore = relocateInstalledCore(legacyCore, sourceInstallPath);

  // Preserve the reward identity before stopping or moving the legacy install.
  // A malformed identity therefore aborts migration while the old Core is
  // still intact and running.
  await preserveLegacyRewardNodeIdentity(legacyCore.previewPath, migratedCore.runtimePath);

  const legacyRuntimePath = getRawRuntimePath(parsedLegacyCore) || legacyCore.previewPath;
  const runningCore = readRunningLocalCoreApiKey();
  const legacyRuntimePid = await readRuntimePid(legacyRuntimePath);

  if (
    (runningCore && isRunningCoreWithinPath(runningCore, legacyCoreBasePath)) ||
    (legacyRuntimePid !== null && isPidRunning(legacyRuntimePid))
  ) {
    await stopLegacyInstalledCore(legacyCore, legacyRuntimePath);
  }

  const runtimeIdentity = await readCoreRuntimeChainIdentity(legacyCore.previewPath);

  await ensureRuntimeChainCompatible(migratedCore.runtimePath, migratedCore.tagName, runtimeIdentity);
  await preserveLegacyCoreRuntimeFiles(legacyCore.previewPath, migratedCore.runtimePath);

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
    await ensureRuntimeChainCompatible(
      installedCore.runtimePath,
      getInstalledCoreRuntimeLabel(installedCore),
      runtimeIdentity,
      { recordIfMissing: true },
    );
  }
}

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
  await coreManagerStates.ensureLayout(CORE_DESCRIPTOR.id, migrateCoreLayout);
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
  return await coreManagerStates.queueManagedJavaMetadataMutation(CORE_DESCRIPTOR.id, async () => {
    await mkdir(getJavaBasePath(), { recursive: true });
    await writeFileAtomically(getCurrentJavaPath(), `${JSON.stringify(installedJava, null, 2)}\n`);
    return installedJava;
  });
}

async function refreshInstalledJavaIfCurrent(
  expected: ManagedJava,
  patch: Pick<ManagedJava, 'upgradeCheckedAt'> & Partial<Pick<ManagedJava, 'latestKnownVersion'>>,
): Promise<ManagedJava> {
  return await coreManagerStates.queueManagedJavaMetadataMutation(CORE_DESCRIPTOR.id, async () => {
    const current = await readInstalledJavaMetadata();

    if (!current || !sameManagedJavaGeneration(current, expected)) {
      return current ?? expected;
    }

    const refreshed = { ...current, ...patch };
    await writeFileAtomically(getCurrentJavaPath(), `${JSON.stringify(refreshed, null, 2)}\n`);
    return refreshed;
  });
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

function sameInstalledCoreGeneration(left: InstalledCore | null, right: InstalledCore | null) {
  if (!left || !right) return left === right;
  return left.installPath === right.installPath && left.jarPath === right.jarPath &&
    left.installedAt === right.installedAt && left.tagName === right.tagName &&
    left.digest === right.digest && left.jarBuildVersion === right.jarBuildVersion &&
    left.jarBuildTimestamp === right.jarBuildTimestamp &&
    sameOptionalCoreCommit(left.jarCommit, right.jarCommit);
}

function sameOptionalCoreCommit(left: string | null | undefined, right: string | null | undefined) {
  return (!left && !right) || coreCommitsMatch(left, right);
}

async function assertHomeV2CoreMaintenanceActivationSafe(
  expected: InstalledCore | null,
  mode: 'initial-install' | 'strict-update',
) {
  const current = await readInstalledCoreMetadata();
  if (mode === 'initial-install' ? current !== null : !sameInstalledCoreGeneration(current, expected)) {
    throw new Error('The installed Qortium Core changed during the maintenance operation.');
  }
  if (await observeQortiumMaintenanceRuntimeState() !== 'stopped') {
    throw new Error('Qortium Core could not be proven stopped at the install boundary.');
  }
  return current;
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

  let refreshed = await refreshInstalledJavaIfCurrent(installedJava, {
    upgradeCheckedAt: new Date().toISOString(),
  });

  if (!sameManagedJavaGeneration(refreshed, installedJava)) {
    return refreshed;
  }

  const javaPlatform = getJavaPlatform();
  const latestVersion = javaPlatform ? (await fetchLatestManagedJavaBinary(javaPlatform))?.version : null;

  if (latestVersion) {
    refreshed = await refreshInstalledJavaIfCurrent(refreshed, {
      latestKnownVersion: latestVersion,
      upgradeCheckedAt: refreshed.upgradeCheckedAt,
    });
  }

  return refreshed;
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

/**
 * Internal cross-network launch selection. Qortal shares Qortium's verified
 * managed Temurin install and the same supported-system-Java fallback, while
 * retaining its own launch and lifecycle policy.
 */
export async function resolveSharedCoreJavaForLaunch() {
  const java = await getJavaStatus({ ensureLayout: false });

  if (
    !java.available ||
    !java.path.trim() ||
    (java.source !== 'managed' && java.source !== 'system')
  ) {
    return null;
  }

  return { command: java.path, source: java.source } as const;
}

async function resolveSharedQortalJavaForLaunch() {
  const java = await resolveSharedCoreJavaForLaunch();
  if (!java) return null;
  const environment = sanitizeManagedChildEnvironment();
  const command = await resolveVerifiedOpenJdkJava(java.command, environment);
  return command ? { ...java, command } : null;
}

function getJavaRuntimeEnv(java: JavaStatus) {
  const environment = sanitizeManagedChildEnvironment();

  if (java.source !== 'managed' || !java.path) {
    return environment;
  }

  const javaBinPath = path.dirname(java.path);

  return {
    ...environment,
    JAVA_HOME: path.dirname(javaBinPath),
    PATH: `${javaBinPath}${path.delimiter}${environment.PATH ?? ''}`,
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
    const response = await fetch(
      `${CORE_DESCRIPTOR.localApi.url}${CORE_DESCRIPTOR.localApi.infoPath}`,
      { signal },
    );

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
    const response = await fetch(
      `${CORE_DESCRIPTOR.localApi.url}${CORE_DESCRIPTOR.localApi.statusPath}`,
      {
        signal: abortController.signal,
      },
    );
    const text = await response.text();

    if (!response.ok) {
      return {
        localApiUrl: CORE_DESCRIPTOR.localApi.url,
        owner: 'unknown',
        running: false,
        status: text,
      };
    }

    const buildInfo = await fetchCoreBuildInfo(abortController.signal);

    return {
      ...buildInfo,
      localApiUrl: CORE_DESCRIPTOR.localApi.url,
      owner: 'unknown',
      running: true,
      status: text ? (JSON.parse(text) as unknown) : null,
    };
  } catch {
    return {
      localApiUrl: CORE_DESCRIPTOR.localApi.url,
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
    const response = await fetch(
      `${CORE_DESCRIPTOR.localApi.url}${CORE_DESCRIPTOR.update.path}`,
      {
        headers: { 'X-API-KEY': apiKey },
        method,
        signal: abortController.signal,
      },
    );
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
    getCoreManagerState().updateEngineStatus = {
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

  getCoreManagerState().updateEngineStatus = {
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
    await withCoreInstallLockForNetwork(CORE_DESCRIPTOR.id, 'helpers', () =>
      refreshCoreHelpersUnlocked(helperRelease),
    );
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

    getCoreManagerState().updateEngineStatus = {
      ...getCoreManagerState().updateEngineStatus,
      available: toCoreUpdateAvailability(candidate, 'installing'),
    };
    await withCoreInstallLockForNetwork(CORE_DESCRIPTOR.id, 'on-chain', () =>
      requestManagedCoreUpdate(installedCore, 'POST'),
    );
    return;
  }

  getCoreManagerState().updateEngineStatus = {
    ...getCoreManagerState().updateEngineStatus,
    available: toCoreUpdateAvailability(candidate, 'installing'),
  };
  await installCore({ channel: candidate.githubChannel });
  getCoreManagerState().updateEngineStatus = {
    available: null,
    checkedAt: new Date().toISOString(),
    error: errors.length > 0 ? errors.join(' ') : undefined,
    helpersOutOfSync: null,
    javaUpdatePendingRestart,
    nodeAutoUpdateMode: nodeAutoUpdateMode || undefined,
  };
}

async function publishCoreStatus() {
  if (!legacyCoreManagerRendererEventsEnabled) return;
  const status = await getStatus();

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('core:status', status);
    }
  }
}

function runCoreUpdateEngine() {
  return coreManagerStates.runUpdateEngine(CORE_DESCRIPTOR.id, runCoreUpdateEnginePassAndPublish);
}

function runCoreUpdateEngineAfterPolicyChange() {
  return coreManagerStates.runUpdateEngineAfterPolicyChange(
    CORE_DESCRIPTOR.id,
    runCoreUpdateEnginePassAndPublish,
  );
}

async function runCoreUpdateEnginePassAndPublish() {
  try {
    await runCoreUpdateEnginePass();
  } catch (error) {
    console.warn('Qortium Core update policy check failed.', error);
    const currentStatus = getCoreManagerState().updateEngineStatus;

    getCoreManagerState().updateEngineStatus = {
      ...currentStatus,
      available:
        currentStatus.available?.action === 'installing'
          ? { ...currentStatus.available, action: 'available' }
          : currentStatus.available,
      checkedAt: new Date().toISOString(),
      error: getErrorMessage(error),
    };
  }

  await publishCoreStatus().catch((error) => {
    console.warn('Unable to publish Qortium Core update status.', error);
  });
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

  const installed = await readInstalledCoreMetadata();

  // The user can replace a managed release with a directly downloaded release
  // or test jar while Home remains open. Re-read the actual installed files on
  // every status refresh instead of treating the launch-time layout check as a
  // permanent installation identity. Compatible changes self-reconcile the
  // runtime metadata; genuinely different chain data remains blocked.
  if (installed && !isCoreInstallActiveForNetwork(CORE_DESCRIPTOR.id)) {
    try {
      await ensureInstalledCoreRuntimeChain(installed, { recordIfMissing: true });
      blockedRuntime = null;
    } catch (error) {
      blockedRuntime = await readRuntimeMigrationBlocked(installed.runtimePath);

      if (!blockedRuntime) {
        throw error;
      }
    }
  }

  const [java, runtime, updateSettings] = await Promise.all([
    getJavaStatus({ ensureLayout: !blockedRuntime }),
    fetchLocalCoreStatus(),
    readCoreUpdateSettings(),
  ]);
  const resolvedRuntime = await resolveRuntimeStatusOwner(runtime, installed);
  const runtimeBlocked = blockedRuntime ?? (await readRuntimeMigrationBlocked(getCoreRuntimePath()));

  return {
    coreUpdate: getCoreManagerState().updateEngineStatus,
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
  const partialPath = `${destinationPath}.${randomBytes(8).toString('hex')}.partial`;

  return await downloadVerifiedCoreAsset({
    asset,
    destinationPath,
    partialPath,
    userAgent: CORE_DESCRIPTOR.github.userAgent,
    onProgress(progress) {
      publishProgress({
        action: 'downloading',
        kind: 'info',
        message: progressMessage ?? `Downloading ${asset.name}.`,
        percent: progress.percent,
      });
    },
  });
}

async function findExtractedCorePaths(versionPath: string) {
  if (CORE_DESCRIPTOR.package.kind !== 'zip-with-preview-helpers') {
    throw new Error(`${CORE_DESCRIPTOR.label} Core does not use an extracted helper package.`);
  }

  const candidates = [versionPath];
  const entries = await readdir(versionPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      candidates.push(path.join(versionPath, entry.name));
    }
  }

  for (const candidate of candidates) {
    const jarPath = path.join(candidate, CORE_DESCRIPTOR.package.jarFileName);
    const previewPath = path.join(
      candidate,
      CORE_DESCRIPTOR.package.previewDirectoryName,
    );

    if (existsSync(jarPath) && existsSync(previewPath)) {
      return {
        installPath: candidate,
        jarPath,
        previewPath,
      };
    }
  }

  throw new Error(
    `Installed Core release did not contain ${CORE_DESCRIPTOR.package.jarFileName} and preview scripts.`,
  );
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

    if (
      topLevelEntry.toLowerCase() ===
        CORE_DESCRIPTOR.storage.runtimeDirectoryName.toLowerCase() ||
      entry.name.toLowerCase() === CORE_DESCRIPTOR.package.jarFileName.toLowerCase()
    ) {
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
    getCoreManagerState().updateEngineStatus = {
      ...getCoreManagerState().updateEngineStatus,
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
    await extractZipSafely(downloadPath, { dir: stagingPath });

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

    getCoreManagerState().updateEngineStatus = {
      ...getCoreManagerState().updateEngineStatus,
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
  return await withCoreInstallLockForNetwork(CORE_DESCRIPTOR.id, 'helpers', () =>
    refreshCoreHelpersUnlocked(),
  );
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
    await extractZipSafely(downloadPath, { dir: destinationPath });
    return;
  }

  await extractTar({
    cwd: destinationPath,
    file: downloadPath,
  });
}

type JavaInstallOptions = {
  readonly activationLease?: () => Promise<void | (() => void)>;
  readonly preDownloadGuard?: () => Promise<void>;
  readonly skipCompletionStatus?: boolean;
  readonly skipLayoutMigration?: boolean;
};

async function installJavaUnlocked(options: JavaInstallOptions = {}) {
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

  const expectedGeneration = await readInstalledJavaMetadata();

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

  let releaseActivation: (() => void) | undefined;
  try {
    await options.preDownloadGuard?.();
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

    if (!javaStatus.available || !javaStatus.version ||
      javaStatus.majorVersion !== MANAGED_JAVA_TARGET_MAJOR_VERSION) {
      throw new Error(`Downloaded Java runtime is not Java ${MANAGED_JAVA_TARGET_MAJOR_VERSION}.`);
    }

    const currentGeneration = await readInstalledJavaMetadata();
    if (!sameManagedJavaGeneration(currentGeneration, expectedGeneration) &&
      !(currentGeneration === null && expectedGeneration === null)) {
      throw new Error('The selected managed Java generation changed during installation.');
    }
    if (currentGeneration && !isNewerJavaVersion(javaStatus.version, currentGeneration.version)) {
      throw new Error('Adoptium did not offer a newer managed Java runtime.');
    }

    releaseActivation = (await options.activationLease?.()) || undefined;

    // Managed Java directories are immutable once selected: either Core may
    // still have the preceding runtime mapped even after it stops answering its
    // API. A unique verified-version directory lets activation switch metadata
    // without ever overwriting or deleting files beneath a JVM.
    const finalPath = path.join(
      getJavaVersionsPath(),
      sanitizePathSegment(
        `${JAVA_DISTRIBUTION}-${MANAGED_JAVA_TARGET_MAJOR_VERSION}-${javaStatus.version}-${download.digest.slice(0, 12)}-${Date.now()}-${randomBytes(6).toString('hex')}-${javaPlatform.platform}-${javaPlatform.arch}`,
      ),
    );

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

    // Keep every previously selected generation immutable. Either Core may
    // still have one mapped; retired-generation cleanup is a separate task.

    getCoreManagerState().updateEngineStatus = {
      ...getCoreManagerState().updateEngineStatus,
      javaUpdatePendingRestart: false,
    };

    publishProgress({
      action: 'idle',
      kind: 'success',
      message: `Installed Java ${javaStatus.version}.`,
      percent: 100,
    });

    return options.skipCompletionStatus ? undefined : await getStatus();
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });
    throw error;
  } finally {
    releaseActivation?.();
    await rm(downloadPath, { force: true });
  }
}

async function installJava(options: JavaInstallOptions = {}) {
  // Layout migration may itself publish Java metadata, so keep it outside the
  // non-reentrant install single-flight.
  if (!options.skipLayoutMigration) await ensureCoreLayout();
  return await coreManagerStates.runManagedJavaInstall(
    CORE_DESCRIPTOR.id,
    () => installJavaUnlocked(options),
  );
}

async function getAutomaticUpdateStatusForHomeV2(options: {
  readonly refreshManagedJava: boolean;
}) {
  const installed = await readInstalledCoreMetadataForHomeV2UpdateDiscovery();
  let installedJava = options.refreshManagedJava ? await readInstalledJavaMetadata() : null;
  if (installedJava) installedJava = await refreshManagedJavaUpdateInfo(installedJava);

  if (!installedJava) return { installed, java: null };

  const detected = await detectJavaVersion(installedJava.javaPath, 'managed');
  const managedUpgradeAvailable = detected.available && isManagedJavaUpdateAvailable(installedJava);
  return {
    installed,
    java: {
      managedUpgradeAvailable,
      source: detected.available ? 'managed' as const : 'unsupported' as const,
      updateAvailableVersion: managedUpgradeAvailable
        ? installedJava.latestKnownVersion ?? String(MANAGED_JAVA_TARGET_MAJOR_VERSION)
        : null,
    },
  };
}

function normalizeInstallRequest(request: CoreInstallRequest): CoreChannel {
  if (request.channel === 'stable' || request.channel === 'prerelease') {
    return request.channel;
  }

  return CORE_DESCRIPTOR.releaseChannels.defaultChannel;
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
      const response = await fetch(
        `${CORE_DESCRIPTOR.localApi.url}${CORE_DESCRIPTOR.update.path}`,
        {
          headers: { 'X-API-KEY': apiKey },
          signal: abortController.signal,
        },
      );
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

async function installCoreUnlocked(request: InternalCoreInstallRequest) {
  if (!request.skipLayoutMigration) await ensureCoreLayout();

  const channel = normalizeInstallRequest(request);
  const releases = await checkReleases();
  const release = releases[channel];

  if (!release.available) {
    throw new Error(release.message);
  }

  const existingCore = request.skipLayoutMigration
    ? await readInstalledCoreMetadataForHomeV2UpdateDiscovery()
    : await readInstalledCoreMetadata();
  const versionComparison = existingCore
    ? compareCoreVersions(release.tagName, existingCore.jarSemver ?? existingCore.tagName)
    : null;
  const sameVersion = existingCore
    ? existingCore.jarSemver
      ? versionComparison === 0
      : release.tagName === existingCore.tagName
    : false;

  if (typeof request.expectedTag === 'string' && release.tagName !== request.expectedTag) {
    throw new Error('The selected Qortium Core release changed. Check releases again before installing.');
  }

  if ((request.mode === 'initial-install' || request.mode === 'strict-update') &&
    !/^[0-9a-f]{40}$/i.test(release.commit)) {
    throw new Error('The Qortium Core release tag commit could not be verified.');
  }

  if (request.mode === 'initial-install' && existingCore) {
    throw new Error('Qortium Core is already installed.');
  }

  if (request.mode === 'strict-update' && (!existingCore || versionComparison === null || versionComparison <= 0)) {
    throw new Error('A strictly newer Qortium Core release is required.');
  }

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
    await preserveLegacyCoreRuntimeFiles(existingCore.previewPath, existingCore.runtimePath);
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
  // Home 2 may now update a RUNNING core in place — but only under exactly the
  // conditions the stop -> replace -> restart dance below already requires:
  //
  //   owner === 'home'      Home started this process, so Home may stop it. A
  //                         core someone else started is not ours to kill.
  //   existingCore !== null There is a known-good install to restore if the
  //                         update fails; without one a failure leaves nothing
  //                         to fall back to.
  //
  // initial-install is deliberately NOT included: by definition it has no
  // existing install to roll back to, and installing fresh over a running core
  // is the case that corrupts it. Home 2 used to refuse BOTH modes outright,
  // which is why a user with a Home-managed core was told to stop it by hand
  // for an ordinary update.
  const canUpdateRunningInPlace = request.mode === 'strict-update' &&
    runtimeBefore.owner === 'home' &&
    existingCore !== null;
  if (
    (request.mode === 'initial-install' || request.mode === 'strict-update') &&
    runtimeBefore.running &&
    !canUpdateRunningInPlace
  ) {
    throw new Error(
      request.mode === 'initial-install'
        ? 'Stop Qortium Core before installing it from Home 2.'
        : runtimeBefore.owner === 'home'
          ? 'Stop Qortium Core before updating it from Home 2.'
          : 'Qortium Core is running but was not started by Home, so Home cannot stop it to update. Stop it where it was started, then try again.',
    );
  }
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

  await mkdir(getCoreDownloadsPath(), { recursive: true });
  await rm(stagingPath, { recursive: true, force: true });
  await mkdir(stagingPath, { recursive: true });

  let releaseActivation: (() => void) | undefined;
  try {
    await assertQortiumReleaseUnchanged(release);
    await request.preDownloadGuard?.();
    await downloadFile(release.asset, downloadPath);

    publishProgress({
      action: 'extracting',
      kind: 'info',
      message: `Extracting ${release.asset.name}.`,
      percent: 0,
    });
    await extractZipSafely(downloadPath, { dir: stagingPath });

    const extractedCorePaths = await findExtractedCorePaths(stagingPath);
    const runtimeIdentity = await readCoreRuntimeChainIdentity(extractedCorePaths.previewPath);
    const candidateJarIdentity = await readCoreJarIdentity(extractedCorePaths.jarPath);

    if (!candidateJarIdentity || getCoreSemver(release.tagName) !== candidateJarIdentity.semver) {
      throw new Error('The verified Qortium Core archive does not match its release tag.');
    }
    if ((request.mode === 'initial-install' || request.mode === 'strict-update') &&
      (!candidateJarIdentity.commit || !coreCommitsMatch(release.commit, candidateJarIdentity.commit))) {
      throw new Error('The verified Qortium Core archive does not match its release commit.');
    }

    if (request.mode === 'initial-install' || request.mode === 'strict-update') {
      // Hold the process-wide operation lease before touching runtime-chain
      // metadata or any other shared Core state. The following stopped proof
      // therefore cannot race a Home 2 start or a policy revocation.
      releaseActivation = (await request.activationLease?.()) || undefined;
    }
    const activationCore = request.mode === 'initial-install' || request.mode === 'strict-update'
      ? await assertHomeV2CoreMaintenanceActivationSafe(existingCore, request.mode)
      : existingCore;
    if (request.mode === 'strict-update' &&
      (!activationCore?.jarSemver ||
        (compareCoreVersions(candidateJarIdentity.semver, activationCore.jarSemver) ?? 0) <= 0)) {
      throw new Error('The verified Qortium Core archive is not strictly newer than the installed JAR.');
    }

    await ensureRuntimeChainCompatible(getCoreRuntimePath(), release.tagName, runtimeIdentity);
    const installPath = getCoreInstallPath();

    if (restartAfterInstall && existingCore) {
      await stopCore({ quiet: true });

      // Wait for the process to actually exit (not just the API to go quiet) so
      // the OS releases the jar lock before we touch the install directory.
      if (ownedPid !== null) {
        await waitForPidExit(ownedPid, STOP_TIMEOUT_MS);
      }

      await new Promise((resolve) => setTimeout(resolve, FILE_RELEASE_SETTLE_MS));

      await preserveLegacyCoreRuntimeFiles(existingCore.previewPath, existingCore.runtimePath);
    } else if (existingCore) {
      await preserveLegacyCoreRuntimeFiles(existingCore.previewPath, existingCore.runtimePath);
    }

    await mirrorRuntimeRewardNodeIdentityToPreview(
      getCoreRuntimePath(),
      extractedCorePaths.previewPath,
    );

    const activateCandidate = async () => {
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

      if (!jarIdentity || jarIdentity.buildVersion !== candidateJarIdentity.buildVersion ||
        jarIdentity.buildTimestamp !== candidateJarIdentity.buildTimestamp ||
        !sameOptionalCoreCommit(jarIdentity.commit, candidateJarIdentity.commit)) {
        throw new Error('The Qortium Core candidate changed during activation.');
      }

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
    };

    if (existingCore) {
      await runCoreInstallTransaction({
        activateCandidate,
        backupPath,
        candidatePath: extractedCorePaths.installPath,
        installPath,
        restorePrevious: async () => {
          await writeInstalledCore(existingCore);
          await ensureBootstrapPeers(installPath);
        },
      });
    } else {
      await movePathReplacingDestination(extractedCorePaths.installPath, installPath);
      await activateCandidate();
    }
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });

    if (restartAfterInstall) {
      // The install transaction restores both the previous files and metadata
      // before this best-effort restart. If restore itself failed, it preserves
      // the backup for manual recovery instead of deleting it.
      try {
        await startCore({ quiet: true });
      } catch {
        // leave the core stopped if it cannot be restarted
      }
    }

    throw error;
  } finally {
    releaseActivation?.();
    await rm(downloadPath, { force: true });
    await rm(stagingPath, { recursive: true, force: true });
  }

  publishProgress({
    action: 'idle',
    kind: 'success',
    message: restartAfterInstall
      ? `Updated and restarted Qortium Core ${release.tagName}.`
      : `Installed Qortium Core ${release.tagName}.`,
    percent: 100,
  });

  getCoreManagerState().updateEngineStatus = {
    ...getCoreManagerState().updateEngineStatus,
    available: null,
    checkedAt: new Date().toISOString(),
    error: undefined,
  };

  return request.skipCompletionStatus ? undefined : await getStatus();
}

async function installCore(request: CoreInstallRequest) {
  const input = isObject(request) ? request : {};
  const allowlistedRequest: CoreInstallRequest = {
    allowDowngrade: input.allowDowngrade,
    channel: input.channel,
    downgradeToken: input.downgradeToken,
    expectedTag: input.expectedTag,
    mode: input.mode,
  };
  return await withCoreInstallLockForNetwork(CORE_DESCRIPTOR.id, 'github', () =>
    installCoreUnlocked(allowlistedRequest),
  );
}

async function installCoreAutomaticallyForHomeV2(request: HomeV2AutomaticCoreInstallRequest) {
  return await withCoreInstallLockForNetwork(CORE_DESCRIPTOR.id, 'github', () =>
    installCoreUnlocked({
      ...request,
      mode: 'strict-update',
      skipCompletionStatus: true,
      skipLayoutMigration: true,
    }),
  );
}

type HomeV2AutomaticJavaInstallRequest = Readonly<{
  activationLease: () => Promise<void | (() => void)>;
  preDownloadGuard: () => Promise<void>;
}>;

async function installJavaAutomaticallyForHomeV2(request: HomeV2AutomaticJavaInstallRequest) {
  return await installJava({
    ...request,
    skipCompletionStatus: true,
    skipLayoutMigration: true,
  });
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
    const launch = prepareManagedLongLivedCommand(command, args);
    const child =
      process.platform === 'win32'
        ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${command}" ${args.map(quoteWindowsCommandArg).join(' ')}"`], {
            cwd,
            env: sanitizeManagedChildEnvironment(env ?? process.env),
            ...(ignoreStdio ? { stdio: 'ignore' as const } : {}),
            windowsHide: true,
            windowsVerbatimArguments: true,
          })
        : spawn(launch.command, launch.args, {
            cwd,
            env: sanitizeManagedChildEnvironment(env ?? process.env),
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

async function waitForRuntimeState(
  running: boolean,
  timeoutMs: number,
  action: CoreProgress['action'],
  publishEvents = true,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const runtime = await fetchLocalCoreStatus();

    if (runtime.running === running) {
      return runtime;
    }

    if (publishEvents) {
      publishProgress({
        action,
        kind: 'info',
        message: running ? 'Waiting for local Core API.' : 'Waiting for local Core to stop.',
        percent: Math.min(95, Math.floor(((Date.now() - startedAt) / timeoutMs) * 100)),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(running ? 'Timed out waiting for local Core API.' : 'Timed out waiting for Core to stop.');
}

function getStartScript(previewPath: string) {
  return getCoreHelperScriptPaths(
    CORE_DESCRIPTOR,
    previewPath,
    process.platform,
  ).startScriptPath;
}

function getStopScript(previewPath: string) {
  return getCoreHelperScriptPaths(
    CORE_DESCRIPTOR,
    previewPath,
    process.platform,
  ).stopScriptPath;
}

// Whether the managed Core has I2P enabled, read from its on-disk participant
// settings (Core isn't running yet at this point). A null/empty/absent
// allowedTransports means Core's default ["IP","I2P"] — I2P enabled. Defaults to
// true on any uncertainty so we never suppress the fallback by accident; only a
// list that positively excludes I2P (e.g. ["IP"]) returns false.
async function isCoreI2pEnabled(runtimePath: string): Promise<boolean> {
  if (CORE_DESCRIPTOR.managedI2p.kind !== 'runtime-settings') {
    return false;
  }

  try {
    const raw = await readFile(
      path.join(runtimePath, CORE_DESCRIPTOR.settings.fileName),
      'utf8',
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const list = parsed[CORE_DESCRIPTOR.managedI2p.allowedTransportsField];

    if (!Array.isArray(list) || list.length === 0) {
      return true;
    }

    return list.some((entry) => typeof entry === 'string' && entry.trim().toUpperCase() === 'I2P');
  } catch {
    return true;
  }
}

type QortiumTransportSettingsSnapshot =
  | {
      exists: boolean;
      fingerprint: string;
      kind: 'known';
      mode: QortiumTransportMode;
      settings: QortiumSettingsObject;
    }
  | { kind: 'unknown' };

export type QortiumTransportModeMutationResult =
  | { kind: 'completed'; mode: QortiumTransportMode }
  | {
      code:
        | 'core-install-missing'
        | 'core-runtime-not-stopped'
        | 'core-runtime-unknown'
        | 'status-unavailable'
        | 'target-changed';
      kind: 'blocked';
    };

function filesystemErrorCode(error: unknown) {
  return error instanceof Error && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function transportSettingsPath(runtimePath: string) {
  return path.join(runtimePath, CORE_DESCRIPTOR.settings.fileName);
}

async function readQortiumTransportSettingsSnapshot(
  runtimePath: string,
): Promise<QortiumTransportSettingsSnapshot> {
  const settingsPath = transportSettingsPath(runtimePath);
  let before;
  try {
    before = await lstat(settingsPath);
  } catch (error) {
    return filesystemErrorCode(error) === 'ENOENT'
      ? {
          exists: false,
          fingerprint: 'missing',
          kind: 'known',
          mode: 'direct-and-i2p',
          settings: {},
        }
      : { kind: 'unknown' };
  }
  if (before.isSymbolicLink() || !before.isFile() || before.size < 0 ||
    before.size > QORTIUM_TRANSPORT_SETTINGS_MAX_BYTES) return { kind: 'unknown' };

  let raw: Buffer;
  let handle;
  try {
    handle = await open(settingsPath, 'r');
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
      opened.size !== before.size) return { kind: 'unknown' };
    raw = Buffer.alloc(opened.size);
    let position = 0;
    while (position < opened.size) {
      const { bytesRead } = await handle.read(raw, position, opened.size - position, position);
      if (bytesRead <= 0) return { kind: 'unknown' };
      position += bytesRead;
    }
  } catch {
    return { kind: 'unknown' };
  } finally {
    await handle?.close().catch(() => undefined);
  }
  if (raw.byteLength > QORTIUM_TRANSPORT_SETTINGS_MAX_BYTES) return { kind: 'unknown' };

  let after;
  try {
    after = await lstat(settingsPath);
  } catch {
    return { kind: 'unknown' };
  }
  if (after.isSymbolicLink() || !after.isFile() || before.dev !== after.dev ||
    before.ino !== after.ino || before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs) return { kind: 'unknown' };

  const parsed = parseQortiumTransportSettingsJson(raw.toString('utf8'));
  if (parsed.kind !== 'known') return { kind: 'unknown' };
  return {
    exists: true,
    fingerprint: createHash('sha256').update(raw).digest('hex'),
    kind: 'known',
    mode: parsed.mode,
    settings: parsed.settings,
  };
}

function sameQortiumTransportSettingsSnapshot(
  left: QortiumTransportSettingsSnapshot,
  right: QortiumTransportSettingsSnapshot,
) {
  return left.kind === 'known' && right.kind === 'known' &&
    left.exists === right.exists && left.fingerprint === right.fingerprint;
}

function sameQortiumTransportCoreTarget(left: InstalledCore, right: InstalledCore) {
  return left.runtimePath === right.runtimePath && left.jarPath === right.jarPath &&
    left.installPath === right.installPath && left.tagName === right.tagName &&
    left.digest === right.digest;
}

function isApprovedQortiumTransportCoreTarget(installed: InstalledCore) {
  if (CORE_DESCRIPTOR.package.kind !== 'zip-with-preview-helpers') return false;
  const installPath = getCoreInstallPath();
  return isApprovedQortiumTransportManagedTarget(
    installed,
    {
      installPath,
      jarPath: path.join(installPath, CORE_DESCRIPTOR.package.jarFileName),
      previewPath: path.join(installPath, CORE_DESCRIPTOR.package.previewDirectoryName),
      runtimePath: getCoreRuntimePath(),
    },
    process.platform,
  );
}

async function preparePrivateTransportSettingsReplacement(
  settingsPath: string,
  contents: string,
) {
  const temporaryPath = `${settingsPath}.home-v2-transport-${process.pid}-${Date.now()}-${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporaryPath, contents, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  if (process.platform !== 'win32') await chmod(temporaryPath, 0o600);
  return temporaryPath;
}

async function ensurePrivateTransportRuntimeDirectory(runtimePath: string) {
  await mkdir(runtimePath, { recursive: true, mode: 0o700 });
  const runtimeDirectory = await lstat(runtimePath);
  if (runtimeDirectory.isSymbolicLink() || !runtimeDirectory.isDirectory()) {
    throw new Error('The Qortium Core runtime path is not a private directory.');
  }
  if (process.platform !== 'win32') await chmod(runtimePath, 0o700);
}

export async function readQortiumTransportModeForHomeV2(): Promise<QortiumTransportModeState> {
  const installed = await readInstalledCoreMetadataForHomeV2UpdateDiscovery();
  if (!installed || !isApprovedQortiumTransportCoreTarget(installed)) return 'unknown';
  const snapshot = await readQortiumTransportSettingsSnapshot(installed.runtimePath);
  return snapshot.kind === 'known' ? snapshot.mode : 'unknown';
}

export async function setQortiumTransportModeForHomeV2(
  mode: QortiumTransportMode,
): Promise<QortiumTransportModeMutationResult> {
  const initialInstall = await readInstalledCoreMetadataForHomeV2UpdateDiscovery();
  if (!initialInstall) return { code: 'core-install-missing', kind: 'blocked' };
  if (!isApprovedQortiumTransportCoreTarget(initialInstall)) {
    return { code: 'status-unavailable', kind: 'blocked' };
  }
  const initialRuntime = await observeQortiumMaintenanceRuntimeState();
  if (initialRuntime === 'running') {
    return { code: 'core-runtime-not-stopped', kind: 'blocked' };
  }
  if (initialRuntime !== 'stopped') {
    return { code: 'core-runtime-unknown', kind: 'blocked' };
  }

  const initialSettings = await readQortiumTransportSettingsSnapshot(initialInstall.runtimePath);
  if (initialSettings.kind !== 'known') {
    return { code: 'status-unavailable', kind: 'blocked' };
  }
  const built = updateQortiumTransportSettings(initialSettings.settings, mode);
  if (built.kind !== 'built') return { code: 'status-unavailable', kind: 'blocked' };

  try {
    await ensurePrivateTransportRuntimeDirectory(initialInstall.runtimePath);
  } catch {
    return { code: 'status-unavailable', kind: 'blocked' };
  }

  const finalInstall = await readInstalledCoreMetadataForHomeV2UpdateDiscovery();
  if (!finalInstall || !isApprovedQortiumTransportCoreTarget(finalInstall) ||
    !sameQortiumTransportCoreTarget(initialInstall, finalInstall)) {
    return { code: 'target-changed', kind: 'blocked' };
  }
  const finalSettings = await readQortiumTransportSettingsSnapshot(finalInstall.runtimePath);
  if (!sameQortiumTransportSettingsSnapshot(initialSettings, finalSettings)) {
    return { code: 'target-changed', kind: 'blocked' };
  }
  const finalRuntime = await observeQortiumMaintenanceRuntimeState();
  if (finalRuntime === 'running') {
    return { code: 'core-runtime-not-stopped', kind: 'blocked' };
  }
  if (finalRuntime !== 'stopped') {
    return { code: 'core-runtime-unknown', kind: 'blocked' };
  }

  const settingsPath = transportSettingsPath(finalInstall.runtimePath);
  let temporaryPath: string;
  try {
    temporaryPath = await preparePrivateTransportSettingsReplacement(settingsPath, built.jsonLine);
  } catch {
    return { code: 'status-unavailable', kind: 'blocked' };
  }
  try {
    const committedInstall = await readInstalledCoreMetadataForHomeV2UpdateDiscovery();
    const committedSettings = await readQortiumTransportSettingsSnapshot(finalInstall.runtimePath);
    const committedRuntime = await observeQortiumMaintenanceRuntimeState();
    if (!committedInstall || !isApprovedQortiumTransportCoreTarget(committedInstall) ||
      !sameQortiumTransportCoreTarget(finalInstall, committedInstall) ||
      !sameQortiumTransportSettingsSnapshot(finalSettings, committedSettings)) {
      return { code: 'target-changed', kind: 'blocked' };
    }
    if (committedRuntime === 'running') {
      return { code: 'core-runtime-not-stopped', kind: 'blocked' };
    }
    if (committedRuntime !== 'stopped') {
      return { code: 'core-runtime-unknown', kind: 'blocked' };
    }
    await rename(temporaryPath, settingsPath);
    if (process.platform !== 'win32') await chmod(settingsPath, 0o600);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  const confirmed = await readQortiumTransportSettingsSnapshot(finalInstall.runtimePath);
  return confirmed.kind === 'known' && confirmed.mode === mode
    ? { kind: 'completed', mode }
    : { code: 'status-unavailable', kind: 'blocked' };
}

type CoreLifecycleOptions = {
  publishEvents?: boolean;
  quiet?: boolean;
  runUpdateEngine?: boolean;
  upgradeJava?: boolean;
};

async function startCore(options: CoreLifecycleOptions = {}) {
  // The running-core key cache must not serve pre-start state while the core
  // comes up (and start-guards below need fresh data).
  invalidateRunningCoreApiKeyCache();

  const installedCore = await readInstalledCore();

  if (!installedCore) {
    throw new Error('Install Qortium Core before starting it.');
  }

  const currentRuntime = await resolveRuntimeStatusOwner(await fetchLocalCoreStatus(), installedCore);

  if (currentRuntime.running) {
    if (options.runUpdateEngine !== false) void runCoreUpdateEngine();
    return await getStatus();
  }

  // The core is confirmed stopped here, so a managed-runtime swap cannot pull
  // the JRE out from under a running JVM.
  if (options.upgradeJava !== false) await maybeUpgradeManagedJava();

  const java = await getJavaStatus();

  if (!java.available) {
    throw new Error(`Java ${MIN_JAVA_MAJOR_VERSION} or newer is required before Qortium Core can start.`);
  }

  await ensureInstalledCoreRuntimeChain(installedCore, { recordIfMissing: true });

  // Bring up the managed I2P router (if installed) before Core, so its SAM bridge
  // is ready when Core looks for it. Best-effort — never blocks Core startup.
  // Skip it when the node has I2P disabled (IP-only): no point running a router
  // Core won't use.
  if (
    CORE_DESCRIPTOR.managedI2p.kind === 'runtime-settings' &&
    (await isCoreI2pEnabled(installedCore.runtimePath))
  ) {
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

  if (options.publishEvents !== false) {
    publishProgress({
      action: 'starting',
      kind: 'info',
      message: 'Starting Qortium Core.',
      percent: 5,
    });
  }
  try {
    ensurePreviewApiKey(installedCore.runtimePath);
    await runScript(
      startScript,
      getCoreHelperStartArguments(CORE_DESCRIPTOR, installedCore.runtimePath),
      installedCore.previewPath,
      getJavaRuntimeEnv(java),
      { stdio: 'ignore' },
    );
    await waitForRuntimeState(
      true,
      START_TIMEOUT_MS,
      'starting',
      options.publishEvents !== false,
    );
  } catch (error) {
    throw new Error(withCoreLogPaths(getErrorMessage(error), installedCore.logPaths));
  }

  if (!options.quiet && options.publishEvents !== false) {
    publishProgress({
      action: 'idle',
      kind: 'success',
      message: 'Qortium Core is running.',
      percent: 100,
    });
  }

  if (options.runUpdateEngine !== false) void runCoreUpdateEngine();

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

  const response = await fetch(
    `${CORE_DESCRIPTOR.localApi.url}${CORE_DESCRIPTOR.localApi.stopPath}`,
    {
      headers: { 'X-API-KEY': apiKey },
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Core stop request failed with HTTP ${response.status}.`);
  }
}

async function stopCore(options: CoreLifecycleOptions = {}) {
  invalidateRunningCoreApiKeyCache();

  const installedCore = await readInstalledCore();
  const currentRuntime = await resolveRuntimeStatusOwner(await fetchLocalCoreStatus(), installedCore);

  if (!currentRuntime.running) {
    return await getStatus();
  }

  const logPaths = installedCore?.logPaths ?? getCoreLogPaths(getCoreRuntimePath());
  const stopScript = installedCore ? getStopScript(installedCore.previewPath) : null;
  const isHomeOwned = currentRuntime.owner === 'home';

  if (options.publishEvents !== false) {
    publishProgress({
      action: 'stopping',
      kind: 'info',
      message: 'Stopping Qortium Core.',
      percent: 5,
    });
  }
  try {
    if (isHomeOwned && installedCore && stopScript && existsSync(stopScript)) {
      await runScript(
        stopScript,
        getCoreHelperStopArguments(CORE_DESCRIPTOR, installedCore.runtimePath),
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

    await waitForRuntimeState(
      false,
      STOP_TIMEOUT_MS,
      'stopping',
      options.publishEvents !== false,
    );
  } catch (error) {
    throw new Error(withCoreLogPaths(getErrorMessage(error), logPaths));
  }

  // Stop the router we started alongside Core (no-op for an external router).
  if (CORE_DESCRIPTOR.managedI2p.kind === 'runtime-settings') {
    await stopI2pdIfManaged();
  }

  if (!options.quiet && options.publishEvents !== false) {
    publishProgress({
      action: 'idle',
      kind: 'success',
      message: 'Qortium Core is stopped.',
      percent: 100,
    });
  }

  return await getStatus();
}

export type QortiumCoreManagerEntry = {
  readonly descriptor: CoreNetworkDescriptor;
  readonly networkId: 'qortium';
  checkReleases: typeof checkReleases;
  checkUpdates(): Promise<CoreStatus>;
  getManagedPreviewPath: typeof getQortiumManagedCorePreviewPath;
  getManagedRuntimePath: typeof getQortiumManagedCoreRuntimePath;
  getStatus: typeof getStatus;
  getMaintenanceRuntimeStateForHomeV2: typeof observeQortiumMaintenanceRuntimeState;
  getTransportModeForHomeV2: typeof readQortiumTransportModeForHomeV2;
  install: typeof installCore;
  installCoreAutomaticallyForHomeV2: typeof installCoreAutomaticallyForHomeV2;
  installJava: typeof installJava;
  installJavaAutomaticallyForHomeV2: typeof installJavaAutomaticallyForHomeV2;
  getAutomaticUpdateStatusForHomeV2: typeof getAutomaticUpdateStatusForHomeV2;
  isManagedCoreUsingI2p: typeof isQortiumManagedCoreUsingI2p;
  isManagedRuntimeRunning: typeof isQortiumManagedCoreRuntimeRunning;
  refreshHelpers: typeof refreshCoreHelpers;
  scheduleUpdateCheck: typeof scheduleQortiumManagedCoreUpdateCheck;
  setUpdateSettings(request: unknown): Promise<CoreStatus>;
  setTransportModeForHomeV2: typeof setQortiumTransportModeForHomeV2;
  start: typeof startCore;
  startForHomeV2(): ReturnType<typeof startCore>;
  stop: typeof stopCore;
  stopForHomeV2(): ReturnType<typeof stopCore>;
};

const qortiumCoreManagerEntry: QortiumCoreManagerEntry = Object.freeze({
  descriptor: CORE_DESCRIPTOR,
  networkId: CORE_DESCRIPTOR.id,
  checkReleases,
  async checkUpdates() {
    await runCoreUpdateEngine();
    return await getStatus();
  },
  getManagedPreviewPath: getQortiumManagedCorePreviewPath,
  getManagedRuntimePath: getQortiumManagedCoreRuntimePath,
  getStatus,
  getMaintenanceRuntimeStateForHomeV2: observeQortiumMaintenanceRuntimeState,
  getTransportModeForHomeV2: readQortiumTransportModeForHomeV2,
  install: installCore,
  installCoreAutomaticallyForHomeV2,
  installJava,
  installJavaAutomaticallyForHomeV2,
  getAutomaticUpdateStatusForHomeV2,
  isManagedCoreUsingI2p: isQortiumManagedCoreUsingI2p,
  isManagedRuntimeRunning: isQortiumManagedCoreRuntimeRunning,
  refreshHelpers: refreshCoreHelpers,
  scheduleUpdateCheck: scheduleQortiumManagedCoreUpdateCheck,
  async setUpdateSettings(request: unknown) {
    await setCoreUpdateSettings(isObject(request) ? request : {});
    await runCoreUpdateEngineAfterPolicyChange();
    return await getStatus();
  },
  setTransportModeForHomeV2: setQortiumTransportModeForHomeV2,
  start: startCore,
  startForHomeV2: () => startCore({
    publishEvents: false,
    quiet: true,
    runUpdateEngine: false,
    upgradeJava: false,
  }),
  stop: stopCore,
  stopForHomeV2: () => stopCore({ publishEvents: false, quiet: true }),
});

export type CoreManagerEntry = QortiumCoreManagerEntry | QortalCoreManager;

const coreManagerEntries = new NetworkManagerEntryRegistry<CoreNetworkId, CoreManagerEntry>([
  qortiumCoreManagerEntry,
]);

export function registerQortalCoreManagerEntry(manager: QortalCoreManager) {
  return coreManagerEntries.register(manager);
}

function qortalPlatformRuntimeOverrides(): Partial<QortalCoreRuntimeOperations> {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return {};
  const resolution = resolveCoreNativeObserverPath({
    appPath: app.getAppPath(),
    arch: process.arch,
    isPackaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
  });
  const supportedArchitecture = process.platform === 'darwin'
    ? process.arch === 'x64' || process.arch === 'arm64'
    : process.arch === 'x64';
  if (resolution.kind !== 'resolved' || !supportedArchitecture) {
    const reason = resolution.kind === 'unknown'
      ? resolution.reason
      : `The native Core observer is unsupported on ${process.platform}/${process.arch}.`;
    return {
      inspectListener: async () => ({ kind: 'unknown', reason }),
      inspectProcesses: async () => ({ kind: 'unknown', processes: [], reason }),
    };
  }
  if (process.platform === 'win32') {
    const observer = { helperPath: resolution.executablePath } as const;
    return {
      inspectListener: async () => await observeWindowsCoreListenerOwners(12391, observer),
      inspectProcesses: async (paths) => await observeWindowsQortalProcesses({
        ...observer,
        selectedJarPath: paths.jarPath,
      }),
      readSecureFile: async (targetPath, maxBytes) =>
        await readWindowsSecureFile(targetPath, maxBytes, observer),
    };
  }
  const observer = {
    arch: process.arch as 'arm64' | 'x64',
    helperPath: resolution.executablePath,
  } as const;
  return {
    inspectListener: async () => await observeMacosCoreListenerOwners(12391, observer),
    inspectProcesses: async (paths) => await observeMacosQortalProcesses({
      ...observer,
      selectedJarPath: paths.jarPath,
    }),
  };
}

async function observeQortiumMaintenanceRuntimeState(): Promise<'running' | 'stopped' | 'unknown'> {
  if ((await fetchLocalCoreStatus()).running) return 'running';

  let listener;
  if (process.platform === 'linux') {
    listener = await observeCoreListenerOwners(CORE_DESCRIPTOR.processProbe.apiPort);
  } else if (process.platform === 'darwin' || process.platform === 'win32') {
    const resolution = resolveCoreNativeObserverPath({
      appPath: app.getAppPath(),
      arch: process.arch,
      isPackaged: app.isPackaged,
      platform: process.platform,
      resourcesPath: process.resourcesPath,
    });
    if (resolution.kind !== 'resolved') return 'unknown';
    if (process.platform === 'win32') {
      if (process.arch !== 'x64') return 'unknown';
      listener = await observeWindowsCoreListenerOwners(CORE_DESCRIPTOR.processProbe.apiPort, {
        helperPath: resolution.executablePath,
      });
    } else {
      if (process.arch !== 'x64' && process.arch !== 'arm64') return 'unknown';
      listener = await observeMacosCoreListenerOwners(CORE_DESCRIPTOR.processProbe.apiPort, {
        arch: process.arch,
        helperPath: resolution.executablePath,
      });
    }
  } else {
    return 'unknown';
  }

  if (listener.kind === 'owners') return 'running';
  if (listener.kind !== 'absent') return 'unknown';

  const installed = await readInstalledCoreMetadataForHomeV2UpdateDiscovery();
  if (!installed) return 'stopped';
  if (!isApprovedQortiumTransportCoreTarget(installed)) return 'unknown';

  let processes;
  if (process.platform === 'linux') {
    processes = await observeCurrentUserQortalProcesses({ selectedJarPath: installed.jarPath });
  } else {
    const resolution = resolveCoreNativeObserverPath({
      appPath: app.getAppPath(),
      arch: process.arch,
      isPackaged: app.isPackaged,
      platform: process.platform,
      resourcesPath: process.resourcesPath,
    });
    if (resolution.kind !== 'resolved') return 'unknown';
    if (process.platform === 'win32') {
      if (process.arch !== 'x64') return 'unknown';
      processes = await observeWindowsQortalProcesses({
        helperPath: resolution.executablePath,
        selectedJarPath: installed.jarPath,
      });
    } else {
      if (process.arch !== 'x64' && process.arch !== 'arm64') return 'unknown';
      processes = await observeMacosQortalProcesses({
        arch: process.arch,
        helperPath: resolution.executablePath,
        selectedJarPath: installed.jarPath,
      });
    }
  }

  if (processes.kind !== 'observed') return 'unknown';
  return processes.processes.some((candidate) =>
    candidate.classification.kind === 'qortal-direct-jar' && candidate.classification.selected)
    ? 'running'
    : 'stopped';
}

export function registerProductionCoreManagerEntries() {
  const existing = coreManagerEntries.get('qortal');
  if (existing) return existing;

  const paths = resolveQortalManagedInstallPaths({
    appDataPath: app.getPath('appData'),
    userDataPath: app.getPath('userData'),
  });
  const runtimeOverrides = qortalPlatformRuntimeOverrides();
  return registerQortalCoreManagerEntry(createProductionQortalCoreManager(
    {
      adoptedRecordPath: resolveQortalAdoptedInstallRecordPath(paths),
      lockRoot: path.join(paths.basePath, 'operation-locks'),
      paths,
      ...(runtimeOverrides.readSecureFile ? {
        readAdoptedRecord: async (recordPath: string, maxBytes: number) =>
          (await runtimeOverrides.readSecureFile!(recordPath, maxBytes)).bytes,
      } : {}),
      userAgent: QORTAL_CORE_DESCRIPTOR.github.userAgent,
    },
    resolveSharedQortalJavaForLaunch,
    runtimeOverrides,
    {
      inspectExternalInstallCollision: async () =>
        await probeProductionQortalExternalInstallCollision(paths),
    },
  ));
}

export function getCoreManagerEntry(networkId: CoreNetworkId) {
  return coreManagerEntries.get(networkId);
}

export function listCoreManagerNetworkIds() {
  return coreManagerEntries.listNetworkIds();
}

export function requireCoreManagerEntry(networkId: CoreNetworkId) {
  return coreManagerEntries.require(networkId);
}

function requireQortiumCoreManagerEntry() {
  const manager = requireCoreManagerEntry('qortium');

  if (manager.networkId !== 'qortium') {
    throw new Error('The Qortium Core manager registry entry has the wrong network identity.');
  }

  return manager;
}

// Existing callers remain source-compatible while entering through the keyed
// Qortium registration. E2 can add a Qortal entry without changing these v1
// compatibility contracts or pretending that it exists before it does.
export function getManagedCorePreviewPath() {
  return requireQortiumCoreManagerEntry().getManagedPreviewPath();
}

export function getManagedCoreRuntimePath() {
  return requireQortiumCoreManagerEntry().getManagedRuntimePath();
}

export function isManagedCoreRuntimeRunning() {
  return requireQortiumCoreManagerEntry().isManagedRuntimeRunning();
}

export function scheduleManagedCoreUpdateCheck() {
  requireQortiumCoreManagerEntry().scheduleUpdateCheck();
}

export function isManagedCoreUsingI2p() {
  return requireQortiumCoreManagerEntry().isManagedCoreUsingI2p();
}

function ensureCoreUpdateEngineStarted(manager: QortiumCoreManagerEntry) {
  if (
    coreManagerStates.ensureUpdateInterval(manager.networkId, () => {
      const interval = setInterval(() => {
        void manager.checkUpdates();
      }, CORE_UPDATE_CHECK_INTERVAL_MS);

      interval.unref();
      return interval;
    })
  ) {
    setTimeout(() => {
      void manager.checkUpdates();
    }, 0).unref();
  }
}

export function registerCoreManagerIpcHandlers() {
  const manager = requireQortiumCoreManagerEntry();

  ipcMain.handle('core:checkReleases', () => manager.checkReleases());
  ipcMain.handle('core:getStatus', () => manager.getStatus());
  ipcMain.handle('core:install', async (_event, request: CoreInstallRequest = {}) => {
    try {
      return await manager.install(request);
    } catch (error) {
      if (error instanceof DowngradeConfirmationRequiredError) {
        return {
          ...(await manager.getStatus()),
          downgradeConfirmation: error.confirmation,
        };
      }

      throw error;
    }
  });
  ipcMain.handle('core:installJava', () => manager.installJava());
  ipcMain.handle('core:refreshHelpers', () => manager.refreshHelpers());
  ipcMain.handle('core:setJavaAutoUpdate', async (_event, enabled: unknown) => {
    return await manager.setUpdateSettings({
      javaUpdatePolicy: enabled === true ? 'install' : 'off',
    });
  });
  ipcMain.handle('core:setUpdatePolicy', async (_event, request: unknown) => {
    return await manager.setUpdateSettings(request);
  });
  ipcMain.handle('core:start', () => manager.start());
  ipcMain.handle('core:stop', () => manager.stop());

  ensureCoreUpdateEngineStarted(manager);
}
