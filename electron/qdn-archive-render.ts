import { app } from 'electron';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { access, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import extract from 'extract-zip';

const ARCHIVE_RENDER_DIR = 'qdn-archive-render';
const ARCHIVE_FILENAME = 'resource.zip';
const CONTENTS_DIR = 'contents';
// Conventional entry files, in priority order. Mirrors Core's ArbitraryDataRenderer
// index-file fallback so desktop inline rendering matches the node's /render behavior.
const INDEX_FILENAMES = ['index.html', 'index.htm', 'default.html', 'default.htm', 'home.html', 'home.htm'];

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

async function directoryHasEntries(directoryPath: string) {
  try {
    return (await readdir(directoryPath)).length > 0;
  } catch {
    return false;
  }
}

// Resolves the entry/fallback file for an extracted archive: a declared entryPoint
// (Core v1.1.0 metadata, when it safely resolves inside the archive) takes
// precedence, otherwise the first conventional index file that exists. Returns the
// absolute path, or undefined when the archive has no usable entry file.
async function resolveEntryFilePath(contentsDir: string, entryPoint?: string) {
  const resolvedContentsDir = await realpath(contentsDir);

  const normalizedEntryPoint = entryPoint ? normalizeArchivePath(entryPoint) : '';

  if (normalizedEntryPoint) {
    const candidatePath = path.resolve(path.join(contentsDir, normalizedEntryPoint));

    if (isPathInsideDirectory(candidatePath, resolvedContentsDir) && (await pathExists(candidatePath))) {
      return candidatePath;
    }
  }

  for (const indexFilename of INDEX_FILENAMES) {
    const indexPath = path.join(contentsDir, indexFilename);

    if (await pathExists(indexPath)) {
      return indexPath;
    }
  }

  return undefined;
}

async function getArchiveRenderTargetPath(contentsDir: string, resourcePath: string, fallbackPath: string) {
  const { pathOnly, queryString } = splitPathAndQuery(resourcePath);
  const normalizedPath = normalizeArchivePath(pathOnly);

  if (!normalizedPath) {
    return {
      filePath: fallbackPath,
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
    filePath: fallbackPath,
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
  entryPoint?: string,
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

  if (!(await directoryHasEntries(contentsDir))) {
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

  const fallbackPath = await resolveEntryFilePath(contentsDir, entryPoint);

  if (!fallbackPath) {
    throw new Error('QDN archive did not contain an index.html or a declared entry point.');
  }

  const target = await getArchiveRenderTargetPath(contentsDir, resource.path, fallbackPath);

  return {
    renderUrl: buildFileUrl(target.filePath, target.queryString),
  };
}
