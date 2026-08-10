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
