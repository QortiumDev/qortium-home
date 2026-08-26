import assert from 'node:assert/strict'
import type { NetworkId } from '../v2/contracts'
import {
  classifyIdentityLookupInput,
  clearIdentityLookupCache,
  normalizeIdentityLookupInput,
  resolveDualIdentity,
  resolveIdentityOnNetwork,
  setIdentityLookupClockForTests,
  type IdentityRead,
} from './identity-resolver'

const ADDRESS_A = 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH'
const ADDRESS_B = 'QwbXDZs6N7YmfTaHoHX2FCTiDtUjsLH22E'

type Fixture = Partial<
  Record<NetworkId, Partial<Record<string, { data: unknown; status: number }>>>
>

function fixtureRead(fixture: Fixture): IdentityRead {
  return async (network, request) =>
    fixture[network]?.[`${request.kind}:${request.value}`] ?? {
      data: { message: 'not found' },
      status: 404,
    }
}

/**
 * The resolver memoizes by network+query, so each behaviour case below — which
 * reuses the same addresses and names against DIFFERENT fixtures — must start
 * from an empty memo. The memo itself is exercised separately at the end.
 */
function freshDual(input: string, read: IdentityRead) {
  clearIdentityLookupCache()
  return resolveDualIdentity(input, read)
}

function resolvedAddressFixture(
  network: NetworkId,
  primaryName: string,
  avatarData: unknown,
): Fixture {
  return {
    [network]: {
      [`namesByAddress:${ADDRESS_A}`]: {
        data: [{ name: primaryName }],
        status: 200,
      },
      [`primaryName:${ADDRESS_A}`]: {
        data: { name: primaryName },
        status: 200,
      },
      [`legacyAvatarResource:${primaryName}`]: {
        data: avatarData,
        status: 200,
      },
    },
  }
}

assert.equal(classifyIdentityLookupInput(ADDRESS_A), 'address')
assert.equal(classifyIdentityLookupInput('Alice'), 'name')
assert.equal(normalizeIdentityLookupInput('  Alice  '), 'Alice')
assert.throws(() => normalizeIdentityLookupInput('  '), /Enter an address/)

const addressResult = await freshDual(
  ADDRESS_A,
  fixtureRead({
    qortal: {
      [`namesByAddress:${ADDRESS_A}`]: { data: [{ name: 'AliceQ' }], status: 200 },
      [`primaryName:${ADDRESS_A}`]: { data: { name: 'AliceQ' }, status: 200 },
    },
    qortium: {
      [`namesByAddress:${ADDRESS_A}`]: { data: [{ name: 'Alice' }], status: 200 },
      [`primaryName:${ADDRESS_A}`]: { data: { name: 'Alice' }, status: 200 },
      [`accountAvatarInfo:${ADDRESS_A}`]: {
        data: { service: 'THUMBNAIL', name: 'Alice', identifier: 'portrait' },
        status: 200,
      },
    },
  }),
)
assert.equal(addressResult.state, 'resolved')
assert.equal(addressResult.sharedAddress, ADDRESS_A)
assert.deepEqual(addressResult.networks.qortal.names, ['AliceQ'])
assert.deepEqual(addressResult.networks.qortium.avatar, {
  identifier: 'portrait',
  name: 'Alice',
  service: 'THUMBNAIL',
  source: 'account-pointer',
})

const qortalLegacyAvatar = await freshDual(
  ADDRESS_A,
  fixtureRead(
    resolvedAddressFixture('qortal', 'AliceQ', [
      {
        identifier: 'qortal_avatar',
        name: 'AliceQ',
        service: 'THUMBNAIL',
      },
    ]),
  ),
)
assert.deepEqual(qortalLegacyAvatar.networks.qortal.avatar, {
  identifier: 'qortal_avatar',
  name: 'AliceQ',
  service: 'THUMBNAIL',
  source: 'legacy-name',
})

