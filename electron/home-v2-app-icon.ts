import { buildHomeV2ResourcePath } from './home-v2-app-actions.js'

export const HOME_V2_APP_ICON_MAX_BYTES = 256 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function requiredSegment(value: unknown, label: string) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} must contain 1 to 128 visible characters.`)
  }
  return value.trim()
}

export function normalizeHomeV2AppIconReadRequest(value: unknown) {
  if (!isRecord(value)) throw new Error('App icon read request is required.')
  const name = requiredSegment(value.name, 'App resource name')
  const identifier =
    value.identifier === null || value.identifier === undefined
      ? null
      : requiredSegment(value.identifier, 'App resource identifier')
  const service =
    typeof value.service === 'string' ? value.service.trim().toUpperCase() : ''
  if (service !== 'APP' && service !== 'WEBSITE') {
    throw new Error('App icon resources must use APP or WEBSITE.')
  }
  return { identifier, name, service }
}

export function buildHomeV2AppIconPath(value: unknown) {
  const request = normalizeHomeV2AppIconReadRequest(value)
  return buildHomeV2ResourcePath('FETCH_QDN_RESOURCE', {
    async: true,
    identifier: request.identifier,
    name: request.name,
    path: 'favicon.ico',
    service: request.service,
  })
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

export function getHomeV2AppIconContentType(bytes: Uint8Array) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  if (startsWith(bytes, [0x42, 0x4d])) return 'image/bmp'
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp'
  }
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) {
    return 'image/vnd.microsoft.icon'
  }
  return null
}
