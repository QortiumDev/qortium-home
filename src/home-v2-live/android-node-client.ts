import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { createPortableNodeClient, parseHomeV2BoundedHttpBody } from './node-client'

interface HomeV2SecureStoragePlugin {
  unwrap(request: { accountId: string }): Promise<{ value: string | null }>
  remove(request: { accountId: string }): Promise<void>
  wrap(request: { accountId: string; value: string }): Promise<void>
}

interface HomeV2BoundedHttpPlugin {
  post(request: {
    apiKey: string
    body: string
    contentType: string
    maxBytes: number
    timeoutMs: number
    url: string
  }): Promise<{ body: string; contentType?: string | null; status: number }>
}

const HomeV2SecureStorage = registerPlugin<HomeV2SecureStoragePlugin>(
  'HomeV2SecureStorage',
)
const HomeV2BoundedHttp = registerPlugin<HomeV2BoundedHttpPlugin>('HomeV2BoundedHttp')

export function createAndroidHomeV2NodeClient() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    throw new Error('The Android node adapter requires Capacitor on Android.')
  }
  return createPortableNodeClient({
    async getPreference(key) {
      return (await Preferences.get({ key })).value
    },
    async getSecret(key) {
      return (await HomeV2SecureStorage.unwrap({ accountId: key })).value
    },
    async removeSecret(key) {
      await HomeV2SecureStorage.remove({ accountId: key })
    },
    async setPreference(key, value) {
      await Preferences.set({ key, value })
    },
    async setSecret(key, value) {
      await HomeV2SecureStorage.wrap({ accountId: key, value })
    },
    async requestJson(
      url,
      method = 'GET',
      timeoutMs = 5_000,
      headers,
      disableRedirects,
      body,
    ) {
      const startedAt = Date.now()
      const response = await CapacitorHttp.request({
        url,
        method,
        headers,
        disableRedirects,
        ...(body === undefined ? {} : { data: body }),
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
    async requestBoundedJson(url, timeoutMs, headers, body, maxBytes) {
      const startedAt = Date.now()
      const response = await HomeV2BoundedHttp.post({
        apiKey: headers['X-API-KEY'] ?? '',
        body,
        contentType: headers['Content-Type'] ?? 'application/json',
        maxBytes,
        timeoutMs,
        url,
      })
      const data = parseHomeV2BoundedHttpBody(response.body, response.contentType ?? '')
      return {
        data,
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
