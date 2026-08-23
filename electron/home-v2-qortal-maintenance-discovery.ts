import { app } from 'electron'
import type { QortalCoreManager } from './qortal-core-manager.js'
import type { QortalManagedInstallPaths } from './qortal-managed-install.js'
import type { HomeV2QortalDiscoveryProbe } from './home-v2-qortal-maintenance-contract.js'
import { probeQortalExternalInstallCollision } from './home-v2-qortal-maintenance-discovery-policy.js'

export function probeProductionQortalExternalInstallCollision(
  managedPaths: QortalManagedInstallPaths,
) {
  return probeQortalExternalInstallCollision(managedPaths, {
    appDataPath: app.getPath('appData'),
    homePath: app.getPath('home'),
    platform: process.platform,
    programFilesPath: process.env.ProgramFiles,
  })
}

export const probeHomeV2QortalInstallDiscovery: HomeV2QortalDiscoveryProbe = async (
  manager: QortalCoreManager,
) => {
  const collision = await probeProductionQortalExternalInstallCollision(manager.config.paths)
  return collision === 'clear' ? 'clear' : collision === 'detected' ? 'candidate-found' : 'unknown'
}
