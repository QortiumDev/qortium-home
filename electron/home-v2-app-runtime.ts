import {
  getHomeV2AppActions,
  getHomeV2AppNetwork,
  type HomeV2AppBridgeProtocol,
  type HomeV2AppNetwork,
} from './home-v2-app-actions.js'
import {
  isHomeV2ForeignWalletAdminAction,
  isHomeV2ForeignWalletReadAction,
  isHomeV2TrustedForeignWalletRoute,
} from './home-v2-foreign-wallet-actions.js'
import { isHomeV2NodeSettingsWriteAction } from './home-v2-node-settings.js'

export type HomeV2AppPlatform = 'android' | 'desktop'
export type HomeV2ConfiguredRouteKind =
  | 'custom-authenticated'
  | 'custom-unauthenticated'
  | 'disabled'
  | 'local'
  | 'public'

export interface HomeV2AppNodeState {
  readonly adminTrusted?: boolean
  readonly capabilities: { readonly read: boolean }
  readonly customAuthenticated?: boolean
  readonly customConfigured: boolean
  readonly error?: string | null
  readonly mode: 'custom' | 'disabled' | 'local' | 'public'
  readonly nodeApiUrl: string | null
}

export interface HomeV2AppRouteDescriptor {
  readonly adminTrusted: boolean
  readonly available: boolean
  readonly configuredKind: HomeV2ConfiguredRouteKind
  readonly effectiveKind: Exclude<HomeV2ConfiguredRouteKind, 'disabled'> | null
  readonly reachable: boolean
  readonly revision: string
}

export interface HomeV2AppHostInfo {
  readonly hostName: 'qortium-home'
  readonly hostVersion: string
  readonly network: HomeV2AppNetwork
  readonly platform: HomeV2AppPlatform
  readonly platformVersion: string
  readonly protocol: HomeV2AppBridgeProtocol
  readonly route: HomeV2AppRouteDescriptor
}

export const HOME_V2_BRIDGE_STATE_EVENT = 'qortiumBridgeStateChanged'

export interface HomeV2BridgeStateDetail {
  readonly network: HomeV2AppNetwork
  readonly protocol: HomeV2AppBridgeProtocol
  readonly revision: string
}

export const HOME_V2_ROUTE_INDEPENDENT_ACTIONS = Object.freeze([
  'BOOKMARKS_APPLY',
  // Encryption is arithmetic over the account's own key. It reads no chain
  // state, contacts no node, and its result does not depend on which route is
  // configured — refusing it because a node is unreachable would be a refusal
  // with no cause.
  'DECRYPT_DATA',
  'ENCRYPT_DATA',
  'BOOKMARKS_GET',
  'BOOKMARKS_HAS_PERMISSION',
  'BOOKMARKS_OPEN',
  'FORGET_PENDING_TRANSACTION',
  'GET_HOST_INFO',
  // The one action that reads from outside the node network entirely (a
  // cached CoinGecko price list), so a disabled or unreachable Qortal/Qortium
  // route has no bearing on whether it can answer. Being route-independent is
  // a statement about where the data comes from, not a privilege: it still
  // returns nothing but public prices.
  'GET_MARKET_PRICES',
  'GET_PENDING_TRANSACTIONS',
  // Both native and supported foreign receive-wallet answers are derived
  // locally by Home. Foreign balance/history reads remain route-gated.
  'GET_USER_WALLET',
  'IS_USING_PUBLIC_NODE',
  'NOTIFICATION_HAS_PERMISSION',
  // Both open actions are route-independent for the same reason: they hand an
  // address to Home's own navigation and never touch a node. An app on an
  // unavailable route can still send the user somewhere useful.
  'OPEN_CURRENT_TAB',
  // The manager family touches Home-profile data only, so it stays callable
  // while every node route is disabled or unreachable — exactly like BOOKMARKS_*.
  'NOTIFICATION_MANAGER_GET',
  'NOTIFICATION_MANAGER_HAS_PERMISSION',
  'NOTIFICATION_MANAGER_REMOVE_RULES',
  'NOTIFICATION_MANAGER_REVOKE',
  'NOTIFICATION_MANAGER_SET_MUTED',
  // Home's own appearance and notification toggle. No node is involved in
  // reading or changing them, so an app can still theme itself to match Home —
  // and still ask to change it — while every route is disabled or unreachable.
  'GET_HOME_SETTINGS',
  'GET_HOME_SETTINGS_METADATA',
  'UPDATE_HOME_SETTINGS',
  'OPEN_NEW_TAB',
  'SHOW_CONTEXT_MENU',
  'SHOW_NOTIFICATION',
  'SHOW_ACTIONS',
  'WHICH_UI',
] as const)

