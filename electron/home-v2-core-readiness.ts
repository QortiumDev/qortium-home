import { app } from 'electron'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  detectHomeV2CoreInstall,
  parseQortalHubDirectory,
  type HomeV2CoreNetwork,
} from './home-v2-core-readiness-policy.js'
export type { HomeV2LocalCoreInstallState } from './home-v2-core-readiness-policy.js'

function readQortalHubDirectory() {
  try {
    const filePath = path.join(
      app.getPath('appData'),
      'qortal-hub',
      'wallet-storage.json',
    )
    return parseQortalHubDirectory(
      JSON.parse(readFileSync(filePath, 'utf8')) as unknown,
    )
  } catch {
    return null
  }
}

export function getHomeV2LocalCoreInstallState(
  network: HomeV2CoreNetwork,
) {
  return detectHomeV2CoreInstall(network, {
    appDataPath: app.getPath('appData'),
    homePath: app.getPath('home'),
    platform: process.platform,
    programFilesPath: process.env.ProgramFiles,
    qortalHubDirectory:
      network === 'qortal' ? readQortalHubDirectory() : null,
  })
}
