import type { AppDescriptor, AppResourceLocation, NetworkId, TabId } from '../v2/contracts'
import { reduceProductState, type ProductAction, type ProductState, type ShellEntry, type TabPageId } from '../v2/product-model'
import { currentAppLocation, currentAppLocationFromRender } from '../v2/current-app-location'
import { appDescriptorForOpenTab } from './publish-preview-tab'
import { HOME_V2_TAB_TRANSFER_MAX_HISTORY } from './tab-transfer'
import { mergeQdnAppHistory, spliceQdnAppHistory, type QdnAppHistorySession } from '../qdn-app-history'
import type { AppTabNavigationSnapshot } from '../v2/shell/AppTabStage'
import type { HomeV2SettingsSectionId } from '../v2/shell/SettingsPage'
import type { HomeV2ReleaseNotesTarget } from '../v2/shell/HomeV2ReleaseNotesPage'

/** Session-only destinations. Deliberately no vault, wallet or grant snapshots. */
export type TabDestination =
  | { readonly kind: 'viewer'; readonly location: string }
  | { readonly kind: 'app'; readonly app: AppDescriptor; readonly location: AppResourceLocation }
  | { readonly kind: 'internal'; readonly page: TabPageId; readonly section?: HomeV2SettingsSectionId }
  | { readonly kind: 'releases'; readonly target: HomeV2ReleaseNotesTarget }
  | { readonly kind: 'core-docs'; readonly network: NetworkId }

export interface TabHistory {
  readonly entries: readonly TabDestination[]
  readonly index: number
  readonly native?: QdnAppHistorySession
}
export type NavigationState = ProductState & {
  readonly navigation?: Readonly<Record<string, TabHistory>>
}
export type NavigationAction = ProductAction
  | { readonly type: 'show-transient'; readonly destination: Extract<TabDestination, { kind: 'releases' | 'core-docs' }> }
  | { readonly type: 'settings-section'; readonly tabId?: TabId; readonly section: HomeV2SettingsSectionId }
  | { readonly type: 'forget-native-history'; readonly tabId: TabId }
  | { readonly type: 'initialize-settings-history'; readonly section: HomeV2SettingsSectionId; readonly tabId?: TabId }
  | { readonly type: 'sync-app-history'; readonly tabId: TabId; readonly snapshot: AppTabNavigationSnapshot }
  | { readonly type: 'traverse-history'; readonly tabId: TabId; readonly index: number }
  | { readonly type: 'select-native-history'; readonly tabId: TabId; readonly index: number }
  /**
   * Installs the history a tab had in the window it was dragged out of, on
   * the tab this window opened for it. Navigation data only: it can never
   * change the tab's account binding, and it is refused unless the entry at
   * `index` is the destination the tab is already showing.
   */
  | { readonly type: 'seed-history'; readonly tabId: TabId; readonly entries: readonly TabDestination[]; readonly index: number }

export function destinationForEntry(entry: ShellEntry): TabDestination | null {
  if (entry.kind === 'viewer') return { kind: 'viewer', location: entry.location }
  if (entry.kind === 'internal') return { kind: 'internal', page: entry.page,
    ...(entry.page === 'settings' ? { section: 'general' as const } : {}) }
  // Preview capabilities are expiring and must never be replayed as an app URL.
  if (entry.context.previewUrl != null) return null
  const app = appDescriptorForOpenTab(entry)
  return app ? { kind: 'app', app, location: currentAppLocation(entry) } : null
}

export function tabHistory(state: NavigationState, id = state.activeTabId): TabHistory | undefined {
  const saved = state.navigation?.[id]
  if (saved) return saved
  const entry = state.entries.find(candidate => candidate.id === id)
  const destination = entry && destinationForEntry(entry)
  return destination ? { entries: [destination], index: 0 } : undefined
}
export function tabDestination(state: NavigationState, id = state.activeTabId) {
  const history = tabHistory(state, id)
  return history?.entries[history.index]
}
function sameDestination(a: TabDestination | undefined, b: TabDestination) {
  return JSON.stringify(a) === JSON.stringify(b)
}
/**
 * Whether two destinations name the same place, ignoring the display-only
 * parts. A destination rebuilt from an address carries a rebuilt AppDescriptor
 * whose title comes from the sender, so identity must be compared by location.
 */
