import {
  BOOKMARK_MANAGER_SCHEMA_VERSION,
  validateBookmarkManagerSnapshot,
  type BookmarkManagerSnapshot,
} from '../../electron/bookmark-manager-contract'
import { BOOKMARKS_STATE_VERSION } from '../../electron/bookmark-toolbar'

export const HOME_V2_LEGACY_COLLECTION_KEYS = [
  'qortium-home-bookmarks',
  'qortium-home-dashboard-pins',
  'qortium-home-start-pages',
  'qortium-home-bookmark-manager-revision',
  'qortium-home-bookmark-manager-snapshot',
] as const

type LegacyCollectionKey = (typeof HOME_V2_LEGACY_COLLECTION_KEYS)[number]
export type HomeV2LegacyCollectionRawValues = Record<LegacyCollectionKey, string | null>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function parseJson(raw: string, label: string) {
  try { return JSON.parse(raw) as unknown }
  catch (error) { throw new Error(`${label} contains invalid JSON.`, { cause: error }) }
}

function parseRevision(raw: string | null) {
  if (raw === null) return 0
  if (!/^(?:0|[1-9][0-9]*)$/.test(raw)) throw new Error('Legacy bookmark manager revision is invalid.')
  const revision = Number(raw)
  if (!Number.isSafeInteger(revision)) throw new Error('Legacy bookmark manager revision is invalid.')
  return revision
}

function parseMirrorSnapshot(raw: HomeV2LegacyCollectionRawValues) {
  const bookmarksValue = raw['qortium-home-bookmarks'] === null
    ? { bookmarks: [], toolbar: [], toolbarVisibility: 'hidden', version: BOOKMARKS_STATE_VERSION }
    : parseJson(raw['qortium-home-bookmarks'], 'Legacy bookmarks')
  if (!isRecord(bookmarksValue)) {
    throw new Error('Legacy bookmarks use an unsupported or malformed schema.')
  }
  let toolbarVisibility: unknown
  if (
    bookmarksValue.version === BOOKMARKS_STATE_VERSION &&
    exactKeys(bookmarksValue, ['bookmarks', 'toolbar', 'toolbarVisibility', 'version'])
  ) {
    toolbarVisibility = bookmarksValue.toolbarVisibility
  } else if (
    bookmarksValue.version === 2 &&
    exactKeys(bookmarksValue, ['bookmarks', 'toolbar', 'toolbarVisible', 'version']) &&
    typeof bookmarksValue.toolbarVisible === 'boolean'
  ) {
    toolbarVisibility = bookmarksValue.toolbarVisible ? 'always' : 'hidden'
  } else {
    throw new Error('Legacy bookmarks use an unsupported or malformed schema.')
  }

  const dashboardPins = raw['qortium-home-dashboard-pins'] === null
    ? []
    : parseJson(raw['qortium-home-dashboard-pins'], 'Legacy dashboard pins')
  const rawStartPages = raw['qortium-home-start-pages'] === null
    ? []
    : parseJson(raw['qortium-home-start-pages'], 'Legacy start pages')
  if (!Array.isArray(rawStartPages)) throw new Error('Legacy start pages use a malformed schema.')
  const legacyStringPages = rawStartPages.every((page) => typeof page === 'string')
  const startPages = legacyStringPages
    ? rawStartPages.map((page) => ({ accountId: null, displayUrl: page }))
    : rawStartPages

  return validateBookmarkManagerSnapshot({
    bookmarks: bookmarksValue.bookmarks,
    dashboardPins,
    revision: parseRevision(raw['qortium-home-bookmark-manager-revision']),
    schemaVersion: BOOKMARK_MANAGER_SCHEMA_VERSION,
    startPages,
    toolbar: bookmarksValue.toolbar,
    toolbarVisibility,
  })
}

function sameSnapshot(left: BookmarkManagerSnapshot, right: BookmarkManagerSnapshot) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function parseHomeV2LegacyCollectionsRaw(raw: HomeV2LegacyCollectionRawValues) {
  const hadData = Object.values(raw).some((value) => value !== null)
  const canonicalRaw = raw['qortium-home-bookmark-manager-snapshot']
  const canonical = canonicalRaw === null
    ? null
    : validateBookmarkManagerSnapshot(parseJson(canonicalRaw, 'Legacy bookmark manager snapshot'))
  const mirrorHadData = HOME_V2_LEGACY_COLLECTION_KEYS
    .filter((key) => key !== 'qortium-home-bookmark-manager-snapshot')
    .some((key) => raw[key] !== null)

  let mirror: BookmarkManagerSnapshot | null = null
  let mirrorError: unknown = null
  if (mirrorHadData || !canonical) {
    try { mirror = parseMirrorSnapshot(raw) }
    catch (error) { mirrorError = error }
  }

  if (!canonical && mirrorError) {
    throw new Error('Legacy saved Home links could not be loaded safely.', { cause: mirrorError })
  }
  if (canonical && mirrorError) return { hadData, snapshot: canonical }
  if (!canonical && mirror) return { hadData, snapshot: mirror }
  if (!canonical || !mirror) throw new Error('Legacy saved Home links could not be loaded safely.')

  if (canonical.revision > mirror.revision) return { hadData, snapshot: canonical }
  if (mirror.revision > canonical.revision) return { hadData, snapshot: mirror }
  if (!sameSnapshot(canonical, mirror)) {
    throw new Error('Legacy saved Home links disagree at the same revision.')
  }
  return { hadData, snapshot: canonical }
}
