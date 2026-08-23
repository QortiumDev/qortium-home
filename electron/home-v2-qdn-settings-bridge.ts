import { ipcMain } from 'electron'
import {
  assertAuthorizedHomeV2Sender,
  sendToAuthorizedHomeV2Senders,
} from './home-v2-authorized-senders.js'
import {
  createAuthorizedHomeV2QdnSettingsHandlers,
  createHomeV2QdnSettingsService,
} from './home-v2-qdn-settings-contract.js'
import {
  readQdnAppRolesStore,
  onQdnAppAssignmentsChanged,
  setQdnAppAssignmentValueIfRevision,
} from './qdn-manager-permission-store.js'
import {
  inspectNotificationStore,
  onNotificationStoreChanged,
  revokeAppNotifications,
  setAppNotificationMuted,
} from './notification-store.js'

const HOME_V2_QDN_SETTINGS_CHANGED = Object.freeze({
  revision: 1,
  schema: 'home-v2-qdn-settings-changed',
})

function broadcastHomeV2QdnSettingsChanged() {
  sendToAuthorizedHomeV2Senders(
    'home-v2-qdn-settings:changed',
    HOME_V2_QDN_SETTINGS_CHANGED,
  )
}

function assertNotificationRevision(expectedRevision: number) {
  const inspection = inspectNotificationStore()
  if (inspection.status !== 'available') {
    throw new Error('QDN notification settings are unavailable.')
  }
  if (inspection.store.revision !== expectedRevision) {
    throw new Error('QDN notification settings changed. Refresh and try again.')
  }
}

export function registerHomeV2QdnSettingsBridgeIpcHandlers() {
  const service = createHomeV2QdnSettingsService({
    inspectNotifications: inspectNotificationStore,
    readAssignments: readQdnAppRolesStore,
    revokeNotifications(expectedRevision, appKey) {
      assertNotificationRevision(expectedRevision)
      return revokeAppNotifications(appKey)
    },
    setAssignment: setQdnAppAssignmentValueIfRevision,
    setMuted(expectedRevision, appKey, muted) {
      assertNotificationRevision(expectedRevision)
      return setAppNotificationMuted(appKey, muted)
    },
  })
  const handlers = createAuthorizedHomeV2QdnSettingsHandlers(
    assertAuthorizedHomeV2Sender,
    service,
  )
  ipcMain.handle('home-v2-qdn-settings:get', handlers.get)
  ipcMain.handle('home-v2-qdn-settings:set-assignment', handlers.setAssignment)
  ipcMain.handle('home-v2-qdn-settings:set-muted', handlers.setMuted)
  ipcMain.handle('home-v2-qdn-settings:revoke', handlers.revoke)
  onQdnAppAssignmentsChanged(broadcastHomeV2QdnSettingsChanged)
  onNotificationStoreChanged(broadcastHomeV2QdnSettingsChanged)
}
