import { MAX_START_PAGES, type StartPage } from '../startPages'

export interface StartPageLaunchInput {
  /** App tabs already open (a restored session keeps its tabs). */
  readonly appTabCount: number
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
 * Decides which saved start pages to open at launch. Mirrors the v1 rules:
 * start pages apply only when the session would otherwise be just the
 * dashboard — a restored session's tabs always win — and never during
 * onboarding. Pages bound to an account that no longer exists open with the
 * current account instead of failing.
 */
export function planStartPageLaunch(
  input: StartPageLaunchInput,
): readonly StartPageLaunchEntry[] {
  if (input.onboardingInProgress || input.appTabCount > 0) return []
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
