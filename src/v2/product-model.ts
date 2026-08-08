import type {
  AppDescriptor,
  AppId,
  OperationContext,
  TabId,
} from './contracts'
import { assertAppMayTargetNetwork } from './policy'

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
  readonly context: OperationContext
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
      readonly context: OperationContext
      readonly tabId: TabId
    }
  | { readonly type: 'activate-tab'; readonly tabId: TabId }
  | { readonly type: 'close-tab'; readonly tabId: TabId }
  | {
      readonly type: 'navigate'
      readonly destination: Exclude<ShellDestination, 'tab'>
    }

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

function contextsIdentifySameTab(
  left: OperationContext,
  right: OperationContext,
): boolean {
  return (
    left.appId === right.appId &&
    left.identityId === right.identityId &&
    left.walletRef === right.walletRef &&
    left.targetNetwork === right.targetNetwork &&
    left.nodeProfileRef === right.nodeProfileRef
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
  assertAppMayTargetNetwork(action.app, action.context)

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
    case 'navigate':
      return freezeProductState({
        ...state,
        destination: action.destination,
        activeTabId: null,
        revision: state.revision + 1,
      })
  }
}
