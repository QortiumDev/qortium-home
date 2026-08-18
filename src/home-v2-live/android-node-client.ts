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
    async requestJson(url, method = 'GET', timeoutMs = 5_000) {
      const startedAt = Date.now()
      const response = await CapacitorHttp.request({
        url,
        method,
        connectTimeout: 5_000,
        readTimeout: timeoutMs,
      })
      return {
        data: response.data,
        headers: response.headers,
        latencyMs: Date.now() - startedAt,
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
      }
    },
    async requestBinary(url, timeoutMs = 8_000) {
      const response = await CapacitorHttp.get({
        url,
        responseType: 'arraybuffer',
        connectTimeout: 5_000,
        readTimeout: timeoutMs,
      })
      return {
        data: response.data,
        headers: response.headers,
        status: response.status,
      }
    },
    async saveBinary(request) {
      const { saveBytesToFile } = await import('../platform')
      return saveBytesToFile(request.fileName, request.bytes, request.mimeType)
    },
    now: () => Date.now(),
  })
}
