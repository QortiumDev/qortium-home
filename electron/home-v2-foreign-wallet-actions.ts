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
