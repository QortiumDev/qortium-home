import { app, ipcMain } from 'electron'
import { requireCoreManagerEntry } from './core-manager.js'
import { assertAuthorizedHomeV2Sender } from './home-v2-authorized-senders.js'
import { homeV2CoreOperationCoordinator } from './home-v2-core-operation-coordinator.js'
import {
  createAuthorizedHomeV2CoreManagerHandlers,
  createHomeV2CoreManagerService,
} from './home-v2-core-manager-contract.js'
import {
  createAuthorizedHomeV2CoreUpdatePolicyHandlers,
  createHomeV2CoreUpdatePolicyService,
} from './home-v2-core-update-policy-contract.js'
import {
  createHomeV2CoreUpdatePolicyEngine,
  createHomeV2CoreUpdatePolicyScheduler,
} from './home-v2-core-update-policy-engine.js'
import {
  readHomeV2CoreUpdatePolicySettings,
  replaceHomeV2CoreUpdatePolicySettings,
} from './home-v2-core-update-policy-storage.js'
import {
  createAuthorizedHomeV2QortalMaintenanceHandlers,
  createHomeV2QortalMaintenanceService,
} from './home-v2-qortal-maintenance-contract.js'
import { probeHomeV2QortalInstallDiscovery } from './home-v2-qortal-maintenance-discovery.js'
import {
  createAuthorizedHomeV2TransportMaintenanceHandlers,
  createHomeV2TransportMaintenanceService,
} from './home-v2-transport-maintenance-contract.js'
import { createHomeV2TransportMaintenanceDependencies } from './home-v2-transport-maintenance-adapter.js'
import {
  inspectMaintenance as inspectI2pdMaintenance,
  install as installI2pd,
  start as startI2pd,
  stopIfManaged as stopI2pdIfManaged,
} from './i2pd-manager.js'

export function registerHomeV2CoreManagerBridgeIpcHandlers() {
  const handlers = createAuthorizedHomeV2CoreManagerHandlers(
    assertAuthorizedHomeV2Sender,
    createHomeV2CoreManagerService(requireCoreManagerEntry),
  )
  const engine = createHomeV2CoreUpdatePolicyEngine({
    readSettings: readHomeV2CoreUpdatePolicySettings,
    resolveManager() {
      const manager = requireCoreManagerEntry('qortium')
      if (manager.networkId !== 'qortium') throw new Error('Qortium Core manager is unavailable.')
      return manager
    },
  })
  const scheduler = createHomeV2CoreUpdatePolicyScheduler(() => engine.runPass())
  ipcMain.handle('home-v2-core-manager:getStatus', handlers.getStatus)
  ipcMain.handle('home-v2-core-manager:getMaintenanceStatus', handlers.getMaintenanceStatus)
  ipcMain.handle('home-v2-core-manager:checkMaintenanceRelease', handlers.checkMaintenanceRelease)
  ipcMain.handle('home-v2-core-manager:runMaintenanceAction', async (event, value) => {
    const result = await handlers.runMaintenanceAction(event, value)
    if (result.outcome === 'completed') void scheduler.trigger()
    return result
  })
  ipcMain.handle('home-v2-core-manager:start', handlers.start)
  ipcMain.handle('home-v2-core-manager:stop', async (event, value) => {
    const result = await handlers.stop(event, value)
    if (result.network === 'qortium' && result.outcome === 'completed') {
      void scheduler.trigger()
    }
    return result
  })
  const qortalMaintenanceHandlers = createAuthorizedHomeV2QortalMaintenanceHandlers(
    assertAuthorizedHomeV2Sender,
    createHomeV2QortalMaintenanceService({
      probeDiscovery: probeHomeV2QortalInstallDiscovery,
      resolveManager: () => requireCoreManagerEntry('qortal'),
    }),
  )
  ipcMain.handle('home-v2-qortal-maintenance:getStatus', qortalMaintenanceHandlers.getStatus)
  ipcMain.handle('home-v2-qortal-maintenance:checkRelease', qortalMaintenanceHandlers.checkRelease)
  ipcMain.handle('home-v2-qortal-maintenance:runAction', async (event, value) => {
    const result = await qortalMaintenanceHandlers.runAction(event, value)
    if (result.code !== 'operation-in-progress') void scheduler.trigger()
    return result
  })
  const transportMaintenanceHandlers = createAuthorizedHomeV2TransportMaintenanceHandlers(
    assertAuthorizedHomeV2Sender,
    createHomeV2TransportMaintenanceService(createHomeV2TransportMaintenanceDependencies({
      acquireInteractiveLease: () =>
        homeV2CoreOperationCoordinator.tryBeginInteractive(['qortium']),
      inspectRouter: inspectI2pdMaintenance,
      installRouter: installI2pd,
      resolveManager: () => requireCoreManagerEntry('qortium'),
      startRouter: startI2pd,
      stopManagedRouter: stopI2pdIfManaged,
    })),
  )
  ipcMain.handle(
    'home-v2-core-manager:getTransportMaintenanceStatus',
    transportMaintenanceHandlers.getStatus,
  )
  ipcMain.handle(
    'home-v2-core-manager:runTransportMaintenanceAction',
    transportMaintenanceHandlers.runAction,
  )
  const policyHandlers = createAuthorizedHomeV2CoreUpdatePolicyHandlers(
    assertAuthorizedHomeV2Sender,
    createHomeV2CoreUpdatePolicyService({
      getActivity: () => engine.getActivity(),
      read: readHomeV2CoreUpdatePolicySettings,
      replace: replaceHomeV2CoreUpdatePolicySettings,
      trigger: () => scheduler.trigger(),
    }),
  )
  ipcMain.handle('home-v2-core-manager:getUpdatePolicy', policyHandlers.get)
  ipcMain.handle('home-v2-core-manager:setUpdatePolicy', policyHandlers.set)
  scheduler.start()
  app.once('before-quit', () => scheduler.stop())
}
