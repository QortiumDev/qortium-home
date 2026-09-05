import type { AppDescriptor, AppResourceLocation, TabId } from '../v2/contracts'
import type { AppTab } from '../v2/product-model'
import { appDescriptorForOpenTab } from './publish-preview-tab'

/** Session-only navigation data, never a saved grant, vault state or native view. */
export interface ClosedAppTab {
  readonly sourceTabId: TabId
  readonly app: AppDescriptor
  readonly resourceLocation: AppResourceLocation
  /** Null is explicitly No account, not the current default. */
  readonly accountId: string | null
}

export function rememberClosedAppTab(
  history: readonly ClosedAppTab[],
  tab: AppTab | undefined,
): ClosedAppTab[] {
  // Preview URLs carry expiring trust state and must not reopen as the
  // published app they preview. Internal pages/viewers have no AppTab here.
  if (!tab || tab.context.previewUrl != null || tab.context.tabId !== tab.id ||
      tab.context.appId !== tab.appId || history.some((entry) => entry.sourceTabId === tab.id)) {
    return [...history]
  }
  const app = appDescriptorForOpenTab(tab)
  const identity = String(tab.context.identityId)
  const prefix = 'home-v2:identity:'
  if (!app || !identity.startsWith(prefix) || !identity.slice(prefix.length).trim()) return [...history]
  const accountId = identity === `${prefix}none` ? null : identity.slice(prefix.length)
  return [...history, { sourceTabId: tab.id, app,
    resourceLocation: tab.context.resourceLocation, accountId }].slice(-10)
}
