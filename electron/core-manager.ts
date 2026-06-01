import { app, BrowserWindow, ipcMain } from 'electron';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import extract from 'extract-zip';
import { extract as extractTar } from 'tar';
import { ensurePreviewApiKey } from './local-api-key.js';

const CORE_REPOSITORY = 'QuickMythril/qortium';
const GITHUB_API_BASE_URL = `https://api.github.com/repos/${CORE_REPOSITORY}`;
const GITHUB_USER_AGENT = 'QortiumHome/1.0';
const MANAGED_CORE_DIR = 'managed-core';
const CURRENT_CORE_FILE = 'current.json';
const CURRENT_JAVA_FILE = 'current-java.json';
const LOCAL_CORE_API_URL = 'http://127.0.0.1:24891';
const LOCAL_CORE_STATUS_PATH = '/admin/status';
const START_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 45_000;
const STATUS_TIMEOUT_MS = 2_500;
const POLL_INTERVAL_MS = 2_000;
const MIN_JAVA_MAJOR_VERSION = 17;
const JAVA_DISTRIBUTION = 'temurin';
const ADOPTIUM_JAVA_API_BASE_URL = 'https://api.adoptium.net/v3/binary/latest';

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

type CoreRuntimeStatus = {
  localApiUrl: string;
  running: boolean;
  status: unknown;
};

