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

console.log('Home v2 app icon fallback loader tests passed.')
