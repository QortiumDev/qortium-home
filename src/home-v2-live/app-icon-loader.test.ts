import assert from 'node:assert/strict'
import { createHomeV2AppIconLoader } from './app-icon-loader'
import type { HomeV2NodeClient } from './node-client'

const calls: string[] = []
const ready = {
  body: 'iVBORw0KGgo=',
  contentLength: 8,
  contentType: 'image/png',
  status: 'ready' as const,
}
const client = {
  async readAppIcon() {
    calls.push('favicon')
    return { status: 'missing' as const }
  },
  async readIdentity(_network: string, request: { kind: string }) {
    calls.push(request.kind)
    if (request.kind === 'name') {
      return {
        data: { owner: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH' },
        status: 200,
      }
    }
    if (request.kind === 'namesByAddress') {
      return { data: [{ name: 'Publisher' }], status: 200 }
    }
    if (request.kind === 'primaryName') {
      return { data: { name: 'Publisher' }, status: 200 }
    }
    if (request.kind === 'accountAvatarInfo') {
      return {
        data: { identifier: 'portrait', name: 'Publisher', service: 'THUMBNAIL' },
        status: 200,
      }
    }
    return { data: [], status: 200 }
  },
  async readAvatar(_network: string, request: { pointer: { identifier: string } }) {
    calls.push(`avatar:${request.pointer.identifier}`)
    return ready
  },
} as unknown as HomeV2NodeClient

const loader = createHomeV2AppIconLoader(client)
assert.deepEqual(
  await loader('qortium', { identifier: 'Chat', name: 'Publisher', service: 'APP' }),
  ready,
)
assert.deepEqual(calls, [
  'favicon',
  'name',
  'namesByAddress',
  'primaryName',
  'accountAvatarInfo',
  // Checks whether the published name has its own avatar before settling for
  // the owner's primary-name avatar.
  'legacyAvatarResource',
  'avatar:portrait',
])

// When the name the app is published under has its own avatar, THAT is used —
// Home 1 behaviour. Publishers with several names have a primary-name avatar
// that is a different picture, or none, which showed a monogram instead.
{
  const ownCalls: string[] = []
  const ownNameClient = {
    async readAppIcon() {
      ownCalls.push('favicon')
      return { status: 'missing' as const }
    },
    async readIdentity(_network: string, request: { kind: string; value: string }) {
      ownCalls.push(`${request.kind}:${request.value}`)
      if (request.kind === 'name') {
        return { data: { owner: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH' }, status: 200 }
      }
      if (request.kind === 'namesByAddress') return { data: [{ name: 'Publisher' }], status: 200 }
      if (request.kind === 'primaryName') return { data: { name: 'Publisher' }, status: 200 }
      if (request.kind === 'accountAvatarInfo') return { data: null, status: 404 }
      if (request.kind === 'legacyAvatarResource' && request.value === 'Boards') {
        return {
          data: [{ identifier: 'avatar', name: 'Boards', service: 'THUMBNAIL' }],
          status: 200,
        }
      }
      return { data: [], status: 200 }
    },
    async readAvatar(_network: string, request: { pointer: { name: string } }) {
      ownCalls.push(`avatar-name:${request.pointer.name}`)
      return ready
    },
  } as unknown as HomeV2NodeClient

  assert.deepEqual(
    await createHomeV2AppIconLoader(ownNameClient)('qortium', {
      identifier: 'Boards',
      name: 'Boards',
      service: 'APP',
    }),
    ready,
  )
  assert.ok(
    ownCalls.includes('avatar-name:Boards'),
    `the published name's own avatar must be used; saw ${JSON.stringify(ownCalls)}`,
  )
}

// A favicon that is not READY -- still being fetched (pending), or unreadable
// (unavailable) -- falls back to the publisher's avatar just as a missing one
// does. A fresh pin's app is usually still downloading, and it used to sit as
// a monogram through two minutes of favicon retries.
for (const outcome of [
  { retryAfterSeconds: 5, status: 'pending' as const },
  { message: 'App icon response was not a supported image.', status: 'unavailable' as const },
]) {
  const withAvatar = createHomeV2AppIconLoader({
    ...client,
    async readAppIcon() {
      return outcome
    },
  } as unknown as HomeV2NodeClient)
  assert.deepEqual(
    await withAvatar('qortium', { identifier: 'Chat', name: 'Publisher', service: 'APP' }),
    ready,
    `${outcome.status} favicon must fall back to the publisher avatar`,
  )

  // No avatar anywhere: the ORIGINAL outcome goes back, so a pending favicon
  // keeps its retry loop instead of being negatively cached as missing.
  const noAvatar = createHomeV2AppIconLoader({
    ...client,
    async readAppIcon() {
      return outcome
    },
    async readAvatar() {
      return { status: 'missing' as const }
    },
  } as unknown as HomeV2NodeClient)
  assert.deepEqual(
    await noAvatar('qortium', { identifier: 'Chat', name: 'Publisher', service: 'APP' }),
    outcome,
    `${outcome.status} favicon with no avatar keeps its own outcome`,
  )
}

// A failing identity read is not a reason to lose the favicon outcome either.
// (A name the earlier cases never resolved: identity lookups are cached.)
{
  const brokenIdentity = createHomeV2AppIconLoader({
    ...client,
    async readAppIcon() {
      return { status: 'missing' as const }
    },
    async readIdentity() {
      throw new Error('node unreachable')
    },
  } as unknown as HomeV2NodeClient)
  assert.deepEqual(
    await brokenIdentity('qortium', { identifier: 'Chat', name: 'Unreachable', service: 'APP' }),
    { status: 'missing' },
  )
}

console.log('Home v2 app icon fallback loader tests passed.')
