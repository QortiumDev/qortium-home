import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import {
  validateBookmarkManagerMutationRequest,
  validateBookmarkManagerSnapshot,
  type BookmarkManagerAccountChoice,
  type BookmarkManagerLinkDraft,
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
const DASHBOARD_DEFAULTS_PENDING_KEY = 'qortium-home-v2-dashboard-defaults-pending'
const FRESH_SHELL_DEFAULTS_PENDING_KEY = 'qortium-home-v2-fresh-shell-defaults-pending'
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

async function writeRawStorageValue(key: string, value: string | null) {
  if (Capacitor.isNativePlatform()) {
    if (value === null) await Preferences.remove({ key })
    else await Preferences.set({ key, value })
    return
  }
  if (value === null) window.localStorage.removeItem(key)
  else window.localStorage.setItem(key, value)
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
  )
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
  private initializedFromEmptyStorage = false
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
    const defaultsPending = await readRawStorageValue(DASHBOARD_DEFAULTS_PENDING_KEY)
    if (defaultsPending !== null && defaultsPending !== '1') {
      throw new Error('Dashboard defaults initialization state is invalid.')
    }
    if (native) {
      const marker = await readRawStorageValue(ANDROID_MIGRATION_MARKER_KEY)
      if (marker !== null && marker !== '1') {
        throw new Error('Saved Home links migration state is invalid.')
      }
      if (marker === '1') {
        const migrated = await readCanonicalSnapshot()
        if (!migrated) throw new Error('Saved Home links migration is incomplete.')
        this.current = migrated
        this.initializedFromEmptyStorage = defaultsPending === '1'
        return
      }
      const imported = await readLocalLegacySnapshot()
      if (!imported.hadData) {
        await writeRawStorageValue(DASHBOARD_DEFAULTS_PENDING_KEY, '1')
      }
      await persistSnapshot(imported.snapshot)
      await Preferences.set({ key: ANDROID_MIGRATION_MARKER_KEY, value: '1' })
      this.current = imported.snapshot
      this.initializedFromEmptyStorage = defaultsPending === '1' || !imported.hadData
      return
    }

    const current = await readCanonicalSnapshot()
    if (current) {
      this.current = current
      this.initializedFromEmptyStorage = defaultsPending === '1'
      return
    }

    const imported = window.homeV2Collections
      ? await window.homeV2Collections.readLegacy().then((result) => ({
          hadData: result.hadData,
          snapshot: withoutAccounts(validateBookmarkManagerSnapshot(result.snapshot)),
        }))
      : await readLocalLegacySnapshot()
    if (!imported.hadData) {
      await writeRawStorageValue(DASHBOARD_DEFAULTS_PENDING_KEY, '1')
    }
    await persistSnapshot(imported.snapshot)
    this.current = imported.snapshot
    this.initializedFromEmptyStorage = defaultsPending === '1' || !imported.hadData
  }

  wasInitializedFromEmptyStorage() {
    if (!this.current) throw new Error('Saved Home links are unavailable.')
    return this.initializedFromEmptyStorage
  }

  markFreshShellForDashboardDefaults() {
    return writeRawStorageValue(FRESH_SHELL_DEFAULTS_PENDING_KEY, '1')
  }

  async hasPendingFreshShellForDashboardDefaults() {
    const marker = await readRawStorageValue(FRESH_SHELL_DEFAULTS_PENDING_KEY)
    if (marker !== null && marker !== '1') {
      throw new Error('Fresh shell defaults initialization state is invalid.')
    }
    return marker === '1'
  }

  /**
   * Decides BOTH sets of first-run defaults in one pass.
   *
   * The toolbar links are seeded here rather than by a second method on
   * purpose: this one clears the fresh-profile flags when it finishes, so
   * anything running afterwards would always see a profile that is no longer
   * fresh and would never seed. One flag lifecycle, one decision point.
   */
  finalizeDashboardPinDefaults(
    shouldSeed: boolean,
    pins: readonly BookmarkManagerLinkDraft[],
    accounts: HomeV2CollectionsAccounts,
    toolbar?: {
      readonly links: readonly BookmarkManagerLinkDraft[]
      readonly shouldSeed: boolean
    },
  ) {
    const operation = this.mutationChain.then(async () => {
      let current = await this.getSnapshot(accounts)
      if (
        shouldSeed &&
        this.initializedFromEmptyStorage &&
        current.dashboardPins.length === 0
      ) {
        for (const pin of pins) {
          current = applyBookmarkManagerMutation(
            snapshotCollections(current, accounts),
            { type: 'addDashboardPin', pin },
          ).snapshot
        }
        const stored = withoutAccounts(current)
        await persistSnapshot(stored)
        this.current = stored
        current = withAccounts(stored, accounts)
      }
      if (
        toolbar?.shouldSeed &&
        this.initializedFromEmptyStorage &&
        current.toolbar.length === 0
      ) {
        for (const link of toolbar.links) {
          current = applyBookmarkManagerMutation(
            snapshotCollections(current, accounts),
            { link, rootId: 'toolbar', type: 'addTreeLink' },
          ).snapshot
        }
        const stored = withoutAccounts(current)
        await persistSnapshot(stored)
        this.current = stored
        current = withAccounts(stored, accounts)
      }
      if (this.initializedFromEmptyStorage) {
        await writeRawStorageValue(DASHBOARD_DEFAULTS_PENDING_KEY, null)
        this.initializedFromEmptyStorage = false
      }
      await writeRawStorageValue(FRESH_SHELL_DEFAULTS_PENDING_KEY, null)
      return current
    })
    this.mutationChain = operation.then(() => undefined, () => undefined)
    return operation
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
