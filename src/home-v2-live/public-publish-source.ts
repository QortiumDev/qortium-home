import { registerPlugin } from '@capacitor/core'

import {
  HOME_V2_PUBLISH_SOURCE_MAX_BYTES,
  HomeV2PublishSourceTokenStore,
  type HomeV2PublishSourceBinding,
} from '../../electron/home-v2-publish-source-tokens'
import { HOME_V2_PUBLISH_MULTIPLE_MAX_ITEMS } from '../../electron/home-v2-publish-extras-contract'
import { HOME_V2_PUBLISH_BLOB_MAX_BYTES } from '../../electron/home-v2-publish-blob-source'

type NativeSelection =
  | { canceled: true }
  | {
      canceled: false
      dataBase64: string
      fileName: string
      mimeType?: string
      size: number
    }

type AndroidPublishSource = Readonly<{
  dataBase64: string
  fileName: string
  mimeType: string | null
  size: number
}>

interface QdnPublishSourcePlugin {
  selectFile(request: { maxBytes: number }): Promise<NativeSelection>
}

const QdnPublishSource = registerPlugin<QdnPublishSourcePlugin>('QdnPublishSource')

/**
 * A batch publish needs several selections alive at once (up to
 * HOME_V2_PUBLISH_MULTIPLE_MAX_ITEMS), so the old capacity of one is not
 * enough — but the count was never the real constraint. Capacitor's picker
 * returns Base64 through the JS bridge, so every retained selection is a
 * copy in WebView memory, and ten 100 MiB files would be roughly 1.3 GB of
 * it. The store therefore holds up to the batch maximum, bounded by a TOTAL
 * byte budget: a new selection evicts the least-recently-used ones until it
 * fits, and one larger than the whole budget is refused outright rather than
 * silently emptying the store.
 */
const ANDROID_PUBLISH_SOURCE_BUDGET_BYTES = 64 * 1024 * 1024

/**
 * The largest selection Android can actually hold, in DECODED bytes.
 *
 * The budget above is measured in base64 characters, which is 4/3 of the file,
 * so the real ceiling is 48 MiB and not the 100 MiB the desktop picker allows.
 * Asking the native picker for 100 MiB meant a 60 MiB file was read, encoded,
 * handed across the bridge and only then refused by the store — the user
 * having waited through all of it. The limit is now told to the picker, and
 * checked here with a message that says what it is (security review,
 * 2026-09-02).
 */
export const HOME_V2_ANDROID_PUBLISH_SOURCE_MAX_BYTES =
  Math.floor(ANDROID_PUBLISH_SOURCE_BUDGET_BYTES / 4) * 3

const ANDROID_SOURCE_TOO_LARGE =
  'Qortium Home for Android can publish or preview files up to 48 MiB. Choose a smaller file.'

export const homeV2AndroidPublishSources = new HomeV2PublishSourceTokenStore<AndroidPublishSource>(
  HOME_V2_PUBLISH_MULTIPLE_MAX_ITEMS,
  undefined,
  undefined,
  {
    maximumBytes: ANDROID_PUBLISH_SOURCE_BUDGET_BYTES,
    // The Base64 copy is what actually occupies memory, not the decoded size.
    sizeOf: (source) => source.dataBase64.length,
  },
)

export function decodeHomeV2AndroidPublishSource(value: string) {
  if (!value || value.length > Math.ceil(HOME_V2_PUBLISH_SOURCE_MAX_BYTES / 3) * 4 + 16) {
    throw new Error('Selected publish source is invalid or exceeds 100 MiB.')
  }
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw new Error('Selected publish source is not valid Base64.')
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  if (bytes.byteLength < 1 || bytes.byteLength > HOME_V2_PUBLISH_SOURCE_MAX_BYTES) {
    throw new Error('Publish source must be between 1 byte and 100 MiB.')
  }
  return bytes
}

