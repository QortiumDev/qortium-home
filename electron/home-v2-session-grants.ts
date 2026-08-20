import type { HomeV2RuntimeInvalidation } from './home-v2-runtime-invalidation.js'

export type HomeV2PermissionNetwork = 'qortal' | 'qortium'

export interface HomeV2SessionGrantBinding {
  readonly family: string
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

// Deliberately explicit: this is the complete read-only surface covered by
// one selected-account approval. Do not replace it with a GET_* wildcard —
// future actions must be reviewed before they can inherit private account
// access on both chains.
export const HOME_V2_ACCOUNT_READ_ACTIONS = Object.freeze([
  'GET_SELECTED_ACCOUNT',
  'GET_USER_ACCOUNT',
  'GET_PRIVATE_DIRECT_ACTIVE_CHATS',
  'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
  'GET_PRIVATE_GROUP_ACTIVE_CHATS',
  'GET_PRIVATE_GROUP_CHAT_STATE',
  'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES',
  'GET_PENDING_TRANSACTIONS',
  'GET_CHAT_ATTACHMENT_STREAM_URL',
  'OPEN_CHAT_ATTACHMENT_VIEWER',
] as const)

const ACCOUNT_READ_ACTIONS = new Set<string>(HOME_V2_ACCOUNT_READ_ACTIONS)

export function isHomeV2AccountReadAction(action: string): boolean {
  return ACCOUNT_READ_ACTIONS.has(action)
}

export function homeV2AccountReadPermissionSummary(appTitle: string): string {
  return `${appTitle} wants read-only access to the selected Home account on Qortal and Qortium, including private chat data.`
}

export function homeV2AccountReadPermissionDetails(accountLabel: string) {
  return [
    { label: 'Account', value: accountLabel },
    { label: 'Networks', value: 'Qortal and Qortium' },
    { label: 'Data', value: 'Address, public identity, DMs, private groups, message searches and attachments, and this app’s pending transaction records' },
    { label: 'Not allowed', value: 'Unlocking, sending, signing, publishing, administration, notifications, widgets, or deleting data' },
  ] as const
}

// A tab-level approval describes a chat capability, not one spelling of the
// same user-visible operation. Keep unrelated actions exact while allowing an
// explicitly disclosed send/edit/delete/reaction family to share one grant.
export function homeV2PermissionGrantFamily(action: string): string {
  if (isHomeV2AccountReadAction(action)) return 'account.read'
  if (PUBLIC_CHAT_MUTATIONS.has(action)) return 'chat.public.mutate'
  if (DIRECT_CHAT_MUTATIONS.has(action)) return 'chat.direct.mutate'
  if (PRIVATE_GROUP_CHAT_MUTATIONS.has(action)) return 'chat.private-group.mutate'
  return action
}

export function homeV2PermissionGrantKey(input: {
  readonly accountId: string
  readonly accountUnlocked: boolean
  readonly action: string
  readonly appIdentity: string
  readonly nodeRoute: string
  readonly principalId: number | string
  readonly protocol: string
  readonly tabId: string
  readonly target?: string
}): string {
  const family = homeV2PermissionGrantFamily(input.action)
  const principal = [
    input.principalId,
    input.tabId,
    input.accountId,
    input.appIdentity,
  ]
  if (family === 'account.read') return [...principal, family].join('|')
  return [
    ...principal,
    input.protocol,
    family,
    input.accountUnlocked,
    input.nodeRoute,
    input.target ?? '',
  ].join('|')
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
        const isAccountRead = binding.family === 'account.read'
        const affected = invalidation.kind === 'account-changed'
          ? true
          : invalidation.kind === 'tab-closed'
            ? binding.tabId === invalidation.tabId
            : invalidation.kind === 'locked'
              ? !isAccountRead
              : invalidation.kind === 'node-changed'
                ? !isAccountRead && binding.network === invalidation.network
                : !isAccountRead && binding.tabId === invalidation.tabId
        if (affected) grants.delete(key)
      }
    },
    size() {
      return grants.size
    },
  }
}
