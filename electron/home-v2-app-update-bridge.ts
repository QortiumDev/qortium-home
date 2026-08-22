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

export function registerHomeV2AppUpdateBridgeIpcHandlers() {
  const service = createHomeV2AppUpdateService({
    downloadAsset: downloadVerifiedAppUpdate,
    fetchRelease: fetchTrustedHomeRelease,
    getEnvironment: getUpdateEnvironment,
    openReleasePage: openExternalUrl,
    revealDownloadedFile: showDownloadedFile,
  })
  const handlers = createAuthorizedHomeV2AppUpdateHandlers(
    assertAuthorizedHomeV2Sender,
    service,
  )
  ipcMain.handle('home-v2-app-update:check', handlers.check)
  ipcMain.handle('home-v2-app-update:download', handlers.download)
  ipcMain.handle('home-v2-app-update:reveal', handlers.reveal)
  ipcMain.handle('home-v2-app-update:open-release-page', handlers.openReleasePage)
}