function sameDestinationLocation(a: TabDestination, b: TabDestination): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'app') return a.location === (b as Extract<TabDestination, { kind: 'app' }>).location
  if (a.kind === 'viewer') return a.location === (b as Extract<TabDestination, { kind: 'viewer' }>).location
  if (a.kind === 'internal') return a.page === (b as Extract<TabDestination, { kind: 'internal' }>).page
  if (a.kind === 'releases') {
    const target = (b as Extract<TabDestination, { kind: 'releases' }>).target
    return a.target.product === target.product && a.target.tagName === target.tagName
  }
  return a.network === (b as Extract<TabDestination, { kind: 'core-docs' }>).network
}
function push(history: TabHistory | undefined, target: TabDestination, keepNative = false): TabHistory {
  if (sameDestination(history?.entries[history.index], target)) return history!
  return { entries: [...(history?.entries.slice(0, history.index + 1) ?? []), target],
    index: (history?.index ?? -1) + 1, ...(keepNative && history?.native ? { native: history.native } : {}) }
}
function withHistory(state: NavigationState, id: TabId, history: TabHistory): NavigationState {
  return { ...state, navigation: { ...state.navigation, [id]: history } }
}
function showCurrent(state: NavigationState): NavigationState {
  const current = tabDestination(state)
  const transient = current?.kind === 'releases' || current?.kind === 'core-docs' ? current.kind : null
  const entry = state.entries.find(candidate => candidate.id === state.activeTabId)!
  return { ...state, transient, destination: transient ?? (entry.kind === 'internal' ? entry.page : entry.kind === 'viewer' ? 'viewer' : 'tab') }
}

/** Native indices are usable only for the currently live app session. */
export function nativeHistoryIndex(state: NavigationState, id: TabId, index: number): number | null {
  const history = tabHistory(state, id), native = history?.native
  const entry = state.tabs.find(candidate => candidate.id === id)
  if (!native || !entry || native.resourceUrl !== entry.context.resourceLocation) return null
  return native.entries[index - native.startIndex]?.index ?? null
}

