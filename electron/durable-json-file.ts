import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Shared durable-write and cross-process lock primitives for Home's on-disk
 * transaction journals.
 *
 * Both journals are write-ahead logs that gate a signed payment: the foreign
 * wallet journal decides whether a Bitcoin-family broadcast may proceed, and
 * the native journal decides whether a Qortal-family transaction is a
 * duplicate of one already in flight. Two Home instances can be pointed at the
 * same userData directory (a second launch, a portable profile, a shared
 * home directory on a multi-seat machine), so every read-modify-write of those
 * files has to be serialized across processes, not just inside one.
 */

export type DurableFileOps = Pick<typeof fs,
  | 'closeSync'
  | 'existsSync'
  | 'fsyncSync'
  | 'openSync'
  | 'readFileSync'
  | 'renameSync'
  | 'rmSync'
  | 'statSync'
  | 'writeFileSync'
>

/** Directory metadata flush policy for {@link writeDurableFile}. */
export type DurableDirectorySync = 'required' | 'best-effort'

export const FOREIGN_JOURNAL_LOCKED_CODE = 'FOREIGN_JOURNAL_LOCKED'
export const HOME_JOURNAL_LOCKED_CODE = 'HOME_JOURNAL_LOCKED'

export const JOURNAL_LOCK_TIMEOUT_MS = 10_000
export const JOURNAL_LOCK_STALE_AFTER_MS = 120_000
const LOCK_RETRY_MIN_DELAY_MS = 10
const LOCK_RETRY_MAX_DELAY_MS = 250
const LOCK_TAKEOVER_ATTEMPTS = 3

/** Raised when a journal lock could not be taken within the bounded wait. */
export class JournalLockedError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'JournalLockedError'
    this.code = code
  }
}

export function isJournalLockedError(error: unknown): error is JournalLockedError {
  if (error instanceof JournalLockedError) return true
  if (!(error instanceof Error)) return false
  const code = (error as { code?: unknown }).code
  return code === FOREIGN_JOURNAL_LOCKED_CODE || code === HOME_JOURNAL_LOCKED_CODE
}

function errorCode(error: unknown) {
  return error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined
}

function syncDirectory(fileOps: DurableFileOps, directory: string, policy: DurableDirectorySync) {
  try {
    const descriptor = fileOps.openSync(directory, 'r')
    try {
      fileOps.fsyncSync(descriptor)
    } finally {
      fileOps.closeSync(descriptor)
    }
  } catch (error) {
    // Windows cannot always open a directory handle for flushing. Callers that
    // gate money on the write ask for 'required' and fail closed there; the
    // rename itself is still atomic for callers that ask for 'best-effort'.
    if (policy === 'required') throw error
  }
}

/**
 * Replaces `target` atomically and durably: staging file in the same directory,
 * fsync of the contents, rename over the target, then a parent directory flush
 * so the rename itself survives a power loss. The staging file is always
 * removed, so a failed write never leaves a partial file behind.
 */
export function writeDurableFile(
  target: string,
  contents: string,
  options: {
    readonly directorySync?: DurableDirectorySync
    readonly fileOps?: DurableFileOps
    readonly mode?: number
  } = {},
) {
  const fileOps = options.fileOps ?? fs
  const mode = options.mode ?? 0o600
  const directory = path.dirname(target)
  const staging = `${target}.tmp-${process.pid}-${process.hrtime.bigint()}`
  let descriptor: number | undefined
  try {
    descriptor = fileOps.openSync(staging, 'wx', mode)
    fileOps.writeFileSync(descriptor, contents, { encoding: 'utf8' })
    fileOps.fsyncSync(descriptor)
    const writtenDescriptor = descriptor
    descriptor = undefined
    fileOps.closeSync(writtenDescriptor)
    fileOps.renameSync(staging, target)
    syncDirectory(fileOps, directory, options.directorySync ?? 'required')
  } finally {
    if (descriptor !== undefined) fileOps.closeSync(descriptor)
    fileOps.rmSync(staging, { force: true })
  }
}

interface JournalLockOwner {
  readonly acquiredAt: number
  readonly host: string
  readonly pid: number
  readonly token: string
}

export interface JournalLockOptions {
  /** Coded error raised when the lock cannot be taken. */
  readonly code?: string
  readonly fileOps?: DurableFileOps
  readonly now?: () => number
  /** Blocking wait between attempts; injected by tests. */
  readonly sleep?: (milliseconds: number) => void
  readonly staleAfterMs?: number
  readonly timeoutMs?: number
}

function blockingSleep(milliseconds: number) {
  // These stores are synchronous by design: a read/check/write transition must
  // not be interleaved with anything else in the main process. Atomics.wait is
  // the only way to pause without giving the event loop a chance to re-enter.
  const signal = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(signal, 0, 0, milliseconds)
}

function isProcessAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists and belongs to another user, so it is
    // alive and its lock must be respected. Only ESRCH proves it is gone.
    return errorCode(error) !== 'ESRCH'
  }
}

function readLockOwner(fileOps: DurableFileOps, lockPath: string): JournalLockOwner | 'missing' | 'unreadable' {
  let raw: string
  try {
    raw = fileOps.readFileSync(lockPath).toString('utf8')
  } catch (error) {
    return errorCode(error) === 'ENOENT' ? 'missing' : 'unreadable'
  }
  try {
    const parsed = JSON.parse(raw) as Partial<JournalLockOwner>
    if (typeof parsed?.token !== 'string' || !parsed.token) return 'unreadable'
    if (typeof parsed.pid !== 'number' || typeof parsed.acquiredAt !== 'number') return 'unreadable'
    if (typeof parsed.host !== 'string') return 'unreadable'
    return { acquiredAt: parsed.acquiredAt, host: parsed.host, pid: parsed.pid, token: parsed.token }
  } catch {
    return 'unreadable'
  }
}

