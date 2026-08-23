import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  collectQortalExternalInstallHints,
  probeQortalExternalInstallCollision,
} from './home-v2-qortal-maintenance-discovery-policy.js'
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
    JSON.stringify({ qortalDirectory: managedInstallPath }),
  )
  const managedHub = await collectQortalExternalInstallHints(paths, {
    appDataPath,
    homePath,
    platform: 'linux',
    programFilesPath,
  })
  assert.equal(managedHub.hints.some((hint) => hint.origin === 'qortal-hub'), false,
    'a Hub hint for Home managed storage must not become an external collision')
  await writeFile(
    path.join(appDataPath, 'qortal-hub', 'wallet-storage.json'),
    JSON.stringify({ qortalDirectory: hubDirectory }),
  )
  await mkdir(hubDirectory, { recursive: true })
  await writeFile(path.join(hubDirectory, 'qortal.jar'), 'jar')
  assert.equal(await probe(), 'detected')
  const collected = await collectQortalExternalInstallHints(paths, {
    appDataPath,
    homePath,
    platform: 'linux',
    programFilesPath,
  })
  assert.equal(collected.kind, 'observed')
  assert.equal(collected.hints.some((hint) => hint.origin === 'qortal-hub' && hint.hubHint === true), true)
  assert.equal(collected.hints.some((hint) => hint.installPath === managedInstallPath), false)
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

  const storagePath = path.join(appDataPath, 'qortal-hub', 'wallet-storage.json')
  await writeFile(storagePath, Buffer.alloc(1024 * 1024 + 1))
  assert.equal(await probe(), 'unknown', 'oversized Hub configuration must fail closed')

  if (process.platform !== 'win32') {
    const storageTarget = path.join(root, 'wallet-storage-target.json')
    await writeFile(storageTarget, JSON.stringify({ qortalDirectory: hubDirectory }))
    await rm(storagePath)
    await symlink(storageTarget, storagePath)
    assert.equal(await probe(), 'unknown', 'a Hub storage symlink must fail closed')
    await rm(storagePath)
  } else {
    await rm(storagePath)
  }
  await writeFile(storagePath, JSON.stringify({ qortalDirectory: hubDirectory }))
  assert.equal(await probeQortalExternalInstallCollision(paths, {
    appDataPath,
    homePath,
    platform: 'linux',
    programFilesPath,
  }, { operations: {
    openHubFile: async () => {
      throw Object.assign(new Error('disappeared after lstat'), { code: 'ENOENT' })
    },
  } }), 'unknown', 'a Hub storage disappearance after observation must fail closed')
  const stableStats = await lstat(storagePath)
  let storageStatsReads = 0
  assert.equal(await probeQortalExternalInstallCollision(paths, {
    appDataPath,
    homePath,
    platform: 'linux',
    programFilesPath,
  }, { operations: {
    lstat: async (targetPath) => {
      const stats = await lstat(targetPath)
      if (targetPath !== storagePath || ++storageStatsReads < 2) return stats
      return new Proxy(stableStats, { get(target, property, receiver) {
        return property === 'ino' ? target.ino + 1 : Reflect.get(target, property, receiver)
      } })
    },
  } }), 'unknown', 'a Hub storage identity race must fail closed')
  assert.equal(await probe('freebsd'), 'unknown')
} finally {
  await rm(root, { force: true, recursive: true })
}

console.log('Home v2 Qortal external-install collision checks passed.')
