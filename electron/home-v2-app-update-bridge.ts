import { ipcMain } from 'electron'
import {
  downloadVerifiedAppUpdate,
  getUpdateEnvironment,
  openExternalUrl,
  showDownloadedFile,
} from './app-updates.js'
import { fetchTrustedHomeRelease } from './app-update-discovery.js'
import { assertAuthorizedHomeV2Sender } from './home-v2-authorized-senders.js'
import {
  createAuthorizedHomeV2AppUpdateHandlers,
  createHomeV2AppUpdateService,
} from './home-v2-app-update-contract.js'
import {
  createAuthorizedHomeV2AppUpdateSettingsHandlers,
  createHomeV2AppUpdateSettingsService,
} from './home-v2-app-update-settings-contract.js'
import {
  readHomeV2AppUpdateSettings,
  writeHomeV2AppUpdateSettings,
} from './home-v2-app-update-settings-storage.js'

export function registerHomeV2AppUpdateBridgeIpcHandlers() {
  const service = createHomeV2AppUpdateService({
    downloadAsset: downloadVerifiedAppUpdate,
    fetchRelease: fetchTrustedHomeRelease,
    getEnvironment: getUpdateEnvironment,
    readSettings: readHomeV2AppUpdateSettings,
    openReleasePage: openExternalUrl,
    revealDownloadedFile: showDownloadedFile,
  })
  const handlers = createAuthorizedHomeV2AppUpdateHandlers(
    assertAuthorizedHomeV2Sender,
    service,
  )
  const settingsHandlers = createAuthorizedHomeV2AppUpdateSettingsHandlers(
    assertAuthorizedHomeV2Sender,
    createHomeV2AppUpdateSettingsService({
      read: readHomeV2AppUpdateSettings,
      write: writeHomeV2AppUpdateSettings,
    }),
  )
  ipcMain.handle('home-v2-app-update:check', handlers.check)
  ipcMain.handle('home-v2-app-update:download', handlers.download)
  ipcMain.handle('home-v2-app-update:reveal', handlers.reveal)
  ipcMain.handle('home-v2-app-update:open-release-page', handlers.openReleasePage)
  ipcMain.handle('home-v2-app-update:get-settings', settingsHandlers.get)
  ipcMain.handle('home-v2-app-update:set-settings', settingsHandlers.set)
  ipcMain.handle('home-v2-app-update:claim-automatic', settingsHandlers.claimAutomatic)
}
