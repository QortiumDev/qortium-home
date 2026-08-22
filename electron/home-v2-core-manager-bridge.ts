import { app, ipcMain } from 'electron'
import { requireCoreManagerEntry } from './core-manager.js'
import { assertAuthorizedHomeV2Sender } from './home-v2-authorized-senders.js'
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
