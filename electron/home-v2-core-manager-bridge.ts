import { app, ipcMain } from 'electron'
import {
  requireCoreManagerEntry,
  revealHomeV2CoreInstall,
  setHomeV2CoreProgressListener,
} from './core-manager.js'
import {
  revealHomeV2ManagedI2pd,
  setHomeV2I2pdProgressListener,
} from './i2pd-manager.js'
import {
  assertAuthorizedHomeV2Sender,
  broadcastToHomeV2Windows,
} from './home-v2-authorized-senders.js'
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
  createAuthorizedHomeV2QortalAdoptionHandlers,
  HomeV2QortalAdoptionService,
} from './home-v2-qortal-adoption-contract.js'
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

/**
 * One Core install/update progress event, addressed only to authorized Home
 * windows.
 *
 * Schema'd and revisioned like every other Home 2 event: the renderer parses
 * it rather than trusting it, so a malformed or unexpected payload renders
 * nothing instead of a wrong percentage.
 *
 * `percent` is optional because the underlying phases are honest about it —
 * "checking" and "extracting" have no meaningful denominator, only
 * "downloading" does. The UI shows an indeterminate state rather than
 * inventing a number.
 */
function broadcastHomeV2CoreProgress(progress: {
  readonly action: string
  readonly kind: string
  readonly message: string
  readonly percent?: number
}) {
  broadcastToHomeV2Windows('home-v2-core-manager:progress', {
    action: progress.action,
    kind: progress.kind,
    message: progress.message,
    percent: typeof progress.percent === 'number' && Number.isFinite(progress.percent)
      ? Math.max(0, Math.min(100, Math.round(progress.percent)))
      : null,
    revision: 1,
    schema: 'home-v2-core-manager-progress',
  })
}

/**
 * The I2P router's install progress, in the same envelope as the Core's.
 *
 * i2pd-manager emits these behind a legacy flag that Home 2 turns OFF at
 * startup, so before this the router could download and extract with the panel
 * showing nothing at all.
 */
function broadcastHomeV2TransportProgress(progress: {
  readonly action: string
  readonly kind: string
  readonly message: string
  readonly percent?: number
}) {
  broadcastToHomeV2Windows('home-v2-transport:progress', {
    action: progress.action,
    kind: progress.kind,
    message: progress.message,
    percent: typeof progress.percent === 'number' && Number.isFinite(progress.percent)
      ? Math.max(0, Math.min(100, Math.round(progress.percent)))
      : null,
    revision: 1,
    schema: 'home-v2-transport-progress',
  })
}

export function registerHomeV2CoreManagerBridgeIpcHandlers() {
  setHomeV2CoreProgressListener(broadcastHomeV2CoreProgress)
  setHomeV2I2pdProgressListener(broadcastHomeV2TransportProgress)
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
    resolveQortalManager() {
      const manager = requireCoreManagerEntry('qortal')
      if (manager.networkId !== 'qortal') throw new Error('Qortal Core manager is unavailable.')
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
  // Opens the install folder in the desktop file manager. The path is resolved and
  // used inside the main process; the renderer receives only whether it opened.
  ipcMain.handle('home-v2-core-manager:revealInstall', async (event) => {
    assertAuthorizedHomeV2Sender(event)
    return await revealHomeV2CoreInstall()
  })
  ipcMain.handle('home-v2-core-manager:start', handlers.start)
  ipcMain.handle('home-v2-core-manager:stop', async (event, value) => {
    const result = await handlers.stop(event, value)
    if (result.network === 'qortium' && result.outcome === 'completed') {
      void scheduler.trigger()
    }
    return result
  })
  const qortalMaintenanceService = createHomeV2QortalMaintenanceService({
    probeDiscovery: probeHomeV2QortalInstallDiscovery,
    resolveManager: () => requireCoreManagerEntry('qortal'),
  })
  const qortalMaintenanceHandlers = createAuthorizedHomeV2QortalMaintenanceHandlers(
    assertAuthorizedHomeV2Sender,
    qortalMaintenanceService,
  )
  ipcMain.handle('home-v2-qortal-maintenance:getStatus', qortalMaintenanceHandlers.getStatus)
  ipcMain.handle('home-v2-qortal-maintenance:checkRelease', qortalMaintenanceHandlers.checkRelease)
  ipcMain.handle('home-v2-qortal-maintenance:runAction', async (event, value) => {
    const result = await qortalMaintenanceHandlers.runAction(event, value)
    if (result.code !== 'operation-in-progress') void scheduler.trigger()
    return result
  })
  const qortalAdoptionHandlers = createAuthorizedHomeV2QortalAdoptionHandlers(
    assertAuthorizedHomeV2Sender,
    new HomeV2QortalAdoptionService({
      getMaintenanceStatus: async () => await qortalMaintenanceService.getStatus({
        network: 'qortal',
        revision: 1,
        schema: 'home-v2-qortal-maintenance-request',
      }),
      resolveManager: () => requireCoreManagerEntry('qortal'),
    }),
  )
  ipcMain.handle('home-v2-qortal-adoption:list', qortalAdoptionHandlers.list)
  ipcMain.handle('home-v2-qortal-adoption:browse', qortalAdoptionHandlers.browse)
  ipcMain.handle('home-v2-qortal-adoption:select', qortalAdoptionHandlers.select)
  const transportMaintenanceHandlers = createAuthorizedHomeV2TransportMaintenanceHandlers(
    assertAuthorizedHomeV2Sender,
    createHomeV2TransportMaintenanceService(createHomeV2TransportMaintenanceDependencies({
      acquireInteractiveLease: () =>
        homeV2CoreOperationCoordinator.tryBeginInteractive(['qortium']),
      inspectRouter: inspectI2pdMaintenance,
      installRouter: installI2pd,
      resolveManager: () => requireCoreManagerEntry('qortium'),
      revealManagedRouter: revealHomeV2ManagedI2pd,
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
