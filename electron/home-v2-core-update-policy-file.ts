import { chmod, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import {
  DEFAULT_HOME_V2_CORE_UPDATE_POLICY_SETTINGS,
  FAILED_CLOSED_HOME_V2_CORE_UPDATE_POLICY_SETTINGS,
  parseLegacyCoreUpdateSettings,
  parseStoredHomeV2CoreUpdatePolicySettings,
  validateWritableHomeV2CoreUpdatePolicySettings,
  type HomeV2CoreUpdatePolicySettings,
  type WritableHomeV2CoreUpdatePolicySettings,
} from './home-v2-core-update-policy-codec.js'

const MAX_SETTINGS_BYTES = 16 * 1024

export function createHomeV2CoreUpdatePolicyFile(
  resolvePath: () => string,
  readMissingDefaults: () => Promise<WritableHomeV2CoreUpdatePolicySettings> = async () =>
    DEFAULT_HOME_V2_CORE_UPDATE_POLICY_SETTINGS,
) {
  let mutationQueue: Promise<void> = Promise.resolve()

  const writeAtomically = async (settings: HomeV2CoreUpdatePolicySettings) => {
    const destination = resolvePath()
    const directory = path.dirname(destination)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
    const temporary = `${destination}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`
    let handle: FileHandle | undefined
    try {
      handle = await open(temporary, 'wx', 0o600)
      await handle.writeFile(`${JSON.stringify({
        coreUpdatePolicy: settings.coreUpdatePolicy,
        generation: settings.generation,
        javaUpdatePolicy: settings.javaUpdatePolicy,
        schema: 'qortium-home-v2-core-update-policy',
        version: 1,
      }, null, 2)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      await rename(temporary, destination)
      await chmod(destination, 0o600)
    } finally {
      await handle?.close().catch(() => undefined)
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  const readCurrent = async (): Promise<HomeV2CoreUpdatePolicySettings> => {
    const destination = resolvePath()
    try {
      const file = await lstat(destination)
      if (!file.isFile() || file.isSymbolicLink()) {
        throw new Error('Stored Core update settings are not a regular file.')
      }
      if (file.size > MAX_SETTINGS_BYTES) throw new Error('Stored Core update settings are too large.')
      const raw = await readFile(destination, 'utf8')
      if (Buffer.byteLength(raw, 'utf8') > MAX_SETTINGS_BYTES) {
        throw new Error('Stored Core update settings are too large.')
      }
      const parsed: unknown = JSON.parse(raw)
      try {
        return parseStoredHomeV2CoreUpdatePolicySettings(parsed)
      } catch {
        const legacy = parseLegacyCoreUpdateSettings(parsed)
        if (!legacy) throw new Error('Stored Core update settings are malformed.')
        const migrated = { ...legacy, generation: 0, storageIssue: null } as const
        await writeAtomically(migrated)
        return migrated
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        return FAILED_CLOSED_HOME_V2_CORE_UPDATE_POLICY_SETTINGS
      }
      const initial = validateWritableHomeV2CoreUpdatePolicySettings(await readMissingDefaults())
      const settings = { ...initial, generation: 0, storageIssue: null } as const
      await writeAtomically(settings)
      return settings
    }
  }

  const queued = <T>(operation: () => Promise<T>) => {
    const result = mutationQueue.then(operation, operation)
    mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  const nextGeneration = (current: HomeV2CoreUpdatePolicySettings) => {
    if (current.generation >= Number.MAX_SAFE_INTEGER - 1) {
      throw new Error('Core update settings generation is exhausted.')
    }
    return current.generation + 1
  }

  return {
    read() {
      return queued(readCurrent)
    },
    replace(expectedGeneration: number, requested: WritableHomeV2CoreUpdatePolicySettings) {
      return queued(async () => {
        const current = await readCurrent()
        if (current.generation !== expectedGeneration) {
          const error = new Error('Core update settings changed in another Home window.')
          Object.assign(error, { code: 'SETTINGS_CHANGED' })
          throw error
        }
        const validated = validateWritableHomeV2CoreUpdatePolicySettings(requested)
        if (!current.storageIssue && current.coreUpdatePolicy === validated.coreUpdatePolicy &&
          current.javaUpdatePolicy === validated.javaUpdatePolicy) return current
        const next = {
          ...validated,
          generation: nextGeneration(current),
          storageIssue: null,
        } as const
        await writeAtomically(next)
        return next
      })
    },
    updatePartial(requested: {
      readonly coreUpdatePolicy?: unknown
      readonly javaUpdatePolicy?: unknown
    }) {
      return queued(async () => {
        const current = await readCurrent()
        const policy = (value: unknown, fallback: HomeV2CoreUpdatePolicySettings['coreUpdatePolicy']) =>
          value === 'install' || value === 'notify' || value === 'off' ? value : fallback
        const next = {
          coreUpdatePolicy: policy(requested.coreUpdatePolicy, current.coreUpdatePolicy),
          generation: nextGeneration(current),
          javaUpdatePolicy: policy(requested.javaUpdatePolicy, current.javaUpdatePolicy),
          storageIssue: null,
        } as const
        await writeAtomically(next)
        return next
      })
    },
  }
}
