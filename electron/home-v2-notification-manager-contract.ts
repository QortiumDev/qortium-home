/**
 * The app-facing notification-manager contract shared by Home 2's desktop and
 * Android bridges.
 *
 * This module owns request validation, the fail-closed store gate, and the
 * revision compare-and-set. It deliberately owns NONE of the response shaping:
 * every summary comes from notification-manager.ts verbatim, because the
 * shipped Notify app hard-validates that shape (`version === 1`, a safe
 * non-negative `revision`, an `apps` array) and depends on its masking contract
 * (`maskedFilterKeys` / `partiallyMaskedFilterKeys`). Re-deriving the summary
 * here would let the two platforms drift from each other and from 1.x.
 *
 * Pattern-matched on home-v2-qdn-settings-contract.ts: one validator, injected
 * platform stores, no Electron import, so desktop and Android cannot disagree
 * about what an app is allowed to ask for.
 */
import {
  applyQdnNotificationManagerMutation,
  getQdnNotificationManagerSummary,
  sanitizeQdnNotificationManagerMutation,
  type QdnNotificationManagerMutation,
  type QdnNotificationManagerSummary,
} from './notification-manager.js'
import type { QdnNotificationStore } from './notification-rules.js'

/**
 * The complete app-facing manager surface. This list is the whole of it: Home 2
 * exposes exactly the five actions 1.x exposed and nothing more. Rule CREATION
 * (NOTIFICATION_ADD / NOTIFICATION_GET / NOTIFICATION_REMOVE) is deliberately
 * absent — see docs/HOME_V2_APP_NOTIFICATIONS.md.
 */
export const HOME_V2_NOTIFICATION_MANAGER_ACTIONS = Object.freeze([
  'NOTIFICATION_MANAGER_HAS_PERMISSION',
  'NOTIFICATION_MANAGER_GET',
  'NOTIFICATION_MANAGER_SET_MUTED',
  'NOTIFICATION_MANAGER_REMOVE_RULES',
  'NOTIFICATION_MANAGER_REVOKE',
] as const)

export type HomeV2NotificationManagerAction =
  (typeof HOME_V2_NOTIFICATION_MANAGER_ACTIONS)[number]

/** The durable capability that gates all five. Never assignment-derived. */
export const HOME_V2_NOTIFICATION_MANAGER_CAPABILITY = 'notifications.manage' as const

export function isHomeV2NotificationManagerAction(
  value: unknown,
): value is HomeV2NotificationManagerAction {
  return typeof value === 'string' &&
    (HOME_V2_NOTIFICATION_MANAGER_ACTIONS as readonly string[]).includes(value)
}

/**
 * The four actions that reach the store. HAS_PERMISSION is excluded on purpose:
 * it answers from the capability store alone, never prompts, and must stay
 * answerable even while the notification store is corrupt — an app has to be
 * able to learn "you have not granted this" without a modal.
 */
export function isHomeV2NotificationManagerStoreAction(value: unknown) {
  return isHomeV2NotificationManagerAction(value) &&
    value !== 'NOTIFICATION_MANAGER_HAS_PERMISSION'
}

/**
 * Mirrors NotificationStoreInspection from electron/notification-store.ts
 * without importing it, so this module stays free of Node/Electron.
 */
export type HomeV2NotificationManagerInspection =
  | { readonly status: 'available'; readonly store: QdnNotificationStore }
  | { readonly status: 'corrupt' | 'unavailable'; readonly store: null }

export type HomeV2NotificationManagerCodedError = Error & { code: string }

/**
 * The `code` on these errors is load-bearing all the way out to the app:
 * home-v2-qdn-app-preload.cts copies every non-`message` field of the error
 * envelope onto the rejection, and Notify branches on `HOME_DATA_STALE` to
 * re-read and retry instead of surfacing a failure. See
 * qortium-notify/src/qdnRequest.ts `isStaleRevisionError`.
 */
export function homeV2NotificationManagerCodedError(
  code: string,
  message: string,
): HomeV2NotificationManagerCodedError {
  return Object.assign(new Error(message), { code })
}