type CoreStatus = {
  installed: InstalledCore | null;
  java: JavaStatus;
  runtime: CoreRuntimeStatus;
  supported: boolean;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getCoreBasePath() {
  return path.join(app.getPath('userData'), MANAGED_CORE_DIR);
}

function getCoreDownloadsPath() {
  return path.join(getCoreBasePath(), 'downloads');
}

function getCoreVersionsPath() {
  return path.join(getCoreBasePath(), 'versions');
}

function getJavaBasePath() {
  return path.join(getCoreBasePath(), 'java');
}

function getJavaVersionsPath() {
  return path.join(getJavaBasePath(), 'versions');
}

function getCurrentCorePath() {
  return path.join(getCoreBasePath(), CURRENT_CORE_FILE);
}

function getCurrentJavaPath() {
  return path.join(getJavaBasePath(), CURRENT_JAVA_FILE);
}

function getCoreLogPaths(previewPath: string): CoreLogPaths {
  const logPaths: CoreLogPaths = {
    appLogPath: path.join(previewPath, 'qortium.log'),
    launcherLogPath: path.join(previewPath, 'run.log'),
  };

  if (process.platform === 'win32') {
    logPaths.windowsErrorLogPath = path.join(previewPath, 'run-error.log');
  }

  return logPaths;
}

function getRunPidPath(previewPath: string) {
  return path.join(previewPath, 'run.pid');
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

function parseInstalledCore(value: unknown): InstalledCore | null {
  if (!isObject(value)) {
    return null;
  }

  const installedCore = value as Partial<InstalledCore>;
  const installPath = getString(installedCore.installPath);
  const previewPath = getString(installedCore.previewPath);
  const jarPath = getString(installedCore.jarPath);
  const tagName = getString(installedCore.tagName);

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
    logPaths: getCoreLogPaths(previewPath),
    name: getString(installedCore.name) || tagName,
    previewPath,
    tagName,
  };
}

async function readInstalledCore(): Promise<InstalledCore | null> {
  try {
    const parsedCore: unknown = JSON.parse(await readFile(getCurrentCorePath(), 'utf8'));
    const installedCore = parseInstalledCore(parsedCore);

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

export async function getManagedCorePreviewPath() {
  return (await readInstalledCore())?.previewPath ?? null;
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

export async function isManagedCoreRuntimeRunning() {
  const installedCore = await readInstalledCore();

  if (!installedCore) {
    return false;
  }

  try {
    const pid = Number((await readFile(getRunPidPath(installedCore.previewPath), 'utf8')).trim());

    return Number.isInteger(pid) && pid > 0 && isPidRunning(pid);
  } catch {
    return false;
  }
}

async function writeInstalledCore(installedCore: InstalledCore) {
  await mkdir(getCoreBasePath(), { recursive: true });
  await writeFile(getCurrentCorePath(), `${JSON.stringify(installedCore, null, 2)}\n`, 'utf8');
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

async function readInstalledJava(): Promise<ManagedJava | null> {
  try {
    const parsedJava: unknown = JSON.parse(await readFile(getCurrentJavaPath(), 'utf8'));
    const installedJava = parseInstalledJava(parsedJava);

    if (installedJava && existsSync(installedJava.installPath) && existsSync(installedJava.javaPath)) {
      return installedJava;
    }
  } catch {
    return null;
  }

  return null;
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

async function getJavaStatus(): Promise<JavaStatus> {
  const installedJava = await readInstalledJava();
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
        running: false,
        status: text,
      };
    }

    return {
      localApiUrl: LOCAL_CORE_API_URL,
      running: true,
      status: text ? (JSON.parse(text) as unknown) : null,
    };
  } catch {
    return {
      localApiUrl: LOCAL_CORE_API_URL,
      running: false,
      status: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getStatus(): Promise<CoreStatus> {
  const [installed, java, runtime] = await Promise.all([
    readInstalledCore(),
    getJavaStatus(),
    fetchLocalCoreStatus(),
  ]);

  return {
    supported: process.platform === 'linux' || process.platform === 'darwin' || process.platform === 'win32',
    installed,
    java,
    runtime,
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
  const channel = normalizeInstallRequest(request);
  const releases = await checkReleases();
  const release = releases[channel];

  if (!release.available) {
    throw new Error(release.message);
  }

  const versionPath = path.join(getCoreVersionsPath(), sanitizePathSegment(release.tagName));
  const downloadPath = path.join(
    getCoreDownloadsPath(),
    `${sanitizePathSegment(release.tagName)}-${sanitizePathSegment(release.asset.name)}`,
  );

  await mkdir(getCoreDownloadsPath(), { recursive: true });
  await rm(versionPath, { recursive: true, force: true });
  await mkdir(versionPath, { recursive: true });

  await downloadFile(release.asset, downloadPath);

  publishProgress({
    action: 'extracting',
    kind: 'info',
    message: `Extracting ${release.asset.name}.`,
    percent: 0,
  });
  await extract(downloadPath, { dir: versionPath });
  await rm(downloadPath, { force: true });

  const corePaths = await findExtractedCorePaths(versionPath);

  await chmodPreviewScripts(corePaths.previewPath);

  const installedCore: InstalledCore = {
    assetName: release.asset.name,
    assetSize: release.asset.size,
    channel: release.channel,
    digest: release.asset.digest,
    downloadUrl: release.asset.downloadUrl,
    htmlUrl: release.htmlUrl,
    installPath: corePaths.installPath,
    installedAt: new Date().toISOString(),
    jarPath: corePaths.jarPath,
    logPaths: getCoreLogPaths(corePaths.previewPath),
    name: release.name,
    previewPath: corePaths.previewPath,
    tagName: release.tagName,
  };

  await writeInstalledCore(installedCore);

  publishProgress({
    action: 'idle',
    kind: 'success',
    message: `Installed Qortium Core ${release.tagName}.`,
    percent: 100,
  });

  return await getStatus();
}

async function runScript(
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
) {
  return new Promise<void>((resolve, reject) => {
    let output = '';
    const child =
      process.platform === 'win32'
        ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${command}" ${args.join(' ')}`], {
            cwd,
            env,
            windowsHide: true,
          })
        : spawn(command, args, {
            cwd,
            env,
            windowsHide: true,
          });

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(output.trim() || `${path.basename(command)} exited with code ${code}.`));
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

async function startCore() {
  const installedCore = await readInstalledCore();

  if (!installedCore) {
    throw new Error('Install Qortium Core before starting it.');
  }

  const java = await getJavaStatus();

  if (!java.available) {
    throw new Error('Java 17 or newer is required before Qortium Core can start.');
  }

  const currentRuntime = await fetchLocalCoreStatus();

  if (currentRuntime.running) {
    return await getStatus();
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

  ensurePreviewApiKey(installedCore.previewPath);

  publishProgress({
    action: 'starting',
    kind: 'info',
    message: 'Starting Qortium Core.',
    percent: 5,
  });
  try {
    await runScript(
      startScript,
      ['--participant'],
      installedCore.previewPath,
      getJavaRuntimeEnv(java),
    );
    await waitForRuntimeState(true, START_TIMEOUT_MS, 'starting');
  } catch (error) {
    throw new Error(withCoreLogPaths(getErrorMessage(error), installedCore.logPaths));
  }

  publishProgress({
    action: 'idle',
    kind: 'success',
    message: 'Qortium Core is running.',
    percent: 100,
  });

  return await getStatus();
}

async function stopCore() {
  const installedCore = await readInstalledCore();

  if (!installedCore) {
    throw new Error('No managed Qortium Core install was found.');
  }

  const currentRuntime = await fetchLocalCoreStatus();

  if (!currentRuntime.running) {
    return await getStatus();
  }

  const stopScript = getStopScript(installedCore.previewPath);

  if (!existsSync(stopScript)) {
    throw new Error(
      withCoreLogPaths(
        `The installed Core release is missing its preview stop script at ${stopScript}.`,
        installedCore.logPaths,
      ),
    );
  }

  publishProgress({
    action: 'stopping',
    kind: 'info',
    message: 'Stopping Qortium Core.',
    percent: 5,
  });
  try {
    await runScript(
      stopScript,
      [],
      installedCore.previewPath,
      getJavaRuntimeEnv(await getJavaStatus()),
    );
    await waitForRuntimeState(false, STOP_TIMEOUT_MS, 'stopping');
  } catch (error) {
    throw new Error(withCoreLogPaths(getErrorMessage(error), installedCore.logPaths));
  }

  publishProgress({
    action: 'idle',
    kind: 'success',
    message: 'Qortium Core is stopped.',
    percent: 100,
  });

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
