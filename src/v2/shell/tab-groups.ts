import type { ShellEntry } from '../product-model'
import { savedEntryAccountId } from './account-context'

/** The group for tabs bound to no account: internal pages and guest viewers. */
export const HOME_TAB_GROUP_KEY = 'home'

export interface TabGroup {
  /** `home`, or `account:<id>`. Stable across renders for the same account. */
  readonly key: string
  readonly accountId: string | null
  readonly entries: readonly ShellEntry[]
}

/**
 * The strip's grouping: a view over the flat, user-ordered tab list, never a
 * change to it. The Home group (tabs bound to no account) comes first; every
 * account's group follows in the order that account first appears in the
 * list, and tabs keep their relative order inside a group. Nothing in the
 * shell state changes, so a session saved before grouping existed renders
 * the same tabs in the same groups.
 */
export function groupTabsByAccount(entries: readonly ShellEntry[]): readonly TabGroup[] {
  const groups = new Map<string, { accountId: string | null; entries: ShellEntry[] }>()
  groups.set(HOME_TAB_GROUP_KEY, { accountId: null, entries: [] })
  for (const entry of entries) {
    const accountId = savedEntryAccountId(entry)
    const key = tabGroupKey(accountId)
    let group = groups.get(key)
    if (!group) {
      group = { accountId, entries: [] }
      groups.set(key, group)
    }
    group.entries.push(entry)
  }
  return [...groups.entries()]
    .filter(([, group]) => group.entries.length > 0)
    .map(([key, group]) => ({ key, accountId: group.accountId, entries: group.entries }))
}

export function tabGroupKey(accountId: string | null): string {
  return accountId ? `account:${accountId}` : HOME_TAB_GROUP_KEY
}

/** The grouped, visual order of tab ids -- what Left/Right arrows walk. */
export function groupedTabOrder(entries: readonly ShellEntry[]): readonly string[] {
  return groupTabsByAccount(entries).flatMap((group) => group.entries.map((entry) => entry.id as string))
}
