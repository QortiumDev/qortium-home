import type { HomeV2AccountCatalogue, HomeV2Snapshot } from '../contracts'
import type { ShellEntry } from '../product-model'

/** Removal is a lock transition too; cached permissions must not survive it. */
export function accountsLosingAccess(previous: HomeV2AccountCatalogue, next: HomeV2AccountCatalogue): string[] {
  return previous.accounts.filter((account) => {
    const replacement = next.accounts.find((candidate) => candidate.id === account.id)
    return !replacement || (account.isUnlocked && !replacement.isUnlocked)
  }).map((account) => account.id)
}

/** A tab's captured identity must never fall back to the default for new tabs. */
export function savedEntryAccountId(entry: ShellEntry | undefined): string | null {
  if (entry?.kind === 'viewer') return entry.accountId
  if (entry?.kind !== 'app') return null
  const identity = String(entry.context.identityId)
  if (identity === 'home-v2:identity:none') return null
  return identity.replace(/^home-v2:identity:/, '')
}

export function chromeAccountContext(
  snapshot: HomeV2Snapshot,
  entry: ShellEntry | undefined,
  catalogue: HomeV2AccountCatalogue | undefined,
  rememberedLabels?: ReadonlyMap<string, string>,
) {
  if (entry?.kind !== 'app' && entry?.kind !== 'viewer') {
    return { snapshot, accountId: undefined, tabBound: false, unavailable: false, useSelectedLookup: true }
  }
  const accountId = savedEntryAccountId(entry)
  const account = catalogue?.accounts.find((candidate) => candidate.id === accountId)
  const identityId = entry.kind === 'app' ? entry.context.identityId : `home-v2:identity:${accountId ?? 'none'}` as HomeV2Snapshot['identity']['id']
  const walletRef = entry.kind === 'app' ? entry.context.walletRef : null
  const matchesSelected = identityId === snapshot.account.selectedIdentityId
  // Fixture callers without a catalogue can still display their supplied identity.
  if (matchesSelected && !catalogue) {
    return { snapshot, accountId, tabBound: true, unavailable: false, useSelectedLookup: true }
  }
  const unavailable = accountId !== null && !account
  const identity: HomeV2Snapshot['identity'] = {
    id: identityId,
    displayLabel: account?.label ?? (accountId ? rememberedLabels?.get(accountId) ?? accountId : ''),
    displayLabelIsRegisteredName: false,
    selectedWallet: walletRef,
    presences: {
      qortal: { network: 'qortal', state: 'unavailable', address: account?.address as HomeV2Snapshot['identity']['presences']['qortal']['address'] ?? null, names: [], primaryName: null, avatar: null, detail: null },
      qortium: { network: 'qortium', state: 'unavailable', address: account?.address as HomeV2Snapshot['identity']['presences']['qortium']['address'] ?? null, names: [], primaryName: null, avatar: null, detail: null },
    },
  }
  return {
    accountId,
    tabBound: true,
    unavailable,
    useSelectedLookup: matchesSelected && !!account,
    snapshot: {
      ...snapshot,
      account: {
        ...snapshot.account,
        state: !accountId ? 'none' as const : account?.isUnlocked ? 'unlocked' as const : 'locked' as const,
        selectedIdentityId: accountId ? identityId : null,
      },
      identity: matchesSelected && account ? snapshot.identity : identity,
    },
  }
}