const HOME_V2_REACHABLE_ROUTE_ACTIONS = new Set<string>([
  'PUBLISH_CHAT_ATTACHMENT',
  'GET_CHAT_ATTACHMENT_STREAM_URL',
  'OPEN_CHAT_ATTACHMENT_VIEWER',
  'SAVE_CHAT_ATTACHMENT',
  'PUBLISH_QDN_RESOURCE',
  'SELECT_QDN_PUBLISH_SOURCE',
  // Previewing sends the file to the node to be rendered, so an unreachable
  // route cannot serve it -- same gate as its publish-source siblings.
  'PREVIEW_QDN_PUBLISH_SOURCE',
])

function configuredRouteKind(node: HomeV2AppNodeState): HomeV2ConfiguredRouteKind {
  if (node.mode !== 'custom') return node.mode
  return node.customAuthenticated
    ? 'custom-authenticated'
    : 'custom-unauthenticated'
}

// A compact deterministic revision is enough here: it is an invalidation
// token, not a credential or content-integrity digest. The input deliberately
// includes only public route/account facts and never an API key or wallet
// secret.
function routeRevision(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `home-v2-route-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function getHomeV2AppRouteDescriptor(input: {
  readonly accountId?: string | null
  readonly network: HomeV2AppNetwork
  readonly node: HomeV2AppNodeState
  readonly platform: HomeV2AppPlatform
  readonly protocol: HomeV2AppBridgeProtocol
}): HomeV2AppRouteDescriptor {
  const configuredKind = configuredRouteKind(input.node)
  const platformSupportsRoute = !(input.platform === 'android' && input.node.mode === 'local')
  const configured = input.node.mode !== 'disabled' &&
    (input.node.mode !== 'custom' || input.node.customConfigured)
  const available = configured && platformSupportsRoute
  const reachable = available && input.node.capabilities.read && !!input.node.nodeApiUrl
  const adminTrusted = reachable && input.node.adminTrusted === true
  const effectiveKind = available && configuredKind !== 'disabled' ? configuredKind : null
  const revision = routeRevision([
    input.platform,
    input.protocol,
    input.network,
    configuredKind,
    effectiveKind ?? 'none',
    available ? 'available' : 'unavailable',
    reachable ? 'reachable' : 'unreachable',
    adminTrusted ? 'admin-trusted' : 'admin-untrusted',
    input.node.nodeApiUrl ?? 'none',
    input.accountId ?? 'none',
  ].join('|'))
  return Object.freeze({
    adminTrusted,
    available,
    configuredKind,
    effectiveKind,
    reachable,
    revision,
  })
}

export function getHomeV2AvailableAppActions(
  protocol: HomeV2AppBridgeProtocol,
  routes: Readonly<Record<HomeV2AppNetwork, HomeV2AppRouteDescriptor>>,
): readonly string[] {
  const implemented = getHomeV2AppActions(protocol)
  const routeIndependent = new Set<string>(HOME_V2_ROUTE_INDEPENDENT_ACTIONS)
  return Object.freeze(implemented.filter((action) => {
    if (routeIndependent.has(action)) return true
    const route = routes[getHomeV2AppNetwork(protocol, action)]
    if (
      protocol === 'qdnRequest' &&
      (isHomeV2ForeignWalletReadAction(action) ||
        isHomeV2ForeignWalletAdminAction(action))
    ) {
      return isHomeV2TrustedForeignWalletRoute(route)
    }
    // The node-settings writes administer a node, so SHOW_ACTIONS stays
    // honest the same way the foreign-wallet family does: advertised only on
    // a reachable route the user actually administers (their managed local
    // Core, or a custom node with their attached key). The metadata READ is
    // not gated — it is the same anonymous Core route FETCH_NODE_API allows.
    if (protocol === 'qdnRequest' && isHomeV2NodeSettingsWriteAction(action)) {
      return route.reachable && route.adminTrusted
    }
    return HOME_V2_REACHABLE_ROUTE_ACTIONS.has(action) ? route.reachable : route.available
  }))
}

const WIDGET_LOCAL_ACTIONS = new Set<string>([
  'WIDGET_CLOSE',
  'WIDGET_END_DRAG',
  'WIDGET_GET_STATE',
  'WIDGET_RESIZE',
  'WIDGET_SET_REGIONS',
  'WIDGET_START_DRAG',
])

// Widget v1 deliberately has no trusted Home chrome for account, signing,
// publishing, notification, viewer or file-picker prompts. Keep this an
// allowlist-shaped predicate so a future write action is not accidentally
// exposed merely because it was added to the normal tab catalogue.
function isWidgetPublicReadAction(action: string) {
  if (WIDGET_LOCAL_ACTIONS.has(action)) return true
  if (action === 'SHOW_ACTIONS' || action === 'WHICH_UI' || action === 'IS_USING_PUBLIC_NODE') {
    return true
  }
  if (action === 'GET_HOST_INFO' || action === 'GET_NODE_INFO' || action === 'GET_NODE_STATUS') {
    return true
  }
  if (!/^(FETCH|GET|LIST|SEARCH|RESOLVE)_/.test(action)) return false
  return !(
    action.includes('PRIVATE_') ||
    action.includes('CHAT_ATTACHMENT') ||
    action === 'GET_PENDING_TRANSACTIONS' ||
    action === 'GET_SELECTED_ACCOUNT' ||
    action === 'GET_USER_ACCOUNT' ||
    // Minting reads describe the user's own node, and GET_MINTING_STATUS
    // defaults to the selected account's address — so answering it in a widget
    // discloses the selected identity with no prompt surface to disclose it
    // through. Both are excluded for the same reason GET_SELECTED_ACCOUNT is,
    // even though they are permissionless in a normal tab.
    action === 'GET_MINTING_STATUS' ||
    action === 'LIST_MINTING_ACCOUNTS' ||
    // The list reads describe the user's own node too — which names the user
    // blocks and follows is a behavioral profile of the person, not of any
    // app — and both match /^GET_/, so without this line they would be
    // admitted silently. Excluded for the same reason as the minting reads.
    action === 'GET_ALL_LISTS' ||
    action === 'GET_LIST' ||
    // Same reason again, and the reason this predicate is a DENYLIST behind a
    // prefix test rather than a plain allowlist is exactly this trap:
    // GET_USER_WALLET matches /^GET_/ and would have been admitted silently.
    // Its entire answer is the selected account's address, so it is
    // GET_SELECTED_ACCOUNT by another name and is excluded with it.
    action === 'GET_USER_WALLET' ||
    isHomeV2ForeignWalletReadAction(action) ||
    // The Home-settings reads match GET_ and would otherwise be admitted here.
    // They are excluded because a widget has no trusted Home chrome to raise
    // the UPDATE_HOME_SETTINGS prompt on, and shipping the read half of a
    // read/write pair without the write half is an incoherent surface: an app
    // would discover the settings and then find the only action that acts on
    // them missing. The display subset a widget actually needs — theme, accent,
    // language, text size, interface style — already reaches it as render-URL
    // parameters, with no bridge call at all.
    action === 'GET_HOME_SETTINGS' ||
    action === 'GET_HOME_SETTINGS_METADATA'
  )
}

/**
 * Reads whose subject address DEFAULTS to the selected account.
 *
 * These stay available in a widget — with an EXPLICIT address, which is all
 * they could ever do before — but the default must not apply there. The
 * default is what turns a public read into an identity disclosure: a widget
 * calling GET_ACCOUNT_DATA with no address would otherwise be handed a record
 * containing the selected account's address, and GET_ACCOUNT_RATING would echo
 * it back as `rater`, with no chrome to tell the user any of it happened.
 *
 * Callers pass a null selected address in widget context, so the request
 * fails with "Address is required" instead of quietly self-addressing.
 */
const WIDGET_SELF_SUBJECT_ACTIONS = new Set<string>([
  'GET_ACCOUNT_DATA',
  'GET_ACCOUNT_RATING',
  'GET_BALANCE',
  'GET_MEMBER_BANS',
  'GET_MEMBER_KICKS',
  'GET_RESOURCE_RATING',
])

export function homeV2WidgetWithholdsSelfSubject(action: string) {
  return WIDGET_SELF_SUBJECT_ACTIONS.has(action)
}

/**
 * Actions Android cannot run, each with the reason it cannot.
 *
 * The 2026-08-27 parity wave emptied this: every SIGNING family runs on
 * Android, and describing an unimplemented feature as a safety measure is how
 * a half-working platform gets mistaken for a careful one. Anything added here
 * needs a reason that is true of the ACTION rather than of the porting
 * schedule, and the reason is written next to the entry so the refusal cannot
 * drift away from it — the single generic "requires transaction signing"
 * message this used to emit was already wrong for the first entry added.
 */
const ANDROID_UNSUPPORTED_ACTION_REASONS = new Map<string, string>([
  [
    // Not a porting gap of Home's: previewing POSTs the chosen source to a
    // node that renders it, and the desktop handler is gated to a LOCAL Core
    // for exactly that reason. Home for Android runs no Core, so the honest
    // answer is that the capability is absent, not that the button is missing.
    //
    // Future Android path, when there is one: Core's
    // POST /arbitrary/preview/{service}/upload?archive=&filename= takes the
    // BYTES rather than a local path, which is what Home 1.x Android used
    // (src/platform.ts, the PREVIEW_QDN_PUBLISH_SOURCE branch). It still needs
    // a trusted node with a write key, so it is a node-trust decision before
    // it is a client one.
    'PREVIEW_QDN_PUBLISH_SOURCE',
    'PREVIEW_QDN_PUBLISH_SOURCE renders the chosen source on your own local Qortium Core, which Qortium Home for Android does not run.',
  ],
])

const ANDROID_UNSUPPORTED_ACTIONS: ReadonlySet<string> = new Set(ANDROID_UNSUPPORTED_ACTION_REASONS.keys())

export function isHomeV2AndroidUnsupportedAction(action: string) {
  return ANDROID_UNSUPPORTED_ACTIONS.has(action)
}

/**
 * The ONE answer to "why can Android not run this action?".
 *
 * This replaces three overlapping gates in the portable client, the last of
 * which was a hand-maintained NEGATION of the second's action list — so
 * porting a single family meant editing four places in step, and forgetting
 * one produced either a wrong message or a silent hole. Now the refusal is
 * derived: membership in ANDROID_UNSUPPORTED_ACTIONS decides IF, this
 * function decides WHY, and an action not advertised on the calling protocol
 * falls through to the generic unsupported-protocol answer instead of being
 * described with the wrong network.
 *
 * Returns null when Android has no objection of its own — the caller then
 * applies its ordinary route/protocol checks.
 */
export function homeV2AndroidActionRefusal(
  action: string,
  protocol: HomeV2AppBridgeProtocol,
): { readonly message: string; readonly network: HomeV2AppNetwork } | null {
  if (!ANDROID_UNSUPPORTED_ACTIONS.has(action)) return null
  // Not advertised on this protocol at all: the generic gate answers
  // UNSUPPORTED_PROTOCOL, which is the honest reply — naming a capability on
  // the wrong network would not be.
  if (!getHomeV2AppActions(protocol).includes(action)) return null
  const network = getHomeV2AppNetwork(protocol, action)
  return {
    message: ANDROID_UNSUPPORTED_ACTION_REASONS.get(action)
      ?? `${action} is only available in Qortium Home desktop.`,
    network,
  }
}

export function getHomeV2ContextualAppActions(
  availableActions: readonly string[],
  context: 'android' | 'tab' | 'widget',
  // Overridable so the withholding MECHANISM stays testable independently of
  // whatever the real set happens to hold.
  unsupportedOnAndroid: ReadonlySet<string> = ANDROID_UNSUPPORTED_ACTIONS,
): readonly string[] {
  const filtered = availableActions.filter((action) => {
    if (context === 'widget') return action !== 'OPEN_AS_WIDGET' && isWidgetPublicReadAction(action)
    if (context === 'android') {
      return action !== 'OPEN_AS_WIDGET' &&
        !WIDGET_LOCAL_ACTIONS.has(action) &&
        !unsupportedOnAndroid.has(action)
    }
    return !WIDGET_LOCAL_ACTIONS.has(action)
  })
  return Object.freeze(context === 'widget'
    ? [...new Set([...filtered, ...WIDGET_LOCAL_ACTIONS])]
    : filtered)
}

export function getHomeV2AppHostInfo(input: {
  readonly accountId?: string | null
  readonly hostVersion: string
  readonly node: HomeV2AppNodeState
  readonly platform: HomeV2AppPlatform
  readonly platformVersion: string
  readonly protocol: HomeV2AppBridgeProtocol
}): HomeV2AppHostInfo {
  const network = getHomeV2AppNetwork(input.protocol, 'GET_HOST_INFO')
  return Object.freeze({
    hostName: 'qortium-home',
    hostVersion: input.hostVersion,
    network,
    platform: input.platform,
    platformVersion: input.platformVersion,
    protocol: input.protocol,
    route: getHomeV2AppRouteDescriptor({
      accountId: input.accountId,
      network,
      node: input.node,
      platform: input.platform,
      protocol: input.protocol,
    }),
  })
}

export function getHomeV2BridgeStateDetails(input: {
  readonly accountId?: string | null
  readonly nodes: Readonly<Record<HomeV2AppNetwork, HomeV2AppNodeState>>
  readonly platform: HomeV2AppPlatform
}): readonly HomeV2BridgeStateDetail[] {
  return Object.freeze(([
    ['qdnRequest', 'qortium'],
    ['qortalRequest', 'qortal'],
  ] as const).map(([protocol, network]) => Object.freeze({
    network,
    protocol,
    revision: getHomeV2AppRouteDescriptor({
      accountId: input.accountId,
      network,
      node: input.nodes[network],
      platform: input.platform,
      protocol,
    }).revision,
  })))
}

export type HomeV2BridgeErrorOutcome = 'rejected' | 'unknown'
export type HomeV2BridgeErrorTarget =
  | { readonly groupId: number; readonly kind: 'group' }
  | { readonly kind: 'direct'; readonly otherAddress: string }

export interface HomeV2BridgeErrorDetails {
  readonly action: string
  readonly code: string
  readonly network: HomeV2AppNetwork
  readonly outcome?: HomeV2BridgeErrorOutcome
  readonly retryable: boolean
  readonly routeRevision?: string
  readonly target?: HomeV2BridgeErrorTarget
}

export type HomeV2BridgeError = Error & HomeV2BridgeErrorDetails

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validOutcome(value: unknown): HomeV2BridgeErrorOutcome | undefined {
  return value === 'rejected' || value === 'unknown' ? value : undefined
}

function validTarget(value: unknown): HomeV2BridgeErrorTarget | undefined {
  if (!isRecord(value)) return undefined
  if (
    value.kind === 'group' &&
    typeof value.groupId === 'number' &&
    Number.isSafeInteger(value.groupId) &&
    value.groupId >= 0
  ) {
    return { groupId: value.groupId, kind: 'group' }
  }
  if (
    value.kind === 'direct' &&
    typeof value.otherAddress === 'string' &&
    value.otherAddress.length > 0 &&
    value.otherAddress.length <= 128
  ) {
    return { kind: 'direct', otherAddress: value.otherAddress }
  }
  return undefined
}

export function createHomeV2BridgeError(
  message: string,
  details: HomeV2BridgeErrorDetails,
): HomeV2BridgeError {
  return Object.assign(new Error(message), details)
}

function inferredCode(message: string) {
  const normalized = message.toLowerCase()
  if (normalized.includes('context changed')) return 'STALE_CONTEXT'
  if (normalized.includes('locked')) return 'ACCOUNT_LOCKED'
  if (
    normalized.includes('user cancelled') ||
    normalized.includes('user canceled') ||
    // Any Home prompt refusal ("Account access was denied.", "Home settings
    // update was denied.", "Opening a widget was denied.", …) is a DEFINITIVE
    // pre-broadcast "no": nothing was signed and nothing was sent. The broad
    // match replaced a narrower "approval/permission was denied" pair that
    // missed the other denial messages, letting them fall through to the
    // generic HOME_BRIDGE_ERROR — so an app could not distinguish the user
    // saying no from a mid-broadcast failure (qortium-chat journaled a denied
    // send as "outcome unknown; it may already have been sent", the opposite
    // of the truth). Apps must treat USER_CANCELLED as definitively not-sent.
    normalized.includes('was denied')
  ) return 'USER_CANCELLED'
  if (
    normalized.includes('unavailable') ||
    normalized.includes('disabled') ||
    normalized.includes('no healthy') ||
    normalized.includes('not available on android')
  ) return 'ROUTE_UNAVAILABLE'
  if (
    normalized.includes('does not expose') ||
    normalized.includes('does not advertise a compatible')
  ) return 'NODE_CAPABILITY_MISSING'
  if (
    normalized.includes('required') ||
    normalized.includes('invalid') ||
    normalized.includes('must be') ||
    normalized.includes('can only') ||
    normalized.includes('outside home v2')
  ) return 'VALIDATION_FAILED'
  return 'HOME_BRIDGE_ERROR'
}

export function normalizeHomeV2BridgeError(
  error: unknown,
  context: {
    readonly action: string
    readonly network: HomeV2AppNetwork
    readonly routeRevision?: string
  },
): HomeV2BridgeError {
  const message = error instanceof Error ? error.message : String(error)
  const record = isRecord(error) ? error : {}
  const code = typeof record.code === 'string' && record.code.trim()
    ? record.code.trim()
    : inferredCode(message)
  const retryable = record.retryable === true || code === 'USER_CANCELLED'
  const outcome = validOutcome(record.outcome)
  const target = validTarget(record.target)
  const routeRevision = typeof record.routeRevision === 'string' && record.routeRevision
    ? record.routeRevision
    : context.routeRevision
  return createHomeV2BridgeError(message, {
    action: typeof record.action === 'string' && record.action ? record.action : context.action,
    code,
    network:
      record.network === 'qortal' || record.network === 'qortium'
        ? record.network
        : context.network,
    retryable,
    ...(outcome ? { outcome } : {}),
    ...(routeRevision ? { routeRevision } : {}),
    ...(target ? { target } : {}),
  })
}

export function homeV2BridgeErrorPayload(error: unknown) {
  const record = isRecord(error) ? error : {}
  const message = error instanceof Error ? error.message : String(error)
  return {
    message,
    ...(typeof record.code === 'string' ? { code: record.code } : {}),
    ...(record.network === 'qortal' || record.network === 'qortium'
      ? { network: record.network }
      : {}),
    ...(typeof record.action === 'string' ? { action: record.action } : {}),
    ...(typeof record.retryable === 'boolean' ? { retryable: record.retryable } : {}),
    ...(validOutcome(record.outcome) ? { outcome: record.outcome } : {}),
    ...(typeof record.routeRevision === 'string'
      ? { routeRevision: record.routeRevision }
      : {}),
    ...(validTarget(record.target) ? { target: validTarget(record.target) } : {}),
  }
}
