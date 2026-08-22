import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  getHomeV2CoreJarCandidates,
  parseQortalHubDirectory,
} from './home-v2-core-readiness-policy.js'
import type { QortalManagedInstallPaths } from './qortal-managed-install.js'

const MAX_HUB_STORAGE_BYTES = 1024 * 1024

export type QortalExternalInstallCollision = 'clear' | 'detected' | 'unknown'

export type QortalCollisionContext = {
  readonly appDataPath: string
  readonly homePath: string
  readonly platform: NodeJS.Platform
  readonly programFilesPath?: string
}

type CollisionOperations = {
  readonly lstat: typeof lstat
  readonly readFile: typeof readFile
}

function errorCode(error: unknown) {
  return error instanceof Error && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined
}

function samePath(left: string, right: string, platform: NodeJS.Platform) {
  const normalized = (value: string) => platform === 'win32'
    ? path.resolve(value).toLowerCase()
    : path.resolve(value)
  return normalized(left) === normalized(right)
}

async function readHubDirectory(
  context: QortalCollisionContext,
  operations: CollisionOperations,
): Promise<{ directory: string | null; uncertain: boolean }> {
  const storagePath = path.join(context.appDataPath, 'qortal-hub', 'wallet-storage.json')
  try {
    const stats = await operations.lstat(storagePath)
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_HUB_STORAGE_BYTES) {
      return { directory: null, uncertain: true }
    }
    const bytes = await operations.readFile(storagePath)
    if (bytes.byteLength > MAX_HUB_STORAGE_BYTES) return { directory: null, uncertain: true }
    const directory = parseQortalHubDirectory(JSON.parse(bytes.toString('utf8')) as unknown)
    const absolute = directory && (context.platform === 'win32'
      ? path.win32.isAbsolute(directory)
      : path.posix.isAbsolute(directory))
    return absolute
      ? { directory, uncertain: false }
      : { directory: null, uncertain: true }
  } catch (error) {
    return errorCode(error) === 'ENOENT'
      ? { directory: null, uncertain: false }
      : { directory: null, uncertain: true }
  }
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
  const operations: CollisionOperations = { lstat, readFile, ...options.operations }
  const hub = await readHubDirectory(context, operations)
  if (hub.uncertain) return 'unknown'
  const candidates = getHomeV2CoreJarCandidates('qortal', {
    ...context,
    qortalHubDirectory: hub.directory,
  }).filter((candidate) => !samePath(candidate, managedPaths.jarPath, context.platform))

  for (const candidate of candidates) {
    try {
      await operations.lstat(candidate)
      return 'detected'
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') return 'unknown'
    }
  }
  return 'clear'
}
