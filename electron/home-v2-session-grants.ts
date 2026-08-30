import type { HomeV2RuntimeInvalidation } from './home-v2-runtime-invalidation.js'
import { canonicalHomeV2PaymentAction, isHomeV2PaymentAction } from './home-v2-payment-actions.js'

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

/**
 * Actions that need no prompt at all (owner decision 2026-08-24: reading is
 * permissionless). Deliberately NARROWER than HOME_V2_ACCOUNT_READ_ACTIONS:
 * a member here must be a pure read with no side effect beyond returning the
 * caller's own data.
 *
 * Excluded on purpose, though they are "reads":
 * - GET_PRIVATE_GROUP_* — resolving a group key PERSISTS it to disk
 *   (persistQpgcKey / the Qortal ring store), and GET_PRIVATE_GROUP_CHAT_STATE
 *   returns memberPublicKeys for an arbitrary groupId with no membership
 *   assertion, so it discloses more than the caller's own data.
 * - GET_CHAT_ATTACHMENT_STREAM_URL / OPEN_CHAT_ATTACHMENT_VIEWER — allocate a
 *   retained decrypted-stream capability, can trigger the same key writes, and
 *   the viewer opens Home UI.
 * Revisit each once those side effects are removed or accepted explicitly.
 *
 * GET_MINTING_STATUS and LIST_MINTING_ACCOUNTS qualify (owner decision,
 * R3-11): both are pure reads that return derived booleans and allowlisted
 * fields — never key material — and both report node-side state only for a
 * local Core the user already runs. The two minting WRITES are deliberately
 * absent: they always prompt.
 *
 * GET_USER_WALLET qualifies by a strictly-less argument (R4 tier-2). It
 * returns the selected account's ADDRESS plus three constants: assetId 0, the
 * native asset label, and native: true. GET_SELECTED_ACCOUNT — already
 * permissionless, first in this list — returns that same address AND the
 * account's registered name AND its lock state. Everything GET_USER_WALLET
 * discloses is therefore already disclosed permissionlessly, and it discloses
 * less besides. It calls no node, derives no key, and does not require an
 * unlocked account (electron/home-v2-wallet-actions.ts).
 *
 * The FOREIGN branch of this action name — which in Home 1.x derived a BTC/LTC/…
 * HD wallet from the account seed — is not implemented in Home 2 at all; it is
 * refused with a coded error. So there is no key-derivation path sitting behind
 * this name that could inherit permissionless status by accident. If the W3
 * foreign-wallet design ever lands, it must NOT simply extend this handler:
 * it needs its own action and its own prompt, and this entry must be revisited.
 */
export const HOME_V2_PERMISSIONLESS_ACTIONS = Object.freeze([
  'GET_SELECTED_ACCOUNT',
  'GET_USER_ACCOUNT',
  'GET_USER_WALLET',
  'GET_PENDING_TRANSACTIONS',
  'GET_PRIVATE_DIRECT_ACTIVE_CHATS',
  'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
  'GET_MINTING_STATUS',
  'LIST_MINTING_ACCOUNTS',
] as const)

const PERMISSIONLESS_ACTIONS = new Set<string>(HOME_V2_PERMISSIONLESS_ACTIONS)

/**
 * Chat sends that a user may grant an app persistently ("always allow").
 * Deliberately excludes publishing, account unlock, group membership and
 * admin, and private-group key operations — those always prompt.
 */
const CHAT_SEND_ACTIONS = new Set<string>([
  'SEND_CHAT_MESSAGE',
  'SEND_CHAT_EDIT',
  'SEND_CHAT_DELETE',
  'SEND_CHAT_REACTION',
  'SEND_DIRECT_CHAT_MESSAGE',
  'SEND_DIRECT_CHAT_EDIT',
  'SEND_DIRECT_CHAT_DELETE',
  'SEND_DIRECT_CHAT_REACTION',
  'SEND_PRIVATE_GROUP_CHAT_MESSAGE',
  'SEND_PRIVATE_GROUP_CHAT_EDIT',
  'SEND_PRIVATE_GROUP_CHAT_DELETE',
  'SEND_PRIVATE_GROUP_CHAT_REACTION',
])

