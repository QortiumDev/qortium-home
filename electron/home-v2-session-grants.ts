import type { HomeV2RuntimeInvalidation } from './home-v2-runtime-invalidation.js'

export type HomeV2PermissionNetwork = 'qortal' | 'qortium'

export interface HomeV2SessionGrantBinding {
  readonly hostWebContentsId: number | string
  readonly network: HomeV2PermissionNetwork
  readonly tabId: string
}

export interface HomeV2SessionGrantStore {
  add(key: string, binding: HomeV2SessionGrantBinding): void
  clear(): void
  has(key: string): boolean
  invalidate(
    hostWebContentsId: HomeV2SessionGrantBinding['hostWebContentsId'],
    invalidation: HomeV2RuntimeInvalidation,
  ): void
  size(): number
}

const PUBLIC_CHAT_MUTATIONS = new Set([
  'SEND_CHAT_DELETE',
  'SEND_CHAT_EDIT',
  'SEND_CHAT_MESSAGE',
  'SEND_CHAT_REACTION',
])

const DIRECT_CHAT_MUTATIONS = new Set([
  'SEND_DIRECT_CHAT_DELETE',
  'SEND_DIRECT_CHAT_EDIT',
  'SEND_DIRECT_CHAT_MESSAGE',
  'SEND_DIRECT_CHAT_REACTION',
])

const PRIVATE_GROUP_CHAT_MUTATIONS = new Set([
  'SEND_PRIVATE_GROUP_CHAT_DELETE',
  'SEND_PRIVATE_GROUP_CHAT_EDIT',
  'SEND_PRIVATE_GROUP_CHAT_MESSAGE',
  'SEND_PRIVATE_GROUP_CHAT_REACTION',
])

// A tab-level approval describes a chat capability, not one spelling of the
// same user-visible operation. Keep unrelated actions exact while allowing an
// explicitly disclosed send/edit/delete/reaction family to share one grant.
export function homeV2PermissionGrantFamily(action: string): string {
  if (PUBLIC_CHAT_MUTATIONS.has(action)) return 'chat.public.mutate'
  if (DIRECT_CHAT_MUTATIONS.has(action)) return 'chat.direct.mutate'
  if (PRIVATE_GROUP_CHAT_MUTATIONS.has(action)) return 'chat.private-group.mutate'
  return action
}

export function createHomeV2SessionGrantStore(): HomeV2SessionGrantStore {
  const grants = new Map<string, HomeV2SessionGrantBinding>()

  return {
    add(key, binding) {
      grants.set(key, Object.freeze({ ...binding }))
    },
    clear() {
      grants.clear()
    },
    has(key) {
      return grants.has(key)
    },
    invalidate(hostWebContentsId, invalidation) {
      for (const [key, binding] of grants) {
        if (binding.hostWebContentsId !== hostWebContentsId) continue
        const affected = invalidation.kind === 'locked' || invalidation.kind === 'account-changed'
          ? true
          : invalidation.kind === 'node-changed'
            ? binding.network === invalidation.network
            : binding.tabId === invalidation.tabId
        if (affected) grants.delete(key)
      }
    },
    size() {
      return grants.size
    },
  }
}
