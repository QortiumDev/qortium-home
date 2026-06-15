import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

type AppUpdatePlatformOs = 'android' | 'linux' | 'macos' | 'unsupported' | 'windows';

type AppUpdateAsset = {
  digest: string | null;
  downloadUrl: string;
  name: string;
  size: number;
};

type AppUpdateDownloadRequest = {
  asset?: unknown;
  platform?: unknown;
  releaseTag?: unknown;
};

type AppUpdateDownloadProgress = {
  action: 'downloading' | 'verifying';
  fileName: string;
  message: string;
  percent: number | null;
  receivedBytes: number;
  releaseTag: string;
  totalBytes: number | null;
};

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<number | string>;
};

const APP_UPDATES_DIR = 'app-updates';
const GITHUB_USER_AGENT = 'QortiumHome/1.0';

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getPlatformOs(): AppUpdatePlatformOs {
  if (process.platform === 'linux') {
    return 'linux';
  }

  if (process.platform === 'darwin') {
    return 'macos';
  }

  if (process.platform === 'win32') {
    return 'windows';
  }

  return 'unsupported';
}

function getAppUpdatesPath() {
  return path.join(app.getPath('userData'), APP_UPDATES_DIR);
}

function sanitizePathSegment(value: string, fallback: string) {
  return value.replace(/[^a-z0-9._-]/gi, '_') || fallback;
}

function normalizeDigest(value: unknown) {
  const digest = getString(value).toLowerCase();

  return /^sha256:[a-f0-9]{64}$/.test(digest) ? digest : null;
}

function parseVersion(value: string): ParsedVersion | null {
  const normalizedValue = value.trim().replace(/^v/i, '').split('+')[0];
  const versionMatch = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(normalizedValue);

  if (!versionMatch) {
    return null;
  }

  return {
    major: Number.parseInt(versionMatch[1], 10),
    minor: Number.parseInt(versionMatch[2], 10),
    patch: Number.parseInt(versionMatch[3], 10),
    prerelease: versionMatch[4]
      ? versionMatch[4].split('.').map((part) => (/^\d+$/.test(part) ? Number.parseInt(part, 10) : part))
      : [],
  };
}

function compareIdentifiers(first: number | string, second: number | string) {
  if (typeof first === 'number' && typeof second === 'number') {
    return Math.sign(first - second);
  }

  if (typeof first === 'number') {
    return -1;
  }

  if (typeof second === 'number') {
    return 1;
  }

  return Math.sign(first.localeCompare(second));
}

function compareAppVersions(firstValue: string, secondValue: string) {
  const first = parseVersion(firstValue);
  const second = parseVersion(secondValue);

  if (!first || !second) {
    return null;
  }

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (first[key] !== second[key]) {
      return Math.sign(first[key] - second[key]);
    }
  }

  if (first.prerelease.length === 0 && second.prerelease.length === 0) {
    return 0;
  }

  if (first.prerelease.length === 0) {
    return 1;
  }

  if (second.prerelease.length === 0) {
    return -1;
  }

  const identifierCount = Math.max(first.prerelease.length, second.prerelease.length);

  for (let index = 0; index < identifierCount; index += 1) {
    const firstIdentifier = first.prerelease[index];
    const secondIdentifier = second.prerelease[index];

    if (firstIdentifier === undefined) {
      return -1;
    }

    if (secondIdentifier === undefined) {
      return 1;
    }

    const comparison = compareIdentifiers(firstIdentifier, secondIdentifier);

    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

function assertUpdateIsNewer(releaseTag: string) {
  const currentVersion = app.getVersion();
  const comparison = compareAppVersions(releaseTag, currentVersion);

  if (comparison === null) {
    throw new Error(`Unable to compare update release ${releaseTag} with current version ${currentVersion}.`);
  }

  if (comparison <= 0) {
    throw new Error(`Qortium Home ${currentVersion} is already current.`);
  }
}

function normalizeDownloadAsset(value: unknown): AppUpdateAsset {
  if (!isObject(value)) {
    throw new Error('Update asset is required.');
  }

  const name = getString(value.name);
  const downloadUrl = normalizeExternalUrl(value.downloadUrl);

  if (!name) {
    throw new Error('Update asset name is required.');
  }

  return {
    name,
    downloadUrl,
    digest: normalizeDigest(value.digest),
    size: getNumber(value.size),
  };
}

function normalizeDownloadRequest(value: AppUpdateDownloadRequest) {
  if (!isObject(value)) {
    throw new Error('Update download request is required.');
  }

  const releaseTag = getString(value.releaseTag);

  if (!releaseTag) {
    throw new Error('Update release tag is required.');
  }

  return {
    asset: normalizeDownloadAsset(value.asset),
    releaseTag,
  };
}

function getPlatformLabel(os: AppUpdatePlatformOs, arch: string) {
  if (os === 'linux') {
    return `Linux ${arch}`;
  }

  if (os === 'macos') {
    return `macOS ${arch}`;
  }

  if (os === 'windows') {
    return `Windows ${arch}`;
  }

  return `${process.platform} ${arch}`;
}

function isSupportedPlatform(os: AppUpdatePlatformOs, arch: string) {
  if (os === 'linux' || os === 'macos') {
    return arch === 'x64' || arch === 'arm64';
  }

  if (os === 'windows') {
    return arch === 'x64';
  }

  return false;
}

function getUpdateEnvironment() {
  const os = getPlatformOs();
  const arch = process.arch;
  // For AppImage builds app.getPath('exe') points at the temporary FUSE mount
  // (/tmp/.../.mount_...), not the real .AppImage on disk. The AppImage runtime
  // exposes the actual file path in the APPIMAGE environment variable; fall back
  // to the executable path on every other platform/packaging.
  const installFile = process.env.APPIMAGE || app.getPath('exe');

  return {
    currentVersion: app.getVersion(),
    installDir: path.dirname(installFile),
    installFile,
    platform: {
      arch,
      label: getPlatformLabel(os, arch),
      os,
      supported: isSupportedPlatform(os, arch),
    },
    updatesDir: getAppUpdatesPath(),
  };
}

function normalizeExternalUrl(value: unknown) {
  const rawUrl = typeof value === 'string' ? value.trim() : '';

  if (!rawUrl) {
    throw new Error('Release URL is required.');
  }

  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Release URL is invalid.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Release URL must use HTTP or HTTPS.');
  }

  return url.toString();
}

