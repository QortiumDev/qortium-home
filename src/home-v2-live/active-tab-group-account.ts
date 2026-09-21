import type { HomeV2AccountCatalogue } from '../v2/contracts'
import type { ProductState, ShellEntry } from '../v2/product-model'
import { savedEntryAccountId } from '../v2/shell/account-context'

/**
 * The account of the tab group the user is IN, read from trusted product
 * state alone — what every shell-originated action follows: the + button, a
 * Dashboard tile, the address the "+" opens, and the selected account itself.
 *
 * - a string: that account's group (an app or viewer bound to it, or an
 *   internal page opened into it);
 * - null: the explicit no-account group (a guest app or viewer, or a page
 *   opened into that group);
 * - the selected account for the Dashboard, which sits with the selection;
 * - undefined: the active tab names no group — an internal page from before
 *   pages carried one, or one reached by `navigate` — and the shell falls
 *   back to the stored selection.
 *
 * Nothing an app supplies reaches this: bindings come from the tab entries.
 */
export function activeTabGroupAccountId(
  state: ProductState,
  selectedAccountId: string | null,
): string | null | undefined {
  const entry = state.entries.find((candidate) => candidate.id === state.activeTabId)
  if (!entry) return undefined
  if (entry.kind === 'internal') {
    if (entry.page === 'dashboard') return selectedAccountId
    return entry.accountId
  }
  return savedEntryAccountId(entry)
}

/**
 * The account a shell-originated open from the active tab binds to: the
 * group's account while it is still in the catalogue; otherwise (a removed
 * account, or the no-account group) null, the explicit no-account binding.
 * Never the stored selection when the tab names a group of its own.
 */
export function activeTabGroupOpenAccountId(
  state: ProductState,
  selectedAccountId: string | null,
  catalogue: Pick<HomeV2AccountCatalogue, 'accounts'>,
): string | null {
  const accountId = activeTabGroupAccountId(state, selectedAccountId)
  const effective = accountId === undefined ? selectedAccountId : accountId
  return effective !== null && catalogue.accounts.some((account) => account.id === effective)
    ? effective
    : null
}

/**
 * The account the stored selection should switch to because the user moved
 * into another group, or null to leave the selection alone: the active tab's
 * group names a real, still-present account that is not the selected one.
 * The no-account group and pages that name no group never deselect — the
 * chrome already shows those tabs as bound to no account, and deselecting
 * the account would lock the user out of the Dashboard and Settings for
 * nothing.
 */
export function tabGroupAccountToFollow(
  state: ProductState,
  selectedAccountId: string | null,
  catalogue: Pick<HomeV2AccountCatalogue, 'accounts'>,
): string | null {
  const accountId = activeTabGroupAccountId(state, selectedAccountId)
  if (!accountId || accountId === selectedAccountId) return null
  return catalogue.accounts.some((account) => account.id === accountId) ? accountId : null
}

/**
 * The wallet an account-mutating dialog (rename, remove, remember-unlock)
 * may act on at submit: the one captured when the dialog opened, and only
 * while it is still the selected wallet. The selection can move behind a
 * modal — a Ctrl+Tab into another group follows it — and the dialog's title
 * and fields describe the account it opened for, so a mismatch is refused
 * rather than retargeted.
 */
export function capturedAccountDialogTarget(
  captured: string | undefined,
  selectedWalletId: string | null | undefined,
): string | null {
  if (!captured || !selectedWalletId) return null
  return captured === selectedWalletId ? captured : null
}

/**
 * The account a tab travels with when it moves to another window or is
 * remembered for reopening: an app or viewer's own binding; an internal
 * page's group, with a page that names no group sent as the explicit
 * no-account one (a transfer never inherits the receiving window's
 * selection). The Dashboard sits with the selection wherever it lands.
 */
export function transferableEntryAccountId(entry: ShellEntry): string | null {
  if (entry.kind === 'internal') return entry.accountId ?? null
  return savedEntryAccountId(entry)
}
