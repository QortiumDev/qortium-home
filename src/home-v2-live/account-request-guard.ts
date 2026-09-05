import type { HomeV2RuntimeInvalidationKind } from '../../electron/home-v2-runtime-invalidation'
import type { HomeV2AccountCatalogue, NetworkId } from '../v2/contracts'
import type { AppTab } from '../v2/product-model'
import type { HomeV2AppRequestContext } from './node-client'

/** The default picker is intentionally not part of an existing tab's authority. */
export function isBoundAccountRequestCurrent(
  context: Pick<HomeV2AppRequestContext, 'tabId' | 'resourceLocation' | 'selectedAccountId'>,
  tabs: readonly AppTab[],
  accounts: HomeV2AccountCatalogue['accounts'],
): boolean {
  const tab = tabs.find((candidate) => candidate.id === context.tabId)
  if (!tab || tab.context.tabId !== context.tabId ||
      tab.context.resourceLocation !== context.resourceLocation) return false

  const accountId = context.selectedAccountId
  if (tab.context.identityId !== `home-v2:identity:${accountId ?? 'none'}`) return false
  if (accountId === null) return tab.context.walletRef === null

  const account = accounts.find((candidate) => candidate.id === accountId)
  // Unlock state is checked by each operation's own policy. Reads and unlock
  // requests themselves must still be able to target a locked bound account.
  return !!account && tab.context.walletRef === `home-v2:wallet:${account.walletId}`
}

/**
 * Capture lifecycle state before asynchronous work, then recheck at every
 * authority-bearing continuation. Comparing only account IDs misses an ABA
 * transition such as locking and unlocking the same account during approval.
 */
export function createAccountRequestEpochs() {
  let globalEpoch = 0
  const tabEpochs = new Map<string, number>()
  const networkEpochs: Record<NetworkId, number> = { qortal: 0, qortium: 0 }

  return {
    capture(tabId: string, network: NetworkId): () => boolean {
      const global = globalEpoch
      const tab = tabEpochs.get(tabId) ?? 0
      const node = networkEpochs[network]
      return () => global === globalEpoch &&
        tab === (tabEpochs.get(tabId) ?? 0) && node === networkEpochs[network]
    },
    invalidate(
      kind: HomeV2RuntimeInvalidationKind,
      tabId: string | null,
      network: NetworkId | null,
    ): void {
      switch (kind) {
        case 'account-changed':
        case 'locked':
          globalEpoch += 1
          break
        case 'navigation-changed':
        case 'app-replaced':
        case 'tab-closed':
          if (tabId) {
            // Keep the tombstone: reusing a closed tab ID must not revive work.
            tabEpochs.set(tabId, (tabEpochs.get(tabId) ?? 0) + 1)
          } else {
            // Missing required scope must fail closed, never preserve authority.
            globalEpoch += 1
          }
          break
        case 'node-changed':
          if (network) networkEpochs[network] += 1
          else globalEpoch += 1
          break
      }
    },
  }
}