const qortalMissingAvatar = await freshDual(
  ADDRESS_A,
  fixtureRead(resolvedAddressFixture('qortal', 'AliceQ', [])),
)
assert.equal(qortalMissingAvatar.networks.qortal.avatar, null)

const qortalWrongAvatarMatches = await freshDual(
  ADDRESS_A,
  fixtureRead(
    resolvedAddressFixture('qortal', 'AliceQ', [
      { identifier: 'qortal_avatar', name: 'AliceQ', service: 'APP' },
      { identifier: 'avatar', name: 'AliceQ', service: 'THUMBNAIL' },
      { identifier: 'qortal_avatar', name: 'SomeoneElse', service: 'THUMBNAIL' },
    ]),
  ),
)
assert.equal(qortalWrongAvatarMatches.networks.qortal.avatar, null)

const qortiumPointerReads: string[] = []
const qortiumPointerPrecedence = await freshDual(
  ADDRESS_A,
  async (network, request) => {
    qortiumPointerReads.push(`${network}:${request.kind}:${request.value}`)
    return fixtureRead({
      qortium: {
        [`namesByAddress:${ADDRESS_A}`]: { data: [{ name: 'Alice' }], status: 200 },
        [`primaryName:${ADDRESS_A}`]: { data: { name: 'Alice' }, status: 200 },
        [`accountAvatarInfo:${ADDRESS_A}`]: {
          data: { identifier: 'portrait', name: 'Alice', service: 'THUMBNAIL' },
          status: 200,
        },
        'legacyAvatarResource:Alice': {
          data: [{ identifier: 'avatar', name: 'Alice', service: 'THUMBNAIL' }],
          status: 200,
        },
      },
    })(network, request)
  },
)
assert.equal(
  qortiumPointerReads.some((entry) => entry.includes(':legacyAvatarResource:')),
  false,
)
assert.deepEqual(qortiumPointerPrecedence.networks.qortium.avatar, {
  identifier: 'portrait',
  name: 'Alice',
  service: 'THUMBNAIL',
  source: 'account-pointer',
})

const qortiumLegacyAvatar = await freshDual(
  ADDRESS_A,
  fixtureRead({
    qortium: {
      [`namesByAddress:${ADDRESS_A}`]: { data: [{ name: 'Alice' }], status: 200 },
      [`primaryName:${ADDRESS_A}`]: { data: { name: 'Alice' }, status: 200 },
      [`accountAvatarInfo:${ADDRESS_A}`]: { data: null, status: 404 },
      'legacyAvatarResource:Alice': {
        data: [{ identifier: 'avatar', name: 'Alice', service: 'THUMBNAIL' }],
        status: 200,
      },
    },
  }),
)
assert.deepEqual(qortiumLegacyAvatar.networks.qortium.avatar, {
  identifier: 'avatar',
  name: 'Alice',
  service: 'THUMBNAIL',
  source: 'legacy-name',
})

const sharedName = await freshDual(
  'Alice',
  fixtureRead({
    qortal: {
      'name:Alice': { data: { name: 'Alice', owner: ADDRESS_A }, status: 200 },
      [`namesByAddress:${ADDRESS_A}`]: { data: [{ name: 'Alice' }], status: 200 },
      [`primaryName:${ADDRESS_A}`]: { data: { name: 'Alice' }, status: 200 },
    },
    qortium: {
      'name:Alice': { data: null, status: 404 },
      [`namesByAddress:${ADDRESS_A}`]: { data: [{ name: 'Alice2' }], status: 200 },
      [`primaryName:${ADDRESS_A}`]: { data: { name: 'Alice2' }, status: 200 },
    },
  }),
)
assert.equal(sharedName.state, 'resolved')
assert.equal(sharedName.sharedAddress, ADDRESS_A)
assert.equal(sharedName.networks.qortal.matchedQueryName, true)
assert.equal(sharedName.networks.qortium.matchedQueryName, false)
assert.equal(sharedName.networks.qortium.primaryName, 'Alice2')

