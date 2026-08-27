// Pure derivation and sanitization for the Home 2 minting bridge actions.
//
// Everything an app is allowed to learn about minting is computed here, from
// raw node payloads, with no network or Electron access — so the rules can be
// tested directly and the bridge handler stays a thin transport around them.
//
// Two invariants this module exists to hold:
//  1. Node-side minting state (which keys the node holds, whether it can mint)
//     is reported ONLY for a trusted local node. Everywhere else those fields
//     are null, exactly as the Home 1.x implementation reported them.
//  2. Nothing derived from `/admin/mintingaccounts` is passed through
//     verbatim. Entries are rebuilt field by field from a fixed allowlist, so
//     any key material a Core build happens to serialize alongside them can
//     never reach an app.

export const HOME_V2_MINTING_READ_ACTIONS = Object.freeze([
  'GET_MINTING_STATUS',
  'LIST_MINTING_ACCOUNTS',
] as const)

export const HOME_V2_MINTING_WRITE_ACTIONS = Object.freeze([
  'START_MINTING',
  'REMOVE_MINTING_ACCOUNT',
] as const)

export type HomeV2MintingReadAction = (typeof HOME_V2_MINTING_READ_ACTIONS)[number]
export type HomeV2MintingWriteAction = (typeof HOME_V2_MINTING_WRITE_ACTIONS)[number]
export type HomeV2MintingAction = HomeV2MintingReadAction | HomeV2MintingWriteAction

const READ_ACTIONS = new Set<string>(HOME_V2_MINTING_READ_ACTIONS)
const WRITE_ACTIONS = new Set<string>(HOME_V2_MINTING_WRITE_ACTIONS)

// A node holding more minting keys than this is not a Home scenario; the cap
// exists so one hostile or broken node cannot make Home build an unbounded
// result object out of a bounded response body.
const MAX_MINTING_ACCOUNTS = 500

// Core's MintingAccountData JSON. Deliberately an allowlist: `publicKey` here
// is the reward-share PUBLIC key the node matches on when removing a minting
// account, and is the only key-shaped value an app ever receives.
const MINTING_ACCOUNT_FIELDS = Object.freeze([
  'address',
  'mintingAccount',
  'publicKey',
  'recipientAccount',
] as const)

const BASE58 = '[1-9A-HJ-NP-Za-km-z]'
const MINTING_PUBLIC_KEY_PATTERN = new RegExp(`^${BASE58}{32,64}$`)

export interface HomeV2MintingStatus {
  readonly address: string
  readonly hasRewardShare: boolean
  readonly isMinting: boolean | null
  readonly keyOnNode: boolean | null
  readonly nodeMintingPossible: boolean | null
}

export interface HomeV2MintingAccountEntry {
  readonly address: string | null
  readonly mintingAccount: string | null
  readonly publicKey: string | null
  readonly recipientAccount: string | null
}

export interface HomeV2MintingAccountsResult {
  readonly accounts: readonly HomeV2MintingAccountEntry[]
  readonly available: boolean
}

export interface HomeV2SelfRewardShare {
  readonly rewardSharePublicKey: string | null
  readonly sharePercent: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

export function isHomeV2MintingAction(action: string): action is HomeV2MintingAction {
  return READ_ACTIONS.has(action) || WRITE_ACTIONS.has(action)
}

export function isHomeV2MintingReadAction(action: string): action is HomeV2MintingReadAction {
  return READ_ACTIONS.has(action)
}

export function isHomeV2MintingWriteAction(action: string): action is HomeV2MintingWriteAction {
  return WRITE_ACTIONS.has(action)
}

export function homeV2MintingOperationLabel(action: string): string {
  return action === 'START_MINTING' ? 'Start minting' : 'Remove a minting key'
}

function isLoopbackIpv4(host: string): boolean {
  const octets = host.split('.')
  if (octets.length !== 4) return false
  if (!octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)) return false
  return octets[0] === '127'
}

/**
 * Whether a node URL points at this machine's loopback interface.
 *
 * Deliberately strict — `localhost`, 127.0.0.0/8, and `::1` only. Anything
 * else is refused, including IPv4-mapped IPv6 forms, because Home's own
 * managed Core is always reached over plain 127.0.0.1 and nothing else needs
 * to pass. Matching is on the PARSED hostname, never on a substring, so
 * `localhost.evil.com` and `127.0.0.1.evil.com` are rejected.
 */
