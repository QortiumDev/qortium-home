import { app } from 'electron';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { access, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import extract from 'extract-zip';

const ARCHIVE_RENDER_DIR = 'qdn-archive-render';
const ARCHIVE_FILENAME = 'resource.zip';
const CONTENTS_DIR = 'contents';
const INDEX_FILENAME = 'index.html';

type QdnArchiveRenderResource = {
  identifier?: string;
  name: string;
  path: string;
  service: string;
};

export type QdnArchiveRenderResult = {
  renderUrl: string;
};

function getHash(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function getResolvedArchiveRenderRoot() {
  return path.resolve(app.getPath('userData'), ARCHIVE_RENDER_DIR);
}

export function getQdnArchiveRenderRoot() {
  return getResolvedArchiveRenderRoot();
}

function getRealPathIfAvailable(filePath: string) {
  try {
    return realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function isPathInsideDirectory(filePath: string, directoryPath: string) {
  const relativePath = path.relative(directoryPath, filePath);

  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

export function isManagedQdnArchiveRenderUrl(rawUrl: string) {
  let filePath: string;

  try {
    const url = new URL(rawUrl);

    if (url.protocol !== 'file:') {
      return false;
    }

    filePath = fileURLToPath(url);
  } catch {
    return false;
  }

  const rootPath = getRealPathIfAvailable(getQdnArchiveRenderRoot());
  const targetPath = getRealPathIfAvailable(filePath);

  return isPathInsideDirectory(targetPath, rootPath);
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

function normalizeArchivePath(resourcePath: string) {
  const trimmedPath = resourcePath.replace(/^\/+/, '');

  if (!trimmedPath) {
    return '';
  }

  const normalizedPath = path.posix.normalize(trimmedPath);

  if (
    normalizedPath === '..' ||
    normalizedPath.startsWith('../') ||
    normalizedPath.includes('/../')
  ) {
    return '';
  }

  return normalizedPath === '.' ? '' : normalizedPath;
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getArchiveRenderTargetPath(contentsDir: string, resourcePath: string) {
  const indexPath = path.join(contentsDir, INDEX_FILENAME);
  const { pathOnly, queryString } = splitPathAndQuery(resourcePath);
  const normalizedPath = normalizeArchivePath(pathOnly);

  if (!normalizedPath) {
    return {
      filePath: indexPath,
      queryString,
    };
  }

  const candidatePath = path.join(contentsDir, normalizedPath);
  const resolvedContentsDir = await realpath(contentsDir);
  const resolvedCandidatePath = path.resolve(candidatePath);

  if (
    isPathInsideDirectory(resolvedCandidatePath, resolvedContentsDir) &&
    await pathExists(resolvedCandidatePath)
  ) {
    return {
      filePath: resolvedCandidatePath,
      queryString,
    };
  }

  return {
    filePath: indexPath,
    queryString,
  };
}

function buildFileUrl(filePath: string, queryString: string) {
  const url = pathToFileURL(filePath);

  if (queryString) {
    url.search = `?${queryString}`;
  }

  return url.toString();
}

export async function prepareQdnArchiveRender(
  resource: QdnArchiveRenderResource,
  archiveBuffer: Buffer,
): Promise<QdnArchiveRenderResult> {
  const resourceHash = getHash(
    JSON.stringify({
      identifier: resource.identifier ?? '',
      name: resource.name,
      path: resource.path,
      service: resource.service,
    }),
  ).slice(0, 12);
  const contentHash = getHash(archiveBuffer);
  const cacheDir = path.join(getQdnArchiveRenderRoot(), `${resource.service.toLowerCase()}-${resourceHash}-${contentHash}`);
  const contentsDir = path.join(cacheDir, CONTENTS_DIR);
  const indexPath = path.join(contentsDir, INDEX_FILENAME);

  if (!(await pathExists(indexPath))) {
    const archivePath = path.join(cacheDir, ARCHIVE_FILENAME);

    await rm(cacheDir, { force: true, recursive: true });
    await mkdir(contentsDir, { recursive: true });
    await writeFile(archivePath, archiveBuffer);

    try {
      await extract(archivePath, { dir: contentsDir });
    } finally {
      await rm(archivePath, { force: true });
    }
  }

  if (!(await pathExists(indexPath))) {
    throw new Error('QDN archive app did not contain a top-level index.html file.');
  }

  const target = await getArchiveRenderTargetPath(contentsDir, resource.path);

  return {
    renderUrl: buildFileUrl(target.filePath, target.queryString),
  };
}
