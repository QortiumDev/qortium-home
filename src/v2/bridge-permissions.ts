import type {
  AppId,
  Brand,
  IdentityId,
  NetworkId,
  NodeProfileRef,
  OperationContext,
  TabId,
  WalletRef,
} from './contracts'

export type BridgeProtocol = 'qdnRequest' | 'qortalRequest'
export type PermissionRequestId = Brand<string, 'PermissionRequestId'>
export type PermissionScope = 'single-request' | 'session' | 'always'
export type PermissionCapability =
  | 'account.read'
  | 'account.public.read'
  | 'qdn.publish'
  | 'qortal.account.read'
  | 'account.unlock'
  | 'chat.send'
  | 'window.widget.open'
  | 'chat.direct.read'
  | 'chat.direct.send'
  | 'chat.private-group.read'
  | 'chat.private-group.recover'
  | 'chat.private-group.rotate'
  | 'chat.private-group.send'
  | 'chat.attachment'
  | 'group.membership'
  | 'group.administration'
  | 'notifications.show'
  // Authority over EVERY app's notification grants and rules, not permission to
  // show one. Durable, app-scoped, and revocable in QDN Apps settings.
  | 'notifications.manage'
  | 'bookmarks.manage'
  | 'transactions.pending.read'
  | 'transactions.pending.forget'
  // Loading or removing a minting key on the local Core. Always a
  // single-request approval; never retained as a grant.
  | 'account.minting'
  // Signing one zero-fee, zero-payment chain MESSAGE to an AT (SEND_MESSAGE).
  // Deliberately NOT 'account.read' and not any 'chat.*' capability: durable
  // grants unify on the capability string, so a signing action must never be
  // reachable through a grant the user gave for a read or a chat send. Always
  // a single-request approval; never retained.
  | 'contract.message.send'

export interface PermissionDetail {
  readonly label: string
  readonly value: string
  // 'scroll' renders the value in a bounded, scrollable, wrapping block rather
  // than a single line. Used for the SEND_MESSAGE prompt's Message row, which
  // discloses the entire signed text (up to 4,000 bytes) — the user must see
  // all of it, but it must not push the approve/deny buttons off-screen.
  readonly variant?: 'scroll'
}

export interface PermissionPrompt {
  readonly id: PermissionRequestId
  readonly protocol: BridgeProtocol
  readonly action:
    | 'GET_SELECTED_ACCOUNT'
    | 'GET_USER_ACCOUNT'
    | 'JOIN_GROUP'
    | 'LEAVE_GROUP'
    | 'APPROVE_GROUP_JOIN_REQUEST'
    | 'INVITE_TO_GROUP'
    | 'CANCEL_GROUP_INVITE'
    | 'ADD_GROUP_ADMIN'
    | 'REMOVE_GROUP_ADMIN'
    | 'GROUP_BAN'
    | 'CANCEL_GROUP_BAN'
    | 'GROUP_KICK'
    | 'BAN_FROM_GROUP'
    | 'KICK_FROM_GROUP'
    | 'UNLOCK_SELECTED_ACCOUNT'
    | 'PUBLISH_QDN_RESOURCE'
    | 'PUBLISH_CHAT_ATTACHMENT'
    | 'GET_CHAT_ATTACHMENT_STREAM_URL'
    | 'OPEN_CHAT_ATTACHMENT_VIEWER'
    | 'SAVE_CHAT_ATTACHMENT'
    | 'SEND_CHAT_DELETE'
    | 'SEND_CHAT_EDIT'
    | 'SEND_CHAT_MESSAGE'
    | 'OPEN_AS_WIDGET'
    | 'SEND_CHAT_REACTION'
    | 'GET_PRIVATE_DIRECT_ACTIVE_CHATS'
    | 'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES'
    | 'SEND_DIRECT_CHAT_DELETE'
    | 'SEND_DIRECT_CHAT_EDIT'
    | 'SEND_DIRECT_CHAT_MESSAGE'
    | 'SEND_DIRECT_CHAT_REACTION'
    | 'GET_PRIVATE_GROUP_ACTIVE_CHATS'
    | 'GET_PRIVATE_GROUP_CHAT_STATE'
    | 'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES'
    | 'REQUEST_PRIVATE_GROUP_CHAT_KEY'
    | 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS'
    | 'ROTATE_PRIVATE_GROUP_CHAT_KEY'
    | 'SEND_PRIVATE_GROUP_CHAT_DELETE'
    | 'SEND_PRIVATE_GROUP_CHAT_EDIT'
    | 'SEND_PRIVATE_GROUP_CHAT_MESSAGE'
    | 'SEND_PRIVATE_GROUP_CHAT_REACTION'
    | 'SHOW_NOTIFICATION'
    | 'BOOKMARKS_GET'
    | 'BOOKMARKS_APPLY'
    | 'BOOKMARKS_OPEN'
    // NOTIFICATION_MANAGER_HAS_PERMISSION is deliberately absent: it never
    // prompts, so it can never be the action a prompt is raised for.
    | 'NOTIFICATION_MANAGER_GET'
    | 'NOTIFICATION_MANAGER_SET_MUTED'
    | 'NOTIFICATION_MANAGER_REMOVE_RULES'
    | 'NOTIFICATION_MANAGER_REVOKE'
    | 'GET_PENDING_TRANSACTIONS'
    | 'FORGET_PENDING_TRANSACTION'
    | 'START_MINTING'
    | 'REMOVE_MINTING_ACCOUNT'
    | 'SEND_MESSAGE'
  readonly capability: PermissionCapability
  readonly appId: AppId
  readonly appIdentityKey: string
  readonly appTitle: string
  readonly context: OperationContext
  readonly title: string
  readonly summary: string
  readonly details: readonly PermissionDetail[]
  readonly allowedScopes: readonly PermissionScope[]
}

