import { createHash, randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { extractZipSafely } from './safe-zip-extraction.js'
import { extract as extractTar } from 'tar'
import {
  classifyI2pdRelease,
  getPinnedI2pdRelease,
  getTrustedI2pdReleases,
  resolveI2pdReleaseTarget,
  type I2pdPinnedRelease,
  type I2pdReleaseTarget,
} from './i2pd-release-policy.js'

const CURRENT_RECORD_NAME = 'current.json'
const GENERATION_RECORD_NAME = '.qortium-home-i2pd-generation.json'
const RECORD_SCHEMA = 'qortium-home-i2pd-managed-install'
const RECORD_REVISION = 1
const MAX_RECORD_BYTES = 64 * 1024
const DOWNLOAD_TIMEOUT_MS = 30_000
const MAX_REDIRECTS = 5
const SHA256 = /^[a-f0-9]{64}$/
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-q([1-9]\d*)$/

export type I2pdManagedInstallPaths = Readonly<{
  basePath: string
  currentRecordPath: string
  downloadsPath: string
  runtimePath: string
  versionsPath: string
}>

export type I2pdManagedInstallRecordV1 = Readonly<{
  archiveSha256: string
  archiveSize: number
  archiveType: 'tar.gz' | 'zip'
  assetName: string
  binaryName: 'i2pd' | 'i2pd.exe'
  binaryRelativePath: string
  binarySha256: string
  binarySize: number
  generation: string
  installedAt: string
  revision: 1
  schema: typeof RECORD_SCHEMA
  target: I2pdReleaseTarget
  version: string
}>

export type I2pdManagedInstall = Readonly<{
  binaryPath: string
  generationPath: string
  paths: I2pdManagedInstallPaths
  record: I2pdManagedInstallRecordV1
}>

export type I2pdLegacyManagedInstall = Readonly<{
  paths: I2pdManagedInstallPaths
  version: string
}>

export type I2pdManagedInstallResult = Readonly<{
  install: I2pdManagedInstall
  kind: 'installed' | 'migrated-legacy' | 'reused-generation' | 'already-current'
}>

export type I2pdArchiveExtractor = (input: Readonly<{
  archivePath: string
  destinationPath: string
  release: I2pdPinnedRelease
}>) => Promise<void>

export type I2pdManagedInstallDependencies = Readonly<{
  beforeActivate?: (record: I2pdManagedInstallRecordV1) => Promise<void> | void
  extractArchive?: I2pdArchiveExtractor
  fetch?: typeof fetch
  now?: () => Date
  randomToken?: () => string
  resolveRelease?: typeof getPinnedI2pdRelease
  timeoutMs?: number
}>

export class I2pdManagedInstallError extends Error {
  constructor(
    readonly code:
      | 'activation-failed'
      | 'archive-invalid'
      | 'download-failed'
      | 'download-invalid'
      | 'installed-newer'
      | 'record-invalid'
      | 'target-unsupported',
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options)
    this.name = 'I2pdManagedInstallError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
}

function errorCode(error: unknown) {
  return error instanceof Error && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined
}

function safeToken(value: string) {
  if (!/^[a-f0-9]{16,128}$/i.test(value)) {
    throw new I2pdManagedInstallError('activation-failed', 'The installer token was invalid.')
  }
  return value.toLowerCase()
}

function defaultToken() {
  return randomBytes(16).toString('hex')
}

function generationName(input: Pick<I2pdManagedInstallRecordV1,
  'archiveSha256' | 'target' | 'version'>) {
  return `${input.version}-${input.target}-${input.archiveSha256}`
}

function expectedAssetName(
  version: string,
  target: I2pdReleaseTarget,
  archiveType: 'tar.gz' | 'zip',
) {
  return `i2pd-${version}-${target}.${archiveType}`
}

function expectedBinaryName(target: I2pdReleaseTarget) {
  return target.startsWith('windows-') ? 'i2pd.exe' as const : 'i2pd' as const
}

function recordMatchesRelease(
  record: I2pdManagedInstallRecordV1,
  release: I2pdPinnedRelease,
) {
  return record.version === release.version &&
    record.target === release.target &&
    record.archiveType === release.archiveType &&
    record.assetName === release.assetName &&
    record.archiveSha256 === release.sha256 &&
    record.archiveSize === release.size &&
    record.binaryName === release.binaryName
}

function normalizeRelativePath(value: string) {
  if (!value || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value)) return null
  const normalized = path.posix.normalize(value)
  if (normalized !== value || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null
  return normalized
}

function isCanonicalTimestamp(value: string) {
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}

function parseRecord(value: unknown, expectedTarget: I2pdReleaseTarget): I2pdManagedInstallRecordV1 {
  if (!isRecord(value) || !hasExactKeys(value, [
    'archiveSha256',
    'archiveSize',
    'archiveType',
    'assetName',
    'binaryName',
    'binaryRelativePath',
    'binarySha256',
    'binarySize',
    'generation',
    'installedAt',
    'revision',
    'schema',
    'target',
    'version',
  ]) || value.schema !== RECORD_SCHEMA || value.revision !== RECORD_REVISION ||
    value.target !== expectedTarget || typeof value.version !== 'string' || !VERSION.test(value.version) ||
    (value.archiveType !== 'tar.gz' && value.archiveType !== 'zip') ||
    typeof value.assetName !== 'string' ||
    value.assetName !== expectedAssetName(value.version, expectedTarget, value.archiveType) ||
    typeof value.archiveSha256 !== 'string' || !SHA256.test(value.archiveSha256) ||
    !Number.isSafeInteger(value.archiveSize) || Number(value.archiveSize) <= 0 ||
    value.binaryName !== expectedBinaryName(expectedTarget) ||
    typeof value.binaryRelativePath !== 'string' ||
    normalizeRelativePath(value.binaryRelativePath) !== value.binaryRelativePath ||
    path.posix.basename(value.binaryRelativePath) !== value.binaryName ||
    typeof value.binarySha256 !== 'string' || !SHA256.test(value.binarySha256) ||
    !Number.isSafeInteger(value.binarySize) || Number(value.binarySize) <= 0 ||
    typeof value.generation !== 'string' || value.generation !== generationName({
      archiveSha256: value.archiveSha256,
      target: expectedTarget,
      version: value.version,
    }) || typeof value.installedAt !== 'string' || !isCanonicalTimestamp(value.installedAt)) {
    throw new I2pdManagedInstallError('record-invalid', 'The managed i2pd record was rejected.')
  }
  return Object.freeze({
    archiveSha256: value.archiveSha256,
    archiveSize: Number(value.archiveSize),
    archiveType: value.archiveType,
    assetName: value.assetName,
    binaryName: expectedBinaryName(expectedTarget),
    binaryRelativePath: value.binaryRelativePath,
    binarySha256: value.binarySha256,
    binarySize: Number(value.binarySize),
    generation: value.generation,
    installedAt: value.installedAt,
    revision: 1,
    schema: RECORD_SCHEMA,
    target: expectedTarget,
    version: value.version,
  })
}

export function resolveI2pdManagedInstallPaths(basePath: string): I2pdManagedInstallPaths {
  if (typeof basePath !== 'string' || !path.isAbsolute(basePath) || path.resolve(basePath) !== basePath) {
    throw new I2pdManagedInstallError('record-invalid', 'The managed i2pd base path must be absolute and normalized.')
  }
  return Object.freeze({
    basePath,
    currentRecordPath: path.join(basePath, CURRENT_RECORD_NAME),
    downloadsPath: path.join(basePath, 'downloads'),
    runtimePath: path.join(basePath, 'runtime'),
    versionsPath: path.join(basePath, 'versions'),
  })
}

async function validatePrivateDirectory(targetPath: string, create: boolean) {
  if (create) await mkdir(targetPath, { mode: 0o700, recursive: false }).catch((error) => {
    if (errorCode(error) !== 'EEXIST') throw error
  })
  const stats = await lstat(targetPath)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new I2pdManagedInstallError('record-invalid', 'A managed i2pd directory was not a real directory.')
  }
  if (process.platform !== 'win32') {
    const uid = process.getuid?.()
    if (uid !== undefined && stats.uid !== uid) {
      throw new I2pdManagedInstallError('record-invalid', 'A managed i2pd directory has the wrong owner.')
    }
    await chmod(targetPath, 0o700)
    const secured = await lstat(targetPath)
    if ((secured.mode & 0o777) !== 0o700) {
      throw new I2pdManagedInstallError('record-invalid', 'A managed i2pd directory is not private.')
    }
  }
}

