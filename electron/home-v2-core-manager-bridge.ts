import { ipcMain } from 'electron'
import { requireCoreManagerEntry } from './core-manager.js'
import { assertAuthorizedHomeV2Sender } from './home-v2-authorized-senders.js'
import {
  createAuthorizedHomeV2CoreManagerHandlers,
  createHomeV2CoreManagerService,
} from './home-v2-core-manager-contract.js'

export function registerHomeV2CoreManagerBridgeIpcHandlers() {
  const handlers = createAuthorizedHomeV2CoreManagerHandlers(
    assertAuthorizedHomeV2Sender,
    createHomeV2CoreManagerService(requireCoreManagerEntry),
  )
  ipcMain.handle('home-v2-core-manager:getStatus', handlers.getStatus)
  ipcMain.handle('home-v2-core-manager:start', handlers.start)
  ipcMain.handle('home-v2-core-manager:stop', handlers.stop)
}

