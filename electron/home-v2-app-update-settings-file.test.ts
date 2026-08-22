import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHomeV2AppUpdateSettingsFile } from './home-v2-app-update-settings-file.js'

const directory = await mkdtemp(path.join(os.tmpdir(), 'qortium-home-update-settings-'))
const destination = path.join(directory, 'settings.json')
const storage = createHomeV2AppUpdateSettingsFile(() => destination)

try {
  assert.deepEqual(await storage.read(), {
    generation: 0,
    homeUpdatePolicy: 'notify',
    releaseChannel: 'stable',
  })
  const first = await storage.write(0, {
    homeUpdatePolicy: 'off',
    releaseChannel: 'prerelease',
  })
  assert.equal(first.generation, 1)
  assert.deepEqual(await storage.read(), first)
  assert.equal((await stat(destination)).mode & 0o777, 0o600)
  await assert.rejects(storage.write(0, {
    homeUpdatePolicy: 'notify',
    releaseChannel: 'stable',
  }), /changed/)
  const competing = await Promise.allSettled([
    storage.write(1, { homeUpdatePolicy: 'notify', releaseChannel: 'stable' }),
    storage.write(1, { homeUpdatePolicy: 'off', releaseChannel: 'stable' }),
  ])
  assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(competing.filter((result) => result.status === 'rejected').length, 1)
  assert.equal((await storage.read()).generation, 2)
  assert.equal((await readdir(directory)).some((name) => name.endsWith('.tmp')), false)

  await writeFile(destination, '{not json', 'utf8')
  await assert.rejects(storage.read(), /JSON/)
  await writeFile(destination, 'x'.repeat(16 * 1024 + 1), 'utf8')
  await assert.rejects(storage.read(), /too large/)
} finally {
  await rm(directory, { force: true, recursive: true })
}

console.log('Home 2 app update settings file tests passed.')