async function openExternalUrl(value: unknown) {
  await shell.openExternal(normalizeExternalUrl(value));
}

function getResponseContentLength(response: Response) {
  const contentLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);

  return Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;
}

function publishDownloadProgress(progress: AppUpdateDownloadProgress) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('updates:downloadProgress', progress);
    }
  }
}

async function downloadAsset(request: AppUpdateDownloadRequest) {
  const normalizedRequest = normalizeDownloadRequest(request);

  assertUpdateIsNewer(normalizedRequest.releaseTag);

  const releasePath = path.join(getAppUpdatesPath(), sanitizePathSegment(normalizedRequest.releaseTag, 'release'));
  const fileName = sanitizePathSegment(normalizedRequest.asset.name, 'update');
  const finalPath = path.join(releasePath, fileName);
  const partialPath = `${finalPath}.download`;

  await mkdir(releasePath, { recursive: true });
  await rm(partialPath, { force: true });

  const response = await fetch(normalizedRequest.asset.downloadUrl, {
    headers: {
      Accept: 'application/octet-stream,*/*',
      'User-Agent': GITHUB_USER_AGENT,
    },
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');

    throw new Error(text || `Update download failed with HTTP ${response.status}.`);
  }

  const hash = createHash('sha256');
  let receivedBytes = 0;
  const totalBytes = getResponseContentLength(response) ?? (normalizedRequest.asset.size > 0 ? normalizedRequest.asset.size : null);
  const digestStream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      hash.update(chunk);
      publishDownloadProgress({
        action: 'downloading',
        fileName,
        message: 'Downloading Qortium Home update',
        percent: totalBytes ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : null,
        receivedBytes,
        releaseTag: normalizedRequest.releaseTag,
        totalBytes,
      });
      callback(null, chunk);
    },
  });

  publishDownloadProgress({
    action: 'downloading',
    fileName,
    message: 'Downloading Qortium Home update',
    percent: 0,
    receivedBytes: 0,
    releaseTag: normalizedRequest.releaseTag,
    totalBytes,
  });

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    digestStream,
    createWriteStream(partialPath),
  );

  publishDownloadProgress({
    action: 'verifying',
    fileName,
    message: 'Verifying Qortium Home update',
    percent: 100,
    receivedBytes,
    releaseTag: normalizedRequest.releaseTag,
    totalBytes,
  });

  const digest = `sha256:${hash.digest('hex')}`;

  if (normalizedRequest.asset.digest && normalizedRequest.asset.digest !== digest) {
    await rm(partialPath, { force: true });
    throw new Error('Downloaded update did not match the expected GitHub asset digest.');
  }

  await rm(finalPath, { force: true });
  await rename(partialPath, finalPath);

  if (/\.appimage$/i.test(finalPath)) {
    await chmod(finalPath, 0o755).catch(() => undefined);
  }

  const fileStatus = await stat(finalPath);

  return {
    canOpen: true,
    canReveal: true,
    digest,
    digestVerified: normalizedRequest.asset.digest === digest,
    downloadedAt: new Date().toISOString(),
    fileName,
    filePath: finalPath,
    releaseTag: normalizedRequest.releaseTag,
    size: fileStatus.size || receivedBytes,
  };
}

function normalizeDownloadedFilePath(value: unknown) {
  const filePath = getString(value);
  const updatesPath = getAppUpdatesPath();
  const relativePath = path.relative(updatesPath, filePath);

  if (!filePath || path.isAbsolute(relativePath) || relativePath.startsWith('..') || !existsSync(filePath)) {
    throw new Error('Downloaded update file was not found.');
  }

  return filePath;
}

async function openDownloadedFile(value: unknown) {
  const message = await shell.openPath(normalizeDownloadedFilePath(value));

  if (message) {
    throw new Error(message);
  }
}

function showDownloadedFile(value: unknown) {
  shell.showItemInFolder(normalizeDownloadedFilePath(value));
}

export function registerAppUpdateIpcHandlers() {
  ipcMain.handle('updates:downloadAsset', (_event, request: AppUpdateDownloadRequest = {}) => downloadAsset(request));
  ipcMain.handle('updates:getEnvironment', () => getUpdateEnvironment());
  ipcMain.handle('updates:openDownloadedFile', (_event, filePath: unknown) => openDownloadedFile(filePath));
  ipcMain.handle('updates:openReleasePage', (_event, url: unknown) => openExternalUrl(url));
  ipcMain.handle('updates:showDownloadedFile', (_event, filePath: unknown) => showDownloadedFile(filePath));
}
