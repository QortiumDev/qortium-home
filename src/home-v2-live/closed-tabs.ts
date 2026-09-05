import type { TabId } from '../v2/contracts'
import type { TabPageId } from '../v2/product-model'
import type { HomeV2SettingsSectionId } from '../v2/shell/SettingsPage'
import { rememberClosedAppTab, type ClosedAppTab } from './closed-app-tabs'
import { tabDestination, type NavigationState } from './tab-navigation'

export type ClosedTab = ClosedAppTab | {
  readonly sourceTabId: TabId
  readonly kind: 'viewer'
  readonly location: string
  readonly accountId: string | null
} | {
  readonly sourceTabId: TabId
  readonly page: TabPageId
  readonly section?: HomeV2SettingsSectionId
}

/** One ordered close stack; internal pages never carry app authority. */
export function rememberClosedTab(history: readonly ClosedTab[], state: NavigationState, id: TabId): ClosedTab[] {
  if (history.some(entry => entry.sourceTabId === id)) return [...history]
  const entry = state.entries.find(candidate => candidate.id === id)
  if (!entry) return [...history]
  if (entry.kind === 'viewer') return [...history, { kind: 'viewer' as const, sourceTabId: id,
    location: entry.location, accountId: entry.accountId }].slice(-10)
  if (entry.kind === 'app') {
    return [...history, ...rememberClosedAppTab([], entry)].slice(-10)
  }
  const current = tabDestination(state, id)
  return [...history, { sourceTabId: id, page: entry.page,
    ...(current?.kind === 'internal' && current.section ? { section: current.section } : {}) }].slice(-10)
}
