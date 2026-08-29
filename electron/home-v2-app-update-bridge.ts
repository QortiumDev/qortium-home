import { ipcMain } from 'electron'
import {
  downloadVerifiedAppUpdate,
  setHomeV2AppDownloadProgressListener,
  getUpdateEnvironment,
  openDownloadedFile,
  openExternalUrl,
  showDownloadedFile,
} from './app-updates.js'
import { fetchTrustedHomeRelease } from './app-update-discovery.js'
import {
  assertAuthorizedHomeV2Sender,
  broadcastToHomeV2Windows,
} from './home-v2-authorized-senders.js'
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

/**
 * One Home-download progress event, to authorized Home windows only.
 *
 * Carries bytes as well as percent: a large download with an unknown total
 * still tells the user something is moving, which "Working…" never did.
 */
function broadcastHomeV2AppDownloadProgress(progress: {
  readonly action: string
  readonly fileName: string
  readonly message: string
  readonly percent: number | null
  readonly receivedBytes: number
  readonly releaseTag: string
  readonly totalBytes: number | null
}) {
  broadcastToHomeV2Windows('home-v2-app-update:progress', {
    action: progress.action,
    fileName: progress.fileName,
    message: progress.message,
    percent: typeof progress.percent === 'number' && Number.isFinite(progress.percent)
      ? Math.max(0, Math.min(100, Math.round(progress.percent)))
      : null,
    receivedBytes: Number.isFinite(progress.receivedBytes)
      ? Math.max(0, Math.round(progress.receivedBytes))
      : 0,
    releaseTag: progress.releaseTag,
    revision: 1,
    schema: 'home-v2-app-update-progress',
    totalBytes: typeof progress.totalBytes === 'number' && Number.isFinite(progress.totalBytes)
      ? Math.max(0, Math.round(progress.totalBytes))
      : null,
  })
}

export function registerHomeV2AppUpdateBridgeIpcHandlers() {
  setHomeV2AppDownloadProgressListener(broadcastHomeV2AppDownloadProgress)
  const service = createHomeV2AppUpdateService({
    downloadAsset: downloadVerifiedAppUpdate,
    fetchRelease: fetchTrustedHomeRelease,
    getEnvironment: getUpdateEnvironment,
    openDownloadedFile,
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
  ipcMain.handle('home-v2-app-update:open', handlers.open)
  ipcMain.handle('home-v2-app-update:reveal', handlers.reveal)
  ipcMain.handle('home-v2-app-update:open-release-page', handlers.openReleasePage)
  ipcMain.handle('home-v2-app-update:get-settings', settingsHandlers.get)
  ipcMain.handle('home-v2-app-update:set-settings', settingsHandlers.set)
  ipcMain.handle('home-v2-app-update:claim-automatic', settingsHandlers.claimAutomatic)
}
