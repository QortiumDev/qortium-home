import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import {
  createHomeV2NotificationPolicyClient,
  createPortableHomeV2NotificationPolicyAdapter,
} from './notification-policy-client'

export function createAndroidHomeV2NotificationPolicyClient() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    throw new Error('The Android notification policy requires Capacitor on Android.')
  }
  return createHomeV2NotificationPolicyClient(
    createPortableHomeV2NotificationPolicyAdapter({
      async getPreference(key) {
        return (await Preferences.get({ key })).value
      },
      async setPreference(key, value) {
        await Preferences.set({ key, value })
      },
    }),
  )
}
