import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHomeV2CoreUpdatePolicyFile } from './home-v2-core-update-policy-file.js'

const root = await mkdtemp(path.join(os.tmpdir(), 'qortium-core-policy-'))
try {
  const destination = path.join(root, 'settings.json')
  const storage = createHomeV2CoreUpdatePolicyFile(
    () => destination,
    async () => ({ coreUpdatePolicy: 'notify', javaUpdatePolicy: 'install', qortalUpdatePolicy: 'notify' }),
  )
  const initial = await storage.read()
  assert.deepEqual(initial, {
    coreUpdatePolicy: 'notify',
    generation: 0,
    javaUpdatePolicy: 'install',
    qortalUpdatePolicy: 'notify',
    storageIssue: null,
  })
  if (process.platform !== 'win32') {
    assert.equal((await stat(destination)).mode & 0o777, 0o600)
    assert.equal((await stat(root)).mode & 0o777, 0o700)
  }

  const next = await storage.replace(0, {
    coreUpdatePolicy: 'off',
    javaUpdatePolicy: 'notify',
    qortalUpdatePolicy: 'install',
  })
  assert.equal(next.generation, 1)
  await assert.rejects(
    storage.replace(0, {
      coreUpdatePolicy: 'install', javaUpdatePolicy: 'install', qortalUpdatePolicy: 'notify',
    }),
    (error: unknown) => (error as { code?: unknown }).code === 'SETTINGS_CHANGED',
  )

  await writeFile(destination, JSON.stringify({
    coreUpdatePolicy: 'install',
    javaUpdatePolicy: 'off',
  }), 'utf8')
  const migrated = await storage.read()
  assert.equal(migrated.coreUpdatePolicy, 'install')
  assert.equal(migrated.javaUpdatePolicy, 'off')
  assert.equal(migrated.qortalUpdatePolicy, 'notify')
  assert.equal(JSON.parse(await readFile(destination, 'utf8')).schema, 'qortium-home-v2-core-update-policy')

  await writeFile(destination, JSON.stringify({
    coreUpdatePolicy: 'off',
    generation: 9,
    javaUpdatePolicy: 'install',
    schema: 'qortium-home-v2-core-update-policy',
    version: 1,
  }), 'utf8')
  const versionOne = await storage.read()
  assert.equal(versionOne.coreUpdatePolicy, 'off')
  assert.equal(versionOne.generation, 9)
  assert.equal(versionOne.javaUpdatePolicy, 'install')
  assert.equal(versionOne.qortalUpdatePolicy, 'notify')
  assert.equal(JSON.parse(await readFile(destination, 'utf8')).version, 2)

  await writeFile(destination, '{broken', 'utf8')
  const failedClosed = await storage.read()
  assert.equal(failedClosed.coreUpdatePolicy, 'off')
  assert.equal(failedClosed.javaUpdatePolicy, 'off')
  assert.equal(failedClosed.qortalUpdatePolicy, 'off')
  assert.equal(failedClosed.storageIssue, 'invalid')
  const recovered = await storage.replace(0, {
    coreUpdatePolicy: 'notify',
    javaUpdatePolicy: 'notify',
    qortalUpdatePolicy: 'notify',
  })
  assert.equal(recovered.generation, 1)
  assert.equal(recovered.storageIssue, null)

  await writeFile(destination, 'x'.repeat(17 * 1024), 'utf8')
  assert.equal((await storage.read()).storageIssue, 'invalid')

  if (process.platform !== 'win32') {
    const target = path.join(root, 'target.json')
    await writeFile(target, '{}', 'utf8')
    await rm(destination, { force: true })
    await symlink(target, destination)
    assert.equal((await storage.read()).storageIssue, 'invalid')
    await rm(destination, { force: true })
  }

  await writeFile(destination, JSON.stringify({
    coreUpdatePolicy: 'notify',
    generation: Number.MAX_SAFE_INTEGER - 1,
    javaUpdatePolicy: 'notify',
    qortalUpdatePolicy: 'notify',
    schema: 'qortium-home-v2-core-update-policy',
    version: 2,
  }), 'utf8')
  await assert.rejects(
    storage.replace(Number.MAX_SAFE_INTEGER - 1, {
      coreUpdatePolicy: 'off',
      javaUpdatePolicy: 'notify',
      qortalUpdatePolicy: 'notify',
    }),
    /generation is exhausted/,
  )
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('Core update settings file tests passed.')