async function ensureLayout(paths: I2pdManagedInstallPaths) {
  await mkdir(paths.basePath, { mode: 0o700, recursive: true })
  await validatePrivateDirectory(paths.basePath, false)
  for (const child of [paths.downloadsPath, paths.versionsPath, paths.runtimePath]) {
    await validatePrivateDirectory(child, true)
    const relative = path.relative(await realpath(paths.basePath), await realpath(child))
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new I2pdManagedInstallError('record-invalid', 'A managed i2pd directory escaped its private base.')
    }
  }
  await sweepInterruptedArtifacts(paths)
}

/**
 * A process killed mid-install never runs its `finally`, so partial archives
 * and staging trees survive with a fresh random token on every retry. They are
 * disposable by construction: sweep them whenever the layout is ensured.
 */
async function sweepInterruptedArtifacts(paths: I2pdManagedInstallPaths) {
  for (const [directory, isDisposable] of [
    [paths.downloadsPath, (name: string) => name.startsWith('.') && name.endsWith('.part')],
    [paths.versionsPath, (name: string) => name.startsWith('.staging-')],
  ] as const) {
    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch {
      continue
    }
    for (const name of entries) {
      if (!isDisposable(name)) continue
      await rm(path.join(directory, name), { force: true, recursive: true }).catch(() => undefined)
    }
  }
}

/**
 * Every installed generation that still validates against Home's trusted
 * catalogue, newest-pinned first. The current record is the only pointer to an
 * install, so without this scan a dangling pointer hides a perfectly good
 * router that is sitting on disk.
 */
