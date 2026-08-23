import { constants as fsConstants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import path from 'node:path'
import {
  getHomeV2CoreJarCandidates,
  parseQortalHubDirectory,
} from './home-v2-core-readiness-policy.js'
import type { QortalManagedInstallPaths } from './qortal-managed-install.js'
import type { QortalInstallCandidateHint } from './qortal-install-source.js'

const MAX_HUB_STORAGE_BYTES = 1024 * 1024

export type QortalExternalInstallCollision = 'clear' | 'detected' | 'unknown'

export type QortalCollisionContext = {
  readonly appDataPath: string
  readonly homePath: string
  readonly platform: NodeJS.Platform
  readonly programFilesPath?: string
}

type CollisionOperations = {
  readonly lstat: (targetPath: string) => Promise<{
    dev: number
    ino: number
    isFile(): boolean
    isSymbolicLink(): boolean
    mtimeMs: number
    size: number
  }>
  readonly openHubFile: (targetPath: string, platform: NodeJS.Platform) => Promise<{
    close(): Promise<void>
    readFile(): Promise<Buffer>
    stat(): Promise<{
      dev: number
      ino: number
      isFile(): boolean
      isSymbolicLink(): boolean
      mtimeMs: number
      size: number
    }>
  }>
}

export type QortalExternalInstallHintCollection = Readonly<{
  hints: readonly QortalInstallCandidateHint[]
  kind: 'observed' | 'unknown'
}>

const DEFAULT_OPERATIONS: CollisionOperations = {
  lstat,
  openHubFile: async (targetPath, platform) => await open(
    targetPath,
    platform === 'win32' ? 'r' : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  ),
}

function errorCode(error: unknown) {
  return error instanceof Error && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined
}

function samePath(left: string, right: string, platform: NodeJS.Platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const normalized = (value: string) => platform === 'win32'
    ? pathApi.resolve(value).toLowerCase()
    : pathApi.resolve(value)
  return normalized(left) === normalized(right)
}

async function readHubDirectory(
  context: QortalCollisionContext,
  operations: CollisionOperations,
): Promise<{ directory: string | null; uncertain: boolean }> {
  const storagePath = path.join(context.appDataPath, 'qortal-hub', 'wallet-storage.json')
  let handle: Awaited<ReturnType<CollisionOperations['openHubFile']>> | null = null
  let observedPath = false
  try {
    const before = await operations.lstat(storagePath)
    observedPath = true
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_HUB_STORAGE_BYTES) {
      return { directory: null, uncertain: true }
    }
    handle = await operations.openHubFile(storagePath, context.platform)
    const opened = await handle.stat()
    if (!opened.isFile() || opened.isSymbolicLink() || opened.size > MAX_HUB_STORAGE_BYTES ||
      opened.dev !== before.dev || opened.ino !== before.ino) return { directory: null, uncertain: true }
    const bytes = await handle.readFile()
    if (bytes.byteLength > MAX_HUB_STORAGE_BYTES) return { directory: null, uncertain: true }
    const [closed, after] = await Promise.all([handle.stat(), operations.lstat(storagePath)])
    if (!after.isFile() || after.isSymbolicLink() || closed.dev !== opened.dev || closed.ino !== opened.ino ||
      closed.size !== opened.size || closed.mtimeMs !== opened.mtimeMs ||
      after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs) return { directory: null, uncertain: true }
    const directory = parseQortalHubDirectory(JSON.parse(bytes.toString('utf8')) as unknown)
    const absolute = directory && (context.platform === 'win32'
      ? path.win32.isAbsolute(directory)
      : path.posix.isAbsolute(directory))
    return absolute
      ? { directory, uncertain: false }
      : { directory: null, uncertain: true }
  } catch (error) {
    return errorCode(error) === 'ENOENT'
      ? { directory: null, uncertain: observedPath }
      : { directory: null, uncertain: true }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export async function collectQortalExternalInstallHints(
  managedPaths: QortalManagedInstallPaths,
  context: QortalCollisionContext,
  options: { operations?: Partial<CollisionOperations> } = {},
): Promise<QortalExternalInstallHintCollection> {
  if (context.platform !== 'linux' && context.platform !== 'darwin' && context.platform !== 'win32') {
    return { hints: [], kind: 'unknown' }
  }
  if (context.platform === 'win32' && (
    !context.programFilesPath || !path.win32.isAbsolute(context.programFilesPath)
  )) return { hints: [], kind: 'unknown' }

  const operations: CollisionOperations = { ...DEFAULT_OPERATIONS, ...options.operations }
  const hub = await readHubDirectory(context, operations)
  if (hub.uncertain) return { hints: [], kind: 'unknown' }
  const pathApi = context.platform === 'win32' ? path.win32 : path.posix

  const hints: QortalInstallCandidateHint[] = getHomeV2CoreJarCandidates('qortal', {
    ...context,
    qortalHubDirectory: null,
  }).filter((candidate) => !samePath(candidate, managedPaths.jarPath, context.platform)).map((candidate) => ({
    installPath: pathApi.dirname(candidate),
    origin: 'default-location',
  }))
  if (hub.directory && !samePath(pathApi.join(hub.directory, 'qortal.jar'), managedPaths.jarPath, context.platform)) {
    hints.push({ hubHint: true, installPath: hub.directory, origin: 'qortal-hub' })
  }
  return { hints, kind: 'observed' }
}

/**
 * Any pathname evidence at a known Qortal JAR location blocks a second install,
 * even when settings are absent or the pathname is not a regular file.
 */
export async function probeQortalExternalInstallCollision(
  managedPaths: QortalManagedInstallPaths,
  context: QortalCollisionContext,
  options: { operations?: Partial<CollisionOperations> } = {},
): Promise<QortalExternalInstallCollision> {
  if (context.platform !== 'linux' && context.platform !== 'darwin' && context.platform !== 'win32') {
    return 'unknown'
  }
  if (context.platform === 'win32' && (
    !context.programFilesPath || !path.win32.isAbsolute(context.programFilesPath)
  )) {
    return 'unknown'
  }
  const operations: CollisionOperations = { ...DEFAULT_OPERATIONS, ...options.operations }
  const collected = await collectQortalExternalInstallHints(managedPaths, context, { operations })
  if (collected.kind === 'unknown') return 'unknown'
  const pathApi = context.platform === 'win32' ? path.win32 : path.posix

  for (const hint of collected.hints) {
    const candidate = pathApi.join(hint.installPath, 'qortal.jar')
    try {
      await operations.lstat(candidate)
      return 'detected'
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') return 'unknown'
    }
  }
  return 'clear'
}
