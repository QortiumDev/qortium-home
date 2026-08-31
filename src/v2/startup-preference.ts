/**
 * What Home opens with.
 *
 * - `restore`    the tabs from the last session. What Home 2 has always done,
 *                and the default, so upgrading changes nothing.
 * - `startPages` the saved start pages, which the Bookmarks app owns and edits.
 * - `newTab`     one new tab, which then follows the "New tab opens" setting --
 *                so choosing this can mean the Dashboard, the search page, or a
 *                custom address, without duplicating that choice here.
 *
 * The start pages THEMSELVES are deliberately not stored here. They live in the
 * bookmark manager's `startPages` root, edited in the Bookmarks app, so Home
 * neither keeps a second copy nor grows a second editor for them.
 */
export type HomeV2StartupPreference =
  | { readonly kind: 'restore' }
  | { readonly kind: 'startPages' }
  | { readonly kind: 'newTab' }

export const DEFAULT_STARTUP_PREFERENCE: HomeV2StartupPreference = Object.freeze(
  { kind: 'restore' },
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function parseHomeV2StartupPreference(
  value: unknown,
): HomeV2StartupPreference {
  if (!isRecord(value)) return DEFAULT_STARTUP_PREFERENCE
  if (value.kind === 'startPages') return Object.freeze({ kind: 'startPages' })
  if (value.kind === 'newTab') return Object.freeze({ kind: 'newTab' })
  return DEFAULT_STARTUP_PREFERENCE
}

/**
 * What a launch should actually do. Pure, so the behaviour is assertable
 * without a window.
 *
 * `startPages` is the only choice that DISCARDS the stored strip. The other two
 * keep the existing rules exactly: `restore` reopens the tabs and lets the
 * start-page launcher fill an otherwise-empty session, which is what Home has
 * always done; `newTab` opens the one tab the New tab setting describes.
 */
export interface HomeV2StartupPlan {
  /** Reopen the stored tab strip. False only for an explicit start-page launch. */
  readonly restoreTabs: boolean
  /**
   * - `when-empty` the long-standing rule: start pages fill a session that
   *   would otherwise be bare. A restored tab wins.
   * - `always`     the explicit choice: open them even though a strip was
   *   stored, because the reader asked for start pages instead of it.
   * - `never`      the reader asked for a new tab.
   */
  readonly startPages: 'when-empty' | 'always' | 'never'
  /** Where the one initial tab points before anything else opens. */
  readonly initialPage: 'dashboard' | 'newtab'
  /** The custom new-tab address to open in its own tab, if that is the choice. */
  readonly newTabAddress: string | null
  /**
   * Close the initial tab once something has replaced it. Otherwise start pages
   * arrive behind a Dashboard nobody asked for.
   */
  readonly closeInitialTab: boolean
}

export function resolveHomeV2StartupPlan(
  preference: HomeV2StartupPreference,
  newTabPreference:
    | { readonly kind: 'search' }
    | { readonly kind: 'dashboard' }
    | { readonly address: string; readonly kind: 'custom' },
): HomeV2StartupPlan {
  if (preference.kind === 'restore') {
    return {
      restoreTabs: true,
      startPages: 'when-empty',
      initialPage: 'dashboard',
      newTabAddress: null,
      closeInitialTab: false,
    }
  }
  if (preference.kind === 'startPages') {
    return {
      restoreTabs: false,
      startPages: 'always',
      initialPage: 'dashboard',
      newTabAddress: null,
      closeInitialTab: true,
    }
  }
  return {
    restoreTabs: false,
    startPages: 'never',
    initialPage: newTabPreference.kind === 'search' ? 'newtab' : 'dashboard',
    newTabAddress:
      newTabPreference.kind === 'custom' ? newTabPreference.address : null,
    closeInitialTab: newTabPreference.kind === 'custom',
  }
}
