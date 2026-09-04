import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  FOREIGN_JOURNAL_LOCKED_CODE,
  HOME_JOURNAL_LOCKED_CODE,
  isJournalLockedError,
  JournalLockedError,
  withFileLock,
  writeDurableFile,
  type DurableFileOps,
} from './durable-json-file.js'

const DEAD_PID = 2 ** 31 - 1

function temporaryDirectory(label: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `durable-json-${label}-`))
}

function captureThrow(run: () => unknown): unknown {
  let threw = false
  let thrown: unknown
  try {
    run()
  } catch (error) {
    threw = true
    thrown = error
  }
  assert.equal(threw, true, 'expected the call to throw')
  return thrown
}

function stagingFiles(directory: string) {
  return fs.readdirSync(directory).filter((name) => name.includes('.tmp-'))
}

function writeLockFile(lockPath: string, owner: Record<string, unknown>) {
  fs.writeFileSync(lockPath, `${JSON.stringify(owner)}\n`, { encoding: 'utf8', mode: 0o600 })
}

// Durable write: content, mode, and no staging residue.
{
  const directory = temporaryDirectory('write')
  const target = path.join(directory, 'journal.json')
  writeDurableFile(target, '{"version":1}\n')
  assert.equal(fs.readFileSync(target, 'utf8'), '{"version":1}\n')
  assert.equal(fs.statSync(target).mode & 0o777, 0o600)
  assert.deepEqual(stagingFiles(directory), [])
  writeDurableFile(target, '{"version":2}\n')
  assert.equal(fs.readFileSync(target, 'utf8'), '{"version":2}\n')
  assert.deepEqual(stagingFiles(directory), [])
}

// Injected fsync/rename/write failures surface as errors and leave no partial
// file. The previous content must survive untouched.
for (const operation of ['writeFileSync', 'fsyncSync', 'renameSync'] as const) {
  const directory = temporaryDirectory(operation)
  const target = path.join(directory, 'journal.json')
  writeDurableFile(target, 'original\n')
  const faultOps = {
    ...fs,
    [operation]: () => { throw new Error(`injected ${operation} failure`) },
  } as unknown as DurableFileOps
  assert.throws(
    () => writeDurableFile(target, 'replacement\n', { fileOps: faultOps }),
    new RegExp(`injected ${operation} failure`),
  )
  assert.equal(fs.readFileSync(target, 'utf8'), 'original\n')
  assert.deepEqual(stagingFiles(directory), [])
}

// A required directory flush failure is fatal; a best-effort one is not.
{
  const directory = temporaryDirectory('dirsync')
  const target = path.join(directory, 'journal.json')
  let syncCount = 0
  const faultOps = {
    ...fs,
    fsyncSync: (descriptor: number) => {
      syncCount += 1
      if (syncCount % 2 === 0) throw new Error('injected directory fsync failure')
      fs.fsyncSync(descriptor)
    },
  } as unknown as DurableFileOps
  assert.throws(
    () => writeDurableFile(target, 'required\n', { fileOps: faultOps }),
    /directory fsync/,
  )
  // The rename already happened, so the file exists; the caller was told the
  // durability could not be proven.
  assert.equal(fs.readFileSync(target, 'utf8'), 'required\n')
  writeDurableFile(target, 'best-effort\n', { directorySync: 'best-effort', fileOps: faultOps })
  assert.equal(fs.readFileSync(target, 'utf8'), 'best-effort\n')
  assert.deepEqual(stagingFiles(directory), [])
}

// The lock is taken and released around the body.
{
  const directory = temporaryDirectory('lock')
  const target = path.join(directory, 'journal.json')
  const lockPath = `${target}.lock`
  const observed = withFileLock(target, () => {
    assert.equal(fs.existsSync(lockPath), true)
    const owner = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Record<string, unknown>
    assert.equal(owner.pid, process.pid)
    assert.equal(owner.host, os.hostname())
    assert.equal(typeof owner.token, 'string')
    return 'body'
  })
  assert.equal(observed, 'body')
  assert.equal(fs.existsSync(lockPath), false)

  // A throwing body still releases.
  assert.throws(() => withFileLock(target, () => { throw new Error('body failed') }), /body failed/)
  assert.equal(fs.existsSync(lockPath), false)

  // Nested acquisition of the same journal does not deadlock.
  assert.equal(
    withFileLock(target, () => withFileLock(target, () => 'nested')),
    'nested',
  )
  assert.equal(fs.existsSync(lockPath), false)
}

// A lock held by a live process is respected: the wait is bounded and the
// failure is the coded one.
{
  const directory = temporaryDirectory('contended')
  const target = path.join(directory, 'journal.json')
  writeLockFile(`${target}.lock`, {
    acquiredAt: 1_000,
    host: os.hostname(),
    pid: process.pid,
    token: 'live-holder-token',
  })
  let elapsed = 0
  let sleeps = 0
  let entered = false
  const error = captureThrow(() => withFileLock(
    target,
    () => { entered = true },
    {
      now: () => 1_000 + elapsed,
      sleep: (milliseconds: number) => { sleeps += 1; elapsed += milliseconds },
      timeoutMs: 10_000,
    },
  )) as JournalLockedError
  assert.equal(entered, false)
  assert.equal(error instanceof JournalLockedError, true)
  assert.equal(error.code, FOREIGN_JOURNAL_LOCKED_CODE)
  assert.equal(isJournalLockedError(error), true)
  assert.match(error.message, /Another Home instance/)
  assert.ok(sleeps > 1)
  assert.ok(elapsed >= 10_000)
  // The live holder's lock was never removed, even though the pid is old.
  assert.equal(
    (JSON.parse(fs.readFileSync(`${target}.lock`, 'utf8')) as { token: string }).token,
    'live-holder-token',
  )
}

