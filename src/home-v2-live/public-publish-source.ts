import { registerPlugin } from '@capacitor/core'

import {
  HOME_V2_PUBLISH_SOURCE_MAX_BYTES,
  HomeV2PublishSourceTokenStore,
  type HomeV2PublishSourceBinding,
} from '../../electron/home-v2-publish-source-tokens'

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
// Capacitor's picker necessarily returns Base64 through the JS bridge. Retain
// only one selected source and never a second decoded copy between selection
// and approval; selecting another file invalidates the prior token.
export const homeV2AndroidPublishSources = new HomeV2PublishSourceTokenStore<AndroidPublishSource>(1)

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
  const result = await QdnPublishSource.selectFile({ maxBytes: HOME_V2_PUBLISH_SOURCE_MAX_BYTES })
  if (result.canceled) return { canceled: true as const }
  const bytes = decodeHomeV2AndroidPublishSource(result.dataBase64)
  if (!Number.isSafeInteger(result.size) || result.size !== bytes.byteLength) {
    throw new Error('Selected publish source size does not match the native file result.')
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
