import { parseAppResourceLocation } from './resource-location'
import type { ShellDestination } from './product-model'

export type NewTabPreference =
  | { readonly kind: 'search' }
  | { readonly kind: 'dashboard' }
  | { readonly address: string; readonly kind: 'custom' }

export const DEFAULT_NEW_TAB_PREFERENCE: NewTabPreference = Object.freeze({
  kind: 'dashboard',
})

const INTERNAL_ADDRESS_PATTERN =
  /^home:\/\/(dashboard|apps|activity|newtab|settings|welcome)\/?$/i
const RELEASE_NOTES_ADDRESS_PATTERN =
  /^home:\/\/releases\/(core|home)\/([^/?#]+)\/?$/i

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

export function parseHomeV2ReleaseNotesAddress(value: string): {
  readonly product: 'core' | 'home'
  readonly tagName: string
} | null {
  const match = RELEASE_NOTES_ADDRESS_PATTERN.exec(value.trim())
  if (!match) return null
  try {
    const tagName = decodeURIComponent(match[2]).trim()
    return tagName && tagName.length <= 100
      ? { product: match[1].toLowerCase() as 'core' | 'home', tagName }
      : null
  } catch {
    return null
  }
}

export function parseHomeV2CoreDocsAddress(
  value: string,
): 'qortal' | 'qortium' | null {
  const address = value.trim()
  if (/^core:\/\/(?:api-documentation\/?)?$/i.test(address)) return 'qortium'
  if (/^qortal-core:\/\/(?:api-documentation\/?)?$/i.test(address)) return 'qortal'
  return null
}

export function validateCustomNewTabAddress(value: string): string {
  const address = value.trim()
  if (!address || address.length > 2_000) {
    throw new Error('Enter a Home or QDN app address of at most 2,000 characters.')
  }
  if (parseHomeV2InternalAddress(address)) return address
  if (parseHomeV2ReleaseNotesAddress(address)) return address
  if (parseHomeV2CoreDocsAddress(address)) return address
  try {
    parseAppResourceLocation(address)
  } catch {
    throw new Error(
      'Use a supported Home, Core, qdn://APP, or qortal://APP address.',
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
