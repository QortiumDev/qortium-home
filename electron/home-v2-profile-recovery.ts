import { app } from 'electron'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

const RECOVERY_ROOT = 'home-v2-recovery'
const STATE_FILE = 'state.json'
const MANIFEST_VERSION = 1
const CURATED_PROFILE_PATHS = ['wallets.json', 'Local Storage'] as const

type ManifestFile = {
  bytes: number
  relativePath: string
  sha256: string
}

type RecoveryManifest = {
  createdAt: string
  files: ManifestFile[]
  id: string
  sourceProfile: string
  version: typeof MANIFEST_VERSION
}

type RecoveryStateFile = {
  backupId: string | null
  message: string | null
  restoreRequested: boolean
  status: 'ready' | 'recovery'
  version: 1
}

export type HomeV2ProfileRecoveryState = Pick<
  RecoveryStateFile,
  'backupId' | 'message' | 'status'
>

function recoveryRoot(userData = app.getPath('userData')) {
  return path.join(userData, RECOVERY_ROOT)
}

function statePath(userData = app.getPath('userData')) {
  return path.join(recoveryRoot(userData), STATE_FILE)
}

function emptyState(): RecoveryStateFile {
  return {
    backupId: null,
    message: null,
    restoreRequested: false,
    status: 'ready',
    version: 1,
  }
}

function readState(userData = app.getPath('userData')): RecoveryStateFile {
  if (!existsSync(statePath(userData))) return emptyState()
  try {
    const value = JSON.parse(readFileSync(statePath(userData), 'utf8')) as Partial<RecoveryStateFile>
    return {
      backupId: typeof value.backupId === 'string' ? value.backupId : null,
      message: typeof value.message === 'string' ? value.message : null,
      restoreRequested: value.restoreRequested === true,
      status: value.status === 'recovery' ? 'recovery' : 'ready',
      version: 1,
    }
  } catch {
    return {
      ...emptyState(),
      message: 'Home could not read its profile recovery state.',
      status: 'recovery',
    }
  }
}

function writeState(state: RecoveryStateFile, userData = app.getPath('userData')) {
  mkdirSync(recoveryRoot(userData), { recursive: true })
  writeFileSync(statePath(userData), `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

function hashFile(filePath: string) {
  const body = readFileSync(filePath)
  return {
    bytes: body.byteLength,
    sha256: createHash('sha256').update(body).digest('hex'),
  }
}

function walkFiles(root: string, current = root): string[] {
  if (!existsSync(current)) return []
  if (!lstatSync(current).isDirectory()) return [current]
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(current, entry.name)
    if (entry.isSymbolicLink()) return []
    return entry.isDirectory() ? walkFiles(root, candidate) : [candidate]
  })
}

function backupDirectory(userData: string, backupId: string) {
  return path.join(recoveryRoot(userData), 'backups', backupId)
}

function manifestPath(userData: string, backupId: string) {
  return path.join(backupDirectory(userData, backupId), 'manifest.json')
}

function readManifest(userData: string, backupId: string): RecoveryManifest {
  const manifest = JSON.parse(readFileSync(manifestPath(userData, backupId), 'utf8')) as RecoveryManifest
  if (
    manifest.version !== MANIFEST_VERSION ||
    manifest.id !== backupId ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error('The profile backup manifest is invalid.')
  }
  return manifest
}

function verifyBackup(userData: string, manifest: RecoveryManifest) {
  const filesRoot = path.join(backupDirectory(userData, manifest.id), 'files')
  for (const file of manifest.files) {
    const candidate = path.resolve(filesRoot, file.relativePath)
    if (!candidate.startsWith(`${path.resolve(filesRoot)}${path.sep}`)) {
      throw new Error('The profile backup manifest contains an unsafe path.')
    }
    const actual = hashFile(candidate)
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) {
      throw new Error(`Profile backup verification failed for ${file.relativePath}.`)
    }
  }
}

export function getHomeV2ProfileRecoveryState(): HomeV2ProfileRecoveryState {
  const { restoreRequested: _restoreRequested, version: _version, ...state } = readState()
  return state
}

export function ensureHomeV2ProfileBackup(userData = app.getPath('userData')) {
  const existing = readState(userData)
  if (existing.backupId && existing.status === 'ready') {
    try {
      verifyBackup(userData, readManifest(userData, existing.backupId))
      return existing.backupId
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Profile backup verification failed.'
      writeState({ ...existing, message, status: 'recovery' }, userData)
      throw new Error(message)
    }
  }

  const backupId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`
  const targetRoot = backupDirectory(userData, backupId)
  const filesRoot = path.join(targetRoot, 'files')
  try {
    mkdirSync(filesRoot, { recursive: true })
    for (const relativePath of CURATED_PROFILE_PATHS) {
      const source = path.join(userData, relativePath)
      if (existsSync(source)) {
        cpSync(source, path.join(filesRoot, relativePath), {
          errorOnExist: true,
          recursive: true,
        })
      }
    }
    const files = walkFiles(filesRoot).map((filePath) => {
      const relativePath = path.relative(filesRoot, filePath)
      return { relativePath, ...hashFile(filePath) }
    })
    const manifest: RecoveryManifest = {
      createdAt: new Date().toISOString(),
      files,
      id: backupId,
      sourceProfile: path.resolve(userData),
      version: MANIFEST_VERSION,
    }
    writeFileSync(manifestPath(userData, backupId), `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    verifyBackup(userData, manifest)
    writeState(
      { backupId, message: null, restoreRequested: false, status: 'ready', version: 1 },
      userData,
    )
    return backupId
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create the Home 2.0 profile backup.'
    writeState(
      { backupId: null, message, restoreRequested: false, status: 'recovery', version: 1 },
      userData,
    )
    throw new Error(message)
  }
}

export function requestHomeV2ProfileRestore() {
  const state = readState()
  if (!state.backupId) throw new Error('No verified Home 2.0 profile backup is available.')
  writeState({ ...state, restoreRequested: true })
}

export function restoreHomeV2ProfileIfRequested(userData = app.getPath('userData')) {
  const state = readState(userData)
  if (!state.restoreRequested) return false
  if (!state.backupId) throw new Error('No profile backup is available to restore.')
  const manifest = readManifest(userData, state.backupId)
  verifyBackup(userData, manifest)
  const filesRoot = path.join(backupDirectory(userData, state.backupId), 'files')
  for (const relativePath of CURATED_PROFILE_PATHS) {
    const source = path.join(filesRoot, relativePath)
    const target = path.join(userData, relativePath)
    if (existsSync(target)) {
      const displaced = `${target}.home-v2-displaced-${Date.now()}`
      renameSync(target, displaced)
    }
    if (existsSync(source)) {
      cpSync(source, target, { errorOnExist: true, recursive: true })
    }
  }
  writeState({ ...state, message: null, restoreRequested: false, status: 'ready' }, userData)
  return true
}

export function resetHomeV2ProfileRecoveryForTests(userData: string) {
  const target = recoveryRoot(userData)
  if (existsSync(target)) rmSync(target, { force: true, recursive: true })
}