export interface PermissionGrant {
  readonly protocol: BridgeProtocol
  readonly action: PermissionPrompt['action']
  readonly capability: PermissionCapability
  readonly appIdentityKey: string
  readonly identityId: IdentityId
  readonly walletRef: WalletRef | null
  readonly targetNetwork: NetworkId
  readonly nodeProfileRef: NodeProfileRef
  readonly sourceTabId: TabId
  readonly scope: Exclude<PermissionScope, 'single-request'>
}

export interface PermissionState {
  readonly pending: readonly PermissionPrompt[]
  readonly grants: readonly PermissionGrant[]
  readonly revision: number
}

export type PermissionDecision =
  | { readonly approved: false }
  | {
      readonly approved: true
      readonly scope: PermissionScope
    }

export interface PermissionResolution {
  readonly requestId: PermissionRequestId
  readonly approved: boolean
  readonly scope: PermissionScope | null
}

export interface PermissionTransition {
  readonly state: PermissionState
  readonly resolution: PermissionResolution
}

export type PermissionInvalidation =
  | { readonly kind: 'identity-changed'; readonly identityId: IdentityId }
  | { readonly kind: 'navigation-changed'; readonly tabId: TabId }
  | { readonly kind: 'node-changed'; readonly network: NetworkId }
  | { readonly kind: 'tab-closed'; readonly tabId: TabId }
  /**
   * One app tab's app was replaced in place (OPEN_CURRENT_TAB). Drops every
   * tab-bound grant, account.read included, exactly as 'tab-closed' does —
   * the tab now hosts a different app. Distinct from 'navigation-changed' (an
   * app navigating within itself, which deliberately keeps account.read) and
   * from 'tab-closed' (there the tab itself goes away).
   */
  | { readonly kind: 'app-replaced'; readonly tabId: TabId }
  | { readonly kind: 'locked' }

export class PermissionModelError extends Error {
  constructor(
    readonly code:
      | 'DUPLICATE_PERMISSION_REQUEST'
      | 'INVALID_PERMISSION_SCOPE'
      | 'PERMISSION_REQUEST_NOT_FOUND',
    message: string,
  ) {
    super(message)
    this.name = 'PermissionModelError'
  }
}

export function createPermissionPrompt(
  prompt: PermissionPrompt,
): PermissionPrompt {
  return Object.freeze({
    ...prompt,
    context: Object.freeze({ ...prompt.context }),
    details: Object.freeze(prompt.details.map((detail) => Object.freeze({ ...detail }))),
    allowedScopes: Object.freeze([...prompt.allowedScopes]),
  })
}

function freezePermissionState(state: PermissionState): PermissionState {
  return Object.freeze({
    ...state,
    pending: Object.freeze(state.pending.map(createPermissionPrompt)),
    grants: Object.freeze(
      state.grants.map((grant) => Object.freeze({ ...grant })),
    ),
  })
}

export function createPermissionState(): PermissionState {
  return freezePermissionState({ pending: [], grants: [], revision: 0 })
}

export function queuePermissionPrompt(
  state: PermissionState,
  prompt: PermissionPrompt,
): PermissionState {
  if (state.pending.some((candidate) => candidate.id === prompt.id)) {
    throw new PermissionModelError(
      'DUPLICATE_PERMISSION_REQUEST',
      `Permission request ${prompt.id} is already pending.`,
    )
  }
  return freezePermissionState({
    ...state,
    pending: [...state.pending, prompt],
    revision: state.revision + 1,
  })
}