const conflict = await freshDual(
  'SharedName',
  fixtureRead({
    qortal: {
      'name:SharedName': { data: { owner: ADDRESS_A }, status: 200 },
      [`namesByAddress:${ADDRESS_A}`]: { data: [{ name: 'SharedName' }], status: 200 },
      [`primaryName:${ADDRESS_A}`]: { data: { name: 'SharedName' }, status: 200 },
    },
    qortium: {
      'name:SharedName': { data: { owner: ADDRESS_B }, status: 200 },
      [`namesByAddress:${ADDRESS_B}`]: { data: [{ name: 'SharedName' }], status: 200 },
      [`primaryName:${ADDRESS_B}`]: { data: { name: 'SharedName' }, status: 200 },
    },
  }),
)
assert.equal(conflict.state, 'conflict')
assert.equal(conflict.sharedAddress, null)
assert.equal(conflict.networks.qortal.address, ADDRESS_A)
assert.equal(conflict.networks.qortium.address, ADDRESS_B)
assert.match(conflict.message, /not merged/)

const missing = await freshDual('Nobody', fixtureRead({}))
assert.equal(missing.state, 'not-found')
assert.equal(missing.networks.qortal.state, 'not-found')
assert.equal(missing.networks.qortium.state, 'not-found')

const unavailable = await freshDual(
  'Nobody',
  fixtureRead({
    qortal: { 'name:Nobody': { data: { message: 'offline' }, status: 503 } },
  }),
)
assert.equal(unavailable.state, 'unavailable')
assert.equal(unavailable.networks.qortal.state, 'unavailable')

const rateLimited = await freshDual(
  'Nobody',
  fixtureRead({
    qortium: {
      'name:Nobody': { data: { message: 'rate limited' }, status: 429 },
    },
  }),
)
assert.equal(rateLimited.state, 'unavailable')
assert.equal(rateLimited.networks.qortium.state, 'unavailable')

const partialAddress = await freshDual(
  ADDRESS_A,
  fixtureRead({
    qortal: {
      [`namesByAddress:${ADDRESS_A}`]: { data: [], status: 200 },
      [`primaryName:${ADDRESS_A}`]: { data: null, status: 404 },
    },
    qortium: {
      [`namesByAddress:${ADDRESS_A}`]: {
        data: { message: 'temporarily unavailable' },
        status: 429,
      },
      [`primaryName:${ADDRESS_A}`]: { data: null, status: 404 },
    },
  }),
)
assert.equal(partialAddress.state, 'partial')
assert.equal(partialAddress.networks.qortium.address, ADDRESS_A)