export function isHomeV2ChatSendAction(action: string): boolean {
  return CHAT_SEND_ACTIONS.has(action)
}

export function isHomeV2PermissionlessAction(action: string): boolean {
  return PERMISSIONLESS_ACTIONS.has(action)
}

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

/**
 * The durable QDN app capability an "always allow" on an account-read prompt
 * grants (owner decision, R3-10). Returns null for every action outside the
 * family, so a caller cannot widen the durable grant by passing an unrelated
 * action: the bridge and the Android host both gate on this returning a
 * capability rather than on the raw scope value.
 *
 * One capability for the whole family on purpose — it mirrors the
 * protocol-independent 'account.read' grant family below, so approving it
 * once covers every HOME_V2_ACCOUNT_READ_ACTIONS member on both chains.
 */
/**
 * The private-chat reads, which are NOT covered by a durable 'account.read'.
 *
 * They remain members of HOME_V2_ACCOUNT_READ_ACTIONS: one SESSION grant still
 * covers the read-only family together, and the prompt copy is unchanged. What
 * they are excluded from is the durable "always allow", for two reasons found
 * on 2026-08-30:
 *
 * - The grant did not match the prompt. Answering "always" to "read your direct
 *   messages" recorded 'account.read', because the generic durable block runs
 *   before the account.directChat one and returns. The user was shown one thing
 *   and given a wider one, covering account identity, pending transactions and
 *   attachment reads.
 * - It defeated the node-trust rule. account.directChat is deliberately usable
 *   only on Home's own local Core, because the node serving an app sees the
 *   plaintext that app reads. 'account.read' carried no such condition, so the
 *   capability actually granted bypassed the gate added for exactly this.
 *
 * Excluding them here fixes both: an "always" on a chat read now falls through
 * to the specific, node-gated capability, and an account.read held from some
 * other action stops covering chat history.
 */
const PRIVATE_CHAT_READ_ACTIONS = new Set<string>([
  'GET_PRIVATE_DIRECT_ACTIVE_CHATS',
  'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
  'GET_PRIVATE_GROUP_ACTIVE_CHATS',
  'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES',
])

export function isHomeV2PrivateChatReadAction(action: string): boolean {
  return PRIVATE_CHAT_READ_ACTIONS.has(action)
}

export function homeV2DurableAccountReadCapability(action: string): 'account.read' | null {
  if (isHomeV2PrivateChatReadAction(action)) return null
  return isHomeV2AccountReadAction(action) ? 'account.read' : null
}

/**
 * Wording-only refinement of an account-read prompt.
 *
 * The private-group and attachment reads stay FULL members of the
 * 'account.read' grant family (see homeV2PermissionGrantFamily): one session
 * grant, and one durable "always allow", still covers all of them on both
 * chains. Only the prompt copy is specialised, because the generic
 * "read-only account access" title hid what those five actions actually do —
 * resolve and persist a private-group key, list a group's members, and
 * decrypt an attachment. Splitting the GRANT is a separate decision and is
 * deliberately not made here.
 */
export type HomeV2AccountReadPromptKind = 'account' | 'attachment' | 'private-group'

const PRIVATE_GROUP_READ_ACTIONS = new Set<string>([
  'GET_PRIVATE_GROUP_ACTIVE_CHATS',
  'GET_PRIVATE_GROUP_CHAT_STATE',
  'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES',
])

const PRIVATE_ATTACHMENT_READ_ACTIONS = new Set<string>([
  'GET_CHAT_ATTACHMENT_STREAM_URL',
  'OPEN_CHAT_ATTACHMENT_VIEWER',
])

