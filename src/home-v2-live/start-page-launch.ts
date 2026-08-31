import { parseHomeV2InternalAddress } from '../v2/new-tab-preference'
import { MAX_START_PAGES, type StartPage } from '../startPages'

export interface StartPageLaunchInput {
  /** App tabs already open (a restored session keeps its tabs). */
  readonly appTabCount: number
  /**
   * How the "When Home opens" setting wants start pages treated.
   *
   * - `when-empty` the long-standing rule: they fill a session that would
   *   otherwise be bare, and a restored tab wins.
   * - `always`     the reader explicitly chose start pages over the stored
   *   strip, so an open tab is no longer a reason to skip them. (The strip is
   *   not restored on that path, so there is normally nothing there anyway.)
   * - `never`      the reader chose a new tab.
   */
  readonly mode: 'when-empty' | 'always' | 'never'
  /** Welcome/onboarding still running suppresses start pages, like v1. */
  readonly onboardingInProgress: boolean
  readonly startPages: readonly StartPage[]
  /** Account ids that still exist; unknown bindings fall back to current. */
  readonly knownAccountIds: readonly string[]
}

export interface StartPageLaunchEntry {
  /** null = open with the currently selected account. */
  readonly accountId: string | null
  readonly displayUrl: string
}

/**
 * Decides which saved start pages to open at launch. The v1 rules still hold
 * for `when-empty`, which is what an unset "When Home opens" means: start pages
 * apply only when the session would otherwise be just the dashboard — a
 * restored session's tabs always win. Onboarding suppresses them whatever the
 * setting says. Pages bound to an account that no longer exists open with the
 * current account instead of failing.
 *
 * The pages themselves come from the bookmark manager's `startPages` root and
 * are edited in the Bookmarks app; Home neither stores a second copy nor offers
 * a second editor.
 */
export function planStartPageLaunch(
  input: StartPageLaunchInput,
): readonly StartPageLaunchEntry[] {
  if (input.mode === 'never' || input.onboardingInProgress) return []
  if (input.mode === 'when-empty' && input.appTabCount > 0) return []
  const known = new Set(input.knownAccountIds)
  return input.startPages.slice(0, MAX_START_PAGES).flatMap((page) => {
    const displayUrl = page.displayUrl.trim()
    if (!displayUrl) return []
    return [
      {
        accountId:
          page.accountId && known.has(page.accountId) ? page.accountId : null,
        displayUrl,
      },
    ]
  })
}

/**
 * The tab page a start-page address names, or null if it is not one of Home's
 * own pages.
 *
 * `parseHomeV2InternalAddress` returns a wider type than its pattern can
 * produce -- it includes destinations that are not tab pages -- so this narrows
 * rather than casts, and anything unrecognised falls through to the ordinary
 * address route.
 */
export function homeV2StartPageTabPage(
  address: string,
): 'dashboard' | 'newtab' | 'settings' | 'welcome' | null {
  const destination = parseHomeV2InternalAddress(address)
  return destination === 'dashboard' ||
    destination === 'newtab' ||
    destination === 'settings' ||
    destination === 'welcome'
    ? destination
    : null
}
