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
  'GET_PENDING_TRANSACTIONS',
  'IS_USING_PUBLIC_NODE',
  'NOTIFICATION_HAS_PERMISSION',
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
    action === 'GET_USER_ACCOUNT'
  )
}

export function getHomeV2ContextualAppActions(
  availableActions: readonly string[],
  context: 'android' | 'tab' | 'widget',
): readonly string[] {
  const filtered = availableActions.filter((action) => {
    if (context === 'widget') return action !== 'OPEN_AS_WIDGET' && isWidgetPublicReadAction(action)
    if (context === 'android') return action !== 'OPEN_AS_WIDGET' && !WIDGET_LOCAL_ACTIONS.has(action)
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
    normalized.includes('approval was denied') ||
    normalized.includes('permission was denied')
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
