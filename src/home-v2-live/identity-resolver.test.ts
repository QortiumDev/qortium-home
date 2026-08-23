import assert from 'node:assert/strict'
import type { NetworkId } from '../v2/contracts'
import {
  classifyIdentityLookupInput,
  normalizeIdentityLookupInput,
  resolveDualIdentity,
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

const addressResult = await resolveDualIdentity(
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

const qortalLegacyAvatar = await resolveDualIdentity(
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

const qortalMissingAvatar = await resolveDualIdentity(
  ADDRESS_A,
  fixtureRead(resolvedAddressFixture('qortal', 'AliceQ', [])),
)
assert.equal(qortalMissingAvatar.networks.qortal.avatar, null)

const qortalWrongAvatarMatches = await resolveDualIdentity(
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
const qortiumPointerPrecedence = await resolveDualIdentity(
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

const qortiumLegacyAvatar = await resolveDualIdentity(
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

const sharedName = await resolveDualIdentity(
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

const conflict = await resolveDualIdentity(
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

const missing = await resolveDualIdentity('Nobody', fixtureRead({}))
assert.equal(missing.state, 'not-found')
assert.equal(missing.networks.qortal.state, 'not-found')
assert.equal(missing.networks.qortium.state, 'not-found')

const unavailable = await resolveDualIdentity(
  'Nobody',
  fixtureRead({
    qortal: { 'name:Nobody': { data: { message: 'offline' }, status: 503 } },
  }),
)
assert.equal(unavailable.state, 'unavailable')
assert.equal(unavailable.networks.qortal.state, 'unavailable')

const rateLimited = await resolveDualIdentity(
  'Nobody',
  fixtureRead({
    qortium: {
      'name:Nobody': { data: { message: 'rate limited' }, status: 429 },
    },
  }),
)
assert.equal(rateLimited.state, 'unavailable')
assert.equal(rateLimited.networks.qortium.state, 'unavailable')

const partialAddress = await resolveDualIdentity(
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

console.log('Home v2 dual identity resolver tests passed.')
