import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { createPortableNodeClient, parseHomeV2BoundedHttpBody } from './node-client'

interface HomeV2SecureStoragePlugin {
  describeAdminRecord(request: { accountId: string }): Promise<{
    bindingId?: string
    nodeApiUrl?: string
    present: boolean
  }>
  unwrap(request: { accountId: string }): Promise<{ value: string | null }>
  remove(request: { accountId: string }): Promise<void>
  wrap(request: { accountId: string; value: string }): Promise<void>
}

interface HomeV2BoundedHttpPlugin {
  request(request: {
    body: string
    contentType: string
    expectedBindingId: string
    maxBytes: number
    /**
     * The deadline for the WHOLE call, sending included. HttpURLConnection's
     * connect and read timeouts do not cover OutputStream.write(), so before
     * this existed a node that accepted the connection and stopped draining
     * left a publish-preview upload stuck with nothing to end it (security
     * review, 2026-09-02). The plugin holds it to its own 180s ceiling and
     * keeps the socket-level timeouts short on its side.
     */
    overallTimeoutMs: number
    method: 'DELETE' | 'GET' | 'HEAD' | 'PATCH' | 'POST'
    timeoutMs: number
    url: string
  }): Promise<{ body: string; contentType?: string | null; status: number }>
}

const HomeV2SecureStorage = registerPlugin<HomeV2SecureStoragePlugin>(
  'HomeV2SecureStorage',
)
const HomeV2BoundedHttp = registerPlugin<HomeV2BoundedHttpPlugin>('HomeV2BoundedHttp')
const ADMIN_CREDENTIAL_ID = 'home-v2-qortium-node-api-key-v1'
const NATIVE_ADMIN_HANDLE_PREFIX = 'native-admin:'

function nativeAdminBindingId(headers?: Readonly<Record<string, string>>) {
  const value = headers?.['X-API-KEY'] ?? ''
  if (!value) return null
  if (!value.startsWith(NATIVE_ADMIN_HANDLE_PREFIX)) {
    throw new Error('Android refused to move a node API key through WebView JavaScript.')
  }
  const bindingId = value.slice(NATIVE_ADMIN_HANDLE_PREFIX.length)
  if (!/^[0-9a-f]{32}$/.test(bindingId)) {
    throw new Error('Android received an invalid native administrative credential handle.')
  }
  return bindingId
}

async function nativeAuthenticatedRequest(input: {
  body?: string
  headers?: Readonly<Record<string, string>>
  maxBytes: number
  method: 'DELETE' | 'GET' | 'HEAD' | 'PATCH' | 'POST'
  timeoutMs: number
  url: string
}) {
  const expectedBindingId = nativeAdminBindingId(input.headers)
  if (!expectedBindingId) return null
  const response = await HomeV2BoundedHttp.request({
    body: input.body ?? '',
    contentType: input.headers?.['Content-Type'] ?? 'application/json',
    expectedBindingId,
    maxBytes: input.maxBytes,
    method: input.method,
    overallTimeoutMs: input.timeoutMs,
    timeoutMs: input.timeoutMs,
    url: input.url,
  })
  return {
    data: parseHomeV2BoundedHttpBody(response.body, response.contentType ?? ''),
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
  }
}

export function createAndroidHomeV2NodeClient() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    throw new Error('The Android node adapter requires Capacitor on Android.')
  }
  return createPortableNodeClient({
    async getPreference(key) {
      return (await Preferences.get({ key })).value
    },
    async getSecret(key) {
      if (key === ADMIN_CREDENTIAL_ID) {
        const record = await HomeV2SecureStorage.describeAdminRecord({ accountId: key })
        if (!record.present) return null
        if (!record.bindingId || !record.nodeApiUrl) return null
        return JSON.stringify({
          apiKey: `${NATIVE_ADMIN_HANDLE_PREFIX}${record.bindingId}`,
          bindingId: record.bindingId,
          nodeApiUrl: record.nodeApiUrl,
          version: 1,
        })
      }
      return (await HomeV2SecureStorage.unwrap({ accountId: key })).value
    },
    isSecretHandle(key, value) {
      return key === ADMIN_CREDENTIAL_ID && value.startsWith(NATIVE_ADMIN_HANDLE_PREFIX)
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
      const native = await nativeAuthenticatedRequest({
        body,
        headers,
        maxBytes: 2 * 1024 * 1024,
        method,
        timeoutMs,
        url,
      })
      if (native) {
        return { ...native, latencyMs: Date.now() - startedAt }
      }
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
      const response = await nativeAuthenticatedRequest({
        body,
        headers,
        maxBytes,
        method: 'POST',
        timeoutMs,
        url,
      })
      if (!response) {
        throw new Error('Bounded Android node requests require a native administrative credential.')
      }
      return {
        data: response.data,
        latencyMs: Date.now() - startedAt,
        ok: response.ok,
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