function lockAgeMs(fileOps: DurableFileOps, lockPath: string, now: number) {
  try {
    return now - fileOps.statSync(lockPath).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Removes a lock only when its recorded owner is provably gone: same host, a
 * pid this machine no longer has, and an age well past any plausible journal
 * write. A lock whose contents never made it to disk (a crash between the
 * exclusive create and the write) has no owner to prove alive, so it is taken
 * over on age alone.
 */
function takeOverStaleLock(
  fileOps: DurableFileOps,
  lockPath: string,
  now: number,
  staleAfterMs: number,
) {
  const owner = readLockOwner(fileOps, lockPath)
  if (owner === 'missing') return true
  if (owner === 'unreadable') {
    if (lockAgeMs(fileOps, lockPath, now) <= staleAfterMs) return false
  } else {
    // A lock recorded by another machine (a shared network profile) can never
    // be judged stale from here: this host's pid table says nothing about it.
    if (owner.host !== os.hostname()) return false
    if (isProcessAlive(owner.pid)) return false
    if (now - owner.acquiredAt <= staleAfterMs) return false
    // Re-read before removing so a holder that replaced the lock in the
    // meantime keeps it.
    const current = readLockOwner(fileOps, lockPath)
    if (current === 'missing') return true
    if (current === 'unreadable' || current.token !== owner.token) return false
  }
  try {
    fileOps.rmSync(lockPath, { force: true })
    return true
  } catch {
    // Windows refuses to unlink a file another process still holds open. Treat
    // that as "still held" rather than as a takeover.
    return false
  }
}

const heldLocks = new Map<string, { depth: number; token: string }>()

/**
 * Runs `run` while holding an exclusive lockfile next to `target`.
 *
 * The lockfile is created with O_EXCL (`wx`), which is honoured on Windows as
 * well as POSIX, and records the owning pid, host, and a random token. The
 * token is what makes release safe: a holder only unlinks a lock it can still
 * prove is its own, so taking over a stale lock never lets two processes
 * delete each other's.
 *
 * Failure to acquire is fatal to the caller by design. A journal write that
 * gates a broadcast must never proceed unlocked.
 */
export function withFileLock<T>(target: string, run: () => T, options: JournalLockOptions = {}): T {
  const fileOps = options.fileOps ?? fs
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? blockingSleep
  const code = options.code ?? FOREIGN_JOURNAL_LOCKED_CODE
  const staleAfterMs = options.staleAfterMs ?? JOURNAL_LOCK_STALE_AFTER_MS
  const timeoutMs = options.timeoutMs ?? JOURNAL_LOCK_TIMEOUT_MS
  const lockPath = `${target}.lock`

  // A journal directory that does not exist yet cannot be shared with another
  // instance, and locking would turn a "no journal" read into a hard failure.
  if (!fileOps.existsSync(path.dirname(target))) return run()

  const reentrant = heldLocks.get(lockPath)
  if (reentrant) {
    // Same process, same journal: the outer frame already holds the file, and
    // a nested read/write must not deadlock against itself.
    reentrant.depth += 1
    try {
      return run()
    } finally {
      reentrant.depth -= 1
    }
  }

  const token = randomUUID()
  const deadline = now() + timeoutMs
  let delay = LOCK_RETRY_MIN_DELAY_MS
  let takeovers = 0
  for (;;) {
    let descriptor: number | undefined
    try {
      descriptor = fileOps.openSync(lockPath, 'wx', 0o600)
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
    }
    if (descriptor !== undefined) {
      try {
        const owner: JournalLockOwner = { acquiredAt: now(), host: os.hostname(), pid: process.pid, token }
        // No fsync here on purpose: a lock only has to be visible to other live
        // processes, and a lock that did not survive a crash is stale anyway.
        fileOps.writeFileSync(descriptor, `${JSON.stringify(owner)}\n`, { encoding: 'utf8' })
      } catch (error) {
        try {
          fileOps.closeSync(descriptor)
        } catch {
          // The write failure is the useful one.
        }
        fileOps.rmSync(lockPath, { force: true })
        throw error
      }
      fileOps.closeSync(descriptor)
      break
    }
    if (takeovers < LOCK_TAKEOVER_ATTEMPTS && takeOverStaleLock(fileOps, lockPath, now(), staleAfterMs)) {
      takeovers += 1
      continue
    }
    if (now() >= deadline) {
      throw new JournalLockedError(
        `Another Home instance is using ${path.basename(target)}. Try again in a moment.`,
        code,
      )
    }
    sleep(delay)
    delay = Math.min(delay * 2, LOCK_RETRY_MAX_DELAY_MS)
  }

  heldLocks.set(lockPath, { depth: 1, token })
  try {
    return run()
  } finally {
    heldLocks.delete(lockPath)
    releaseLock(fileOps, lockPath, token)
  }
}

function releaseLock(fileOps: DurableFileOps, lockPath: string, token: string) {
  try {
    const owner = readLockOwner(fileOps, lockPath)
    // Never unlink a lock this process cannot still prove is its own: after a
    // stale takeover the file on disk belongs to somebody else.
    if (owner === 'missing' || owner === 'unreadable' || owner.token !== token) return
    fileOps.rmSync(lockPath, { force: true })
  } catch {
    // Releasing runs in a finally block. Throwing here would replace the real
    // result of the journal operation, including a write that already
    // succeeded, with a cleanup error. An orphaned lock is recovered by the
    // stale-takeover rule instead.
  }
}