// The coded error can be requested per journal.
{
  const directory = temporaryDirectory('coded')
  const target = path.join(directory, 'journal.json')
  writeLockFile(`${target}.lock`, {
    acquiredAt: 1_000,
    host: os.hostname(),
    pid: process.pid,
    token: 'live-holder-token',
  })
  let elapsed = 0
  const error = captureThrow(() => withFileLock(target, () => 'unreachable', {
    code: HOME_JOURNAL_LOCKED_CODE,
    now: () => 1_000 + elapsed,
    sleep: (milliseconds: number) => { elapsed += milliseconds },
  })) as JournalLockedError
  assert.equal(error.code, HOME_JOURNAL_LOCKED_CODE)
  assert.equal(isJournalLockedError(error), true)
  assert.equal(isJournalLockedError(new Error('Another Home instance is using it.')), false)
}

// A stale lock left by a dead pid is taken over once it is old enough.
{
  const directory = temporaryDirectory('stale')
  const target = path.join(directory, 'journal.json')
  const lockPath = `${target}.lock`
  const staleOwner = {
    acquiredAt: 1_000,
    host: os.hostname(),
    pid: DEAD_PID,
    token: 'dead-holder-token',
  }
  writeLockFile(lockPath, staleOwner)
  // Not yet old enough: the dead pid alone does not authorize a takeover.
  let elapsed = 0
  assert.equal(isJournalLockedError(captureThrow(() => withFileLock(target, () => 'unreachable', {
    now: () => 1_000 + elapsed,
    sleep: (milliseconds: number) => { elapsed += milliseconds },
    staleAfterMs: 120_000,
    timeoutMs: 1_000,
  }))), true)
  assert.equal(fs.existsSync(lockPath), true)

  // Old enough, and the recorded pid is gone: taken over.
  assert.equal(
    withFileLock(target, () => 'took-over', { now: () => 1_000 + 500_000, staleAfterMs: 120_000 }),
    'took-over',
  )
  assert.equal(fs.existsSync(lockPath), false)
}

// A stale-looking lock recorded by another host is never taken over.
{
  const directory = temporaryDirectory('other-host')
  const target = path.join(directory, 'journal.json')
  writeLockFile(`${target}.lock`, {
    acquiredAt: 1_000,
    host: `${os.hostname()}-elsewhere`,
    pid: DEAD_PID,
    token: 'remote-holder-token',
  })
  let elapsed = 0
  assert.equal(isJournalLockedError(captureThrow(() => withFileLock(target, () => 'unreachable', {
    now: () => 1_000 + 500_000 + elapsed,
    sleep: (milliseconds: number) => { elapsed += milliseconds },
    timeoutMs: 1_000,
  }))), true)
  assert.equal(fs.existsSync(`${target}.lock`), true)
}

// A lock whose contents never reached disk has no owner to prove alive, so it
// is taken over on age alone and respected while it is fresh.
{
  const directory = temporaryDirectory('unreadable')
  const target = path.join(directory, 'journal.json')
  const lockPath = `${target}.lock`
  fs.writeFileSync(lockPath, '', { encoding: 'utf8', mode: 0o600 })
  let elapsed = 0
  assert.equal(isJournalLockedError(captureThrow(() => withFileLock(target, () => 'unreachable', {
    now: () => Date.now() + elapsed,
    sleep: (milliseconds: number) => { elapsed += milliseconds },
    staleAfterMs: 120_000,
    timeoutMs: 1_000,
  }))), true)
  assert.equal(fs.existsSync(lockPath), true)
  assert.equal(
    withFileLock(target, () => 'took-over', {
      now: () => Date.now() + 500_000,
      staleAfterMs: 120_000,
    }),
    'took-over',
  )
  assert.equal(fs.existsSync(lockPath), false)
}

// Release only ever unlinks a lock this process can still prove is its own.
{
  const directory = temporaryDirectory('token')
  const target = path.join(directory, 'journal.json')
  const lockPath = `${target}.lock`
  withFileLock(target, () => {
    // Simulate another holder having taken the lock over in the meantime.
    writeLockFile(lockPath, {
      acquiredAt: Date.now(),
      host: os.hostname(),
      pid: process.pid,
      token: 'someone-elses-token',
    })
  })
  assert.equal(
    (JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { token: string }).token,
    'someone-elses-token',
  )
  fs.rmSync(lockPath, { force: true })
}

// A failed lock write leaves no lock file behind.
{
  const directory = temporaryDirectory('lock-write-fault')
  const target = path.join(directory, 'journal.json')
  const faultOps = {
    ...fs,
    writeFileSync: () => { throw new Error('injected lock write failure') },
  } as unknown as DurableFileOps
  assert.throws(
    () => withFileLock(target, () => 'unreachable', { fileOps: faultOps }),
    /injected lock write failure/,
  )
  assert.equal(fs.existsSync(`${target}.lock`), false)
}

// A journal directory that does not exist cannot be shared, so no lock file is
// demanded of it.
{
  const directory = path.join(temporaryDirectory('absent'), 'not-created')
  const target = path.join(directory, 'journal.json')
  assert.equal(withFileLock(target, () => 'unlocked'), 'unlocked')
  assert.equal(fs.existsSync(`${target}.lock`), false)
}

console.log('Durable JSON file and journal lock tests passed.')