async function listValidTrustedGenerations(
  paths: I2pdManagedInstallPaths,
  target: I2pdReleaseTarget,
  trustedReleases: readonly I2pdPinnedRelease[],
): Promise<readonly I2pdManagedInstall[]> {
  let entries: string[]
  try {
    entries = await readdir(paths.versionsPath)
  } catch {
    return []
  }
  const found: { install: I2pdManagedInstall; rank: number }[] = []
  for (const name of entries) {
    if (name.startsWith('.')) continue
    let record: I2pdManagedInstallRecordV1
    try {
      record = await readGenerationRecord(path.join(paths.versionsPath, name), target)
    } catch {
      continue
    }
    if (record.generation !== name) continue
    const rank = trustedReleases.findIndex((release) => recordMatchesRelease(record, release))
    if (rank < 0) continue
    try {
      found.push({ install: await validateGeneration(paths, target, record), rank })
    } catch {
      continue
    }
  }
  return Object.freeze(found.sort((left, right) => left.rank - right.rank).map((entry) => entry.install))
}

async function validateExistingLayout(paths: I2pdManagedInstallPaths) {
  try {
    await validatePrivateDirectory(paths.basePath, false)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
  for (const child of [paths.downloadsPath, paths.versionsPath, paths.runtimePath]) {
    try {
      await validatePrivateDirectory(child, false)
    } catch (error) {
      // A subdirectory deleted by hand means "not laid out yet", exactly like a
      // missing base path. Throwing here used to brick the maintenance panel:
      // the only code that recreates these directories is ensureLayout, which
      // is reachable only through an install the broken state disabled.
      if (errorCode(error) === 'ENOENT') return false
      throw error
    }
  }
  return true
}

async function readBoundedFile(targetPath: string, maxBytes: number) {
  const before = await lstat(targetPath)
  if (!before.isFile() || before.isSymbolicLink() || before.size < 0 || before.size > maxBytes) {
    throw new I2pdManagedInstallError('record-invalid', 'A managed i2pd record was not a bounded regular file.')
  }
  if (process.platform !== 'win32') {
    const uid = process.getuid?.()
    if (uid !== undefined && before.uid !== uid) {
      throw new I2pdManagedInstallError('record-invalid', 'A managed i2pd record has the wrong owner.')
    }
  }
  const handle = await open(targetPath, 'r')
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size !== before.size || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new I2pdManagedInstallError('record-invalid', 'A managed i2pd record changed while it was opened.')
    }
    const buffer = Buffer.alloc(opened.size)
    let position = 0
    while (position < opened.size) {
      const { bytesRead } = await handle.read(buffer, position, opened.size - position, position)
      if (bytesRead <= 0) {
        throw new I2pdManagedInstallError('record-invalid', 'A managed i2pd record was truncated.')
      }
      position += bytesRead
    }
    const after = await handle.stat()
    if (after.size !== opened.size || after.dev !== opened.dev || after.ino !== opened.ino ||
      after.mtimeMs !== opened.mtimeMs) {
      throw new I2pdManagedInstallError('record-invalid', 'A managed i2pd record changed while it was read.')
    }
    return Object.freeze({ bytes: buffer.toString('utf8'), mode: opened.mode })
  } finally {
    await handle.close()
  }
}

function requirePrivateRecordMode(mode: number) {
  if (process.platform !== 'win32' && (mode & 0o077) !== 0) {
    throw new I2pdManagedInstallError('record-invalid', 'A managed i2pd record was not private.')
  }
}

function isExactLegacyCurrentRecord(
  value: unknown,
  paths: I2pdManagedInstallPaths,
  release: I2pdPinnedRelease,
) {
  if (!isRecord(value) || !hasExactKeys(value, [
    'asset', 'binaryPath', 'installedAt', 'sha256', 'target', 'version',
  ]) || value.version !== release.version || value.target !== release.target ||
    value.asset !== release.assetName || value.sha256 !== release.sha256 ||
    typeof value.installedAt !== 'string' || !isCanonicalTimestamp(value.installedAt) ||
    typeof value.binaryPath !== 'string' || value.binaryPath.includes('\0')) return false

  const expected = path.join(
    paths.versionsPath,
    `${release.version}-${release.target}`,
    release.binaryName,
  )
  const candidate = path.resolve(value.binaryPath)
  const expectedResolved = path.resolve(expected)
  return process.platform === 'win32'
    ? candidate.toLowerCase() === expectedResolved.toLowerCase()
    : candidate === expectedResolved
}