export function isHomeV2LoopbackNodeUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value) return false
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  // WHATWG keeps the brackets on an IPv6 literal and normalizes its form, so
  // [0:0:0:0:0:0:0:1] arrives here as ::1.
  const host = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
  return host === 'localhost' || host === '::1' || isLoopbackIpv4(host)
}

/**
 * SUPERSEDED by evaluateHomeV2AdminTrust (home-v2-admin-trust.ts), which the
 * bridge now uses: administration is allowed for Home's managed Core OR for a
 * custom node the user attached their own API key to, so a self-hosted node —
 * including one reached through an SSH tunnel — is administrable from any
 * platform. This predicate remains as the loopback half of that rule and for
 * the historical record below.
 *
 * The original rule: the node-side minting surface
 * (`/admin/mintingaccounts`, the minting fields of `/admin/status`, and both
 * write actions) is reachable ONLY through a local Core that Home itself
 * runs, holds the API key for, and reaches over loopback.
 *
 * A public node is somebody else's node: its minting state is not the user's
 * to read and its admin endpoints are not the user's to write. A custom node
 * is reachable but not owned by Home, so it is treated the same way — this is
 * deliberately stricter than Home 1.x, which only excluded public nodes.
 *
 * The loopback requirement was the backstop: both the mode and the API key
 * come from Home's own settings, so a mis-set or tampered node URL could
 * otherwise send an administrative key to a remote host. (The account private
 * key no longer travels at all — the reward-share key is derived locally.)
 */
export function isHomeV2TrustedMintingNode(input: {
  readonly apiKey: string
  readonly mode: string
  readonly nodeApiUrl: unknown
}): boolean {
  return input.mode === 'local' &&
    input.apiKey.length > 0 &&
    isHomeV2LoopbackNodeUrl(input.nodeApiUrl)
}

export function buildHomeV2SelfRewardSharesPath(address: string): string {
  const encoded = encodeURIComponent(address)
  return `/addresses/rewardshares?minters=${encoded}&recipients=${encoded}`
}

/**
 * The self-share reward shares for one address. Core's filter is by query
 * parameter, so Home re-checks both sides here rather than trusting the node
 * to have honored the selectors it was given.
 */
export function selectHomeV2SelfRewardShares(
  value: unknown,
  address: string,
): readonly HomeV2SelfRewardShare[] {
  if (!Array.isArray(value)) return Object.freeze([])
  const shares: HomeV2SelfRewardShare[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    if (entry.mintingAccount !== address || entry.recipient !== address) continue
    shares.push(Object.freeze({
      rewardSharePublicKey: stringOrNull(entry.rewardSharePublicKey),
      sharePercent: typeof entry.sharePercent === 'number' ? entry.sharePercent : null,
    }))
  }
  return Object.freeze(shares)
}

function isSelfMintingAccount(entry: unknown, address: string): entry is Record<string, unknown> {
  return isRecord(entry) &&
    entry.mintingAccount === address &&
    entry.recipientAccount === address
}

export function hasHomeV2MintingKeyOnNode(mintingAccounts: unknown, address: string): boolean {
  if (!Array.isArray(mintingAccounts)) return false
  return mintingAccounts.some((entry) => isSelfMintingAccount(entry, address))
}

/**
 * The reward-share PUBLIC key the node holds for one address' own self share,
 * or null when it holds none.
 *
 * This is what REMOVE_MINTING_ACCOUNT deletes. Home resolves it here, from the
 * node's own list, rather than accepting a key from the app: Core's DELETE
 * matches a private key just as happily as a public one, so an app-supplied
 * value would be both an arbitrary-key-removal primitive and a channel for
 * routing key material through Home. The returned value is shape-checked so a
 * malformed entry cannot be echoed back to the node either.
 */
export function resolveHomeV2SelfMintingPublicKey(
  mintingAccounts: unknown,
  address: string,
): string | null {
  if (!Array.isArray(mintingAccounts)) return null
  for (const entry of mintingAccounts) {
    if (!isSelfMintingAccount(entry, address)) continue
    const publicKey = stringOrNull(entry.publicKey)
    if (publicKey && MINTING_PUBLIC_KEY_PATTERN.test(publicKey)) return publicKey
  }
  return null
}

