import type {
  AppDescriptor,
  AppId,
  AppTabContext,
  TabId,
} from './contracts'
import { parseAppResourceLocation } from './resource-location'
import { sanitizeHomeV2AppTitle } from './app-frame-messages'

export type ShellDestination =
  | 'core-docs'
  | 'dashboard'
  | 'newtab'
  | 'releases'
  | 'settings'
  | 'welcome'
  | 'tab'

export type InternalPageId = Exclude<ShellDestination, 'tab'>

/**
 * Pages that own unpersisted side state in the shell (the release target, the
 * docs network, onboarding progress). They render full-window instead of
 * taking a tab, so there is only ever one of each and they never survive a
 * restart.
 */
export type TransientPageId = 'core-docs' | 'releases'

/** Internal pages that can hold a tab, and may do so more than once. */
export type TabPageId = Exclude<InternalPageId, TransientPageId>

const transientPages: ReadonlySet<InternalPageId> = new Set<InternalPageId>([
  'core-docs',
  'releases',
])

export function isTransientPage(page: InternalPageId): page is TransientPageId {
  return transientPages.has(page)
}

export interface AppTab {
  readonly id: TabId
  readonly appId: AppId
  readonly title: string
  readonly context: AppTabContext
}

/**
 * One entry in the tab strip. Internal pages and apps share a single ordered
 * list, so they interleave and drag past each other freely, and a page may
 * appear more than once — every instance has its own id.
 */
export type ShellEntry =
  | { readonly kind: 'internal'; readonly id: TabId; readonly page: TabPageId }
  | {
      readonly kind: 'app'
      readonly id: TabId
      readonly appId: AppId
      readonly title: string
      readonly context: AppTabContext
    }

export interface ProductState {
  /** Source of truth: every tab, in strip order. Never empty. */
  readonly entries: readonly ShellEntry[]
  readonly activeTabId: TabId
  /** Full-window page that temporarily replaces the active tab's content. */
  readonly transient: TransientPageId | null
  /** Derived: app entries only, for surfaces that ignore internal pages. */
  readonly tabs: readonly AppTab[]
  /** Derived: transient page, else the active internal page, else 'tab'. */
  readonly destination: ShellDestination
  readonly revision: number
}

export type ProductAction =
  | {
      readonly type: 'open-app'
      readonly app: AppDescriptor
      readonly context: AppTabContext
      readonly tabId: TabId
    }
  /**
   * Replaces one app tab's content in place, keeping its id and its position
   * in the strip. The reducer behind the OPEN_CURRENT_TAB bridge action.
   */
  | {
      readonly type: 'replace-tab-app'
      readonly app: AppDescriptor
      readonly context: AppTabContext
      readonly tabId: TabId
    }
  | { readonly type: 'activate-tab'; readonly tabId: TabId }
  | { readonly type: 'close-tab'; readonly tabId: TabId }
  | {
      readonly type: 'set-tab-title'
      readonly tabId: TabId
      readonly title: string | null
    }
  /** Focuses an existing tab for the page, opening one only if none is open. */
  | {
      readonly type: 'navigate'
      readonly destination: InternalPageId
    }
  /** Always opens another instance of the page (the "+" / Ctrl+T route). */
  | {
      readonly type: 'open-internal'
      readonly page: TabPageId
      readonly tabId: TabId
    }
  | {
      readonly type: 'reorder-tab'
      readonly tabId: TabId
      readonly toIndex: number
    }
  | { readonly type: 'restore'; readonly state: ProductState }

export class ProductModelError extends Error {
  constructor(
    readonly code:
      | 'APP_CONTEXT_MISMATCH'
      | 'TAB_ALREADY_EXISTS'
      | 'TAB_NOT_FOUND',
    message: string,
  ) {
    super(message)
    this.name = 'ProductModelError'
  }
}

let fallbackTabSequence = 0

/** Ids only have to be unique within a window. */
function nextInternalTabId(): TabId {
  fallbackTabSequence += 1
  return `home-v2:internal:${fallbackTabSequence}` as TabId
}

function freezeEntry(entry: ShellEntry): ShellEntry {
  return entry.kind === 'app'
    ? Object.freeze({ ...entry, context: Object.freeze({ ...entry.context }) })
    : Object.freeze({ ...entry })
}