export type HomeV2NotificationManagerRequest =
  | { readonly action: 'NOTIFICATION_MANAGER_HAS_PERMISSION'; readonly kind: 'has-permission' }
  | { readonly action: 'NOTIFICATION_MANAGER_GET'; readonly kind: 'get' }
  | {
      readonly action: Exclude<
        HomeV2NotificationManagerAction,
        'NOTIFICATION_MANAGER_HAS_PERMISSION' | 'NOTIFICATION_MANAGER_GET'
      >
      readonly expectedRevision: number
      readonly kind: 'mutate'
      readonly mutation: QdnNotificationManagerMutation
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Exact-field validation, the same posture the trusted settings contract takes.
 * An unknown field is refused rather than ignored, so a request that means
 * something the manager does not implement can never be answered as if it meant
 * the subset the manager does implement.
 *
 * `action` is tolerated because the bridge hands the whole app request through;
 * it is not required, because the caller has already dispatched on it.
 */
function requireExactFields(
  value: unknown,
  action: HomeV2NotificationManagerAction,
  fields: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${action} requires a request object.`)
  }
  // Compared case-insensitively on purpose: both hosts normalize the dispatched
  // action name (trim + uppercase) before they get here, so a caller that sent
  // a lowercase action — which 1.x accepted — must not be rejected for
  // disagreeing with its own normalized name.
  if (value.action !== undefined && (
    typeof value.action !== 'string' || value.action.trim().toUpperCase() !== action
  )) {
    throw new Error(`${action} request named a different action.`)
  }
  const allowed = new Set<string>([...fields, 'action'])
  const unsupported = Object.keys(value).find((key) => !allowed.has(key))
  if (unsupported) {
    throw new Error(`${action} does not support the field ${unsupported}.`)
  }
  const missing = fields.find((field) => !Object.hasOwn(value, field))
  if (missing) {
    throw new Error(`${action} requires ${missing}.`)
  }
  return value
}

function expectedRevisionOf(value: Record<string, unknown>) {
  const revision = value.expectedRevision
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) {
    throw new Error('Notification manager expectedRevision must be a non-negative safe integer.')
  }
  return revision as number
}

/**
 * Parses one app request. Throws on anything malformed, which the bridge turns
 * into a VALIDATION_FAILED rejection — the mutation never reaches the store.
 *
 * Note the ORDER this enforces at the call sites: parsing happens before the
 * permission prompt (matching 1.x), so a malformed request cannot be used to
 * raise a permission prompt the user would otherwise never see.
 */
export function parseHomeV2NotificationManagerRequest(
  action: HomeV2NotificationManagerAction,
  value: unknown,
): HomeV2NotificationManagerRequest {
  switch (action) {
    case 'NOTIFICATION_MANAGER_HAS_PERMISSION':
      requireExactFields(value, action, [])
      return { action, kind: 'has-permission' }
    case 'NOTIFICATION_MANAGER_GET':
      requireExactFields(value, action, [])
      return { action, kind: 'get' }
    case 'NOTIFICATION_MANAGER_SET_MUTED': {
      const request = requireExactFields(value, action, ['appKey', 'expectedRevision', 'muted'])
      return {
        action,
        expectedRevision: expectedRevisionOf(request),
        kind: 'mutate',
        mutation: sanitizeQdnNotificationManagerMutation({
          type: 'SET_APP_MUTED',
          appKey: request.appKey,
          muted: request.muted,
        }),
      }
    }
    case 'NOTIFICATION_MANAGER_REMOVE_RULES': {
      const request = requireExactFields(value, action, [
        'appKey',
        'expectedRevision',
        'notificationIds',
      ])
      return {
        action,
        expectedRevision: expectedRevisionOf(request),
        kind: 'mutate',
        mutation: sanitizeQdnNotificationManagerMutation({
          type: 'REMOVE_APP_RULES',
          appKey: request.appKey,
          notificationIds: request.notificationIds,
        }),
      }
    }
    case 'NOTIFICATION_MANAGER_REVOKE': {
      const request = requireExactFields(value, action, ['appKey', 'expectedRevision'])
      return {
        action,
        expectedRevision: expectedRevisionOf(request),
        kind: 'mutate',
        mutation: sanitizeQdnNotificationManagerMutation({
          type: 'REVOKE_APP',
          appKey: request.appKey,
        }),
      }
    }
    default:
      // Unreachable for a caller that honoured the parameter type, and a
      // deliberate fail-closed backstop for one that did not.
      throw new Error('Notification manager action is not supported.')
  }
}

/**
 * Fail closed on a degraded store. 1.x read the store with readNotificationStore(),
 * which turns a corrupt or unreadable file into an EMPTY store — safe for the
 * "is this app allowed to notify?" question it was written for, but wrong here:
 * a manager would be told the user has no grants and no rules, and a mutation
 * would then be written over the damaged file. Home 2 refuses instead, with a
 * code the app can distinguish from a genuine empty profile.
 */
export function requireAvailableHomeV2NotificationStore(
  inspection: HomeV2NotificationManagerInspection,
): QdnNotificationStore {
  if (inspection.status !== 'available') {
    throw homeV2NotificationManagerCodedError(
      inspection.status === 'corrupt'
        ? 'HOME_NOTIFICATION_STORE_CORRUPT'
        : 'HOME_NOTIFICATION_STORE_UNAVAILABLE',
      'Notification settings are unavailable.',
    )
  }
  return inspection.store
}

export function readHomeV2NotificationManagerSummary(
  inspection: HomeV2NotificationManagerInspection,
): QdnNotificationManagerSummary {
  return getQdnNotificationManagerSummary(requireAvailableHomeV2NotificationStore(inspection))
}

/**
 * Resolves the store a mutation would produce, or throws.
 *
 * Deliberately pure and synchronous: the caller owns the write, so the desktop
 * (synchronous atomic file replace) and Android (serialized async write chain
 * with its own CAS) can share this exact check without either one having to
 * model the other's persistence.
 */
export function resolveHomeV2NotificationManagerMutation(
  inspection: HomeV2NotificationManagerInspection,
  request: Extract<HomeV2NotificationManagerRequest, { kind: 'mutate' }>,
): QdnNotificationStore {
  const store = requireAvailableHomeV2NotificationStore(inspection)
  if (store.revision !== request.expectedRevision) {
    throw homeV2NotificationManagerCodedError(
      'HOME_DATA_STALE',
      'Notification settings changed; refresh and try again.',
    )
  }
  return applyQdnNotificationManagerMutation(store, request.mutation)
}

export function summarizeHomeV2NotificationManagerStore(
  store: QdnNotificationStore,
): QdnNotificationManagerSummary {
  return getQdnNotificationManagerSummary(store)
}