async function readI2pdLegacyManagedInstallForRelease(input: Readonly<{
  arch: string
  basePath: string
  platform: string
}>, release: I2pdPinnedRelease): Promise<I2pdLegacyManagedInstall | null> {
  const paths = resolveI2pdManagedInstallPaths(input.basePath)
  if (!(await validateExistingLayout(paths))) return null
  try {
    const file = await readBoundedFile(paths.currentRecordPath, MAX_RECORD_BYTES)
    const parsed = JSON.parse(file.bytes) as unknown
    return isExactLegacyCurrentRecord(parsed, paths, release)
      ? Object.freeze({ paths, version: release.version })
      : null
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

export async function readI2pdLegacyManagedInstall(input: Readonly<{
  arch: string
  basePath: string
  platform: string
}>): Promise<I2pdLegacyManagedInstall | null> {
  for (const release of getTrustedI2pdReleases(input.platform, input.arch)) {
    const legacy = await readI2pdLegacyManagedInstallForRelease(input, release)
    if (legacy) return legacy
  }
  return null
}

async function writeAtomicPrivateJson(targetPath: string, value: unknown, token: string) {
  const temporaryPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${token}.tmp`)
  const handle = await open(temporaryPath, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => undefined)
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
  await handle.close()
  if (process.platform !== 'win32') await chmod(temporaryPath, 0o600)
  try {
    await rename(temporaryPath, targetPath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function hashRegularFile(targetPath: string) {
  const before = await lstat(targetPath)
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0) {
    throw new I2pdManagedInstallError('archive-invalid', 'The managed i2pd binary was not a regular file.')
  }
  const handle = await open(targetPath, 'r')
  const hash = createHash('sha256')
  let position = 0
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw new I2pdManagedInstallError('archive-invalid', 'The managed i2pd binary changed while it was opened.')
    }
    const buffer = Buffer.allocUnsafe(64 * 1024)
    while (position < opened.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, opened.size - position), position)
      if (bytesRead <= 0) throw new I2pdManagedInstallError('archive-invalid', 'The managed i2pd binary was truncated.')
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    const after = await handle.stat()
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) {
      throw new I2pdManagedInstallError('archive-invalid', 'The managed i2pd binary changed during verification.')
    }
    return Object.freeze({ sha256: hash.digest('hex'), size: opened.size })
  } finally {
    await handle.close()
  }
}

async function inspectExtractedTree(rootPath: string, binaryName: string) {
  const binaries: string[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name)
      const stats = await lstat(candidate)
      if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) {
        throw new I2pdManagedInstallError('archive-invalid', 'The i2pd archive contained an unsafe entry.')
      }
      if (stats.isDirectory()) await visit(candidate)
      else if (entry.name === binaryName) binaries.push(candidate)
    }
  }
  await visit(rootPath)
  if (binaries.length !== 1) {
    throw new I2pdManagedInstallError('archive-invalid', 'The i2pd archive must contain exactly one expected binary.')
  }
  return binaries[0]
}

function safeArchiveEntryName(value: string) {
  if (!value || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value)) return false
  const withoutTrailingSlash = value.endsWith('/') ? value.slice(0, -1) : value
  return !!withoutTrailingSlash && path.posix.normalize(withoutTrailingSlash) === withoutTrailingSlash &&
    withoutTrailingSlash !== '..' && !withoutTrailingSlash.startsWith('../')
}

async function defaultExtractArchive({ archivePath, destinationPath, release }: Parameters<I2pdArchiveExtractor>[0]) {
  if (release.archiveType === 'zip') {
    await extractZipSafely(archivePath, {
      dir: destinationPath,
      onEntry(entry) {
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
        if (!safeArchiveEntryName(entry.fileName) || (unixMode & 0o170000) === 0o120000) {
          throw new I2pdManagedInstallError('archive-invalid', 'The i2pd ZIP contained an unsafe entry.')
        }
      },
    })
  } else {
    await extractTar({
      cwd: destinationPath,
      file: archivePath,
      filter(entryPath, entry) {
        const entryType = 'type' in entry ? entry.type : null
        if (!safeArchiveEntryName(entryPath) || (entryType !== 'File' && entryType !== 'Directory')) {
          throw new I2pdManagedInstallError('archive-invalid', 'The i2pd tarball contained an unsafe entry.')
        }
        return true
      },
      preservePaths: false,
      strict: true,
    })
  }
}

function trustedDownloadUrl(candidate: URL, release: I2pdPinnedRelease) {
  if (candidate.protocol !== 'https:' || candidate.port || candidate.username || candidate.password || candidate.hash) return false
  const original = new URL(release.downloadUrl)
  if (candidate.hostname === 'github.com') {
    return candidate.pathname === original.pathname && candidate.search === ''
  }
  return candidate.hostname === 'release-assets.githubusercontent.com' ||
    candidate.hostname === 'objects.githubusercontent.com'
}

async function fetchWithTrustedRedirects(
  release: I2pdPinnedRelease,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
) {
  let current = new URL(release.downloadUrl)
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!trustedDownloadUrl(current, release)) {
      throw new I2pdManagedInstallError('download-failed', 'The i2pd download redirect was rejected.')
    }
    const response = await fetchImpl(current, {
      headers: { Accept: 'application/octet-stream,*/*', 'User-Agent': 'QortiumHome/1.0' },
      redirect: 'manual',
      signal,
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    await response.body?.cancel().catch(() => undefined)
    const location = response.headers.get('location')
    if (!location || redirectCount === MAX_REDIRECTS) {
      throw new I2pdManagedInstallError('download-failed', 'The i2pd download redirect chain was rejected.')
    }
    current = new URL(location, current)
  }
  throw new I2pdManagedInstallError('download-failed', 'The i2pd download redirect chain was rejected.')
}

async function downloadPinnedArchive(
  release: I2pdPinnedRelease,
  destinationPath: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchWithTrustedRedirects(release, fetchImpl, controller.signal)
    if (!response.ok || !response.body) {
      throw new I2pdManagedInstallError('download-failed', 'The pinned i2pd archive was unavailable.')
    }
    const declared = response.headers.get('content-length')
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== release.size)) {
      await response.body.cancel().catch(() => undefined)
      throw new I2pdManagedInstallError('download-invalid', 'The pinned i2pd archive size was rejected.')
    }
    const hash = createHash('sha256')
    let received = 0
    const verifier = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.byteLength
        if (received > release.size) {
          callback(new I2pdManagedInstallError('download-invalid', 'The pinned i2pd archive exceeded its byte limit.'))
          return
        }
        hash.update(chunk)
        callback(null, chunk)
      },
    })
    try {
      await pipeline(
        Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
        verifier,
        createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 }),
      )
    } catch (error) {
      throw error instanceof I2pdManagedInstallError
        ? error
        : new I2pdManagedInstallError('download-failed', 'The pinned i2pd archive download failed.', { cause: error })
    }
    const digest = hash.digest('hex')
    if (received !== release.size || digest !== release.sha256) {
      throw new I2pdManagedInstallError('download-invalid', 'The pinned i2pd archive failed exact verification.')
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new I2pdManagedInstallError('download-failed', 'The pinned i2pd archive download timed out.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function stageVerifiedLegacyArchive(
  sourcePath: string,
  destinationPath: string,
  release: I2pdPinnedRelease,
) {
  let source: Awaited<ReturnType<typeof open>> | undefined
  let destination: Awaited<ReturnType<typeof open>> | undefined
  let staged = false
  try {
    const before = await lstat(sourcePath)
    if (!before.isFile() || before.isSymbolicLink() || before.size !== release.size) return false
    source = await open(sourcePath, 'r')
    const opened = await source.stat()
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
      opened.size !== before.size) return false

    destination = await open(destinationPath, 'wx', 0o600)
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let position = 0
    while (position < opened.size) {
      const { bytesRead } = await source.read(
        buffer,
        0,
        Math.min(buffer.length, opened.size - position),
        position,
      )
      if (bytesRead <= 0) return false
      hash.update(buffer.subarray(0, bytesRead))
      let written = 0
      while (written < bytesRead) {
        const result = await destination.write(buffer, written, bytesRead - written, position + written)
        if (result.bytesWritten <= 0) return false
        written += result.bytesWritten
      }
      position += bytesRead
    }

    const after = await source.stat()
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size ||
      hash.digest('hex') !== release.sha256) return false
    await destination.sync()
    if (process.platform !== 'win32') await destination.chmod(0o600)
    staged = true
    return true
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  } finally {
    await source?.close().catch(() => undefined)
    await destination?.close().catch(() => undefined)
    if (!staged) await rm(destinationPath, { force: true }).catch(() => undefined)
  }
}

function recordForRelease(
  release: I2pdPinnedRelease,
  binaryRelativePath: string,
  binary: Readonly<{ sha256: string; size: number }>,
  installedAt: string,
): I2pdManagedInstallRecordV1 {
  const generation = generationName({
    archiveSha256: release.sha256,
    target: release.target,
    version: release.version,
  })
  return Object.freeze({
    archiveSha256: release.sha256,
    archiveSize: release.size,
    archiveType: release.archiveType,
    assetName: release.assetName,
    binaryName: release.binaryName,
    binaryRelativePath,
    binarySha256: binary.sha256,
    binarySize: binary.size,
    generation,
    installedAt,
    revision: 1,
    schema: RECORD_SCHEMA,
    target: release.target,
    version: release.version,
  })
}

async function validateGeneration(
  paths: I2pdManagedInstallPaths,
  expectedTarget: I2pdReleaseTarget,
  record: I2pdManagedInstallRecordV1,
): Promise<I2pdManagedInstall> {
  const generationPath = path.join(paths.versionsPath, record.generation)
  const generationStats = await lstat(generationPath)
  if (!generationStats.isDirectory() || generationStats.isSymbolicLink()) {
    throw new I2pdManagedInstallError('record-invalid', 'The managed i2pd generation was not a real directory.')
  }
  const versionsRealPath = await realpath(paths.versionsPath)
  const generationRealPath = await realpath(generationPath)
  const relativeGeneration = path.relative(versionsRealPath, generationRealPath)
  if (!relativeGeneration || relativeGeneration.startsWith('..') || path.isAbsolute(relativeGeneration)) {
    throw new I2pdManagedInstallError('record-invalid', 'The managed i2pd generation escaped its versions directory.')
  }
  const binaryPath = path.join(generationPath, ...record.binaryRelativePath.split('/'))
  const binaryRealPath = await realpath(binaryPath)
  const relativeBinary = path.relative(generationRealPath, binaryRealPath)
  if (!relativeBinary || relativeBinary.startsWith('..') || path.isAbsolute(relativeBinary)) {
    throw new I2pdManagedInstallError('record-invalid', 'The managed i2pd binary escaped its generation.')
  }
  const discoveredBinary = await inspectExtractedTree(generationPath, record.binaryName)
  if (path.resolve(discoveredBinary) !== path.resolve(binaryPath)) {
    throw new I2pdManagedInstallError('record-invalid', 'The managed i2pd binary path did not match its generation record.')
  }
  const identity = await hashRegularFile(binaryPath)
  if (identity.size !== record.binarySize || identity.sha256 !== record.binarySha256) {
    throw new I2pdManagedInstallError('record-invalid', 'The managed i2pd binary did not match its generation record.')
  }
  if (record.target !== expectedTarget) {
    throw new I2pdManagedInstallError('record-invalid', 'The managed i2pd target did not match this host.')
  }
  return Object.freeze({ binaryPath, generationPath, paths, record })
}

async function readGenerationRecord(
  generationPath: string,
  expectedTarget: I2pdReleaseTarget,
) {
  try {
    const file = await readBoundedFile(path.join(generationPath, GENERATION_RECORD_NAME), MAX_RECORD_BYTES)
    requirePrivateRecordMode(file.mode)
    return parseRecord(JSON.parse(file.bytes) as unknown, expectedTarget)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') throw error
    if (error instanceof I2pdManagedInstallError) throw error
    throw new I2pdManagedInstallError('record-invalid', 'The managed i2pd generation record was unreadable.', { cause: error })
  }
}

async function readI2pdManagedInstallForRelease(input: Readonly<{
  arch: string
  basePath: string
  platform: string
}>, trustedReleases: readonly I2pdPinnedRelease[]): Promise<I2pdManagedInstall | null> {
  const target = resolveI2pdReleaseTarget(input.platform, input.arch)
  if (!target) throw new I2pdManagedInstallError('target-unsupported', 'Managed i2pd is unsupported on this target.')
  const paths = resolveI2pdManagedInstallPaths(input.basePath)
  if (!(await validateExistingLayout(paths))) return null
  let bytes: string
  let mode: number
  try {
    const file = await readBoundedFile(paths.currentRecordPath, MAX_RECORD_BYTES)
    bytes = file.bytes
    mode = file.mode
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
  let record: I2pdManagedInstallRecordV1
  try {
    const parsed = JSON.parse(bytes) as unknown
    if (trustedReleases.some((release) => isExactLegacyCurrentRecord(parsed, paths, release))) return null
    requirePrivateRecordMode(mode)
    record = parseRecord(parsed, target)
  } catch (error) {
    if (error instanceof I2pdManagedInstallError) throw error
    throw new I2pdManagedInstallError('record-invalid', 'The managed i2pd current record was unreadable.', { cause: error })
  }
  // A current record whose generation is missing, incomplete or no longer
  // self-consistent is a stale pointer, not a catastrophe. Reporting "nothing
  // installed" lets the maintenance panel offer Install again; throwing here
  // left the user with a status message and no action at all, and made every
  // reinstall attempt fail before it could download.
  try {
    const generationRecord = await readGenerationRecord(path.join(paths.versionsPath, record.generation), target)
    if (JSON.stringify(generationRecord) !== JSON.stringify(record)) return null
    return await validateGeneration(paths, target, record)
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || error instanceof I2pdManagedInstallError) return null
    throw error
  }
}

export async function readI2pdManagedInstall(input: Readonly<{
  arch: string
  basePath: string
  platform: string
}>): Promise<I2pdManagedInstall | null> {
  return await readI2pdManagedInstallForRelease(
    input,
    getTrustedI2pdReleases(input.platform, input.arch),
  )
}

/** Runtime authority gate: structural self-consistency alone is not enough to
 * execute a managed binary. The current record must match an exact descriptor
 * in Home's trusted old/new catalogue. */
export async function readTrustedI2pdManagedInstall(input: Readonly<{
  arch: string
  basePath: string
  platform: string
}>): Promise<I2pdManagedInstall | null> {
  const installed = await readI2pdManagedInstall(input)
  if (!installed) return null
  const trusted = getTrustedI2pdReleases(input.platform, input.arch)
    .some((release) => recordMatchesRelease(installed.record, release))
  if (!trusted) {
    throw new I2pdManagedInstallError(
      'record-invalid',
      'The managed i2pd current record was not an exact trusted release.',
    )
  }
  return installed
}

/**
 * Re-activates an already validated immutable generation. This is deliberately
 * narrower than installation: it performs no download or extraction and is
 * used by the manager to restore the previous trusted release after a failed
 * update readiness check.
 */
export async function activateTrustedI2pdGeneration(
  input: Readonly<{ arch: string; basePath: string; platform: string }>,
  expected: I2pdManagedInstall,
  dependencies: Pick<I2pdManagedInstallDependencies, 'randomToken'> = {},
): Promise<I2pdManagedInstall> {
  const target = resolveI2pdReleaseTarget(input.platform, input.arch)
  if (!target) throw new I2pdManagedInstallError('target-unsupported', 'Managed i2pd is unsupported on this target.')
  const paths = resolveI2pdManagedInstallPaths(input.basePath)
  if (expected.paths.basePath !== paths.basePath || expected.record.target !== target) {
    throw new I2pdManagedInstallError('record-invalid', 'The rollback i2pd generation did not match this installation.')
  }
  const release = getTrustedI2pdReleases(input.platform, input.arch)
    .find((candidate) => recordMatchesRelease(expected.record, candidate))
  if (!release) {
    throw new I2pdManagedInstallError('record-invalid', 'The rollback i2pd generation was not a trusted release.')
  }
  const validated = await validateGeneration(paths, target, expected.record)
  const token = safeToken((dependencies.randomToken ?? defaultToken)())
  await writeAtomicPrivateJson(paths.currentRecordPath, validated.record, token)
  return validated
}

async function discardOwnGeneration(generationPath: string) {
  await rm(generationPath, { force: true, recursive: true })
}

/** Sentinel: the caller's ENOENT handler resumes the normal download path. */
function incompleteGenerationDiscarded() {
  return Object.assign(new Error('Discarded an incomplete managed i2pd generation.'), { code: 'ENOENT' })
}

/**
 * Repairs a stale current record by re-pointing it at the newest trusted
 * generation already on disk. Performs no download, so it is the recovery a
 * user can run while offline, and it is what makes an existing older install
 * usable again after a failed update.
 */
export async function activateNewestTrustedI2pdGeneration(input: Readonly<{
  arch: string
  basePath: string
  platform: string
}>, dependencies: Pick<I2pdManagedInstallDependencies, 'randomToken'> = {}): Promise<I2pdManagedInstall | null> {
  const target = resolveI2pdReleaseTarget(input.platform, input.arch)
  if (!target) throw new I2pdManagedInstallError('target-unsupported', 'Managed i2pd is unsupported on this target.')
  const paths = resolveI2pdManagedInstallPaths(input.basePath)
  if (!(await validateExistingLayout(paths))) return null
  // The catalogue is not ordered newest-first, so put the pinned release at the
  // head: a repair should prefer the version Home would install today.
  const releases = getTrustedI2pdReleases(input.platform, input.arch)
  const pinned = getPinnedI2pdRelease(input.platform, input.arch)
  const [newest] = await listValidTrustedGenerations(
    paths,
    target,
    pinned ? [pinned, ...releases.filter((candidate) => candidate.version !== pinned.version)] : releases,
  )
  if (!newest) return null
  const token = safeToken((dependencies.randomToken ?? defaultToken)())
  await writeAtomicPrivateJson(paths.currentRecordPath, newest.record, token)
  return newest
}

export async function installPinnedI2pd(
  input: Readonly<{ arch: string; basePath: string; platform: string }>,
  dependencies: I2pdManagedInstallDependencies = {},
): Promise<I2pdManagedInstallResult> {
  const release = (dependencies.resolveRelease ?? getPinnedI2pdRelease)(input.platform, input.arch)
  if (!release) throw new I2pdManagedInstallError('target-unsupported', 'Managed i2pd is unsupported on this target.')
  const resolvedTarget = resolveI2pdReleaseTarget(input.platform, input.arch)
  if (!resolvedTarget || release.target !== resolvedTarget || release.binaryName !== expectedBinaryName(resolvedTarget) ||
    !VERSION.test(release.version) || !SHA256.test(release.sha256) ||
    !Number.isSafeInteger(release.size) || release.size <= 0 ||
    release.assetName !== expectedAssetName(release.version, resolvedTarget, release.archiveType) ||
    new URL(release.downloadUrl).pathname !==
      `/QortiumDev/qortium-i2pd/releases/download/${release.version}/${release.assetName}` ||
    !trustedDownloadUrl(new URL(release.downloadUrl), release)) {
    throw new I2pdManagedInstallError('target-unsupported', 'The managed i2pd release descriptor was rejected.')
  }
  const timeoutMs = dependencies.timeoutMs ?? DOWNLOAD_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > DOWNLOAD_TIMEOUT_MS) {
    throw new I2pdManagedInstallError('download-failed', 'The managed i2pd download timeout was rejected.')
  }
  const paths = resolveI2pdManagedInstallPaths(input.basePath)
  await ensureLayout(paths)
  const trustedReleases = getTrustedI2pdReleases(input.platform, input.arch)
  const existing = await readI2pdManagedInstallForRelease(
    input,
    [...trustedReleases, release],
  )
  const legacy = existing ? null : await readI2pdLegacyManagedInstallForRelease(input, release)
  if (existing) {
    if (existing.record.version === release.version) {
      if (!recordMatchesRelease(existing.record, release)) {
        throw new I2pdManagedInstallError('record-invalid', 'The current i2pd version did not match its pinned release.')
      }
      return Object.freeze({ install: existing, kind: 'already-current' })
    }
    const decision = classifyI2pdRelease(existing.record.version, input.platform, input.arch)
    if (decision.action !== 'install' && decision.action !== 'update') {
      throw new I2pdManagedInstallError('installed-newer', 'The pinned i2pd release would not be an upgrade.')
    }
  }

  const token = safeToken((dependencies.randomToken ?? defaultToken)())
  const generation = generationName({ archiveSha256: release.sha256, target: release.target, version: release.version })
  const generationPath = path.join(paths.versionsPath, generation)
  try {
    const existingGeneration = await lstat(generationPath)
    if (!existingGeneration.isDirectory() || existingGeneration.isSymbolicLink()) {
      throw new I2pdManagedInstallError('record-invalid', 'The immutable i2pd generation path was unsafe.')
    }
    // An interrupted install can leave the generation directory behind in a
    // state that used to refuse every later reinstall for good. Two shapes are
    // provably Home's own disposable work and are discarded so the install can
    // proceed: a directory that is completely empty, and one whose record
    // matches this exact release but whose tree no longer validates. Anything
    // else — unknown files, a record naming a different release — is still
    // refused rather than deleted, because Home cannot prove it owns it.
    let generationRecord: I2pdManagedInstallRecordV1 | null = null
    let recordError: unknown = null
    try {
      generationRecord = await readGenerationRecord(generationPath, release.target)
    } catch (error) {
      if (errorCode(error) !== 'ENOENT' && !(error instanceof I2pdManagedInstallError)) throw error
      recordError = error
    }
    const ownsGeneration = !!generationRecord && generationRecord.archiveSha256 === release.sha256 &&
      generationRecord.archiveSize === release.size && generationRecord.assetName === release.assetName
    if (generationRecord && ownsGeneration) {
      let install: I2pdManagedInstall
      try {
        install = await validateGeneration(paths, release.target, generationRecord)
      } catch {
        await discardOwnGeneration(generationPath)
        throw incompleteGenerationDiscarded()
      }
      await dependencies.beforeActivate?.(generationRecord)
      await writeAtomicPrivateJson(paths.currentRecordPath, generationRecord, token)
      return Object.freeze({ install, kind: legacy ? 'migrated-legacy' : 'reused-generation' })
    }
    if (!generationRecord && (await readdir(generationPath)).length === 0) {
      await discardOwnGeneration(generationPath)
      throw incompleteGenerationDiscarded()
    }
    if (recordError && errorCode(recordError) === 'ENOENT') {
      throw new I2pdManagedInstallError('record-invalid', 'The immutable i2pd generation was incomplete.')
    }
    if (recordError) throw recordError
    throw new I2pdManagedInstallError('record-invalid', 'The immutable i2pd generation did not match the pinned release.')
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }

  const archivePath = path.join(paths.downloadsPath, `.${release.assetName}.${token}.part`)
  const stagingPath = path.join(paths.versionsPath, `.staging-${generation}-${token}`)
  let staged = false
  try {
    const reusedLegacyArchive = legacy
      ? await stageVerifiedLegacyArchive(
          path.join(paths.downloadsPath, release.assetName),
          archivePath,
          release,
        )
      : false
    if (!reusedLegacyArchive) {
      await downloadPinnedArchive(
        release,
        archivePath,
        dependencies.fetch ?? globalThis.fetch,
        timeoutMs,
      )
    }
    await mkdir(stagingPath, { mode: 0o700, recursive: false })
    staged = true
    await (dependencies.extractArchive ?? defaultExtractArchive)({
      archivePath,
      destinationPath: stagingPath,
      release,
    })
    const binaryPath = await inspectExtractedTree(stagingPath, release.binaryName)
    if (process.platform !== 'win32') await chmod(binaryPath, 0o700)
    const binary = await hashRegularFile(binaryPath)
    const binaryRelativePath = path.relative(stagingPath, binaryPath).split(path.sep).join('/')
    const record = recordForRelease(
      release,
      binaryRelativePath,
      binary,
      (dependencies.now ?? (() => new Date()))().toISOString(),
    )
    await writeAtomicPrivateJson(path.join(stagingPath, GENERATION_RECORD_NAME), record, token)
    try {
      try {
        await lstat(generationPath)
        throw new I2pdManagedInstallError('activation-failed', 'The immutable i2pd generation already existed.')
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error
      }
      await rename(stagingPath, generationPath)
      staged = false
    } catch (error) {
      if (errorCode(error) !== 'EEXIST' && errorCode(error) !== 'ENOTEMPTY') throw error
      const racedRecord = await readGenerationRecord(generationPath, release.target)
      if (JSON.stringify(racedRecord) !== JSON.stringify(record)) throw error
    }
    const activatedRecord = await readGenerationRecord(generationPath, release.target)
    const install = await validateGeneration(paths, release.target, activatedRecord)
    await dependencies.beforeActivate?.(activatedRecord)
    try {
      await writeAtomicPrivateJson(paths.currentRecordPath, activatedRecord, token)
    } catch (error) {
      throw new I2pdManagedInstallError('activation-failed', 'The managed i2pd generation could not be activated.', { cause: error })
    }
    return Object.freeze({ install, kind: legacy ? 'migrated-legacy' : 'installed' })
  } finally {
    await rm(archivePath, { force: true }).catch(() => undefined)
    if (staged) await rm(stagingPath, { force: true, recursive: true }).catch(() => undefined)
  }
}