function freezeProductState(
  state: Omit<ProductState, 'tabs' | 'destination'>,
): ProductState {
  const entries: readonly ShellEntry[] = state.entries.length
    ? state.entries
    : [
        {
          kind: 'internal' as const,
          id: nextInternalTabId(),
          page: 'dashboard' as const,
        },
      ]
  const activeTabId = entries.some((entry) => entry.id === state.activeTabId)
    ? state.activeTabId
    : entries[0].id
  const active = entries.find((entry) => entry.id === activeTabId)!
  const appTabs = entries.filter(
    (entry): entry is Extract<ShellEntry, { kind: 'app' }> =>
      entry.kind === 'app',
  )
  return Object.freeze({
    ...state,
    entries: Object.freeze(entries.map(freezeEntry)),
    activeTabId,
    tabs: Object.freeze(
      appTabs.map((entry) =>
        Object.freeze({
          id: entry.id,
          appId: entry.appId,
          title: entry.title,
          context: Object.freeze({ ...entry.context }),
        }),
      ),
    ),
    destination:
      state.transient ?? (active.kind === 'internal' ? active.page : 'tab'),
  })
}

export function createProductState(): ProductState {
  const id = nextInternalTabId()
  return freezeProductState({
    entries: [{ kind: 'internal', id, page: 'dashboard' }],
    activeTabId: id,
    transient: null,
    revision: 0,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const tabPages: ReadonlySet<string> = new Set<TabPageId>([
  'dashboard',
  'newtab',
  'settings',
  'welcome',
])

/**
 * Welcome opens as an ordinary closable tab, but it must not come BACK on a
 * later launch: onboarding state is separate, and a restored welcome tab in a
 * completed profile would render its error state.
 */
const restorableTabPages: ReadonlySet<string> = new Set<TabPageId>([
  'dashboard',
  'newtab',
  'settings',
])

function parseAppEntry(candidate: unknown): ShellEntry | null {
  if (!isRecord(candidate) || !isRecord(candidate.context)) return null
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
  const appId = typeof candidate.appId === 'string' ? candidate.appId.trim() : ''
  const title = sanitizeHomeV2AppTitle(candidate.title)
  const context = candidate.context
  const resourceLocation =
    typeof context.resourceLocation === 'string'
      ? context.resourceLocation.trim()
      : ''
  if (
    !id ||
    id.length > 80 ||
    !appId ||
    appId.length > 400 ||
    !title ||
    context.appId !== appId ||
    context.tabId !== id ||
    (context.sourceNetwork !== 'qortal' && context.sourceNetwork !== 'qortium')
  ) {
    return null
  }
  try {
    const parsed = parseAppResourceLocation(resourceLocation)
    if (parsed.sourceNetwork !== context.sourceNetwork) return null
  } catch {
    return null
  }
  return {
    kind: 'app',
    id: id as TabId,
    appId: appId as AppId,
    title,
    context: {
      appId: appId as AppId,
      identityId:
        typeof context.identityId === 'string'
          ? (context.identityId as AppTabContext['identityId'])
          : ('home-v2:identity:none' as AppTabContext['identityId']),
      resourceLocation: resourceLocation as AppTabContext['resourceLocation'],
      sourceNetwork: context.sourceNetwork,
      tabId: id as TabId,
      walletRef:
        typeof context.walletRef === 'string'
          ? (context.walletRef as AppTabContext['walletRef'])
          : null,
    },
  }
}

export function restoreProductState(value: unknown): ProductState {
  if (!isRecord(value)) return createProductState()
  const entries: ShellEntry[] = []
  const seenIds = new Set<string>()

  const pushEntry = (entry: ShellEntry | null) => {
    if (!entry || seenIds.has(entry.id)) return
    seenIds.add(entry.id)
    entries.push(entry)
  }

  if (Array.isArray(value.entries)) {
    for (const candidate of value.entries.slice(0, 20)) {
      if (!isRecord(candidate)) continue
      if (candidate.kind === 'internal') {
        const page = typeof candidate.page === 'string' ? candidate.page : ''
        const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
        if (!restorableTabPages.has(page) || !id || id.length > 80) continue
        pushEntry({ kind: 'internal', id: id as TabId, page: page as TabPageId })
      } else {
        pushEntry(parseAppEntry(candidate))
      }
    }
  } else {
    // Pre-unified states: a separate internalPages list plus app tabs.
    if (Array.isArray(value.internalPages)) {
      for (const candidate of value.internalPages.slice(0, 8)) {
        if (typeof candidate !== 'string' || !restorableTabPages.has(candidate)) continue
        pushEntry({
          kind: 'internal',
          id: nextInternalTabId(),
          page: candidate as TabPageId,
        })
      }
    }
    if (Array.isArray(value.tabs)) {
      for (const candidate of value.tabs.slice(0, 12)) {
        pushEntry(parseAppEntry(candidate))
      }
    }
    if (!entries.some((entry) => entry.kind === 'internal')) {
      entries.unshift({
        kind: 'internal',
        id: nextInternalTabId(),
        page: 'dashboard',
      })
    }
  }

  const activeTabId =
    typeof value.activeTabId === 'string' &&
    entries.some((entry) => entry.id === value.activeTabId)
      ? (value.activeTabId as TabId)
      : (entries[0]?.id ?? nextInternalTabId())

  return freezeProductState({
    entries,
    activeTabId,
    // Transient pages never restore: their side state is not persisted.
    transient: null,
    revision: 0,
  })
}

function contextsIdentifySameTab(
  left: AppTabContext,
  right: AppTabContext,
): boolean {
  return (
    left.appId === right.appId &&
    left.identityId === right.identityId &&
    left.walletRef === right.walletRef &&
    left.sourceNetwork === right.sourceNetwork &&
    left.resourceLocation === right.resourceLocation
  )
}

/**
 * The invariants every app tab must satisfy, whether it is being opened in a
 * new tab or replacing the content of an existing one: the immutable context
 * names this exact app and tab, its resource location parses, and that
 * location agrees with the app's source chain and resource identity.
 *
 * Shared so the in-place replacement can never be validated more loosely than
 * a fresh open.
 */
function assertAppTabTarget(
  app: AppDescriptor,
  context: AppTabContext,
  tabId: TabId,
): void {
  if (context.appId !== app.id || context.tabId !== tabId) {
    throw new ProductModelError(
      'APP_CONTEXT_MISMATCH',
      'The app or tab does not match the immutable operation context.',
    )
  }
  let parsedLocation: ReturnType<typeof parseAppResourceLocation>
  try {
    parsedLocation = parseAppResourceLocation(context.resourceLocation)
  } catch {
    throw new ProductModelError(
      'APP_CONTEXT_MISMATCH',
      'The app resource location is invalid.',
    )
  }
  if (
    context.sourceNetwork !== app.sourceNetwork ||
    parsedLocation.sourceNetwork !== app.sourceNetwork ||
    parsedLocation.identity.name !== app.resourceIdentity.name ||
    parsedLocation.identity.identifier !== app.resourceIdentity.identifier
  ) {
    throw new ProductModelError(
      'APP_CONTEXT_MISMATCH',
      'The app resource location does not match its immutable source chain.',
    )
  }
}

/**
 * Replaces one app tab's content in place, keeping its id and strip position.
 *
 * This is the reducer behind the OPEN_CURRENT_TAB bridge action. The tab it
 * acts on is chosen by the trusted host from the requesting view's own
 * context — never from a field the app supplied — and this reducer refuses any
 * id that is not an existing APP tab. So even a bridge mistake cannot turn
 * "navigate my own tab" into navigating Settings, the dashboard, or a tab
 * belonging to a different app.
 */
function replaceTabApp(
  state: ProductState,
  action: Extract<ProductAction, { readonly type: 'replace-tab-app' }>,
): ProductState {
  const index = state.entries.findIndex((entry) => entry.id === action.tabId)
  if (index < 0) {
    throw new ProductModelError(
      'TAB_NOT_FOUND',
      `Tab ${action.tabId} was not found.`,
    )
  }
  const current = state.entries[index]
  if (current.kind !== 'app') {
    throw new ProductModelError(
      'TAB_NOT_FOUND',
      `Tab ${action.tabId} is not an app tab.`,
    )
  }
  assertAppTabTarget(action.app, action.context, action.tabId)
  // Already showing exactly this app in this tab: bring it forward rather than
  // rebuilding an identical entry, matching how open-app treats a repeat open.
  if (contextsIdentifySameTab(current.context, action.context)) {
    return freezeProductState({
      ...state,
      transient: null,
      activeTabId: current.id,
      revision: state.revision + 1,
    })
  }
  const entries = [...state.entries]
  entries[index] = {
    kind: 'app',
    id: action.tabId,
    appId: action.app.id,
    title: action.app.title,
    context: { ...action.context, tabId: action.tabId },
  }
  return freezeProductState({
    ...state,
    entries,
    transient: null,
    activeTabId: action.tabId,
    revision: state.revision + 1,
  })
}

function openApp(
  state: ProductState,
  action: Extract<ProductAction, { readonly type: 'open-app' }>,
): ProductState {
  assertAppTabTarget(action.app, action.context, action.tabId)

  const existing = state.entries.find(
    (entry) =>
      entry.kind === 'app' &&
      contextsIdentifySameTab(entry.context, action.context),
  )
  if (existing) {
    return freezeProductState({
      ...state,
      transient: null,
      activeTabId: existing.id,
      revision: state.revision + 1,
    })
  }
  if (state.entries.some((entry) => entry.id === action.tabId)) {
    throw new ProductModelError(
      'TAB_ALREADY_EXISTS',
      `Tab ${action.tabId} already exists.`,
    )
  }

  return freezeProductState({
    ...state,
    entries: [
      ...state.entries,
      {
        kind: 'app',
        id: action.tabId,
        appId: action.app.id,
        title: action.app.title,
        context: { ...action.context, tabId: action.tabId },
      },
    ],
    transient: null,
    activeTabId: action.tabId,
    revision: state.revision + 1,
  })
}

function activateTab(state: ProductState, tabId: TabId): ProductState {
  if (!state.entries.some((entry) => entry.id === tabId)) {
    throw new ProductModelError('TAB_NOT_FOUND', `Tab ${tabId} was not found.`)
  }
  return freezeProductState({
    ...state,
    transient: null,
    activeTabId: tabId,
    revision: state.revision + 1,
  })
}

function closeTab(state: ProductState, tabId: TabId): ProductState {
  const closingIndex = state.entries.findIndex((entry) => entry.id === tabId)
  if (closingIndex < 0) {
    throw new ProductModelError('TAB_NOT_FOUND', `Tab ${tabId} was not found.`)
  }
  const entries = state.entries.filter((entry) => entry.id !== tabId)
  if (state.activeTabId !== tabId) {
    return freezeProductState({
      ...state,
      entries,
      revision: state.revision + 1,
    })
  }
  // Closing the active tab moves to its neighbour; emptying the strip
  // reopens the dashboard rather than leaving a blank window.
  const nextActive = entries[Math.min(closingIndex, entries.length - 1)]
  return freezeProductState({
    ...state,
    entries,
    transient: null,
    activeTabId: nextActive?.id ?? nextInternalTabId(),
    revision: state.revision + 1,
  })
}

function setTabTitle(
  state: ProductState,
  tabId: TabId,
  requestedTitle: string | null,
): ProductState {
  const current = state.entries.find((entry) => entry.id === tabId)
  if (!current || current.kind !== 'app') {
    throw new ProductModelError('TAB_NOT_FOUND', `Tab ${tabId} was not found.`)
  }
  const fallback = parseAppResourceLocation(
    current.context.resourceLocation,
  ).identity.name
  const title = sanitizeHomeV2AppTitle(requestedTitle) ?? fallback
  if (title === current.title) return state
  return freezeProductState({
    ...state,
    entries: state.entries.map((entry) =>
      entry.id === tabId && entry.kind === 'app' ? { ...entry, title } : entry,
    ),
    revision: state.revision + 1,
  })
}

function openInternal(
  state: ProductState,
  page: TabPageId,
  tabId: TabId,
): ProductState {
  if (state.entries.some((entry) => entry.id === tabId)) {
    throw new ProductModelError(
      'TAB_ALREADY_EXISTS',
      `Tab ${tabId} already exists.`,
    )
  }
  return freezeProductState({
    ...state,
    entries: [...state.entries, { kind: 'internal', id: tabId, page }],
    transient: null,
    activeTabId: tabId,
    revision: state.revision + 1,
  })
}

function navigate(
  state: ProductState,
  destination: InternalPageId,
): ProductState {
  if (isTransientPage(destination)) {
    return freezeProductState({
      ...state,
      transient: destination,
      revision: state.revision + 1,
    })
  }
  const existing = state.entries.find(
    (entry) => entry.kind === 'internal' && entry.page === destination,
  )
  if (existing) {
    return freezeProductState({
      ...state,
      transient: null,
      activeTabId: existing.id,
      revision: state.revision + 1,
    })
  }
  return openInternal(state, destination, nextInternalTabId())
}

// toIndex is the entry's desired final index in the single ordered strip.
function reorderTab(
  state: ProductState,
  tabId: TabId,
  toIndex: number,
): ProductState {
  const fromIndex = state.entries.findIndex((entry) => entry.id === tabId)
  if (fromIndex < 0) {
    throw new ProductModelError('TAB_NOT_FOUND', `Tab ${tabId} was not found.`)
  }
  const clamped = Math.max(
    0,
    Math.min(state.entries.length - 1, Math.trunc(toIndex)),
  )
  if (clamped === fromIndex) return state
  const entries = [...state.entries]
  const [moved] = entries.splice(fromIndex, 1)
  entries.splice(clamped, 0, moved)
  return freezeProductState({
    ...state,
    entries,
    revision: state.revision + 1,
  })
}

export function reduceProductState(
  state: ProductState,
  action: ProductAction,
): ProductState {
  switch (action.type) {
    case 'open-app':
      return openApp(state, action)
    case 'replace-tab-app':
      return replaceTabApp(state, action)
    case 'activate-tab':
      return activateTab(state, action.tabId)
    case 'close-tab':
      return closeTab(state, action.tabId)
    case 'set-tab-title':
      return setTabTitle(state, action.tabId, action.title)
    case 'navigate':
      return navigate(state, action.destination)
    case 'open-internal':
      return openInternal(state, action.page, action.tabId)
    case 'reorder-tab':
      return reorderTab(state, action.tabId, action.toIndex)
    case 'restore':
      return freezeProductState(action.state)
  }
}
