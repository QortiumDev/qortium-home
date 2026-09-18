import type { QdnAppNavigationSnapshot } from '../qdn-app-history'
import { normalizeQdnBridgeNavigationSnapshot } from '../qdn-navigation-bridge'

const APP_TITLE_MAX_LENGTH = 160
const APP_HISTORY_MAX_ENTRIES = 200
const APP_HISTORY_URL_MAX_LENGTH = 2_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function sanitizeHomeV2AppTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const title = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!title) return null
  return title.length > APP_TITLE_MAX_LENGTH
    ? `${title.slice(0, APP_TITLE_MAX_LENGTH - 1)}…`
    : title
}

/**
 * Apps commonly title themselves with the network in front of their own name
 * ("Qortium Chat"), and that whole string is what the bridge reports as the
 * tab label. On a narrow strip -- Home on a phone, or a condensed desktop
 * window -- the network word is all that fits, so every tab reads "Qortium…".
 * The label is the app's name; which network the tab belongs to is already
 * carried by the tab's network mark and its account group badge.
 *
 * Only a network word that is separated from the rest of the title is removed,
 * and only when a name is left over: "Qortium" alone, or "Qortiumizer", is the
 * app's own name and stays whole. A leading counter badge ("(3) Qortium Chat")
 * is kept, since it is the app's unread signal rather than part of its name.
 */
const APP_TITLE_NETWORK_WORDS = ['qortium', 'qortal'] as const
const APP_TITLE_LEADING_BADGE = /^(?:\([^()]{1,12}\)|\[[^[\]]{1,12}\])\s*/
const APP_TITLE_LEADING_SEPARATOR = /^[\s\-–—:|·>»]+/
const APP_TITLE_TRAILING_SEPARATOR = /[\s\-–—:|·<«]+$/

export function stripNetworkNameFromAppTitle(title: string): string {
  const badge = APP_TITLE_LEADING_BADGE.exec(title)?.[0] ?? ''
  let rest = title.slice(badge.length)

  for (const word of APP_TITLE_NETWORK_WORDS) {
    if (!rest.toLowerCase().startsWith(word)) continue
    const after = rest.slice(word.length)
    const trimmed = after.replace(APP_TITLE_LEADING_SEPARATOR, '')
    if (trimmed && trimmed.length < after.length) {
      rest = trimmed
      break
    }
  }

  for (const word of APP_TITLE_NETWORK_WORDS) {
    if (!rest.toLowerCase().endsWith(word)) continue
    const before = rest.slice(0, rest.length - word.length)
    const trimmed = before.replace(APP_TITLE_TRAILING_SEPARATOR, '')
    if (trimmed && trimmed.length < before.length) {
      rest = trimmed
      break
    }
  }

  return `${badge}${rest}`
}

export function readHomeV2AppTitleMessage(
  value: unknown,
  bridgeToken: string,
): { readonly title: string | null } | null {
  if (
    !isRecord(value) ||
    value.type !== 'qortium:qdn-title' ||
    value.bridgeToken !== bridgeToken
  ) {
    return null
  }
  return { title: sanitizeHomeV2AppTitle(value.title) }
}

export function readHomeV2AppNavigationMessage(
  value: unknown,
  bridgeToken: string,
  renderUrl: string,
): QdnAppNavigationSnapshot | null {
  if (
    !isRecord(value) ||
    value.type !== 'qortium:qdn-navigation' ||
    value.bridgeToken !== bridgeToken ||
    !Number.isSafeInteger(value.activeIndex) ||
    (value.activeIndex as number) < 0 ||
    !Array.isArray(value.entries) ||
    value.entries.length < 1 ||
    value.entries.length > APP_HISTORY_MAX_ENTRIES
  ) {
    return null
  }

  const indexes = new Set<number>()
  const entries: QdnAppNavigationSnapshot['entries'] = []
  for (const entry of value.entries) {
    if (
      !isRecord(entry) ||
      !Number.isSafeInteger(entry.index) ||
      (entry.index as number) < 0 ||
      typeof entry.url !== 'string' ||
      entry.url.length > APP_HISTORY_URL_MAX_LENGTH ||
      indexes.has(entry.index as number)
    ) {
      return null
    }
    indexes.add(entry.index as number)
    entries.push({ index: entry.index as number, url: entry.url })
  }
  if (!indexes.has(value.activeIndex as number)) return null

  try {
    return normalizeQdnBridgeNavigationSnapshot(
      { activeIndex: value.activeIndex as number, entries },
      renderUrl,
    )
  } catch {
    return null
  }
}
