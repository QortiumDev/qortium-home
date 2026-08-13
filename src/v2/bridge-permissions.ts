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
  | 'account.public.read'
  | 'qdn.publish'
  | 'qortal.account.read'
  | 'account.unlock'
  | 'chat.send'

export interface PermissionDetail {
  readonly label: string
  readonly value: string
}

export interface PermissionPrompt {
  readonly id: PermissionRequestId
  readonly protocol: BridgeProtocol
  readonly action:
    | 'GET_SELECTED_ACCOUNT'
    | 'GET_USER_ACCOUNT'
    | 'UNLOCK_SELECTED_ACCOUNT'
    | 'PUBLISH_QDN_RESOURCE'
    | 'SEND_CHAT_MESSAGE'
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
  | {
      readonly kind: 'node-changed'
      readonly network: NetworkId
      readonly nodeProfileRef: NodeProfileRef
    }
  | { readonly kind: 'tab-closed'; readonly tabId: TabId }
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
  return (
    grant.protocol === prompt.protocol &&
    grant.action === prompt.action &&
    grant.capability === prompt.capability &&
    grant.appIdentityKey === prompt.appIdentityKey &&
    grant.identityId === prompt.context.identityId &&
    grant.walletRef === prompt.context.walletRef &&
    grant.targetNetwork === prompt.context.targetNetwork &&
    grant.nodeProfileRef === prompt.context.nodeProfileRef &&
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
      ...state.grants.filter(
        (candidate) =>
          !(
            candidate.scope === grant.scope &&
            (grant.scope === 'always' ||
              candidate.sourceTabId === grant.sourceTabId) &&
            candidate.protocol === grant.protocol &&
            candidate.capability === grant.capability &&
            candidate.appIdentityKey === grant.appIdentityKey &&
            candidate.action === grant.action &&
            candidate.identityId === grant.identityId &&
            candidate.walletRef === grant.walletRef &&
            candidate.targetNetwork === grant.targetNetwork &&
            candidate.nodeProfileRef === grant.nodeProfileRef
          ),
      ),
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
      grants: [],
      revision: state.revision + 1,
    })
  }

  const affectsPrompt = (prompt: PermissionPrompt): boolean => {
    switch (change.kind) {
      case 'identity-changed':
        return prompt.context.identityId === change.identityId
      case 'navigation-changed':
      case 'tab-closed':
        return prompt.context.tabId === change.tabId
      case 'node-changed':
        return (
          prompt.context.targetNetwork === change.network &&
          prompt.context.nodeProfileRef === change.nodeProfileRef
        )
    }
  }
  const affectsGrant = (grant: PermissionGrant): boolean => {
    switch (change.kind) {
      case 'identity-changed':
        return grant.identityId === change.identityId
      case 'navigation-changed':
      case 'tab-closed':
        return grant.scope === 'session' && grant.sourceTabId === change.tabId
      case 'node-changed':
        return (
          grant.targetNetwork === change.network &&
          grant.nodeProfileRef === change.nodeProfileRef
        )
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
