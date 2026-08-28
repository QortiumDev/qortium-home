import { ipcMain } from 'electron'
import {
  assertAuthorizedHomeV2Sender,
  broadcastToHomeV2Windows,
} from './home-v2-authorized-senders.js'
import {
  createAuthorizedHomeV2QdnSettingsHandlers,
  createHomeV2QdnSettingsService,
} from './home-v2-qdn-settings-contract.js'
import {
  readQdnAppRolesStore,
  onQdnAppStoreChanged,
  revokeQdnAccountCapabilityPermissionIfRevision,
  revokeQdnAppCapabilityPermissionIfRevision,
  setQdnAppAssignmentValueIfRevision,
} from './qdn-manager-permission-store.js'
import {
  inspectNotificationStore,
  onNotificationStoreChanged,
  revokeAppNotifications,
  setAppNotificationMuted,
} from './notification-store.js'
import { isQdnAccountScopedCapability } from './qdn-manager-permissions.js'

const HOME_V2_QDN_SETTINGS_CHANGED = Object.freeze({
  revision: 1,
  schema: 'home-v2-qdn-settings-changed',
})

function broadcastHomeV2QdnSettingsChanged() {
  broadcastToHomeV2Windows(
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
    revokeBookmarks(expectedRevision, appKey, capability, accountId) {
      // Capability is validated against the revocable allowlist in the
      // contract parser; anything else never reaches here. The parser also
      // guarantees accountId is non-null for exactly the account-scoped
      // capabilities, so the two stores can never be crossed.
      if (accountId !== null) {
        // Forward the REQUESTED capability. This used to pass the literal
        // 'account.read', which was invisible while that was the only
        // account-scoped capability and silently wrong the moment a second one
        // existed: revoking account.encrypt would have revoked account.read
        // instead, leaving the card the user clicked still standing and
        // quietly dropping a different grant.
        if (!isQdnAccountScopedCapability(capability)) {
          throw new Error(`${capability} is not an account-scoped capability.`)
        }
        return revokeQdnAccountCapabilityPermissionIfRevision(
          expectedRevision,
          appKey,
          accountId,
          capability,
        )
      }
      return revokeQdnAppCapabilityPermissionIfRevision(
        expectedRevision,
        appKey,
        capability,
      )
    },
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
  ipcMain.handle('home-v2-qdn-settings:revoke-bookmarks', handlers.revokeBookmarks)
  onQdnAppStoreChanged(broadcastHomeV2QdnSettingsChanged)
  onNotificationStoreChanged(broadcastHomeV2QdnSettingsChanged)
}