export function homeV2AccountReadPromptKind(action: string): HomeV2AccountReadPromptKind | null {
  if (!isHomeV2AccountReadAction(action)) return null
  if (PRIVATE_GROUP_READ_ACTIONS.has(action)) return 'private-group'
  if (PRIVATE_ATTACHMENT_READ_ACTIONS.has(action)) return 'attachment'
  return 'account'
}

export function homeV2AccountReadPromptTitle(kind: HomeV2AccountReadPromptKind): string {
  if (kind === 'private-group') return 'Allow private group chat access?'
  if (kind === 'attachment') return 'Allow chat attachment access?'
  return 'Allow read-only account access?'
}

export function homeV2AccountReadPromptSummary(
  kind: HomeV2AccountReadPromptKind,
  appTitle: string,
): string {
  if (kind === 'private-group') {
    return `${appTitle} wants to read your private group chats: a group’s member list and its encrypted message history, decrypted with your account’s group key. Resolving that key stores a copy of it on this device. The key itself is never given to the app.`
  }
  if (kind === 'attachment') {
    return `${appTitle} wants Home to decrypt a private chat attachment and hand it back as a temporary stream of the decrypted bytes. The key used to decrypt it is never given to the app.`
  }
  return homeV2AccountReadPermissionSummary(appTitle)
}

/**
 * Shown on every account-read prompt that offers "Always allow", because the
 * durable grant is broader than the one action being asked about right now —
 * but NOT unlimited. It names the account because the grant is bound to it:
 * selecting a different account prompts again, exactly as the session grant
 * behaves on 'account-changed'.
 */
export function homeV2AccountReadAlwaysAllowDetail(accountLabel: string) {
  return Object.freeze({
    label: 'Always allow',
    value: `One choice for this app and ${accountLabel}: it covers private group chat reads, chat attachment reads, and the other read-only account data for this account, on Qortal and Qortium, until revoked in Settings › QDN Apps. Other accounts are asked separately.`,
  })
}

// A tab-level approval describes a chat capability, not one spelling of the
// same user-visible operation. Keep unrelated actions exact while allowing an
// explicitly disclosed send/edit/delete/reaction family to share one grant.
//
// START_MINTING and REMOVE_MINTING_ACCOUNT are deliberately NOT collapsed into
// a shared "minting" family: starting minting and removing a key off the node
// are different user-visible operations, so one approval must never satisfy
// the other. They are single-request only (see requireAccountReadPermission),
// which means no grant is retained under either name; the exact family keeps
// that true even if the single-request rule is ever relaxed. The user-facing
// grouping lives in the prompt's `account.minting` capability instead.
export function homeV2PermissionGrantFamily(action: string): string {
  if (isHomeV2AccountReadAction(action)) return 'account.read'
  if (PUBLIC_CHAT_MUTATIONS.has(action)) return 'chat.public.mutate'
  if (DIRECT_CHAT_MUTATIONS.has(action)) return 'chat.direct.mutate'
  if (PRIVATE_GROUP_CHAT_MUTATIONS.has(action)) return 'chat.private-group.mutate'
  // PAYMENT and SEND_COIN are one operation with one label and identical
  // disclosure rows, so two of them render as visually indistinguishable
  // prompts. Without canonicalizing here the pending-prompt dedupe treats them
  // as different families and stacks both — the journal's conflict key already
  // canonicalizes the alias, and this is the other place that must
  // (payments review, 2026-08-27).
  if (isHomeV2PaymentAction(action)) return `payment.${canonicalHomeV2PaymentAction(action)}`
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
          // 'app-replaced' shares 'tab-closed' semantics deliberately, in ONE
          // branch so the two cannot drift: the tab now hosts a different app,
          // so every grant bound to that tab goes, account.read included. Only
          // 'navigation-changed' — an app moving around inside itself — keeps
          // an account.read binding alive (the final branch below).
          : invalidation.kind === 'tab-closed' || invalidation.kind === 'app-replaced'
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
