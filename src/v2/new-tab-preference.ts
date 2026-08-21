import { parseAppResourceLocation } from './resource-location'
import type { ShellDestination } from './product-model'

export type NewTabPreference =
  | { readonly kind: 'search' }
  | { readonly kind: 'dashboard' }
  | { readonly address: string; readonly kind: 'custom' }

export const DEFAULT_NEW_TAB_PREFERENCE: NewTabPreference = Object.freeze({
  kind: 'search',
})

const INTERNAL_ADDRESS_PATTERN =
  /^home:\/\/(dashboard|apps|activity|newtab|settings)\/?$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function parseHomeV2InternalAddress(
  value: string,
): Exclude<ShellDestination, 'tab'> | null {
  const match = INTERNAL_ADDRESS_PATTERN.exec(value.trim())
  return match
    ? (match[1].toLowerCase() as Exclude<ShellDestination, 'tab'>)
    : null
}

export function validateCustomNewTabAddress(value: string): string {
  const address = value.trim()
  if (!address || address.length > 2_000) {
    throw new Error('Enter a Home or QDN app address of at most 2,000 characters.')
  }
  if (parseHomeV2InternalAddress(address)) return address
  try {
    parseAppResourceLocation(address)
  } catch {
    throw new Error(
      'Use home://dashboard or a complete qdn://APP or qortal://APP address.',
    )
  }
  return address
}

export function parseNewTabPreference(value: unknown): NewTabPreference {
  if (!isRecord(value)) return DEFAULT_NEW_TAB_PREFERENCE
  if (value.kind === 'search') return DEFAULT_NEW_TAB_PREFERENCE
  if (value.kind === 'dashboard') return Object.freeze({ kind: 'dashboard' })
  if (value.kind !== 'custom' || typeof value.address !== 'string') {
    return DEFAULT_NEW_TAB_PREFERENCE
  }
  try {
    return Object.freeze({
      address: validateCustomNewTabAddress(value.address),
      kind: 'custom',
    })
  } catch {
    return DEFAULT_NEW_TAB_PREFERENCE
  }
}
