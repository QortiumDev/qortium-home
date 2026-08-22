import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { probeQortalExternalInstallCollision } from './home-v2-qortal-maintenance-discovery-policy.js'
import type { QortalManagedInstallPaths } from './qortal-managed-install.js'

const root = await mkdtemp(path.join(os.tmpdir(), 'qortal-collision-probe-'))
const appDataPath = path.join(root, 'app-data')
const homePath = path.join(root, 'home')
const programFilesPath = path.join(root, 'program-files')
const managedInstallPath = path.join(appDataPath, 'qortal-core', 'install')
const paths = {
  installPath: managedInstallPath,
  jarPath: path.join(managedInstallPath, 'qortal.jar'),
} as QortalManagedInstallPaths

async function probe(platform: NodeJS.Platform = 'linux') {
  return await probeQortalExternalInstallCollision(paths, {
    appDataPath,
    homePath,
    platform,
    programFilesPath,
  })
}

try {
  assert.equal(await probe(), 'clear')

  const conventional = path.join(homePath, 'qortal')
  await mkdir(conventional, { recursive: true })
  await writeFile(path.join(conventional, 'qortal.jar'), 'jar-with-no-settings')
  assert.equal(await probe(), 'detected', 'settings.json is not required to block a duplicate install')
  await rm(conventional, { recursive: true })

  const uppercase = path.join(homePath, 'Qortal')
  await mkdir(uppercase, { recursive: true })
  await writeFile(path.join(uppercase, 'qortal.jar'), 'jar')
  assert.equal(await probe(), 'detected')
  await rm(uppercase, { recursive: true })

  const hubDirectory = path.join(root, 'custom-hub-qortal')
  await mkdir(path.join(appDataPath, 'qortal-hub'), { recursive: true })
  await writeFile(
    path.join(appDataPath, 'qortal-hub', 'wallet-storage.json'),
    JSON.stringify({ qortalDirectory: hubDirectory }),
  )
  await mkdir(hubDirectory, { recursive: true })
  await writeFile(path.join(hubDirectory, 'qortal.jar'), 'jar')
  assert.equal(await probe(), 'detected')
  await rm(hubDirectory, { recursive: true })

  assert.equal(await probeQortalExternalInstallCollision(paths, {
    appDataPath,
    homePath,
    platform: 'win32',
  }), 'unknown', 'missing Windows Program Files authority must fail closed')
  assert.equal(await probeQortalExternalInstallCollision(paths, {
    appDataPath,
    homePath,
    platform: 'win32',
    programFilesPath: 'relative-program-files',
  }), 'unknown', 'relative Windows Program Files authority must fail closed')

  await writeFile(
    path.join(appDataPath, 'qortal-hub', 'wallet-storage.json'),
    JSON.stringify({ qortalDirectory: 'relative/qortal' }),
  )
  assert.equal(await probe(), 'unknown', 'relative Hub directories must fail closed')

  await writeFile(path.join(appDataPath, 'qortal-hub', 'wallet-storage.json'), '{')
  assert.equal(await probe(), 'unknown', 'uncertain Hub configuration must fail closed')
  assert.equal(await probe('freebsd'), 'unknown')
} finally {
  await rm(root, { force: true, recursive: true })
}

console.log('Home v2 Qortal external-install collision checks passed.')
