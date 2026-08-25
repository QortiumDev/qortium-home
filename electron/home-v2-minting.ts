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

/**
 * The node-side minting surface (`/admin/mintingaccounts`, the minting fields
 * of `/admin/status`, and both write actions) is reachable ONLY through a
 * local Core that Home itself runs and holds the API key for.
 *
 * A public node is somebody else's node: its minting state is not the user's
 * to read and its admin endpoints are not the user's to write. A custom node
 * is reachable but not owned by Home, so it is treated the same way — this is
 * deliberately stricter than Home 1.x, which only excluded public nodes.
 */
export function isHomeV2TrustedMintingNode(input: {
  readonly apiKey: string
  readonly mode: string
}): boolean {
  return input.mode === 'local' && input.apiKey.length > 0
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

export function hasHomeV2MintingKeyOnNode(mintingAccounts: unknown, address: string): boolean {
  if (!Array.isArray(mintingAccounts)) return false
  return mintingAccounts.some(
    (entry) =>
      isRecord(entry) &&
      entry.mintingAccount === address &&
      entry.recipientAccount === address,
  )
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

export function createHomeV2RemoveMintingAccountResult(publicKey: string) {
  return Object.freeze({
    accepted: true as const,
    action: 'REMOVE_MINTING_ACCOUNT' as const,
    publicKey,
    removed: true as const,
  })
}
