import {
  normalizeForeignWalletCoin,
  type ForeignWalletCoin,
} from './foreign-wallets.js'

export const HOME_V2_FOREIGN_WALLET_READ_ACTIONS = Object.freeze([
  'GET_WALLET_BALANCE',
  'GET_USER_WALLET_INFO',
  'GET_USER_WALLET_TRANSACTIONS',
] as const)

export const HOME_V2_FOREIGN_WALLET_ADMIN_ACTIONS = Object.freeze([
  'SET_CURRENT_FOREIGN_SERVER',
] as const)

const READ_ACTIONS = new Set<string>(HOME_V2_FOREIGN_WALLET_READ_ACTIONS)
const ADMIN_ACTIONS = new Set<string>(HOME_V2_FOREIGN_WALLET_ADMIN_ACTIONS)

export function isHomeV2ForeignWalletReadAction(action: string) {
  return READ_ACTIONS.has(action)
}

export function isHomeV2ForeignWalletAdminAction(action: string) {
  return ADMIN_ACTIONS.has(action)
}

export function isHomeV2TrustedForeignWalletRoute(
  route: Readonly<{
    adminTrusted: boolean
    reachable: boolean
  }>,
) {
  return route.reachable && route.adminTrusted
}

export const HOME_V2_FOREIGN_WALLET_LOCAL_ROUTE_LABEL = 'Home local wallet'

export const HOME_V2_ROUTE_INDEPENDENT_GRANT_ROUTE = 'route-independent'

export type HomeV2ForeignWalletReadConsentBinding = Readonly<{
  /**
   * The exact node-route string the session grant is keyed on and the
   * post-approval recheck compares against: the resolved admin node's
   * `${mode}|${nodeApiUrl}`, or 'route-independent' for the local fallback.
   * One value feeds the prompt label, the grant key and the recheck, so the
   * user can never approve one route while the grant is stored under another.
   */
  nodeRoute: string
  operationLabel: string
  /**
   * True only for the receive-only GET_USER_WALLET derivation when no trusted
   * Qortium node resolved. The bridge then keys the session grant on
   * 'route-independent' instead of a node route, so address derivation keeps
   * working without a Core (the balance reads fail without one anyway).
   */
  routeIndependent: boolean
  routeLabel: string
}>

/**
 * How one of the four foreign-wallet reads binds its consent prompt and
 * session grant to a node route.
 *
 * The four actions share one grant family (account.foreign-wallet.read), but
 * a grant is only reused when its key matches — and the key includes the node
 * route. GET_USER_WALLET derives address/xpub locally and used to bind to a
 * fixed 'Home local wallet' pseudo-route while the balance, address-info and
 * history reads bound to the trusted Core's route, so a wallet app that
 * opened its receive address and then its balance raised TWO prompts for
 * what the user sees as one decision (owner decision 2026-09-20: one
 * consent). When a trusted Qortium node has resolved, every read — the
 * receive-only derivation included — binds to that same route and label, so
 * one "for this tab" approval covers all four. Only when NO trusted node
 * resolves does the receive-only read fall back to a route-independent grant
 * with the local-wallet label.
 */
export function homeV2ForeignWalletReadConsentBinding(input: {
  readonly action: string
  /**
   * The resolved, admin-trusted Qortium node (resolveHomeV2AdminNode), or
   * null when none resolved. `nodeRoute` is its `${mode}|${nodeApiUrl}`.
   */
  readonly adminNode: Readonly<{ nodeApiUrl: string; nodeRoute: string }> | null
}): HomeV2ForeignWalletReadConsentBinding {
  const receiveOnly = input.action === 'GET_USER_WALLET'
  if (!receiveOnly && !isHomeV2ForeignWalletReadAction(input.action)) {
    throw new Error(`${input.action} is not a foreign wallet read.`)
  }
  if (input.adminNode) {
    if (!input.adminNode.nodeApiUrl || !input.adminNode.nodeRoute) {
      throw new Error('A trusted node binding needs its API URL and route.')
    }
    return Object.freeze({
      nodeRoute: input.adminNode.nodeRoute,
      operationLabel: 'Read foreign wallet',
      routeIndependent: false,
      routeLabel: input.adminNode.nodeApiUrl,
    })
  }
  if (!receiveOnly) {
    throw new Error(`${input.action} requires an authenticated Qortium node.`)
  }
  return Object.freeze({
    nodeRoute: HOME_V2_ROUTE_INDEPENDENT_GRANT_ROUTE,
    operationLabel: 'Read foreign receive wallet',
    routeIndependent: true,
    routeLabel: HOME_V2_FOREIGN_WALLET_LOCAL_ROUTE_LABEL,
  })
}

export function normalizeHomeV2ForeignWalletCoin(
  request: Record<string, unknown>,
): ForeignWalletCoin {
  const payload = isRecord(request.payload) ? request.payload : request
  return normalizeForeignWalletCoin(
    payload.coin ?? payload.blockchain ?? request.coin ?? request.blockchain,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function integerValue(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim())
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

export type HomeV2ForeignServerRequest = Readonly<{
  certificateSha256Fingerprint?: string
  connectionType: 'SSL' | 'TCP'
  hostName: string
  port: number
}>

/** Home 1.x-compatible input aliases, normalized to Core's exact DTO. */
export function normalizeHomeV2ForeignServerRequest(
  request: Record<string, unknown>,
): HomeV2ForeignServerRequest {
  const payload = isRecord(request.payload) ? request.payload : request
  const server = isRecord(payload.server)
    ? payload.server
    : isRecord(request.server)
      ? request.server
      : payload
  const hostName = stringValue(server.hostName) ||
    stringValue(server.hostname) ||
    stringValue(server.host)
  const port = integerValue(server.port)
  const connectionType = (
    stringValue(server.connectionType) ||
    stringValue(server.type) ||
    stringValue(server.connection)
  ).toUpperCase()
  const certificateSha256Fingerprint = stringValue(server.certificateSha256Fingerprint) ||
    stringValue(server.certificate) ||
    stringValue(server.sslCertificate)

  if (!hostName) throw new Error('Foreign server host is required.')
  if (hostName.length > 253 || /[\s/\\]/.test(hostName)) {
    throw new Error('Foreign server host is invalid.')
  }
  if (port === null || port <= 0 || port > 65_535) {
    throw new Error('Foreign server port must be a valid TCP port.')
  }
  if (connectionType !== 'SSL' && connectionType !== 'TCP') {
    throw new Error('Foreign server connection type must be SSL or TCP.')
  }
  if (
    certificateSha256Fingerprint &&
    !/^(?:[a-fA-F0-9]{64}|(?:[a-fA-F0-9]{2}:){31}[a-fA-F0-9]{2})$/.test(certificateSha256Fingerprint)
  ) {
    throw new Error('Foreign server certificate fingerprint must be a SHA-256 fingerprint.')
  }

  return Object.freeze({
    ...(certificateSha256Fingerprint ? { certificateSha256Fingerprint } : {}),
    connectionType,
    hostName,
    port,
  } as HomeV2ForeignServerRequest)
}