export function reduceTabNavigation(state: NavigationState, action: NavigationAction): NavigationState {
  if (action.type === 'initialize-settings-history') {
    let next = state
    for (const entry of state.entries) {
      const history = tabHistory(state, entry.id)
      if ((!action.tabId || entry.id === action.tabId) && entry.kind === 'internal' &&
          entry.page === 'settings' && history?.entries.length === 1) {
        next = withHistory(next, entry.id, { entries: [{ kind: 'internal', page: 'settings', section: action.section }], index: 0 })
      }
    }
    return next
  }
  if (action.type === 'forget-native-history') {
    const history = tabHistory(state, action.tabId)
    return history ? withHistory(state, action.tabId, { entries: history.entries, index: history.index }) : state
  }
  if (action.type === 'select-native-history') {
    const history = tabHistory(state, action.tabId)
    if (!history || nativeHistoryIndex(state, action.tabId, action.index) === null) return state
    return showCurrent(withHistory(state, action.tabId, { ...history, index: action.index }))
  }
  if (action.type === 'seed-history') {
    // The tab must exist here, and the seeded history must be describing IT:
    // an adopted tab is opened through the ordinary open path first, so the
    // entry the index points at has to be the destination that open produced.
    // Anything else is a payload that does not match what this window did, and
    // is dropped rather than applied.
    const entry = state.entries.find(candidate => candidate.id === action.tabId)
    const destination = entry && destinationForEntry(entry)
    const target = action.entries[action.index]
    if (!entry || !destination || !target || !Number.isInteger(action.index) ||
        action.index < 0 || action.index >= action.entries.length ||
        action.entries.length > HOME_V2_TAB_TRANSFER_MAX_HISTORY ||
        !sameDestinationLocation(target, destination)) return state
    // Only ever a seed, onto a PRISTINE history: a tab that has already
    // navigated owns its history, and a late or repeated payload must not
    // rewrite it. `native` means the tab's own webview has already reported a
    // session, so even a one-entry history there is no longer pristine.
    const existing = state.navigation?.[action.tabId]
    if (existing && (existing.native || existing.entries.length > 1)) return state
    // Copied, and no `native`: a session that belonged to another window's
    // webview is meaningless here.
    return withHistory(state, action.tabId, { entries: [...action.entries], index: action.index })
  }
  if (action.type === 'sync-app-history') {
    const tab = state.tabs.find(entry => entry.id === action.tabId)
    const snapshot = action.snapshot
    if (!tab || tab.context.previewUrl != null || !snapshot.renderUrl ||
        snapshot.resourceUrl !== tab.context.resourceLocation) return state
    const history = tabHistory(state, action.tabId)
    const app = appDescriptorForOpenTab(tab)
    if (!history || !app) return state
    const locations = snapshot.entries.map(entry => currentAppLocationFromRender(tab.context, entry.url, snapshot.renderUrl!))
    // Refuse a malformed/foreign snapshot wholesale, never realign indices by filtering it.
    if (locations.some(location => !location)) return state
    const overlay = history.entries[history.index]?.kind !== 'app'
    // A slow app can deliver its first snapshot after docs have covered it.
    // Anchor that session to the underlying app, never replace the viewer.
    let sessionStart = history.index
    if (overlay && !history.native) {
      while (sessionStart >= 0 && history.entries[sessionStart].kind !== 'app') sessionStart -= 1
      if (sessionStart < 0) return state
    }
    const merge = mergeQdnAppHistory({ currentHistoryIndex: sessionStart,
      activeIndex: snapshot.activeIndex, entries: [...snapshot.entries],
      displayUrls: locations as string[], previous: history.native,
      resourceUrl: tab.context.resourceLocation })
    if (!merge) return state
    const result = spliceQdnAppHistory({ currentEntries: [...history.entries],
      merge: overlay ? { ...merge, truncateForward: false } : merge,
      previousSessionLength: history.native?.entries.length ?? 1,
      nextAppEntries: locations.map(location => ({ kind: 'app' as const, app, location: location! })) })
    const delta = result.entries.length - history.entries.length
    return withHistory(state, action.tabId, { entries: result.entries,
      index: overlay ? history.index + delta : result.index, native: merge.session })
  }
  if (action.type === 'show-transient') {
    return showCurrent(withHistory(state, state.activeTabId,
      push(tabHistory(state), action.destination, true)))
  }
  if (action.type === 'settings-section') {
    const entry = state.entries.find(candidate => candidate.id === (action.tabId ?? state.activeTabId))
    if (entry?.kind !== 'internal' || entry.page !== 'settings') return state
    return withHistory(state, entry.id, push(tabHistory(state, entry.id),
      { kind: 'internal', page: 'settings', section: action.section }))
  }
  if (action.type === 'traverse-history') {
    const history = tabHistory(state, action.tabId)
    const target = history?.entries[action.index]
    const entry = state.entries.find(candidate => candidate.id === action.tabId)
    if (!history || !target || !entry || !Number.isInteger(action.index)) return state
    let next: NavigationState = state
    if (target.kind === 'app') {
      if (entry.kind !== 'app') return state
      // Bind to the tab's CURRENT account. History is navigation data, never authority.
      next = reduceProductState(state, { type: 'replace-tab-app', app: target.app,
        tabId: entry.id, fromResourceLocation: entry.context.resourceLocation,
        context: { ...entry.context, appId: target.app.id, sourceNetwork: target.app.sourceNetwork,
          resourceLocation: target.location, previewUrl: null } })
    } else {
      next = reduceProductState(state, { type: 'activate-tab', tabId: entry.id })
    }
    // A recreated app session receives fresh native indices; never reuse the old ones.
    return showCurrent(withHistory(next, entry.id, { entries: history.entries, index: action.index,
      ...(target.kind !== 'app' && history.native ? { native: history.native } : {}) }))
  }
  let next: NavigationState = reduceProductState(state, action)
  const navigation: Record<string, TabHistory> = {}
  for (const entry of next.entries) {
    const history = tabHistory(state, entry.id)
    const destination = destinationForEntry(entry)
    if (history) navigation[entry.id] = history
    else if (destination) navigation[entry.id] = { entries: [destination], index: 0 }
  }
  next = { ...next, navigation }
  if (action.type === 'replace-tab-app') {
    const before = state.entries.find(entry => entry.id === action.tabId)
    const after = next.entries.find(entry => entry.id === action.tabId)
    const destination = after && destinationForEntry(after)
    if (destination && before?.kind === 'app' && after?.kind === 'app' &&
        before.context.resourceLocation !== after.context.resourceLocation) {
      next = withHistory(next, action.tabId, push(tabHistory(state, action.tabId), destination))
    }
  }
  // Explicitly opening an already-open page returns to its root, but selecting
  // its tab resumes its current destination. Neither records visits to other tabs.
  if (action.type === 'open-app' || (action.type === 'navigate' && action.destination !== 'releases' && action.destination !== 'core-docs')) {
    const current = tabDestination(next)
    if (current?.kind === 'releases' || current?.kind === 'core-docs') {
      const entry = next.entries.find(candidate => candidate.id === next.activeTabId)!
      const destination = destinationForEntry(entry)
      if (destination) next = withHistory(next, entry.id, push(tabHistory(next), destination))
    }
  }
  // Legacy transient actions are retained for fixture/backward compatibility.
  return action.type === 'navigate' && (action.destination === 'releases' || action.destination === 'core-docs')
    ? next : showCurrent(next)
}
