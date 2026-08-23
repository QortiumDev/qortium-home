import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import {
  validateBookmarkManagerMutationRequest,
  validateBookmarkManagerSnapshot,
  type BookmarkManagerAccountChoice,
  type BookmarkManagerMutationRequest,
  type BookmarkManagerMutationResult,
  type BookmarkManagerSnapshot,
} from '../../electron/bookmark-manager-contract'
import { applyBookmarkManagerMutation, createBookmarkManagerSnapshot } from '../bookmarkManager'
import { saveBookmarkManagerRevision } from '../bookmarkManagerRevision'
import { saveBookmarkManagerSnapshot } from '../bookmarkManagerStore'
import { DEFAULT_BOOKMARKS_STATE, saveBookmarksState } from '../bookmarks'
import { saveDashboardPins } from '../dashboardPins'
import { saveStartPages } from '../startPages'
import {
  HOME_V2_LEGACY_COLLECTION_KEYS,
  parseHomeV2LegacyCollectionsRaw,
  type HomeV2LegacyCollectionRawValues,
} from './legacy-collections-contract'

const SNAPSHOT_KEY = 'qortium-home-bookmark-manager-snapshot'
const ANDROID_MIGRATION_MARKER_KEY = 'qortium-home-v2-collections-migrated'
export type HomeV2CollectionsAccounts = {
  activeAccountId: string | null
  availableAccounts: BookmarkManagerAccountChoice[]
}

function withAccounts(snapshot: BookmarkManagerSnapshot, accounts: HomeV2CollectionsAccounts) {
  return validateBookmarkManagerSnapshot({
    ...snapshot,
    activeAccountId: accounts.activeAccountId,
    availableAccounts: accounts.availableAccounts,
  })
}

function withoutAccounts(snapshot: BookmarkManagerSnapshot) {
  const { activeAccountId: _activeAccountId, availableAccounts: _availableAccounts, ...stored } = snapshot
  return validateBookmarkManagerSnapshot(stored)
}

async function readRawStorageValue(key: string) {
  return Capacitor.isNativePlatform()
    ? (await Preferences.get({ key })).value
    : window.localStorage.getItem(key)
}

async function readCanonicalSnapshot() {
  const raw = await readRawStorageValue(SNAPSHOT_KEY)
  if (raw === null) return null
  try {
    return withoutAccounts(validateBookmarkManagerSnapshot(JSON.parse(raw)))
  } catch (error) {
    throw new Error('Saved Home links could not be loaded safely.', { cause: error })
  }
}

async function readLocalLegacySnapshot() {
  const entries = await Promise.all(HOME_V2_LEGACY_COLLECTION_KEYS.map(async (key) => [
    key,
    await readRawStorageValue(key),
  ] as const))
  return parseHomeV2LegacyCollectionsRaw(
    Object.fromEntries(entries) as HomeV2LegacyCollectionRawValues,
  ).snapshot
}

function snapshotCollections(snapshot: BookmarkManagerSnapshot, accounts: HomeV2CollectionsAccounts) {
  return {
    accounts,
    bookmarksState: {
      ...DEFAULT_BOOKMARKS_STATE,
      bookmarks: snapshot.bookmarks,
      toolbar: snapshot.toolbar,
      toolbarVisibility: snapshot.toolbarVisibility,
    },
    dashboardPins: snapshot.dashboardPins,
    revision: snapshot.revision,
    startPages: snapshot.startPages,
  }
}

async function persistSnapshot(snapshot: BookmarkManagerSnapshot) {
  const stored = withoutAccounts(snapshot)
  await Promise.all([
    saveBookmarksState({
      ...DEFAULT_BOOKMARKS_STATE,
      bookmarks: stored.bookmarks,
      toolbar: stored.toolbar,
      toolbarVisibility: stored.toolbarVisibility,
    }),
    saveDashboardPins(stored.dashboardPins),
    saveStartPages(stored.startPages),
  ])
  await saveBookmarkManagerRevision(stored.revision)
  // The canonical snapshot is the commit marker. Mirror failures therefore
  // cannot advance the authoritative CAS revision ahead of this client.
  await saveBookmarkManagerSnapshot(stored)
}

export class HomeV2CollectionsClient {
  private current: BookmarkManagerSnapshot | null = null
  private initialization: Promise<void> | null = null
  private mutationChain = Promise.resolve()

  initialize() {
    if (this.initialization) return this.initialization
    this.initialization = this.initializeOnce().catch((error) => {
      this.initialization = null
      throw error
    })
    return this.initialization
  }

  private async initializeOnce() {
    const native = Capacitor.isNativePlatform()
    if (native) {
      const marker = await readRawStorageValue(ANDROID_MIGRATION_MARKER_KEY)
      if (marker !== null && marker !== '1') {
        throw new Error('Saved Home links migration state is invalid.')
      }
      if (marker === '1') {
        const migrated = await readCanonicalSnapshot()
        if (!migrated) throw new Error('Saved Home links migration is incomplete.')
        this.current = migrated
        return
      }
      const imported = await readLocalLegacySnapshot()
      await persistSnapshot(imported)
      await Preferences.set({ key: ANDROID_MIGRATION_MARKER_KEY, value: '1' })
      this.current = imported
      return
    }

    const current = await readCanonicalSnapshot()
    if (current) {
      this.current = current
      return
    }

    const imported = window.homeV2Collections
      ? withoutAccounts(validateBookmarkManagerSnapshot(
          (await window.homeV2Collections.readLegacy()).snapshot,
        ))
      : await readLocalLegacySnapshot()
    await persistSnapshot(imported)
    this.current = imported
  }

  async getSnapshot(accounts: HomeV2CollectionsAccounts) {
    await this.initialize()
    if (!this.current) throw new Error('Saved Home links are unavailable.')
    return withAccounts(this.current, accounts)
  }

  apply(requestValue: unknown, accounts: HomeV2CollectionsAccounts) {
    const request = validateBookmarkManagerMutationRequest(requestValue) as BookmarkManagerMutationRequest
    const operation = this.mutationChain.then(async (): Promise<BookmarkManagerMutationResult> => {
      const currentSnapshot = await this.getSnapshot(accounts)
      if (request.expectedRevision !== currentSnapshot.revision) {
        throw Object.assign(new Error('Bookmarks changed; refresh and try again.'), { code: 'HOME_DATA_STALE' })
      }
      const result = applyBookmarkManagerMutation(
        snapshotCollections(currentSnapshot, accounts),
        request.mutation,
      )
      if (!result.changed) return { changed: false, snapshot: result.snapshot }
      const stored = withoutAccounts(result.snapshot)
      await persistSnapshot(stored)
      this.current = stored
      return { changed: true, snapshot: withAccounts(stored, accounts) }
    })
    this.mutationChain = operation.then(() => undefined, () => undefined)
    return operation
  }
}
