import type {
  HomeV2AccountCatalogue,
  HomeV2AccountCatalogueEntry,
} from '../v2/contracts'

const PRIVATE_KEY_WALLET_VERSION = 3
const ADDRESS_PATTERN = /^Q[1-9A-HJ-NP-Za-km-z]{33}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function boundedString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && normalized.length <= maxLength ? normalized : null
}

function address(value: unknown) {
  const normalized = boundedString(value, 34)
  return normalized && ADDRESS_PATTERN.test(normalized) ? normalized : null
}

function catalogueEntry(
  value: Record<string, unknown>,
  addressIndex: number,
  addressValue: string,
): HomeV2AccountCatalogueEntry | null {
  const walletId = boundedString(value.id, 200)
  const walletLabel = boundedString(value.label, 120)
  const encryptedWallet = isRecord(value.encryptedWallet)
    ? value.encryptedWallet
    : null
  if (!walletId || !walletLabel || !encryptedWallet) return null
  const version = encryptedWallet.version
  if (typeof version !== 'number' || !Number.isFinite(version)) return null
  return {
    address: addressValue,
    addressIndex,
    id: addressIndex === 0 ? walletId : `${walletId}:${addressIndex}`,
    isUnlocked: false,
    label: addressIndex === 0 ? walletLabel : `${walletLabel} · ${addressIndex}`,
    supportsDerivedAddresses: version !== PRIVATE_KEY_WALLET_VERSION,
    walletId,
  }
}

export function parseHomeV2AccountCatalogueStore(
  rawStore: string | null,
): HomeV2AccountCatalogue {
  if (!rawStore) return { accounts: [], activeAccountId: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawStore) as unknown
  } catch {
    return { accounts: [], activeAccountId: null }
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.wallets)) {
    return { accounts: [], activeAccountId: null }
  }
  const accounts: HomeV2AccountCatalogueEntry[] = []
  const seenIds = new Set<string>()
  for (const value of parsed.wallets) {
    if (!isRecord(value)) continue
    const baseAddress = address(value.address)
    const base = baseAddress ? catalogueEntry(value, 0, baseAddress) : null
    if (!base || seenIds.has(base.id)) continue
    accounts.push(base)
    seenIds.add(base.id)
    if (!Array.isArray(value.derivedAddresses)) continue
    const derived = value.derivedAddresses
      .filter(isRecord)
      .map((entry) => ({
        address: address(entry.address),
        index: entry.index,
      }))
      .filter(
        (entry): entry is { address: string; index: number } =>
          !!entry.address &&
          typeof entry.index === 'number' &&
          Number.isInteger(entry.index) &&
          entry.index > 0 &&
          entry.index <= 1_000_000,
      )
      .sort((first, second) => first.index - second.index)
    for (const entry of derived) {
      const account = catalogueEntry(value, entry.index, entry.address)
      if (!account || seenIds.has(account.id)) continue
      accounts.push(account)
      seenIds.add(account.id)
    }
  }
  const requestedActiveId = boundedString(parsed.activeAccountId, 240)
  return {
    accounts,
    activeAccountId:
      requestedActiveId && seenIds.has(requestedActiveId)
        ? requestedActiveId
        : null,
  }
}
