import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_HOME_V2_APP_UPDATE_SETTINGS,
  parseStoredHomeV2AppUpdateSettings,
  type StoredHomeV2AppUpdateSettings,
} from './home-v2-app-update-settings-codec.js'

const MAX_SETTINGS_BYTES = 16 * 1024

export function createHomeV2AppUpdateSettingsFile(resolvePath: () => string) {
  let writeQueue: Promise<void> = Promise.resolve()

  const readCurrent = async () => {
    const destination = resolvePath()
    try {
      const { size } = await stat(destination)
      if (size > MAX_SETTINGS_BYTES) throw new Error('Stored app update settings are too large.')
      const raw = await readFile(destination, 'utf8')
      if (Buffer.byteLength(raw, 'utf8') > MAX_SETTINGS_BYTES) {
        throw new Error('Stored app update settings are too large.')
      }
      return parseStoredHomeV2AppUpdateSettings(JSON.parse(raw))
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return DEFAULT_HOME_V2_APP_UPDATE_SETTINGS
      }
      throw error
    }
  }

  const writeAtomically = async (settings: StoredHomeV2AppUpdateSettings) => {
    const destination = resolvePath()
    await mkdir(path.dirname(destination), { recursive: true })
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify({
        ...settings,
        schema: 'qortium-home-v2-app-update-settings',
        version: 1,
      }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, destination)
      await chmod(destination, 0o600)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  const queued = <T>(operation: () => Promise<T>) => {
    const result = writeQueue.then(operation, operation)
    writeQueue = result.then(() => undefined, () => undefined)
    return result
  }

  return {
    async read() {
      await writeQueue
      return readCurrent()
    },
    write(
      expectedGeneration: number,
      next: Omit<StoredHomeV2AppUpdateSettings, 'generation'>,
    ) {
      return queued(async () => {
        const current = await readCurrent()
        if (current.generation !== expectedGeneration) {
          const error = new Error('App update settings changed in another Home window.')
          Object.assign(error, { code: 'SETTINGS_CHANGED' })
          throw error
        }
        if (current.generation >= Number.MAX_SAFE_INTEGER - 1) {
          throw new Error('App update settings generation is exhausted.')
        }
        const settings = { ...next, generation: current.generation + 1 }
        await writeAtomically(settings)
        return settings
      })
    },
  }
}
