import type { BookmarkManagerMutation, BookmarkManagerSnapshot } from '../../bookmarkManagerContract'
import { captureSavedAccountContext, getSavedAccountContext } from '../../accountContext'
import { locateBookmarkManagerLink } from '../../bookmarkManager'
import { t } from '../../i18n'

type SavedTabDraft = { accountId: string | null; displayUrl: string; title: string }

function assertMatchingAccount(existing: { accountId?: string | null; displayUrl: string }, draft: SavedTabDraft) {
  if (getSavedAccountContext(existing.displayUrl, existing.accountId) !== getSavedAccountContext(draft.displayUrl, draft.accountId)) {
    throw new Error(t('home2.account.savedLinkConflict'))
  }
}

/** Resolve against the latest revision, so retries cannot remove another account's save. */
export function buildTabBookmarkToggle(snapshot: BookmarkManagerSnapshot, draft: SavedTabDraft): BookmarkManagerMutation {
  draft = { ...draft, accountId: captureSavedAccountContext(draft.displayUrl, draft.accountId) }
  const existing = locateBookmarkManagerLink(snapshot, draft.displayUrl)
  if (existing) {
    assertMatchingAccount(existing.link, draft)
    return { type: 'removeTreeItem', rootId: existing.rootId, itemId: existing.link.id }
  }
  return { type: 'addTreeLink', rootId: 'bookmarks', link: draft }
}

export function buildTabToolbarSave(snapshot: BookmarkManagerSnapshot, draft: SavedTabDraft): BookmarkManagerMutation | null {
  draft = { ...draft, accountId: captureSavedAccountContext(draft.displayUrl, draft.accountId) }
  const existing = locateBookmarkManagerLink({ bookmarks: [], toolbar: snapshot.toolbar }, draft.displayUrl)
  if (existing) {
    assertMatchingAccount(existing.link, draft)
    return null
  }
  return { type: 'addTreeLink', rootId: 'toolbar', link: draft }
}

export function buildTabDashboardPin(snapshot: BookmarkManagerSnapshot, draft: SavedTabDraft): BookmarkManagerMutation {
  draft = { ...draft, accountId: captureSavedAccountContext(draft.displayUrl, draft.accountId) }
  const existing = snapshot.dashboardPins.find((pin) => pin.displayUrl === draft.displayUrl)
  if (existing) {
    assertMatchingAccount(existing, draft)
    return { type: 'updateDashboardPin', pinId: existing.id, pin: draft }
  }
  return { type: 'addDashboardPin', pin: draft }
}
