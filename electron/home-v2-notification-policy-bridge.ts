import { app, ipcMain } from 'electron'
import path from 'node:path'
import {
  assertAuthorizedHomeV2Sender,
  broadcastToHomeV2Windows,
} from './home-v2-authorized-senders.js'
import { parseHomeV2NotificationPolicyMutation } from './home-v2-notification-policy-codec.js'
import {
  createHomeV2NotificationPolicyFile,
  type HomeV2NotificationPolicyFile,
} from './home-v2-notification-policy-file.js'
import { setQdnAppNotificationsEnabled } from './qdn.js'

export const HOME_V2_NOTIFICATION_POLICY_CHANGED_CHANNEL =
  'home-v2-notification-policy:changed'

type HomeV2NotificationPolicyBridgeDependencies = {
  readonly assertAuthorized: (event: Electron.IpcMainInvokeEvent) => void
  readonly broadcast: (channel: string, value: unknown) => void
  readonly setAuthoritativeGate: (enabled: boolean) => void
  readonly storage: HomeV2NotificationPolicyFile
}

export function createHomeV2NotificationPolicyHandlers(
  dependencies: HomeV2NotificationPolicyBridgeDependencies,
) {
  return {
    async get(event: Electron.IpcMainInvokeEvent) {
      dependencies.assertAuthorized(event)
      return dependencies.storage.read()
    },
    async set(event: Electron.IpcMainInvokeEvent, value: unknown) {
      dependencies.assertAuthorized(event)
      const request = parseHomeV2NotificationPolicyMutation(value)
      const result = await dependencies.storage.set(
        request.expectedGeneration,
        request.enabled,
      )
      if (result.changed) {
        dependencies.setAuthoritativeGate(result.snapshot.enabled)
        dependencies.broadcast(HOME_V2_NOTIFICATION_POLICY_CHANGED_CHANNEL, result.snapshot)
      }
      return result.snapshot
    },
  }
}

export async function registerHomeV2NotificationPolicyBridgeIpcHandlers() {
  const storage = createHomeV2NotificationPolicyFile(
    () => path.join(app.getPath('userData'), 'home-v2-notification-policy.json'),
  )
  const initial = await storage.initialize()
  setQdnAppNotificationsEnabled(initial.enabled)
  const handlers = createHomeV2NotificationPolicyHandlers({
    assertAuthorized: assertAuthorizedHomeV2Sender,
    broadcast: broadcastToHomeV2Windows,
    setAuthoritativeGate: setQdnAppNotificationsEnabled,
    storage,
  })
  ipcMain.handle('home-v2-notification-policy:get', handlers.get)
  ipcMain.handle('home-v2-notification-policy:set', handlers.set)
  return initial
}
