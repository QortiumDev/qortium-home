import { walletScanStart, walletScanPromptRows, type WalletScanStart } from './wallet-scan-start.js'
import { compatibleXmrSendCore } from './xmr-send-contract.js'
import { projectWalletReadStatus, type WalletReadStatus } from './wallet-read-status.js'
/** Public XMR read contract; safe to import in the permission renderer. No key derivation here. */
export const XMR_CUSTODY_CONTRACT = 'qortium-home-xmr-custody-v1' as const
export const XMR_ACTIONS = ['GET_XMR_WALLET', 'ACTIVATE_XMR_WALLET', 'STOP_XMR_WALLET'] as const
export type XmrAction = (typeof XMR_ACTIONS)[number]
export const isXmrAction = (action: string): action is XmrAction =>
  (XMR_ACTIONS as readonly string[]).includes(action)
export const XMR_STOP_CONTRACT = 'qortium-home-xmr-stop-v1' as const
export const isXmrControlAction = (action: string) => action === 'ACTIVATE_XMR_WALLET' || action === 'STOP_XMR_WALLET'
export const xmrGrantFamily = (action: string) => action === 'STOP_XMR_WALLET' ? 'account.xmr-custody.stop' : action === 'ACTIVATE_XMR_WALLET' ? 'account.xmr-custody.activate' : 'account.xmr-custody.read'
export const XMR_PROMPT_TITLE = 'Allow XMR wallet custody on your local Core?'
export const XMR_PROMPT_SUMMARY =
  'Home will give this local Core the selected account’s XMR spending key. Core keeps an encrypted wallet and scans Monero. The app can see its receive address, balances and recent history, but receives no keys. This approval does not authorize sending XMR; sending requires separate approval. Activating another account stops the previous wallet’s scan.'
export const XMR_UNAVAILABLE =
  'XMR requires desktop Home and an enabled, supported local Core wallet.'
