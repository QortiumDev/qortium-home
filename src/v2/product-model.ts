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
  | 'dashboard'
  | 'settings'
  | 'tab'

export interface AppTab {
  readonly id: TabId
  readonly appId: AppId
  readonly title: string
  readonly context: AppTabContext
}

export interface ProductState {
  readonly destination: ShellDestination
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
    tabs: Object.freeze(state.tabs.map(freezeTab)),
  })
}

export function createProductState(): ProductState {
  return freezeProductState({
    destination: 'dashboard',
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
  'dashboard',
  'settings',
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
  return freezeProductState({
    destination: destination === 'tab' && !activeTabId ? 'dashboard' : destination,
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
  return freezeProductState({
    destination: nextActive ? 'tab' : 'dashboard',
    tabs,
    activeTabId: nextActive?.id ?? null,
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
        activeTabId: null,
        revision: state.revision + 1,
      })
    case 'restore':
      return freezeProductState(action.state)
  }
}
