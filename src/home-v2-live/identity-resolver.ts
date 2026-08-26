import type {
  DualIdentityLookupResult,
  IdentityAvatarPointer,
  IdentityLookupInputKind,
  NetworkId,
  NetworkIdentityLookup,
} from '../v2/contracts'
import type {
  HomeV2IdentityReadRequest,
  HomeV2IdentityReadResponse,
} from './node-client'

export type IdentityRead = (
  network: NetworkId,
  request: HomeV2IdentityReadRequest,
) => Promise<HomeV2IdentityReadResponse>

const ADDRESS_PATTERN = /^Q[1-9A-HJ-NP-Za-km-z]{33}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function messageFrom(value: unknown, fallback: string) {
  return (isRecord(value) && nonEmptyString(value.message)) || fallback
}

function parseName(value: unknown) {
  if (typeof value === 'string') return nonEmptyString(value)
  return isRecord(value) ? nonEmptyString(value.name) : null
}

function parseOwner(value: unknown) {
  return isRecord(value) ? nonEmptyString(value.owner) : null
}

function parseNames(value: unknown) {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const name = parseName(entry)
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

function unavailableNetwork(
  network: NetworkId,
  detail: string,
  address: string | null = null,
  matchedQueryName = false,
): NetworkIdentityLookup {
  return {
    address,
    avatar: null,
    detail,
    matchedQueryName,
    names: [],
    network,
    primaryName: null,
    state: 'unavailable',
  }
}

function avatarFor(
  network: NetworkId,
  primaryName: string | null,
  response: HomeV2IdentityReadResponse | null,
): IdentityAvatarPointer | null {
  if (
    network === 'qortium' &&
    response?.status === 200 &&
    isRecord(response.data)
  ) {
    const service = nonEmptyString(response.data.service)
    const name = nonEmptyString(response.data.name)
    const identifier = nonEmptyString(response.data.identifier)
    if (service && name && identifier) {
      return { identifier, name, service, source: 'account-pointer' }
    }
  }
  if (
    !primaryName ||
    response?.status !== 200 ||
    !Array.isArray(response.data)
  ) {
    return null
  }
  const expectedIdentifier = network === 'qortal' ? 'qortal_avatar' : 'avatar'
  const legacyExists = response.data.some((entry) => {
    if (!isRecord(entry)) return false
    return (
      nonEmptyString(entry.service)?.toUpperCase() === 'THUMBNAIL' &&
      nonEmptyString(entry.name)?.toLowerCase() === primaryName.toLowerCase() &&
      nonEmptyString(entry.identifier) === expectedIdentifier
    )
  })
  if (!legacyExists) return null
  return {
    identifier: expectedIdentifier,
    name: primaryName,
    service: 'THUMBNAIL',
    source: 'legacy-name',
  }
}

async function safeRead(
  read: IdentityRead,
  network: NetworkId,
  request: HomeV2IdentityReadRequest,
) {
  try {
    return await read(network, request)
  } catch (error) {
    return {
      data: {
        message: error instanceof Error ? error.message : 'Identity lookup failed.',
      },
      status: 503,
    }
  }
}

async function resolveAddressOnNetwork(
  read: IdentityRead,
  network: NetworkId,
  address: string,
  matchedQueryName: boolean,
): Promise<NetworkIdentityLookup> {
  const [namesResponse, primaryResponse] = await Promise.all([
    safeRead(read, network, { kind: 'namesByAddress', value: address }),
    safeRead(read, network, { kind: 'primaryName', value: address }),
  ])
  if (
    (namesResponse.status !== 200 && namesResponse.status !== 404) ||
    (primaryResponse.status !== 200 && primaryResponse.status !== 404)
  ) {
    return unavailableNetwork(
      network,
      messageFrom(namesResponse.data, 'The configured node is unavailable.'),
      address,
      matchedQueryName,
    )
  }
  const names = namesResponse.status === 200 ? parseNames(namesResponse.data) : []
  const primaryName =
    primaryResponse.status === 200 ? parseName(primaryResponse.data) : null
  const normalizedNames = primaryName && !names.includes(primaryName)
    ? [primaryName, ...names]
    : names
  let avatar: IdentityAvatarPointer | null = null
  if (network === 'qortium') {
    const accountAvatarResponse = await safeRead(read, network, {
      kind: 'accountAvatarInfo',
      value: address,
    })
    avatar = avatarFor(network, primaryName, accountAvatarResponse)
    if (!avatar && primaryName) {
      const legacyAvatarResponse = await safeRead(read, network, {
        kind: 'legacyAvatarResource',
        value: primaryName,
      })
      avatar = avatarFor(network, primaryName, legacyAvatarResponse)
    }
  } else if (primaryName) {
    const legacyAvatarResponse = await safeRead(read, network, {
      kind: 'legacyAvatarResource',
      value: primaryName,
    })
    avatar = avatarFor(network, primaryName, legacyAvatarResponse)
  }
  return {
    address,
    avatar,
    detail:
      normalizedNames.length > 0
        ? `${normalizedNames.length} registered name${normalizedNames.length === 1 ? '' : 's'}`
        : 'No registered names on this network',
    matchedQueryName,
    names: normalizedNames,
    network,
    primaryName,
    state: 'resolved',
  }
}

function directNameState(
  network: NetworkId,
  response: HomeV2IdentityReadResponse,
) {
  if (response.status !== 200 && response.status !== 404) {
    return {
      network,
      owner: null,
      state: 'unavailable' as const,
      detail: messageFrom(response.data, 'The configured node is unavailable.'),
    }
  }
  const owner = response.status === 200 ? parseOwner(response.data) : null
  return owner
    ? { network, owner, state: 'resolved' as const, detail: '' }
    : {
        network,
        owner: null,
        state: 'not-found' as const,
        detail: 'This name is not registered on this network.',
      }
}

/**
 * Identity lookups are chatty and repetitive: one app icon can cost up to four
 * round-trips (app-icon-loader.ts), a grid of icons published under the same
 * name repeats every one of them, and the account chrome re-resolves the same
 * address on every switch, unlock and relaunch. The answers barely move, so a
 * small memo in front of the two public entry points removes almost all of it.
 *
 * Two things it deliberately does NOT do:
 *  - cache a transient failure for more than a moment. An unavailable node is a
 *    fact about right now, not about the identity; sticking it for five minutes
 *    would keep a monogram on screen long after the node came back.
 *  - key on the `read` it was given. Callers pass a closure over the current
 *    node client, so a node-settings change can serve up to IDENTITY_CACHE_MS of
 *    answers from the previous node. Call `clearIdentityLookupCache()` from any
 *    future node-switch path.
 */
const IDENTITY_CACHE_MS = 5 * 60_000
const IDENTITY_TRANSIENT_CACHE_MS = 15_000
const MAX_IDENTITY_CACHE_ENTRIES = 100

type IdentityCacheEntry<T> = {
  expiresAt: number
  inflight: Promise<T> | null
  value: T | null
}

const identityCache = new Map<string, IdentityCacheEntry<unknown>>()
let clock = () => Date.now()

function touch(key: string, entry: IdentityCacheEntry<unknown>) {
  // Re-inserting moves the key to the end, so plain iteration order is LRU.
  identityCache.delete(key)
  identityCache.set(key, entry)
}

function pruneIdentityCache() {
  if (identityCache.size <= MAX_IDENTITY_CACHE_ENTRIES) return
  for (const [key, entry] of identityCache) {
    if (entry.inflight) continue
    identityCache.delete(key)
    if (identityCache.size <= MAX_IDENTITY_CACHE_ENTRIES) return
  }
}

async function cachedLookup<T>(
  key: string,
  isTransient: (value: T) => boolean,
  resolve: () => Promise<T>,
): Promise<T> {
  const existing = identityCache.get(key) as IdentityCacheEntry<T> | undefined
  if (existing) {
    // In-flight dedupe: concurrent identical lookups share one resolution, so
    // ten icons for the same publisher make one set of node calls, not ten.
    if (existing.inflight) {
      touch(key, existing as IdentityCacheEntry<unknown>)
      return existing.inflight
    }
    if (existing.value !== null && clock() < existing.expiresAt) {
      touch(key, existing as IdentityCacheEntry<unknown>)
      return existing.value
    }
  }
  const entry: IdentityCacheEntry<T> = { expiresAt: 0, inflight: null, value: null }
  // resolve() starts here, but the entry is registered below in the same tick,
  // so any concurrent caller finds `inflight` before the first await resumes.
  const inflight = resolve().then(
    (value) => {
      if (identityCache.get(key) === (entry as IdentityCacheEntry<unknown>)) {
        entry.value = value
        entry.expiresAt =
          clock() + (isTransient(value) ? IDENTITY_TRANSIENT_CACHE_MS : IDENTITY_CACHE_MS)
        entry.inflight = null
      }
      return value
    },
    (error: unknown) => {
      // A thrown lookup is never cached at all.
      if (identityCache.get(key) === (entry as IdentityCacheEntry<unknown>)) {
        identityCache.delete(key)
      }
      throw error
    },
  )
  entry.inflight = inflight
  touch(key, entry as IdentityCacheEntry<unknown>)
  pruneIdentityCache()
  return inflight
}

/** Drop every memoized identity answer (node switched, or a test boundary). */
export function clearIdentityLookupCache() {
  identityCache.clear()
}

/** Test seam for the memo's TTLs; pass null to restore the real clock. */
export function setIdentityLookupClockForTests(next: (() => number) | null) {
  clock = next ?? (() => Date.now())
}

export function classifyIdentityLookupInput(input: string): IdentityLookupInputKind {
  return ADDRESS_PATTERN.test(input.trim()) ? 'address' : 'name'
}

export function normalizeIdentityLookupInput(input: string) {
  const query = input.trim()
  if (!query) throw new Error('Enter an address or name.')
  if (query.length > 128) throw new Error('Names and addresses are limited to 128 characters.')
  return query
}

export async function resolveIdentityOnNetwork(
  input: string,
  network: NetworkId,
  read: IdentityRead,
): Promise<NetworkIdentityLookup> {
  const query = normalizeIdentityLookupInput(input)
  return cachedLookup(
    `${network}:${query}`,
    (value: NetworkIdentityLookup) => value.state === 'unavailable',
    () => resolveIdentityOnNetworkUncached(query, network, read),
  )
}

async function resolveIdentityOnNetworkUncached(
  query: string,
  network: NetworkId,
  read: IdentityRead,
): Promise<NetworkIdentityLookup> {
  if (classifyIdentityLookupInput(query) === 'address') {
    return resolveAddressOnNetwork(read, network, query, false)
  }
  const nameResponse = await safeRead(read, network, {
    kind: 'name',
    value: query,
  })
  const direct = directNameState(network, nameResponse)
  if (direct.state === 'unavailable') {
    return unavailableNetwork(network, direct.detail)
  }
  if (!direct.owner) {
    return {
      ...unavailableNetwork(network, direct.detail),
      state: 'not-found',
    }
  }
  return resolveAddressOnNetwork(read, network, direct.owner, true)
}

export async function resolveDualIdentity(
  input: string,
  read: IdentityRead,
): Promise<DualIdentityLookupResult> {
  const query = normalizeIdentityLookupInput(input)
  return cachedLookup(
    `dual:${query}`,
    // `partial` carries one unavailable network, so it is transient too.
    (value: DualIdentityLookupResult) =>
      value.state === 'unavailable' || value.state === 'partial',
    () => resolveDualIdentityUncached(query, read),
  )
}

async function resolveDualIdentityUncached(
  query: string,
  read: IdentityRead,
): Promise<DualIdentityLookupResult> {
  const inputKind = classifyIdentityLookupInput(query)
  if (inputKind === 'address') {
    const [qortal, qortium] = await Promise.all([
      resolveAddressOnNetwork(read, 'qortal', query, false),
      resolveAddressOnNetwork(read, 'qortium', query, false),
    ])
    const unavailable = qortal.state === 'unavailable' && qortium.state === 'unavailable'
    const partial = qortal.state === 'unavailable' || qortium.state === 'unavailable'
    return {
      inputKind,
      message: unavailable
        ? 'Neither configured node could complete the lookup.'
        : 'The same address is shown independently on both networks.',
      networks: { qortal, qortium },
      query,
      sharedAddress: query,
      state: unavailable ? 'unavailable' : partial ? 'partial' : 'resolved',
    }
  }

  const [qortalName, qortiumName] = await Promise.all([
    safeRead(read, 'qortal', { kind: 'name', value: query }),
    safeRead(read, 'qortium', { kind: 'name', value: query }),
  ])
  const direct = {
    qortal: directNameState('qortal', qortalName),
    qortium: directNameState('qortium', qortiumName),
  }
  const owners = [direct.qortal.owner, direct.qortium.owner].filter(
    (owner): owner is string => !!owner,
  )

  if (owners.length === 0) {
    const unavailable = direct.qortal.state === 'unavailable' || direct.qortium.state === 'unavailable'
    return {
      inputKind,
      message: unavailable
        ? 'The name could not be checked on every configured network.'
        : 'This name was not found on Qortal or Qortium.',
      networks: {
        qortal:
          direct.qortal.state === 'unavailable'
            ? unavailableNetwork('qortal', direct.qortal.detail)
            : { ...unavailableNetwork('qortal', direct.qortal.detail), state: 'not-found' },
        qortium:
          direct.qortium.state === 'unavailable'
            ? unavailableNetwork('qortium', direct.qortium.detail)
            : { ...unavailableNetwork('qortium', direct.qortium.detail), state: 'not-found' },
      },
      query,
      sharedAddress: null,
      state: unavailable ? 'unavailable' : 'not-found',
    }
  }

  if (
    direct.qortal.owner &&
    direct.qortium.owner &&
    direct.qortal.owner !== direct.qortium.owner
  ) {
    const [qortal, qortium] = await Promise.all([
      resolveAddressOnNetwork(read, 'qortal', direct.qortal.owner, true),
      resolveAddressOnNetwork(read, 'qortium', direct.qortium.owner, true),
    ])
    return {
      inputKind,
      message: 'This name belongs to different addresses. The results are not merged.',
      networks: { qortal, qortium },
      query,
      sharedAddress: null,
      state: 'conflict',
    }
  }

  const sharedAddress = owners[0]
  const [qortal, qortium] = await Promise.all([
    resolveAddressOnNetwork(
      read,
      'qortal',
      sharedAddress,
      direct.qortal.owner === sharedAddress,
    ),
    resolveAddressOnNetwork(
      read,
      'qortium',
      sharedAddress,
      direct.qortium.owner === sharedAddress,
    ),
  ])
  return {
    inputKind,
    message:
      qortal.state === 'unavailable' || qortium.state === 'unavailable'
        ? 'The shared address resolved, but one configured network is unavailable.'
        : 'Identity is grouped by its shared address across both networks.',
    networks: { qortal, qortium },
    query,
    sharedAddress,
    state:
      qortal.state === 'unavailable' || qortium.state === 'unavailable'
        ? 'partial'
        : 'resolved',
  }
}
