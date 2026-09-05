import type { AppDescriptor, AppResourceLocation, HomeV2AccountCatalogue } from '../v2/contracts'
import type { AppTab } from '../v2/product-model'
import { appDescriptorForOpenTab } from './publish-preview-tab'

export interface AccountTabLaunch {
  readonly app: AppDescriptor
  readonly resourceLocation: AppResourceLocation
  /** Explicit target: null means guest, never the default account. */
  readonly accountId: string | null
}

/**
 * Plan a new tab from the current trusted shell state, synchronously. The
 * source remains untouched; no vault, grant, viewer, or navigation state is
 * copied. Callers gate on shell readiness and block viewer/transient surfaces.
 */
export function resolveAccountTabLaunch(input: {
  readonly tabId: string
  readonly resourceLocation: string
  readonly accountId: string | null
  readonly tabs: readonly AppTab[]
  readonly accounts: HomeV2AccountCatalogue['accounts']
  readonly blocked?: boolean
}): AccountTabLaunch {
  if (input.blocked) throw new Error('This view cannot be opened with another account.')
  const source = input.tabs.find((tab) => tab.id === input.tabId)
  if (!source || source.context.tabId !== source.id || source.context.appId !== source.appId ||
      source.context.resourceLocation !== input.resourceLocation) {
    throw new Error('The source app tab changed or is no longer available.')
  }
  if (source.context.previewUrl != null) {
    throw new Error('A publish preview cannot be opened with another account.')
  }
  if (input.accountId !== null && (
    typeof input.accountId !== 'string' || !input.accountId ||
    !input.accounts.some((account) => account.id === input.accountId)
  )) {
    throw new Error('The selected Home account is no longer available.')
  }
  const app = appDescriptorForOpenTab(source)
  if (!app) throw new Error('The source app address is no longer valid.')
  return { app, resourceLocation: source.context.resourceLocation, accountId: input.accountId }
}
