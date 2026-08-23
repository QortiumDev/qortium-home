import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { open as openZip, type Entry, type ZipFile } from 'yauzl'

const FILE_TYPE_MASK = 0o170000
const DIRECTORY_TYPE = 0o040000
const REGULAR_FILE_TYPE = 0o100000
const SYMBOLIC_LINK_TYPE = 0o120000

export interface SafeZipExtractionOptions {
  readonly defaultDirMode?: number
  readonly defaultFileMode?: number
  readonly dir: string
  readonly onEntry?: (entry: Entry, zipFile: ZipFile) => void
}

function unsafeEntry(message: string, entryName: string) {
  return new Error(`Unsafe ZIP entry ${JSON.stringify(entryName)}: ${message}`)
}

export function assertSafeZipEntry(entry: Pick<Entry, 'externalFileAttributes' | 'fileName'>) {
  const name = entry.fileName
  if (!name || name.includes('\\') || name.includes('\0') || name.includes(':') || path.posix.isAbsolute(name)) {
    throw unsafeEntry('the path is not a portable relative path', name)
  }
  const withoutTrailingSlash = name.endsWith('/') ? name.slice(0, -1) : name
  if (
    !withoutTrailingSlash ||
    path.posix.normalize(withoutTrailingSlash) !== withoutTrailingSlash ||
    withoutTrailingSlash.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw unsafeEntry('the path is not normalized beneath the extraction root', name)
  }

  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  const fileType = unixMode & FILE_TYPE_MASK
  if (fileType === SYMBOLIC_LINK_TYPE) {
    throw unsafeEntry('symbolic links are not allowed', name)
  }
  if (fileType !== 0 && fileType !== DIRECTORY_TYPE && fileType !== REGULAR_FILE_TYPE) {
    throw unsafeEntry('only regular files and directories are allowed', name)
  }
}

function openArchive(zipPath: string) {
  return new Promise<ZipFile>((resolve, reject) => {
    openZip(zipPath, {
      autoClose: true,
      decodeStrings: true,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    }, (error, zipFile) => {
      if (error) reject(error)
      else resolve(zipFile)
    })
  })
}

function openEntryStream(zipFile: ZipFile, entry: Entry) {
  return new Promise<NodeJS.ReadableStream>((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) reject(error)
      else resolve(stream)
    })
  })
}

async function ensureDirectory(root: string, segments: readonly string[], mode: number) {
  let current = root
  for (const segment of segments) {
    current = path.join(current, segment)
    try {
      await mkdir(current, { mode })
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    }
    const stats = await lstat(current)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`ZIP extraction directory is not a real directory: ${current}`)
    }
  }
}

async function extractEntry(
  root: string,
  zipFile: ZipFile,
  entry: Entry,
  options: SafeZipExtractionOptions,
) {
  options.onEntry?.(entry, zipFile)
  assertSafeZipEntry(entry)
  if (entry.fileName.startsWith('__MACOSX/')) return

  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  const madeBy = entry.versionMadeBy >>> 8
  const fileType = unixMode & FILE_TYPE_MASK
  const isDirectory =
    entry.fileName.endsWith('/') ||
    fileType === DIRECTORY_TYPE ||
    (madeBy === 0 && entry.externalFileAttributes === 16)
  const segments = entry.fileName.replace(/\/$/, '').split('/')
  const destination = path.resolve(root, ...segments)
  const relative = path.relative(root, destination)
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw unsafeEntry('the resolved path escaped the extraction root', entry.fileName)
  }

  const directoryMode = (options.defaultDirMode ?? 0o755) & 0o777
  const fileMode = ((unixMode || options.defaultFileMode || 0o644) & 0o777)
  await ensureDirectory(root, isDirectory ? segments : segments.slice(0, -1), directoryMode)
  if (isDirectory) return

  const readStream = await openEntryStream(zipFile, entry)
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0)
  const destinationHandle = await open(destination, flags, fileMode)
  await pipeline(readStream, destinationHandle.createWriteStream({ autoClose: true }))
}

/**
 * Extracts into a caller-owned disposable target. If extraction fails, the
 * target directory and every partial output beneath it are removed.
 */
export async function extractZipSafely(zipPath: string, options: SafeZipExtractionOptions) {
  if (!path.isAbsolute(options.dir)) {
    throw new Error('ZIP extraction target must be an absolute path.')
  }
  await mkdir(options.dir, { recursive: true })
  const targetStats = await lstat(options.dir)
  if (targetStats.isSymbolicLink() || !targetStats.isDirectory()) {
    throw new Error('ZIP extraction target must be a real directory.')
  }
  const root = await realpath(options.dir)
  const zipFile = await openArchive(zipPath)

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const succeed = () => {
        if (settled) return
        settled = true
        zipFile.close()
        resolve()
      }
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        zipFile.close()
        reject(error)
      }
      zipFile.once('error', fail)
      zipFile.once('end', succeed)
      zipFile.on('entry', (entry: Entry) => {
        void extractEntry(root, zipFile, entry, options)
          .then(() => {
            if (zipFile.entriesRead >= zipFile.entryCount) succeed()
            else zipFile.readEntry()
          })
          .catch(fail)
      })
      zipFile.readEntry()
    })
  } catch (error) {
    try {
      await rm(root, { force: true, recursive: true })
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'ZIP extraction failed and partial output could not be removed.')
    }
    throw error
  }
}