export function xmrPromptDetails(account: string, node: string, activate: boolean | 'stop' = true, start?: WalletScanStart) {
  return [
    { label: 'Account', value: account },
    { label: 'Coin', value: 'Monero (XMR)' },
    { label: 'Custody node', value: node },
    {
      label: 'Core access',
      value: activate === 'stop'
        ? 'Stop the selected account’s active wallet; no keys are transferred.'
        : activate
        ? 'XMR spending authority; encrypted wallet files remain on this node.'
        : 'Read the already active wallet only; no keys are transferred.',
    },
    {
      label: 'Shared with app',
      value: activate === 'stop' ? 'Stop acknowledgement only; no wallet keys or session tokens.' : 'Receive address, scan progress, balances and up to 100 recent transactions.',
    },
    {
      label: 'Scan',
      value: activate === 'stop'
        ? 'Stops background scanning and retries after any current wallet operation finishes. Saved wallet files are kept; resume requires activation.'
        : activate
        ? (start ? walletScanPromptRows(start)[0].value : 'Resume saved progress; a fresh wallet uses a conservative historical scan start.')
        : 'Does not start, stop or switch a wallet scan.',
    },
    { label: 'Not permitted', value: 'Sending, trade funding, key export or remote-node custody.' },
  ]
}
export function validateXmrRequest(action: XmrAction, request: Record<string, unknown>) {
  if (
    Object.keys(request).some(
      (key) =>
        !['action', 'coin', ...(action === 'GET_XMR_WALLET' ? ['passive'] : action === 'ACTIVATE_XMR_WALLET' ? ['scanMode', 'restoreHeight'] : [])].includes(key),
    ) ||
    (request.coin !== undefined && request.coin !== 'XMR') ||
    (request.passive !== undefined && typeof request.passive !== 'boolean') ||
    request.action !== action
  )
    throw new Error('Invalid XMR request.')
  if (action === 'ACTIVATE_XMR_WALLET') walletScanStart(request)
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
export function compatibleXmrCore(v: unknown) {
  return (
    record(v) &&
    v.protocolVersion === 1 &&
    v.derivationVersion === 1 &&
    v.decimals === 12 &&
    v.enabled === true &&
    v.platformSupported === true &&
    v.network === 'mainnet' &&
    v.localCustodyOnly === true &&
    (v.send === false || compatibleXmrSendCore(v))
  )
}
const STATES = new Set([
  'IDLE',
  'OPENING',
  'CLOSING',
  'ACTIVATION_REJECTED',
  'SCANNING',
  'READY',
  'UNAVAILABLE',
  'STALE',
  'RESTART_REQUIRED',
  'STOPPED',
])
export function parseXmrSession(v: unknown) {
  if (
    !record(v) ||
    !(
      v.sessionId === null ||
      (typeof v.sessionId === 'string' &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.sessionId))
    ) ||
    !(
      v.walletId === null ||
      (typeof v.walletId === 'string' && /^[a-f0-9]{64}$/.test(v.walletId))
    ) ||
    !STATES.has(String(v.state))
  )
    throw new Error('XMR session could not be verified.')
  return {
    sessionId: v.sessionId as string | null,
    walletId: v.walletId as string | null,
    state: v.state as string,
    errorCode:
      ['XMR_RESTORE_HEIGHT_ABOVE_TIP', 'XMR_DAEMON_UNAVAILABLE', 'XMR_EXISTING_WALLET', 'XMR_RESTORE_HEIGHT_MISMATCH'].includes(String(v.errorCode))
        ? v.errorCode
        : null,
  }
}
const boundedInteger = (v: unknown, max = 500_000_000): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max
const atomic = (v: unknown) => {
  if (v === null) return null
  if (
    typeof v !== 'string' ||
    !/^(0|[1-9][0-9]{0,19})$/.test(v) ||
    BigInt(v) > 18446744073709551615n
  )
    throw new Error('XMR atomic amount could not be verified.')
  return v
}
export type XmrTransaction = {
  txid: string
  timestamp: number | null
  height: number | null
  confirmed: boolean
  incomingAtomic: string | null
  outgoingAtomic: string | null
  feeAtomic: string | null
}
export type XmrScanProgress = {
  scanId: string
  startHeight: number
  height: number
  targetHeight: number
  updatedAt: number
}
export type XmrPublicWallet = {
  contract: typeof XMR_CUSTODY_CONTRACT
  state: string
  send: false
  updatedAt: number | null
  progress: XmrScanProgress | null
  preparation?: XmrScanProgress
  scanStart?: { mode: string; height: number }
  scanStartError?: string
  read?: WalletReadStatus
  wallet: null | {
    address: string
    height: number
    targetHeight: number
    synced: boolean
    balanceAtomic: string | null
    unlockedAtomic: string | null
    transactions: XmrTransaction[]
  }
}
export const inactiveXmrWallet = (state = 'INACTIVE'): XmrPublicWallet => ({
  contract: XMR_CUSTODY_CONTRACT,
  state,
  send: false,
  updatedAt: null,
  progress: null,
  wallet: null,
})
/** Allowlist projection: Core session authority, wallet ids, extra fields and error text never reach QDN. */
export function projectXmrWallet(v: unknown, session: string, walletId: string): XmrPublicWallet {
  if (
    !record(v) ||
    v.sessionId !== session ||
    v.walletId !== walletId ||
    v.send !== false ||
    !STATES.has(String(v.state)) ||
    !(v.updatedAt === null || boundedInteger(v.updatedAt, 8_640_000_000_000_000))
  )
    throw new Error('XMR wallet ownership could not be verified.')
  const result = inactiveXmrWallet(v.state as string)
  result.updatedAt = v.updatedAt as number | null
  const read = projectWalletReadStatus(v.read)
  if (read) result.read = read
  // Optional for older Core versions. No raw session or wallet authority is projected.
  if (v.progress != null) {
    const p = v.progress
    if (!record(p) || typeof p.scanId !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(p.scanId) ||
        !boundedInteger(p.startHeight) || !boundedInteger(p.height) ||
        !boundedInteger(p.targetHeight) || p.targetHeight <= 0 ||
        p.startHeight > p.height || p.height > p.targetHeight ||
        !boundedInteger(p.updatedAt, 8_640_000_000_000_000))
      throw new Error('XMR scan progress could not be verified.')
    result.progress = { scanId: p.scanId, startHeight: p.startHeight, height: p.height,
      targetHeight: p.targetHeight, updatedAt: p.updatedAt }
  }
  if (v.restoreHeight != null) {
    if (!boundedInteger(v.restoreHeight) || typeof v.initializationMode !== 'string' || !['RESUME', 'RESTORE_FROM_HEIGHT', 'NEW_AT_CURRENT_TIP'].includes(String(v.initializationMode)))
      throw new Error('Invalid wallet scan start metadata.')
    result.scanStart = { mode: String(v.initializationMode), height: v.restoreHeight }
  }
  if (v.preparation != null) {
    const p = v.preparation
    if (!record(p) || typeof p.scanId !== 'string' || !/^[a-f0-9-]{36}$/.test(p.scanId) ||
        !boundedInteger(p.startHeight) || !boundedInteger(p.height) || !boundedInteger(p.targetHeight) ||
        p.startHeight > p.height || p.height >= p.targetHeight || !boundedInteger(p.updatedAt, 8_640_000_000_000_000))
      throw new Error('Invalid chain preparation progress.')
    result.preparation = { scanId: p.scanId, startHeight: p.startHeight, height: p.height, targetHeight: p.targetHeight, updatedAt: p.updatedAt }
  }
  if (v.wallet === null) return result
  const w = v.wallet
  if (
    !record(w) ||
    typeof w.address !== 'string' ||
    !/^4[1-9A-HJ-NP-Za-km-z]{94}$/.test(w.address) ||
    !boundedInteger(w.height) ||
    !boundedInteger(w.targetHeight) ||
    typeof w.synced !== 'boolean' ||
    !Array.isArray(w.transactions) ||
    w.transactions.length > 100
  )
    throw new Error('XMR wallet response could not be verified.')
  const transactions = w.transactions
    .map((tx): XmrTransaction => {
      if (
        !record(tx) ||
        typeof tx.txid !== 'string' ||
        !/^[a-f0-9]{64}$/.test(tx.txid) ||
        typeof tx.confirmed !== 'boolean' ||
        !(tx.timestamp === null || boundedInteger(tx.timestamp, 8_640_000_000_000)) ||
        !(tx.height === null || boundedInteger(tx.height))
      )
        throw new Error('XMR history could not be verified.')
      return {
        txid: tx.txid,
        timestamp: tx.timestamp as number | null,
        height: tx.height as number | null,
        confirmed: tx.confirmed,
        incomingAtomic: atomic(tx.incomingAtomic),
        outgoingAtomic: atomic(tx.outgoingAtomic),
        feeAtomic: atomic(tx.feeAtomic),
      }
    })
    .sort((a, b) => (b.timestamp ?? -1) - (a.timestamp ?? -1) || a.txid.localeCompare(b.txid))
  if (new Set(transactions.map((tx) => tx.txid)).size !== transactions.length)
    throw new Error('Duplicate XMR transaction.')
  result.wallet = {
    address: w.address,
    height: w.height,
    targetHeight: w.targetHeight,
    synced: w.synced,
    balanceAtomic: atomic(w.balanceAtomic),
    unlockedAtomic: atomic(w.unlockedAtomic),
    transactions,
  }
  return result
}

/** Generic node reads must never bypass the dedicated custody bridge. */
export function assertNotXmrCustodyPath(input: string) {
  let value = input.split('?')[0]
  for (let depth = 0; depth < 8; depth++) {
    const canonical = new URL(value, 'https://home.invalid').pathname
      .toLowerCase()
      .replace(/\\/g, '/')
      .split('/')
      .map((segment) => segment.split(';')[0])
      .filter(Boolean)
      .join('/')
    if (/^crosschain\/(?:xmr|wallets\/xmr)(?:\/|$)/.test(canonical))
      throw new Error('XMR custody requires its dedicated wallet action.')
    let decoded: string
    try {
      decoded = decodeURIComponent(value)
    } catch {
      throw new Error('Invalid encoded node API path.')
    }
    if (decoded === value) return
    value = decoded
  }
  throw new Error('Excessively encoded node API path.')
}

export function isNumericLoopbackXmrUrl(value: string) {
  try {
    const url = new URL(value)
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      ['127.0.0.1', '[::1]'].includes(url.hostname) &&
      !url.search &&
      !url.hash &&
      url.pathname === '/'
    )
  } catch {
    return false
  }
}
