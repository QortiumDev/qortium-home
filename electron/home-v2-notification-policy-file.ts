import { randomBytes } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  rm,
  type FileHandle,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_HOME_V2_NOTIFICATION_POLICY,
  encodeStoredHomeV2NotificationPolicy,
  failedClosedHomeV2NotificationPolicy,
  parseStoredHomeV2NotificationPolicy,
  type HomeV2NotificationPolicySnapshot,
} from './home-v2-notification-policy-codec.js'

const MAX_POLICY_BYTES = 16 * 1024

type NotificationPolicyFileDependencies = {
  readonly chmod: typeof chmod
  readonly lstat: typeof lstat
  readonly mkdir: typeof mkdir
  readonly open: (
    filePath: string,
    flags: number | string,
    mode?: number,
  ) => Promise<FileHandle>
  readonly rename: typeof rename
  readonly rm: typeof rm
}

const DEFAULT_DEPENDENCIES: NotificationPolicyFileDependencies = {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  rm,
}

export function createHomeV2NotificationPolicyFile(
  resolvePath: () => string,
  dependencies: Partial<NotificationPolicyFileDependencies> = {},
) {
  const fs = { ...DEFAULT_DEPENDENCIES, ...dependencies }
  let cached: HomeV2NotificationPolicySnapshot | undefined
  let operationQueue: Promise<void> = Promise.resolve()

  const queued = <T>(operation: () => Promise<T>) => {
    const result = operationQueue.then(operation, operation)
    operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  const readFromDisk = async (): Promise<HomeV2NotificationPolicySnapshot> => {
    const destination = resolvePath()
    let inspected
    try {
      inspected = await fs.lstat(destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return DEFAULT_HOME_V2_NOTIFICATION_POLICY
      }
      return failedClosedHomeV2NotificationPolicy('unavailable')
    }
    if (
      !inspected.isFile() ||
      inspected.isSymbolicLink() ||
      inspected.size > MAX_POLICY_BYTES
    ) {
      return failedClosedHomeV2NotificationPolicy('corrupt')
    }

    let handle: FileHandle | undefined
    try {
      handle = await fs.open(
        destination,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ELOOP') {
        return failedClosedHomeV2NotificationPolicy('corrupt')
      }
      return failedClosedHomeV2NotificationPolicy('unavailable')
    }
    try {
      const file = await handle.stat()
      if (
        !file.isFile() ||
        file.size > MAX_POLICY_BYTES ||
        file.dev !== inspected.dev ||
        file.ino !== inspected.ino
      ) {
        return failedClosedHomeV2NotificationPolicy('corrupt')
      }
      const raw = await handle.readFile({ encoding: 'utf8' })
      if (Buffer.byteLength(raw, 'utf8') > MAX_POLICY_BYTES) {
        return failedClosedHomeV2NotificationPolicy('corrupt')
      }
      try {
        return parseStoredHomeV2NotificationPolicy(JSON.parse(raw) as unknown)
      } catch {
        return failedClosedHomeV2NotificationPolicy('corrupt')
      }
    } catch {
      return failedClosedHomeV2NotificationPolicy('unavailable')
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  const writeAtomically = async (snapshot: HomeV2NotificationPolicySnapshot) => {
    const destination = resolvePath()
    const directory = path.dirname(destination)
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = `${destination}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`
    let handle: FileHandle | undefined
    try {
      handle = await fs.open(temporary, 'wx', 0o600)
      await handle.writeFile(
        `${JSON.stringify(encodeStoredHomeV2NotificationPolicy(snapshot), null, 2)}\n`,
        'utf8',
      )
      await handle.sync()
      await handle.close()
      handle = undefined
      await fs.chmod(temporary, 0o600)
      await fs.rename(temporary, destination)
    } finally {
      await handle?.close().catch(() => undefined)
      await fs.rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  const initialize = () => queued(async () => {
    if (!cached) cached = await readFromDisk()
    return cached
  })

  return {
    initialize,
    read: initialize,
    set(expectedGeneration: number, enabled: boolean) {
      return queued(async () => {
        if (!cached) cached = await readFromDisk()
        const current = cached
        if (current.status !== 'available') {
          const error = new Error(`Notification policy storage is ${current.status}.`)
          Object.assign(error, { code: 'POLICY_STORAGE_UNAVAILABLE' })
          throw error
        }
        if (current.generation !== expectedGeneration) {
          const error = new Error('Notification policy changed in another Home window.')
          Object.assign(error, { code: 'SETTINGS_CHANGED' })
          throw error
        }
        if (current.enabled === enabled) return { changed: false, snapshot: current } as const
        // Left with its own descriptive message: it names no path, so it is
        // safe to surface, and the app-facing bridge collapses it to a generic
        // code anyway (normalizeHomeV2NotificationPolicyError).
        if (current.generation >= Number.MAX_SAFE_INTEGER) {
          throw new Error('Notification policy generation is exhausted.')
        }
        const next = Object.freeze({
          enabled,
          generation: current.generation + 1,
          schema: 'qortium-home-v2-notification-policy' as const,
          status: 'available' as const,
          version: 1 as const,
        })
        try {
          await writeAtomically(next)
        } catch (error) {
          // A raw fs failure carries the absolute policy path, the temp-file
          // name and the pid in its message. That message would otherwise
          // travel out of main untouched: Electron serializes a rejected
          // ipcMain.handle by MESSAGE (custom fields like `code` are dropped),
          // the shell forwards it, and UPDATE_HOME_SETTINGS hands it to an
          // untrusted QDN app. The detail is logged HERE, in trusted main, and
          // only a fixed public message leaves this process.
          console.warn('[home-v2-notification-policy] Unable to persist the notification policy:', error)
          const sanitized = new Error('Notification settings could not be saved.')
          Object.assign(sanitized, { code: 'POLICY_WRITE_FAILED' })
          throw sanitized
        }
        cached = next
        return { changed: true, snapshot: next } as const
      })
    },
  }
}

export type HomeV2NotificationPolicyFile = ReturnType<
  typeof createHomeV2NotificationPolicyFile
>
