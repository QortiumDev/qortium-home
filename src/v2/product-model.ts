import type {
  AppDescriptor,
  AppId,
  AppTabContext,
  TabId,
} from './contracts'
import { parseAppResourceLocation } from './resource-location'
import { sanitizeHomeV2AppTitle } from './app-frame-messages'

export type ShellDestination =
  | 'activity'
  | 'apps'
  | 'core-docs'
  | 'dashboard'
  | 'newtab'
  | 'releases'
  | 'settings'
  | 'welcome'
  | 'tab'

export interface AppTab {
  readonly id: TabId
  readonly appId: AppId
  readonly title: string
  readonly context: AppTabContext
}

export type InternalPageId = Exclude<ShellDestination, 'tab'>

export interface ProductState {
  readonly destination: ShellDestination
  /**
   * Internal pages open as tabs, in tab-strip order. Each page is open at
   * most once; a non-'tab' destination is always a member of this list.
   */
  readonly internalPages: readonly InternalPageId[]
  readonly tabs: readonly AppTab[]
  readonly activeTabId: TabId | null
  readonly revision: number
}

export type ProductAction =
  | {
      readonly type: 'open-app'
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
  | {
      readonly type: 'navigate'
      readonly destination: Exclude<ShellDestination, 'tab'>
    }
  | { readonly type: 'close-internal'; readonly page: InternalPageId }
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

function freezeTab(tab: AppTab): AppTab {
  return Object.freeze({
    ...tab,
    context: Object.freeze({ ...tab.context }),
  })
}

function freezeProductState(state: ProductState): ProductState {
  return Object.freeze({
    ...state,
    internalPages: Object.freeze([...state.internalPages]),
    tabs: Object.freeze(state.tabs.map(freezeTab)),
  })
}

export function createProductState(): ProductState {
  return freezeProductState({
    destination: 'dashboard',
    internalPages: ['dashboard'],
    tabs: [],
    activeTabId: null,
    revision: 0,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const destinations = new Set<ShellDestination>([
  'activity',
  'apps',
  'core-docs',
  'dashboard',
  'newtab',
  'releases',
  'settings',
  'welcome',
  'tab',
])

export function restoreProductState(value: unknown): ProductState {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return createProductState()
  const tabs: AppTab[] = []
  for (const candidate of value.tabs.slice(0, 12)) {
    if (!isRecord(candidate) || !isRecord(candidate.context)) continue
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
      (context.sourceNetwork !== 'qortal' &&
        context.sourceNetwork !== 'qortium')
    ) {
      continue
    }
    try {
      const parsed = parseAppResourceLocation(resourceLocation)
      if (parsed.sourceNetwork !== context.sourceNetwork) continue
    } catch {
      continue
    }
    tabs.push(
      freezeTab({
        id: id as TabId,
        appId: appId as AppId,
        title,
        context: {
          appId: appId as AppId,
          identityId:
            typeof context.identityId === 'string'
              ? (context.identityId as AppTabContext['identityId'])
              : ('home-v2:identity:none' as AppTabContext['identityId']),
          resourceLocation:
            resourceLocation as AppTabContext['resourceLocation'],
          sourceNetwork: context.sourceNetwork,
          tabId: id as TabId,
          walletRef:
            typeof context.walletRef === 'string'
              ? (context.walletRef as AppTabContext['walletRef'])
              : null,
        },
      }),
    )
  }
  const destination = destinations.has(value.destination as ShellDestination)
    ? (value.destination as ShellDestination)
    : 'dashboard'
  const activeTabId =
    typeof value.activeTabId === 'string' &&
    tabs.some((tab) => tab.id === value.activeTabId)
      ? (value.activeTabId as TabId)
      : null
  const finalDestination =
    destination === 'releases' ||
    destination === 'core-docs' ||
    destination === 'welcome' ||
    (destination === 'tab' && !activeTabId)
      ? 'dashboard'
      : destination
  // Transient pages carry side state (release target, docs network,
  // onboarding) that is not persisted, so they never restore as open tabs —
  // matching the destination downgrade above.
  const internalPages: InternalPageId[] = []
  if (Array.isArray(value.internalPages)) {
    for (const candidate of value.internalPages.slice(0, 8)) {
      if (typeof candidate !== 'string') continue
      if (!destinations.has(candidate as ShellDestination)) continue
      const page = candidate as InternalPageId
      if (
        (page as ShellDestination) === 'tab' ||
        page === 'releases' ||
        page === 'core-docs' ||
        page === 'welcome' ||
        internalPages.includes(page)
      ) {
        continue
      }
      internalPages.push(page)
    }
  } else {
    // Older persisted states predate multiple internal tabs.
    internalPages.push('dashboard')
  }
  if (
    finalDestination !== 'tab' &&
    !internalPages.includes(finalDestination)
  ) {
    internalPages.push(finalDestination)
  }
  if (internalPages.length === 0 && finalDestination !== 'tab') {
    internalPages.push('dashboard')
  }
  return freezeProductState({
    destination: finalDestination,
    internalPages,
    tabs,
    activeTabId: destination === 'tab' ? activeTabId : null,
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

function openApp(
  state: ProductState,
  action: Extract<ProductAction, { readonly type: 'open-app' }>,
): ProductState {
  if (
    action.context.appId !== action.app.id ||
    action.context.tabId !== action.tabId
  ) {
    throw new ProductModelError(
      'APP_CONTEXT_MISMATCH',
      'The app or tab does not match the immutable operation context.',
    )
  }
  let parsedLocation: ReturnType<typeof parseAppResourceLocation>
  try {
    parsedLocation = parseAppResourceLocation(action.context.resourceLocation)
  } catch {
    throw new ProductModelError(
      'APP_CONTEXT_MISMATCH',
      'The app resource location is invalid.',
    )
  }
  if (
    action.context.sourceNetwork !== action.app.sourceNetwork ||
    parsedLocation.sourceNetwork !== action.app.sourceNetwork ||
    parsedLocation.identity.name !== action.app.resourceIdentity.name ||
    parsedLocation.identity.identifier !== action.app.resourceIdentity.identifier
  ) {
    throw new ProductModelError(
      'APP_CONTEXT_MISMATCH',
      'The app resource location does not match its immutable source chain.',
    )
  }

  const existing = state.tabs.find((tab) =>
    contextsIdentifySameTab(tab.context, action.context),
  )
  if (existing) {
    return freezeProductState({
      ...state,
      destination: 'tab',
      activeTabId: existing.id,
      revision: state.revision + 1,
    })
  }
  if (state.tabs.some((tab) => tab.id === action.tabId)) {
    throw new ProductModelError(
      'TAB_ALREADY_EXISTS',
      `Tab ${action.tabId} already exists.`,
    )
  }

  const tab = freezeTab({
    id: action.tabId,
    appId: action.app.id,
    title: action.app.title,
    context: {
      ...action.context,
      tabId: action.tabId,
    },
  })
  return freezeProductState({
    destination: 'tab',
    internalPages: state.internalPages,
    tabs: [...state.tabs, tab],
    activeTabId: tab.id,
    revision: state.revision + 1,
  })
}

function activateTab(state: ProductState, tabId: TabId): ProductState {
  if (!state.tabs.some((tab) => tab.id === tabId)) {
    throw new ProductModelError('TAB_NOT_FOUND', `Tab ${tabId} was not found.`)
  }
  return freezeProductState({
    ...state,
    destination: 'tab',
    activeTabId: tabId,
    revision: state.revision + 1,
  })
}

function closeTab(state: ProductState, tabId: TabId): ProductState {
  const closingIndex = state.tabs.findIndex((tab) => tab.id === tabId)
  if (closingIndex < 0) {
    throw new ProductModelError('TAB_NOT_FOUND', `Tab ${tabId} was not found.`)
  }

  const tabs = state.tabs.filter((tab) => tab.id !== tabId)
  if (state.activeTabId !== tabId) {
    return freezeProductState({
      ...state,
      tabs,
      revision: state.revision + 1,
    })
  }

  const nextActive = tabs[Math.min(closingIndex, tabs.length - 1)] ?? null
  // With no app tab left, fall back to the last open internal page (or
  // reopen the dashboard when the user closed every internal tab too).
  const fallbackPage =
    state.internalPages[state.internalPages.length - 1] ?? 'dashboard'
  return freezeProductState({
    destination: nextActive ? 'tab' : fallbackPage,
    internalPages:
      nextActive || state.internalPages.includes(fallbackPage)
        ? state.internalPages
        : [...state.internalPages, fallbackPage],
    tabs,
    activeTabId: nextActive?.id ?? null,
    revision: state.revision + 1,
  })
}

function closeInternalPage(
  state: ProductState,
  page: InternalPageId,
): ProductState {
  const closingIndex = state.internalPages.indexOf(page)
  if (closingIndex < 0) {
    throw new ProductModelError(
      'TAB_NOT_FOUND',
      `Internal page ${page} is not open.`,
    )
  }
  const internalPages = state.internalPages.filter(
    (candidate) => candidate !== page,
  )
  if (state.destination !== page) {
    return freezeProductState({
      ...state,
      internalPages,
      revision: state.revision + 1,
    })
  }
  const fallbackPage =
    internalPages[Math.min(closingIndex, internalPages.length - 1)] ?? null
  if (fallbackPage) {
    return freezeProductState({
      ...state,
      destination: fallbackPage,
      internalPages,
      activeTabId: null,
      revision: state.revision + 1,
    })
  }
  const nextActive = state.tabs[0] ?? null
  if (nextActive) {
    return freezeProductState({
      ...state,
      destination: 'tab',
      internalPages,
      activeTabId: nextActive.id,
      revision: state.revision + 1,
    })
  }
  // Never leave the window empty: closing the last surface reopens the
  // dashboard.
  return freezeProductState({
    ...state,
    destination: 'dashboard',
    internalPages: ['dashboard'],
    activeTabId: null,
    revision: state.revision + 1,
  })
}

function setTabTitle(
  state: ProductState,
  tabId: TabId,
  requestedTitle: string | null,
): ProductState {
  const current = state.tabs.find((tab) => tab.id === tabId)
  if (!current) {
    throw new ProductModelError('TAB_NOT_FOUND', `Tab ${tabId} was not found.`)
  }
  const fallback = parseAppResourceLocation(
    current.context.resourceLocation,
  ).identity.name
  const title = sanitizeHomeV2AppTitle(requestedTitle) ?? fallback
  if (title === current.title) return state
  return freezeProductState({
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, title } : tab,
    ),
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
    case 'activate-tab':
      return activateTab(state, action.tabId)
    case 'close-tab':
      return closeTab(state, action.tabId)
    case 'set-tab-title':
      return setTabTitle(state, action.tabId, action.title)
    case 'navigate':
      return freezeProductState({
        ...state,
        destination: action.destination,
        internalPages: state.internalPages.includes(action.destination)
          ? state.internalPages
          : [...state.internalPages, action.destination],
        activeTabId: null,
        revision: state.revision + 1,
      })
    case 'close-internal':
      return closeInternalPage(state, action.page)
    case 'restore':
      return freezeProductState(action.state)
  }
}