/**
 * The complete, derived-only minting answer an app receives. No node payload
 * is forwarded: every field is a boolean (or null) computed here.
 *
 * `nodeAdmin` is null whenever the node is not a trusted local Core, which
 * yields the same all-null node-side answer Home 1.x returned for a public
 * node — the app can still see whether the on-chain authorization exists.
 */
export function deriveHomeV2MintingStatus(input: {
  readonly address: string
  readonly nodeAdmin?: {
    readonly mintingAccounts: unknown
    readonly status: unknown
  } | null
  readonly rewardShares: unknown
}): HomeV2MintingStatus {
  const hasRewardShare = selectHomeV2SelfRewardShares(input.rewardShares, input.address).length > 0
  if (!input.nodeAdmin) {
    return Object.freeze({
      address: input.address,
      hasRewardShare,
      isMinting: null,
      keyOnNode: null,
      nodeMintingPossible: null,
    })
  }
  const keyOnNode = hasHomeV2MintingKeyOnNode(input.nodeAdmin.mintingAccounts, input.address)
  return Object.freeze({
    address: input.address,
    hasRewardShare,
    isMinting: hasRewardShare && keyOnNode,
    keyOnNode,
    nodeMintingPossible:
      isRecord(input.nodeAdmin.status) && input.nodeAdmin.status.isMintingPossible === true,
  })
}

/**
 * Rebuilds each minting account from the fixed field allowlist above. Any
 * other property on the node's entry — including anything key-shaped — is
 * dropped rather than filtered, so a future Core field cannot leak by default.
 */
export function sanitizeHomeV2MintingAccounts(
  value: unknown,
): readonly HomeV2MintingAccountEntry[] {
  if (!Array.isArray(value)) return Object.freeze([])
  const accounts: HomeV2MintingAccountEntry[] = []
  for (const entry of value) {
    if (accounts.length >= MAX_MINTING_ACCOUNTS) break
    if (!isRecord(entry)) continue
    const sanitized: Record<string, string | null> = {}
    for (const field of MINTING_ACCOUNT_FIELDS) sanitized[field] = stringOrNull(entry[field])
    if (MINTING_ACCOUNT_FIELDS.every((field) => sanitized[field] === null)) continue
    accounts.push(Object.freeze(sanitized as unknown as HomeV2MintingAccountEntry))
  }
  return Object.freeze(accounts)
}

export function createHomeV2MintingAccountsResult(input: {
  readonly accounts: unknown
  readonly available: boolean
}): HomeV2MintingAccountsResult {
  return Object.freeze({
    accounts: input.available ? sanitizeHomeV2MintingAccounts(input.accounts) : Object.freeze([]),
    available: input.available,
  })
}

export function normalizeHomeV2MintingPublicKey(value: unknown): string {
  const publicKey = typeof value === 'string' ? value.trim() : ''
  // Shape check only. The node fully validates the key and answers "false"
  // when it holds no matching minting account.
  if (!MINTING_PUBLIC_KEY_PATTERN.test(publicKey)) {
    throw new Error('A minting key must be a base58-encoded public key.')
  }
  return publicKey
}

export function createHomeV2StartMintingResult(input: {
  readonly address: string
  readonly keyAdded: boolean
  readonly rewardSharePending?: boolean
  readonly transactionSignature?: string
}) {
  return Object.freeze({
    accepted: true as const,
    action: 'START_MINTING' as const,
    address: input.address,
    keyAdded: input.keyAdded,
    ...(input.rewardSharePending ? { rewardSharePending: true as const } : {}),
    ...(input.transactionSignature ? { transactionSignature: input.transactionSignature } : {}),
  })
}

/**
 * `removed: false` with a null key is the answer when the node held no
 * self-share minting key for the selected account — a no-op, not a failure,
 * and reached without calling the node at all.
 */
export function createHomeV2RemoveMintingAccountResult(input: {
  readonly address: string
  readonly publicKey: string | null
  readonly removed: boolean
}) {
  return Object.freeze({
    accepted: true as const,
    action: 'REMOVE_MINTING_ACCOUNT' as const,
    address: input.address,
    publicKey: input.publicKey,
    removed: input.removed,
  })
}