export async function selectHomeV2AndroidPublishSource(binding: HomeV2PublishSourceBinding) {
  const result = await QdnPublishSource.selectFile({
    maxBytes: HOME_V2_ANDROID_PUBLISH_SOURCE_MAX_BYTES,
  })
  if (result.canceled) return { canceled: true as const }
  const bytes = decodeHomeV2AndroidPublishSource(result.dataBase64)
  if (!Number.isSafeInteger(result.size) || result.size !== bytes.byteLength) {
    throw new Error('Selected publish source size does not match the native file result.')
  }
  // Belt and braces: a native picker that ignored maxBytes must not reach the
  // store, whose refusal names a budget rather than a limit the user can act on.
  if (bytes.byteLength > HOME_V2_ANDROID_PUBLISH_SOURCE_MAX_BYTES) {
    throw new Error(ANDROID_SOURCE_TOO_LARGE)
  }
  const fileName = result.fileName.trim().split(/[\\/]/).pop()?.slice(0, 180) || 'qdn-resource'
  const source = Object.freeze({
    dataBase64: result.dataBase64,
    fileName,
    mimeType: result.mimeType?.trim().slice(0, 255) || null,
    size: bytes.byteLength,
  })
  return {
    canceled: false as const,
    fileName,
    kind: 'file' as const,
    mimeType: source.mimeType,
    size: source.size,
    sourceToken: homeV2AndroidPublishSources.issue(binding, source),
  }
}

// STAGE_QDN_PUBLISH_SOURCE (attachments-matrix B1), Android side: the app
// supplies bytes it already holds (paste/drop) and receives the same shape
// of selection the native picker returns. Validation mirrors the desktop
// bridge's home-v2-publish-blob-source contract — tighter 25 MiB cap, base64
// checked before decoding — and the staged base64 lives in the SAME budgeted
// store the picker uses, so the publish and private-attachment paths redeem
// it with no further changes. Staging alone grants nothing: the redeeming
// publish still runs its full approval prompt.
export function stageHomeV2AndroidPublishBlob(
  binding: HomeV2PublishSourceBinding,
  requestValue: Record<string, unknown>,
) {
  const encoded = requestValue.bytesBase64
  if (typeof encoded !== 'string' || !encoded) {
    throw new Error('STAGE_QDN_PUBLISH_SOURCE requires bytesBase64.')
  }
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('STAGE_QDN_PUBLISH_SOURCE bytesBase64 must be valid base64.')
  }
  if (encoded.length > Math.ceil(HOME_V2_PUBLISH_BLOB_MAX_BYTES / 3) * 4) {
    throw new Error('STAGE_QDN_PUBLISH_SOURCE accepts at most 25 MiB.')
  }
  const bytes = decodeHomeV2AndroidPublishSource(encoded)
  if (bytes.byteLength > HOME_V2_PUBLISH_BLOB_MAX_BYTES) {
    throw new Error('STAGE_QDN_PUBLISH_SOURCE accepts at most 25 MiB.')
  }
  const mimeValue = requestValue.mimeType
  let mimeType: string | null = null
  if (mimeValue !== undefined && mimeValue !== null && mimeValue !== '') {
    if (typeof mimeValue !== 'string' || mimeValue.length > 100 || !/^[\w.+-]+\/[\w.+-]+$/.test(mimeValue)) {
      throw new Error('STAGE_QDN_PUBLISH_SOURCE mimeType is invalid.')
    }
    mimeType = mimeValue
  }
  const requestedName = typeof requestValue.fileName === 'string' ? requestValue.fileName.trim() : ''
  const fileName = requestedName.split(/[\\/]/).pop()?.replace(/[. ]+$/g, '').slice(0, 180) || 'qdn-resource'
  const source = Object.freeze({
    dataBase64: encoded,
    fileName,
    mimeType,
    size: bytes.byteLength,
  })
  return {
    canceled: false as const,
    fileName,
    kind: 'blob' as const,
    mimeType,
    size: source.size,
    sourceToken: homeV2AndroidPublishSources.issue(binding, source),
  }
}