function grantMatchesPrompt(
  grant: PermissionGrant,
  prompt: PermissionPrompt,
): boolean {
  const unifiedAccountRead = grant.capability === 'account.read' && prompt.capability === 'account.read'
  return (
    (unifiedAccountRead || grant.protocol === prompt.protocol) &&
    (unifiedAccountRead || grant.action === prompt.action) &&
    grant.capability === prompt.capability &&
    grant.appIdentityKey === prompt.appIdentityKey &&
    grant.identityId === prompt.context.identityId &&
    grant.walletRef === prompt.context.walletRef &&
    (unifiedAccountRead || grant.targetNetwork === prompt.context.targetNetwork) &&
    (unifiedAccountRead || grant.nodeProfileRef === prompt.context.nodeProfileRef) &&
    (grant.scope === 'always' || grant.sourceTabId === prompt.context.tabId)
  )
}

export function hasPermissionGrant(
  state: PermissionState,
  prompt: PermissionPrompt,
): boolean {
  return state.grants.some((grant) => grantMatchesPrompt(grant, prompt))
}

export function resolvePermissionPrompt(
  state: PermissionState,
  requestId: PermissionRequestId,
  decision: PermissionDecision,
): PermissionTransition {
  const prompt = state.pending.find((candidate) => candidate.id === requestId)
  if (!prompt) {
    throw new PermissionModelError(
      'PERMISSION_REQUEST_NOT_FOUND',
      `Permission request ${requestId} was not found.`,
    )
  }

  if (decision.approved && !prompt.allowedScopes.includes(decision.scope)) {
    throw new PermissionModelError(
      'INVALID_PERMISSION_SCOPE',
      `${decision.scope} is not available for ${prompt.action}.`,
    )
  }

  let grants = state.grants
  if (decision.approved && decision.scope !== 'single-request') {
    const grant: PermissionGrant = Object.freeze({
      protocol: prompt.protocol,
      action: prompt.action,
      capability: prompt.capability,
      appIdentityKey: prompt.appIdentityKey,
      identityId: prompt.context.identityId,
      walletRef: prompt.context.walletRef,
      targetNetwork: prompt.context.targetNetwork,
      nodeProfileRef: prompt.context.nodeProfileRef,
      sourceTabId: prompt.context.tabId,
      scope: decision.scope,
    })
    grants = [
      ...state.grants.filter((candidate) => {
        const unifiedAccountRead = candidate.capability === 'account.read' && grant.capability === 'account.read'
        return !(
          candidate.scope === grant.scope &&
          (grant.scope === 'always' || candidate.sourceTabId === grant.sourceTabId) &&
          (unifiedAccountRead || candidate.protocol === grant.protocol) &&
          candidate.capability === grant.capability &&
          candidate.appIdentityKey === grant.appIdentityKey &&
          (unifiedAccountRead || candidate.action === grant.action) &&
          candidate.identityId === grant.identityId &&
          candidate.walletRef === grant.walletRef &&
          (unifiedAccountRead || candidate.targetNetwork === grant.targetNetwork) &&
          (unifiedAccountRead || candidate.nodeProfileRef === grant.nodeProfileRef)
        )
      }),
      grant,
    ]
  }

  const nextState = freezePermissionState({
    pending: state.pending.filter((candidate) => candidate.id !== requestId),
    grants,
    revision: state.revision + 1,
  })
  return Object.freeze({
    state: nextState,
    resolution: Object.freeze({
      requestId,
      approved: decision.approved,
      scope: decision.approved ? decision.scope : null,
    }),
  })
}

export function invalidatePermissionState(
  state: PermissionState,
  change: PermissionInvalidation,
): PermissionState {
  if (change.kind === 'locked') {
    return freezePermissionState({
      pending: [],
      grants: state.grants.filter((grant) => grant.capability === 'account.read'),
      revision: state.revision + 1,
    })
  }

  const affectsPrompt = (prompt: PermissionPrompt): boolean => {
    switch (change.kind) {
      case 'identity-changed':
        return prompt.context.identityId === change.identityId
      case 'navigation-changed':
      case 'tab-closed':
      case 'app-replaced':
        return prompt.context.tabId === change.tabId
      case 'node-changed':
        return prompt.context.targetNetwork === change.network
    }
  }
  const affectsGrant = (grant: PermissionGrant): boolean => {
    switch (change.kind) {
      case 'identity-changed':
        return grant.identityId === change.identityId
      case 'navigation-changed':
      case 'tab-closed':
      case 'app-replaced':
        // 'app-replaced' takes the same side as 'tab-closed': the tab now
        // hosts a different app, so its account.read binding goes too. Only
        // 'navigation-changed' (an app navigating within itself) keeps it.
        return grant.scope === 'session' && grant.sourceTabId === change.tabId &&
          (change.kind !== 'navigation-changed' || grant.capability !== 'account.read')
      case 'node-changed':
        return grant.capability !== 'account.read' && grant.targetNetwork === change.network
    }
  }

  const pending = state.pending.filter((prompt) => !affectsPrompt(prompt))
  const grants = state.grants.filter((grant) => !affectsGrant(grant))
  if (pending.length === state.pending.length && grants.length === state.grants.length) {
    return state
  }
  return freezePermissionState({
    pending,
    grants,
    revision: state.revision + 1,
  })
}
