import {
  getHomeV2AppActions,
  getHomeV2AppNetwork,
  type HomeV2AppBridgeProtocol,
  type HomeV2AppNetwork,
} from './home-v2-app-actions.js'

export type HomeV2AppPlatform = 'android' | 'desktop'
export type HomeV2ConfiguredRouteKind =
  | 'custom-authenticated'
  | 'custom-unauthenticated'
  | 'disabled'
  | 'local'
  | 'public'

export interface HomeV2AppNodeState {
  readonly capabilities: { readonly read: boolean }
  readonly customAuthenticated?: boolean
  readonly customConfigured: boolean
  readonly error?: string | null
  readonly mode: 'custom' | 'disabled' | 'local' | 'public'
  readonly nodeApiUrl: string | null
}

export interface HomeV2AppRouteDescriptor {
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
  const effectiveKind = available && configuredKind !== 'disabled' ? configuredKind : null
  const revision = routeRevision([
    input.platform,
    input.protocol,
    input.network,
    configuredKind,
    effectiveKind ?? 'none',
    available ? 'available' : 'unavailable',
    reachable ? 'reachable' : 'unreachable',
    input.node.nodeApiUrl ?? 'none',
    input.accountId ?? 'none',
  ].join('|'))
  return Object.freeze({
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
 * Actions the Android host advertises in the desktop catalogue but cannot
 * actually run, so they are filtered out of Android's SHOW_ACTIONS.
 *
 * SEND_MESSAGE signs a transaction, and Android has no signing path (the
 * portable node client is read-only plus a few Home-mediated actions). Leaving
 * it in SHOW_ACTIONS would make the result LIE: an app would try it and hit a
 * rejection. The one signing action goes here; the portable client also
 * rejects it explicitly (node-client.ts) as defense in depth.
 *
 * UNLOCK_SELECTED_ACCOUNT is deliberately NOT here: unlocking is a Home-account
 * operation with no chain semantics, the Android host DOES implement it, and
 * the legacy wallet reaches it through qortalRequest — so it stays advertised
 * on Android on both protocols.
 */
const ANDROID_UNSUPPORTED_ACTIONS = new Set<string>([
  'SEND_MESSAGE',
  // The list family administers a node. Home now allows that for any node the
  // user attached their own API key to (evaluateHomeV2AdminTrust), so this is
  // no longer a platform rule — the Android arm that builds the approval
  // prompt simply is not implemented yet, and SHOW_ACTIONS must not advertise
  // what cannot run. Removing these four is parity-wave work, not a policy
  // change. The portable client refuses direct calls for the same stated
  // reason as defense in depth.
  'GET_ALL_LISTS',
  'GET_LIST',
  'ADD_TO_LIST',
  'REMOVE_FROM_LIST',
  // Poll writes sign transactions, and Android has no signing path — the same
  // reason SEND_MESSAGE is here. The generic portable-client refusal names
  // signing, which is exactly the reason, so no special arm is needed.
  'CREATE_POLL',
  'UPDATE_POLL',
  'VOTE_ON_POLL',
  // The name writes sign too (and BUY_NAME pays); same reason.
  'BUY_NAME',
  'CANCEL_SELL_NAME',
  'REGISTER_NAME',
  'SELL_NAME',
  'UPDATE_NAME',
  // And the group mutations.
  'CREATE_GROUP',
  'GROUP_APPROVAL',
  'SET_GROUP',
  'SET_GROUP_AVATAR',
  'UPDATE_GROUP',
  // The publishing extras sign transactions through the desktop bridge's
  // source-token and tombstone flows, neither of which the Android host
  // implements — unlike single PUBLISH_QDN_RESOURCE, which it mediates.
  'DELETE_QDN_RESOURCE',
  'PUBLISH_MULTIPLE_QDN_RESOURCES',
  // The rating writes sign transactions too; same reason.
  'RATE_ACCOUNT',
  'RATE_RESOURCE',
  // And the account avatar pointer.
  'SET_ACCOUNT_AVATAR',
  // The payment family MOVES FUNDS and stays desktop-only until an
  // independently reviewed Android signing path exists.
  'PAYMENT',
  'SEND_COIN',
  'SEND_QORT',
  'TRANSFER_ASSET',
])

export function isHomeV2AndroidUnsupportedAction(action: string) {
  return ANDROID_UNSUPPORTED_ACTIONS.has(action)
}

export function getHomeV2ContextualAppActions(
  availableActions: readonly string[],
  context: 'android' | 'tab' | 'widget',
): readonly string[] {
  const filtered = availableActions.filter((action) => {
    if (context === 'widget') return action !== 'OPEN_AS_WIDGET' && isWidgetPublicReadAction(action)
    if (context === 'android') {
      return action !== 'OPEN_AS_WIDGET' &&
        !WIDGET_LOCAL_ACTIONS.has(action) &&
        !ANDROID_UNSUPPORTED_ACTIONS.has(action)
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