// --- memoization ------------------------------------------------------------
// Icon and account chrome lookups repeat the same few queries constantly, so the
// resolver memoizes them. What matters is that a hit costs nothing, that
// concurrent duplicates collapse into one set of node reads, and that a node
// being briefly down is never what sticks.
{
  let fakeNow = 1_000_000
  setIdentityLookupClockForTests(() => fakeNow)
  const okFixture = resolvedAddressFixture('qortal', 'AliceQ', [])
  try {
    clearIdentityLookupCache()
    let reads = 0
    const countingRead: IdentityRead = async (network, request) => {
      reads += 1
      return fixtureRead(okFixture)(network, request)
    }
    const first = await resolveIdentityOnNetwork(ADDRESS_A, 'qortal', countingRead)
    assert.equal(first.state, 'resolved')
    const readsAfterFirst = reads
    assert.ok(readsAfterFirst > 0, 'the first lookup must actually read the node')

    const second = await resolveIdentityOnNetwork(ADDRESS_A, 'qortal', countingRead)
    assert.equal(reads, readsAfterFirst, 'a repeated identity lookup must not re-read the node')
    assert.equal(second, first, 'a memo hit must hand back the cached result itself')

    await resolveIdentityOnNetwork(ADDRESS_A, 'qortium', countingRead)
    assert.ok(reads > readsAfterFirst, 'the memo must be keyed by network as well as query')

    // The dual lookup behind the account chrome is memoized on the same terms.
    clearIdentityLookupCache()
    let dualReads = 0
    const dualRead: IdentityRead = async (network, request) => {
      dualReads += 1
      return fixtureRead(okFixture)(network, request)
    }
    const dualFirst = await resolveDualIdentity(ADDRESS_A, dualRead)
    const dualReadsAfterFirst = dualReads
    const dualSecond = await resolveDualIdentity(ADDRESS_A, dualRead)
    assert.equal(dualReads, dualReadsAfterFirst, 'a repeated account lookup must not re-read')
    assert.equal(dualSecond, dualFirst)

    // In-flight dedupe: two concurrent identical lookups share one resolution,
    // so a grid of icons published under one name makes one set of node calls.
    clearIdentityLookupCache()
    let concurrentReads = 0
    const deferred = { release: () => {} }
    const gate = new Promise<void>((resolve) => {
      deferred.release = () => resolve()
    })
    const gatedRead: IdentityRead = async (network, request) => {
      concurrentReads += 1
      await gate
      return fixtureRead(okFixture)(network, request)
    }
    const inflightA = resolveIdentityOnNetwork(ADDRESS_A, 'qortal', gatedRead)
    const readsAfterA = concurrentReads
    const inflightB = resolveIdentityOnNetwork(ADDRESS_A, 'qortal', gatedRead)
    assert.equal(
      concurrentReads,
      readsAfterA,
      'a second concurrent lookup must not start its own node reads',
    )
    deferred.release()
    const [resolvedA, resolvedB] = await Promise.all([inflightA, inflightB])
    assert.equal(resolvedA, resolvedB, 'concurrent identical lookups must share one result')
    assert.equal(
      concurrentReads,
      3,
      'one deduped address resolution is namesByAddress + primaryName + legacyAvatarResource',
    )

    // A node that is briefly unreachable must not be cached like an answer.
    clearIdentityLookupCache()
    let offline = true
    let flakyReads = 0
    const flakyRead: IdentityRead = async (network, request) => {
      flakyReads += 1
      if (offline) return { data: { message: 'offline' }, status: 503 }
      return fixtureRead(okFixture)(network, request)
    }
    const offlineResult = await resolveIdentityOnNetwork(ADDRESS_A, 'qortal', flakyRead)
    assert.equal(offlineResult.state, 'unavailable')
    const readsWhileOffline = flakyReads
    await resolveIdentityOnNetwork(ADDRESS_A, 'qortal', flakyRead)
    assert.equal(flakyReads, readsWhileOffline, 'a failure is held just long enough to stop a storm')

    offline = false
    fakeNow += 16_000
    const recovered = await resolveIdentityOnNetwork(ADDRESS_A, 'qortal', flakyRead)
    assert.equal(recovered.state, 'resolved', 'a transient failure must not outlive its short window')
    assert.ok(flakyReads > readsWhileOffline)

    // A real answer, by contrast, is held for the full TTL and then expires.
    const readsAfterRecovery = flakyReads
    fakeNow += 60_000
    await resolveIdentityOnNetwork(ADDRESS_A, 'qortal', flakyRead)
    assert.equal(flakyReads, readsAfterRecovery, 'a resolved identity must stay cached for minutes')
    fakeNow += 5 * 60_000
    await resolveIdentityOnNetwork(ADDRESS_A, 'qortal', flakyRead)
    assert.ok(flakyReads > readsAfterRecovery, 'the memo must expire at its TTL')
  } finally {
    setIdentityLookupClockForTests(null)
    clearIdentityLookupCache()
  }
}

console.log('Home v2 dual identity resolver tests passed.')
