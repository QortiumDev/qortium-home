import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { createPortableNodeClient } from './node-client'

export function createAndroidHomeV2NodeClient() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    throw new Error('The Android node adapter requires Capacitor on Android.')
  }
  return createPortableNodeClient({
    async getPreference(key) {
      return (await Preferences.get({ key })).value
    },
    async setPreference(key, value) {
      await Preferences.set({ key, value })
    },
    async requestJson(url) {
      const startedAt = Date.now()
      const response = await CapacitorHttp.get({
        url,
        connectTimeout: 5_000,
        readTimeout: 5_000,
      })
      return {
        data: response.data,
        latencyMs: Date.now() - startedAt,
        ok: response.status >= 200 && response.status < 300,
      }
    },
    now: () => Date.now(),
  })
}
