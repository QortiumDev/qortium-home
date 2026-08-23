export const QORTIUM_TRANSPORT_SETTINGS_MAX_BYTES = 512 * 1024

export type QortiumTransportMode = 'direct-and-i2p' | 'direct-only' | 'i2p-only'
export type QortiumTransportModeState = QortiumTransportMode | 'unknown'

export type QortiumSettingsJsonValue =
  | boolean
  | null
  | number
  | string
  | QortiumSettingsJsonValue[]
  | { [key: string]: QortiumSettingsJsonValue }

export type QortiumSettingsObject = Record<string, QortiumSettingsJsonValue>

export type QortiumTransportSettingsParseResult =
  | Readonly<{
      kind: 'known'
      mode: QortiumTransportMode
      settings: QortiumSettingsObject
    }>
  | Readonly<{
      kind: 'unknown'
      reason:
        | 'invalid-json'
        | 'not-plain-object'
        | 'oversize'
        | 'unknown-allowed-transports'
        | 'unsafe-structure'
      settings: QortiumSettingsObject | null
    }>

export type QortiumTransportSettingsBuildResult =
  | Readonly<{ kind: 'built'; jsonLine: string }>
  | Readonly<{
      kind: 'rejected'
      reason: 'invalid-mode' | 'oversize' | 'unsafe-structure'
    }>

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_JSON_DEPTH = 100
const MAX_JSON_VALUES = 100_000

const DIRECT_AND_I2P = Object.freeze(['IP', 'I2P'] as const)
const DIRECT_ONLY = Object.freeze(['IP'] as const)
const I2P_ONLY = Object.freeze(['I2P'] as const)

export const QORTIUM_TRANSPORTS_BY_MODE: Readonly<
  Record<QortiumTransportMode, readonly ('IP' | 'I2P')[]>
> = Object.freeze({
  'direct-and-i2p': DIRECT_AND_I2P,
  'direct-only': DIRECT_ONLY,
  'i2p-only': I2P_ONLY,
})

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isSafeJsonStructure(root: unknown): root is QortiumSettingsJsonValue {
  const pending: Array<{ depth: number; value: unknown }> = [{ depth: 0, value: root }]
  const seen = new WeakSet<object>()
  let values = 0

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) return false
    values += 1
    if (values > MAX_JSON_VALUES || current.depth > MAX_JSON_DEPTH) return false

    const value = current.value
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      continue
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return false
    seen.add(value)

    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return false
      const keys = Reflect.ownKeys(value)
      const elementKeys = keys.filter((key): key is string => key !== 'length' && typeof key === 'string')
      if (keys.some((key) => typeof key === 'symbol') || elementKeys.length !== value.length) {
        return false
      }

      for (let index = 0; index < value.length; index += 1) {
        const key = String(index)
        if (elementKeys[index] !== key) return false
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          return false
        }
        pending.push({ depth: current.depth + 1, value: descriptor.value })
      }
      continue
    }

    if (!isPlainObject(value)) return false
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || UNSAFE_KEYS.has(key)) return false
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        return false
      }
      pending.push({ depth: current.depth + 1, value: descriptor.value })
    }
  }

  return true
}

function normalizedTransport(value: unknown): 'IP' | 'I2P' | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return normalized === 'IP' || normalized === 'I2P' ? normalized : null
}

export function getQortiumTransportMode(settings: unknown): QortiumTransportModeState {
  if (!isPlainObject(settings) || !isSafeJsonStructure(settings)) return 'unknown'
  if (!Object.prototype.hasOwnProperty.call(settings, 'allowedTransports')) {
    return 'direct-and-i2p'
  }

  const value = settings.allowedTransports
  if (value === null) return 'direct-and-i2p'
  if (!Array.isArray(value)) return 'unknown'
  if (value.length === 0) return 'direct-and-i2p'

  const normalized: Array<'IP' | 'I2P'> = []
  for (const entry of value) {
    const transport = normalizedTransport(entry)
    if (!transport || normalized.includes(transport)) return 'unknown'
    normalized.push(transport)
  }

  if (normalized.length === 1 && normalized[0] === 'IP') return 'direct-only'
  if (normalized.length === 1 && normalized[0] === 'I2P') return 'i2p-only'
  if (normalized.length === 2 && normalized[0] === 'IP' && normalized[1] === 'I2P') {
    return 'direct-and-i2p'
  }
  return 'unknown'
}

export function parseQortiumTransportSettingsJson(
  value: string,
): QortiumTransportSettingsParseResult {
  if (utf8ByteLength(value) > QORTIUM_TRANSPORT_SETTINGS_MAX_BYTES) {
    return { kind: 'unknown', reason: 'oversize', settings: null }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return { kind: 'unknown', reason: 'invalid-json', settings: null }
  }

  if (!isPlainObject(parsed)) {
    return { kind: 'unknown', reason: 'not-plain-object', settings: null }
  }
  if (!isSafeJsonStructure(parsed)) {
    return { kind: 'unknown', reason: 'unsafe-structure', settings: null }
  }

  const settings = parsed as QortiumSettingsObject
  const mode = getQortiumTransportMode(settings)
  return mode === 'unknown'
    ? { kind: 'unknown', reason: 'unknown-allowed-transports', settings }
    : { kind: 'known', mode, settings }
}

/**
 * Replaces only allowedTransports and emits compact JSON with one trailing LF.
 * Unsafe values and output beyond the settings-file bound fail closed.
 */
export function updateQortiumTransportSettings(
  settings: unknown,
  mode: unknown,
): QortiumTransportSettingsBuildResult {
  const transports = typeof mode === 'string'
    ? QORTIUM_TRANSPORTS_BY_MODE[mode as QortiumTransportMode]
    : undefined
  if (!transports) return { kind: 'rejected', reason: 'invalid-mode' }
  if (!isPlainObject(settings) || !isSafeJsonStructure(settings)) {
    return { kind: 'rejected', reason: 'unsafe-structure' }
  }

  let jsonLine: string
  try {
    jsonLine = `${JSON.stringify({ ...settings, allowedTransports: [...transports] })}\n`
  } catch {
    return { kind: 'rejected', reason: 'unsafe-structure' }
  }
  if (utf8ByteLength(jsonLine) > QORTIUM_TRANSPORT_SETTINGS_MAX_BYTES) {
    return { kind: 'rejected', reason: 'oversize' }
  }
  return { kind: 'built', jsonLine }
}
