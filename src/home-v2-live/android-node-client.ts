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
    async requestJson(url, method = 'GET') {
      const startedAt = Date.now()
      const response = await CapacitorHttp.request({
        url,
        method,
        connectTimeout: 5_000,
        readTimeout: 5_000,
      })
      return {
        data: response.data,
        latencyMs: Date.now() - startedAt,
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
      }
    },
    async requestBinary(url) {
      const response = await CapacitorHttp.get({
        url,
        responseType: 'arraybuffer',
        connectTimeout: 5_000,
        readTimeout: 8_000,
      })
      return {
        data: response.data,
        headers: response.headers,
        status: response.status,
      }
    },
    now: () => Date.now(),
  })
}
