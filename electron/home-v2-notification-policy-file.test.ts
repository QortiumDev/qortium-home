import assert from 'node:assert/strict'
import { mkdtemp, open, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHomeV2NotificationPolicyFile } from './home-v2-notification-policy-file.js'

const root = await mkdtemp(path.join(os.tmpdir(), 'qortium-notification-policy-'))
const expectedDefault = {
  enabled: true,
  generation: 0,
  schema: 'qortium-home-v2-notification-policy',
  status: 'available',
  version: 1,
}

try {
  const destination = path.join(root, 'home-v2-notification-policy.json')
  const storage = createHomeV2NotificationPolicyFile(() => destination)
  assert.deepEqual(await storage.read(), expectedDefault)

  const first = await storage.set(0, false)
  assert.equal(first.changed, true)
  assert.equal(first.snapshot.generation, 1)
  assert.equal(first.snapshot.enabled, false)
  if (process.platform !== 'win32') {
    assert.equal((await stat(destination)).mode & 0o777, 0o600)
  }
  assert.equal(
    (await readdir(root)).some((name) => name.endsWith('.tmp')),
    false,
  )
  assert.deepEqual(JSON.parse(await readFile(destination, 'utf8')), {
    enabled: false,
    generation: 1,
    schema: 'qortium-home-v2-notification-policy',
    version: 1,
  })

  const noOp = await storage.set(1, false)
  assert.equal(noOp.changed, false)
  assert.equal(noOp.snapshot.generation, 1)
  await assert.rejects(storage.set(0, true), (error: unknown) =>
    (error as { code?: unknown }).code === 'SETTINGS_CHANGED')
  const competing = await Promise.allSettled([
    storage.set(1, true),
    storage.set(1, true),
  ])
  assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(competing.filter((result) => result.status === 'rejected').length, 1)

  const corruptPath = path.join(root, 'corrupt.json')
  await writeFile(corruptPath, '{broken', 'utf8')
  const corrupt = createHomeV2NotificationPolicyFile(() => corruptPath)
  assert.equal((await corrupt.read()).status, 'corrupt')
  await assert.rejects(corrupt.set(0, true), /storage is corrupt/)
  assert.equal(await readFile(corruptPath, 'utf8'), '{broken')

  const unknownPath = path.join(root, 'unknown.json')
  const unknownBytes = JSON.stringify({
    enabled: true,
    extra: true,
    generation: 0,
    schema: 'qortium-home-v2-notification-policy',
    version: 1,
  })
  await writeFile(unknownPath, unknownBytes, 'utf8')
  assert.equal(
    (await createHomeV2NotificationPolicyFile(() => unknownPath).read()).status,
    'corrupt',
  )
  assert.equal(await readFile(unknownPath, 'utf8'), unknownBytes)

  const oversizePath = path.join(root, 'oversize.json')
  await writeFile(oversizePath, 'x'.repeat(16 * 1024 + 1), 'utf8')
  assert.equal(
    (await createHomeV2NotificationPolicyFile(() => oversizePath).read()).status,
    'corrupt',
  )

  if (process.platform !== 'win32') {
    const symlinkPath = path.join(root, 'symlink.json')
    await symlink(destination, symlinkPath)
    assert.equal(
      (await createHomeV2NotificationPolicyFile(() => symlinkPath).read()).status,
      'corrupt',
    )
  }

  const unreadable = createHomeV2NotificationPolicyFile(() => destination, {
    open: async () => {
      const error = new Error('denied') as NodeJS.ErrnoException
      error.code = 'EACCES'
      throw error
    },
  })
  assert.deepEqual(await unreadable.read(), {
    enabled: false,
    generation: null,
    schema: 'qortium-home-v2-notification-policy',
    status: 'unavailable',
    version: 1,
  })

  const identityPath = path.join(root, 'identity.json')
  const identityReplacementPath = path.join(root, 'identity-replacement.json')
  await writeFile(identityPath, JSON.stringify({
    enabled: false,
    generation: 2,
    schema: 'qortium-home-v2-notification-policy',
    version: 1,
  }), 'utf8')
  await writeFile(identityReplacementPath, JSON.stringify({
    enabled: true,
    generation: 9,
    schema: 'qortium-home-v2-notification-policy',
    version: 1,
  }), 'utf8')
  const identityMismatch = createHomeV2NotificationPolicyFile(() => identityPath, {
    async open(target, flags, mode) {
      return open(target === identityPath ? identityReplacementPath : target, flags, mode)
    },
  })
  assert.equal((await identityMismatch.read()).status, 'corrupt')

  const failedPath = path.join(root, 'failed-write.json')
  const failedStorage = createHomeV2NotificationPolicyFile(() => failedPath, {
    rename: async () => { throw new Error('injected rename failure') },
  })
  assert.deepEqual(await failedStorage.read(), expectedDefault)
  await assert.rejects(failedStorage.set(0, false), /injected rename failure/)
  assert.deepEqual(await failedStorage.read(), expectedDefault)
  assert.equal(
    (await readdir(root)).some((name) => name.startsWith('failed-write.json.') && name.endsWith('.tmp')),
    false,
  )

  const exhaustedPath = path.join(root, 'exhausted.json')
  await writeFile(exhaustedPath, JSON.stringify({
    enabled: true,
    generation: Number.MAX_SAFE_INTEGER,
    schema: 'qortium-home-v2-notification-policy',
    version: 1,
  }), 'utf8')
  const exhausted = createHomeV2NotificationPolicyFile(() => exhaustedPath)
  await assert.rejects(
    exhausted.set(Number.MAX_SAFE_INTEGER, false),
    /generation is exhausted/,
  )
  assert.equal(JSON.parse(await readFile(exhaustedPath, 'utf8')).enabled, true)

  if (process.platform !== 'win32') {
    const racePath = path.join(root, 'race.json')
    const openedPath = path.join(root, 'race-opened.json')
    const replacementPath = path.join(root, 'race-replacement.json')
    await writeFile(racePath, JSON.stringify({
      enabled: false,
      generation: 2,
      schema: 'qortium-home-v2-notification-policy',
      version: 1,
    }), 'utf8')
    await writeFile(replacementPath, JSON.stringify({
      enabled: true,
      generation: 9,
      schema: 'qortium-home-v2-notification-policy',
      version: 1,
    }), 'utf8')
    let swapped = false
    const stableHandleStorage = createHomeV2NotificationPolicyFile(() => racePath, {
      async open(target, flags, mode) {
        const handle = await open(target, flags, mode)
        if (!swapped && target === racePath) {
          swapped = true
          await rename(racePath, openedPath)
          await symlink(replacementPath, racePath)
        }
        return handle
      },
    })
    const stableSnapshot = await stableHandleStorage.read()
    assert.equal(stableSnapshot.enabled, false)
    assert.equal(stableSnapshot.generation, 2)
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('Home 2 notification policy file tests passed.')
