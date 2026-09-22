// Home 2 desktop ARRR custody read adapter — contract tests.
//
// Covers the pure module (electron/arrr-custody.ts) end to end with a mocked
// transport, the capability projection, the consent family, the runtime
// advertising/Android/widget rules, and the bridge-source invariants that
// keep the entropy inside the privileged process.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ARRR_CUSTODY_CONTRACT,
  ARRR_CUSTODY_RUNTIME,
  ARRR_READ_SUPERSEDED_CODE,
  ARRR_SYNC_CONTRACT_UNSUPPORTED_CODE,
  ARRR_VERIFIED_BALANCE_UNAVAILABLE_CODE,
  ARRR_WALLET_BUSY_CODE,
  ARRR_WALLET_BUSY_MESSAGE,
  HOME_V2_ARRR_ANDROID_UNAVAILABLE_REASON,
  HOME_V2_ARRR_CUSTODY_GRANT_FAMILY,
  HOME_V2_ARRR_CUSTODY_PROMPT_TITLE,
  HOME_V2_ARRR_CUSTODY_READ_ACTIONS,
  HOME_V2_ARRR_LOCKED_ACCOUNT_REASON,
  HOME_V2_ARRR_SYNC_STATUS_ACTION,
  HOME_V2_ARRR_UNTRUSTED_ROUTE_REASON,
  ARRR_READ_BACKLOG_CODE,
  ARRR_READ_BACKLOG_LIMIT,
  ARRR_READ_CANCELLED_CODE,
  base58EncodeOwned,
  base58ScratchLength,
  buildArrrCustodyReadRequest,
  projectArrrTransactions,
  classifyArrrCustodyFailure,
  createArrrCustodyReadQueue,
  executeArrrCustodyRead,
  homeV2ArrrBalanceVerified,
  homeV2ArrrCustodyConsentBinding,
  homeV2ArrrCustodyPromptDetails,
  homeV2ArrrCustodyPromptSummary,
  isArrrCustodyError,
  isHomeV2ArrrCustodyRequest,
  parseArrrSyncSnapshot,
  scrubArrrEntropy,
  withArrrEntropy58,
  type ArrrCustodyReadRequest,
  type ArrrCustodyResponse,
} from './arrr-custody.js'
import { base58Decode, base58Encode } from './base58.js'
import {
  ARRR_CUSTODY_CONTEXT_CHANGED_MESSAGE,
  ARRR_CUSTODY_ROUTE_CHANGED_MESSAGE,
  adminTrustUnchangedAcrossAwait,
  arrrCustodyBridgeErrorDetails,
  arrrCustodyCancelsQueuedRead,
  createArrrCustodyNodeCrypto,
  projectArrrCustodyRoute,
  runHomeV2ArrrCustodyRead,
  type ArrrCustodyReadDeps,
  type ArrrCustodyRoute,
} from './home-v2-arrr-custody-read.js'
import { encodeQdnBridgeError } from './qdn-bridge-error.js'
import { createHomeV2BridgeError } from './home-v2-app-runtime.js'
import { createHomeV2SessionGrantStore } from './home-v2-session-grants.js'
import {
  buildForeignWalletReadRequest,
  executeForeignWalletRead,
  isArrrCustodyRuntime,
} from './foreign-wallet-read-contract.js'
import { deriveForeignWalletPublicRuntime, getForeignWalletCoins } from './foreign-wallets.js'
import { getHomeWalletCapability } from './qdn-wallet-capabilities.js'
import { projectHomeV2CrosschainReadResult } from './home-v2-crosschain-actions.js'
import {
  homeV2ForeignWalletReadConsentBinding,
  isHomeV2ForeignWalletReadAction,
} from './home-v2-foreign-wallet-actions.js'
import {
  homeV2PermissionGrantFamily,
  homeV2PermissionGrantKey,
  isHomeV2PermissionlessAction,
} from './home-v2-session-grants.js'
import { getHomeV2AppActions } from './home-v2-app-actions.js'
import {
  getHomeV2AppHostInfo,
  getHomeV2AvailableAppActions,
  getHomeV2ContextualAppActions,
  homeV2AndroidActionRefusal,
  isHomeV2AndroidUnsupportedAction,
} from './home-v2-app-runtime.js'

const here = path.dirname(fileURLToPath(import.meta.url))
function readRepoSource(fromDist: string, fromSource: string) {
  const candidates = [path.resolve(here, fromDist), path.resolve(here, fromSource)]
  const found = candidates.find((candidate) => existsSync(candidate))
  assert.ok(found, `source not found: ${candidates.join(', ')}`)
  return readFileSync(found, 'utf8')
}
function sliceAfter(source: string, marker: string, length: number, label: string) {
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `${label}: could not find ${marker}`)
  return source.slice(start, start + length)
}

// A rejection that is asserted only after a later await must already have a
// handler, or Node reports it as unhandled before the assertion runs.
function observed<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined)
  return promise
}

const crypto = {
  sha256: (data: Uint8Array) => Uint8Array.from(createHash('sha256').update(data).digest()),
  sha512: (data: Uint8Array) => Uint8Array.from(createHash('sha512').update(data).digest()),
}

// ---------------------------------------------------------------------------
// 1. Derivation vectors (Hub-compatible)
//
// Fixed seeds → the entropy58 the implementation produces (pinned), and a
// SECOND computation written independently below from the Hub reading
// (phrase-wallet.ts genAddress/_genAddressSeed, AltcoinHDWallet.ts
// generateSeedHash/generatePrivateKey, utils.ts int32ToBytes) with node:crypto
// and a BigInt Base58, which must agree byte for byte.

const SEED_32 = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const SEED_64 = Uint8Array.from({ length: 64 }, (_, index) => (index * 7 + 3) & 0xff)

const PINNED_VECTORS = [
  { entropy58: '9joN5p4M7qEBHYYiaq2mU7NV698N1q3Jwx4A9YSQhxXY', nonce: 0, seed: SEED_32, walletVersion: 2 },
  { entropy58: '7LRGtxdMHLiog9Qiv2uQCD8VswR6Vb7J9vzKPRXa9sRG', nonce: 3, seed: SEED_32, walletVersion: 2 },
  { entropy58: '7BfkcP3n8fwGCRjXYavWWQTztrfgwZvwsigjhp6hfDiT', nonce: 0, seed: SEED_32, walletVersion: 1 },
  { entropy58: 'FezpFrCJYEeDHkssM5iT86JqxFTFTBrVCFLhQEjDNnkZ', nonce: 5, seed: SEED_64, walletVersion: 1 },
  { entropy58: '3VUSn6gpvuvutgwGkNE3RkkcuyBYZbhLE7FYdoMwev9d', nonce: 1, seed: SEED_64, walletVersion: 2 },
] as const

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function independentBase58(bytes: Uint8Array) {
  let value = 0n
  for (const byte of bytes) value = value * 256n + BigInt(byte)
  let out = ''
  while (value > 0n) {
    out = BASE58[Number(value % 58n)] + out
    value /= 58n
  }
  for (const byte of bytes) {
    if (byte !== 0) break
    out = '1' + out
  }
  return out
}
function independentHubEntropy58(seed: Uint8Array, nonce: number, walletVersion: number) {
  const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest()
  const sha512 = (data: Uint8Array) => createHash('sha512').update(data).digest()
  // utils.int32ToBytes: big-endian 32-bit
  const nonceBytes = Buffer.from([(nonce >>> 24) & 0xff, (nonce >>> 16) & 0xff, (nonce >>> 8) & 0xff, nonce & 0xff])
  // genAddress: addrSeed = nonce ‖ byteSeed ‖ nonce; v1 → byteSeed itself,
  // else _genAddressSeed(addrSeed).slice(0, 32) where _genAddressSeed(s) =
  // SHA512(SHA512(s) ‖ s)
  const addrSeedMaterial = Buffer.concat([nonceBytes, Buffer.from(seed), nonceBytes])
  const addrSeed = walletVersion === 1
    ? Buffer.from(seed)
    : sha512(Buffer.concat([sha512(addrSeedMaterial), addrSeedMaterial])).subarray(0, 32)
  // AltcoinHDWallet.generateSeedHash(seed, false, 'ARRR'): buffer =
  // seed.reverse() ‖ UTF8('ARRR')  (reverse() MUTATES seed, so the second
  // stage's `seed` is the reversed copy too); seedHash = SHA512(seed ‖ SHA256(buffer))
  const reversed = Buffer.from(addrSeed).reverse()
  const reverseSeedHash = sha256(Buffer.concat([reversed, Buffer.from('ARRR', 'utf8')]))
  const seedHash = sha512(Buffer.concat([reversed, reverseSeedHash]))
  // generatePrivateKey: seed58 = Base58.encode(seedHash.slice(0, 32)) — BEFORE
  // the secp256k1 modular reduction.
  return independentBase58(Uint8Array.from(seedHash.subarray(0, 32)))
}

for (const vector of PINNED_VECTORS) {
  const seedBefore = Uint8Array.from(vector.seed)
  const produced = withArrrEntropy58(
    { crypto, nonce: vector.nonce, seed: vector.seed, walletVersion: vector.walletVersion },
    (entropy58) => entropy58,
  )
  assert.equal(produced, vector.entropy58, `pinned vector v${vector.walletVersion} n${vector.nonce}`)
  assert.equal(
    independentHubEntropy58(vector.seed, vector.nonce, vector.walletVersion),
    vector.entropy58,
    `independent Hub computation v${vector.walletVersion} n${vector.nonce}`,
  )
  assert.equal(base58Decode(produced).byteLength, 32, 'entropy is 32 raw bytes, no checksum')
  // The caller's seed is copied, never mutated (Hub's reverse() mutates ITS copy).
  assert.deepEqual(vector.seed, seedBefore, 'the supplied seed is left intact for the caller to zero')
}
// Version 1 uses the WHOLE seed, exactly as Hub assigns `this._byteSeed`: a
// 64-byte v1 seed is not silently truncated to its first 32 bytes.
{
  const whole = withArrrEntropy58({ crypto, nonce: 5, seed: SEED_64, walletVersion: 1 }, (e) => e)
  const truncated = withArrrEntropy58({ crypto, nonce: 5, seed: SEED_64.slice(0, 32), walletVersion: 1 }, (e) => e)
  assert.notEqual(whole, truncated, 'a version-1 seed longer than 32 bytes is used whole')
  assert.equal(whole, independentHubEntropy58(SEED_64, 5, 1))
}
// Index and version both change the answer; v1 ignores the index (Hub: the
// byte seed IS the account seed for a version-1 wallet).
assert.notEqual(
  withArrrEntropy58({ crypto, nonce: 0, seed: SEED_32, walletVersion: 2 }, (e) => e),
  withArrrEntropy58({ crypto, nonce: 1, seed: SEED_32, walletVersion: 2 }, (e) => e),
)
assert.equal(
  withArrrEntropy58({ crypto, nonce: 0, seed: SEED_32, walletVersion: 1 }, (e) => e),
  withArrrEntropy58({ crypto, nonce: 9, seed: SEED_32, walletVersion: 1 }, (e) => e),
)
// The callback's return value is the only thing that leaves; the buffers
// handed to the hash functions are zeroed once it returns.
{
  const seen: Uint8Array[] = []
  const observing = {
    sha256: (data: Uint8Array) => { seen.push(data); return crypto.sha256(data) },
    sha512: (data: Uint8Array) => { seen.push(data); return crypto.sha512(data) },
  }
  const result = withArrrEntropy58({ crypto: observing, nonce: 0, seed: SEED_32, walletVersion: 2 }, () => 'done')
  assert.equal(result, 'done')
  assert.ok(seen.length >= 4)
  for (const buffer of seen) assert.ok(buffer.every((byte) => byte === 0), 'every hashed intermediate is zeroed in finally')
}
// The finally runs even when the callback throws, and a rejected promise
// from an async callback is passed through.
assert.throws(() => withArrrEntropy58({ crypto, nonce: 0, seed: SEED_32, walletVersion: 2 }, () => { throw new Error('boom') }), /boom/)
assert.throws(() => withArrrEntropy58({ crypto, nonce: -1, seed: SEED_32, walletVersion: 2 }, (e) => e), /account index/)
assert.throws(() => withArrrEntropy58({ crypto, nonce: 0, seed: SEED_32, walletVersion: 0 }, (e) => e), /wallet version/)
assert.throws(() => withArrrEntropy58({ crypto, nonce: 0, seed: new Uint8Array(0), walletVersion: 2 }, (e) => e), /seed/)

// The eight bitcoiny vectors are untouched by the ARRR work: their runtime
// still derives from the same seed and shares nothing with the ARRR entropy.
for (const coin of getForeignWalletCoins()) {
  const runtime = deriveForeignWalletPublicRuntime({ coin, crypto: { ...crypto, ripemd160: (d) => Uint8Array.from(createHash('ripemd160').update(d).digest()) }, nonce: 0, seed: SEED_32, walletVersion: 2 })
  assert.equal(runtime.coin, coin)
  assert.ok(runtime.xpub58.length > 0)
  assert.notEqual(runtime.xpub58, PINNED_VECTORS[0].entropy58)
}

// ---------------------------------------------------------------------------
// 2. The ARRR runtime kind never carries an xpub

assert.equal(ARRR_CUSTODY_RUNTIME.kind, 'arrr-custody')
assert.equal(ARRR_CUSTODY_RUNTIME.coin, 'ARRR')
assert.equal(ARRR_CUSTODY_RUNTIME.contract, ARRR_CUSTODY_CONTRACT)
for (const forbidden of ['xpub58', 'xprv58', 'publicKey', 'publickey', 'address', 'entropy58', 'entropy', 'seed']) {
  assert.ok(!(forbidden in ARRR_CUSTODY_RUNTIME), `ARRR runtime must not carry ${forbidden}`)
}
assert.ok(Object.isFrozen(ARRR_CUSTODY_RUNTIME))
assert.equal(isArrrCustodyRuntime(ARRR_CUSTODY_RUNTIME), true)
assert.equal(isArrrCustodyRuntime({ address: 'a', coin: 'BTC', publicKey: 'x', xpub58: 'x' }), false)
// The xpub request builder refuses the ARRR runtime outright — it cannot
// fabricate an xpub because the type has none.
assert.throws(() => buildForeignWalletReadRequest(ARRR_CUSTODY_RUNTIME, 'walletbalance'), /no extended public key/)
await assert.rejects(
  executeForeignWalletRead(ARRR_CUSTODY_RUNTIME, 'walletbalance', async () => 'never'),
  /no extended public key/,
)

// ---------------------------------------------------------------------------
// 3. Capability projection

const available = getHomeWalletCapability('ARRR', false, false, false, { available: true })
assert.equal(available.implemented, true)
assert.equal(available.protocol, 'qdnRequest')
assert.equal(available.read, true)
assert.equal(available.readMode, 'TRUSTED_CORE_CUSTODY')
assert.equal(available.receive, true)
assert.equal(available.receiveMode, 'TRUSTED_CORE_CUSTODY')
assert.equal(available.requiresUnlockedAccount, true)
assert.equal(available.send, false)
assert.equal(available.sendMode, 'NONE')
assert.equal(available.serverManagement, false)
assert.equal(available.serverManagementMode, 'NONE')
assert.equal(available.syncStatus, true)
assert.equal(available.syncControlContract, 'qortium-home-arrr-sync-control-v1')
assert.equal(getHomeWalletCapability('ARRR').syncControlContract, undefined)
assert.equal(getHomeWalletCapability('BTC', true).syncControlContract, undefined)
assert.equal(available.custodyContract, ARRR_CUSTODY_CONTRACT)
assert.equal(available.unavailableReason, undefined)
// The bitcoiny flags never make ARRR available, and "send" can never be
// requested into it.
for (const flags of [[true, true, true], [true, false, true], [false, true, false]] as const) {
  const row = getHomeWalletCapability('ARRR', ...flags)
  assert.equal(row.read, false)
  assert.equal(row.receive, false)
  assert.equal(row.send, false)
  assert.equal(row.sendMode, 'NONE')
  assert.equal(row.syncStatus, false)
  assert.equal(typeof row.unavailableReason, 'string')
}
// Untrusted route and Android report their reasons; the bitcoiny rows carry
// none of the custody fields.
{
  const untrusted = projectHomeV2CrosschainReadResult(
    'GET_CROSSCHAIN_BLOCKCHAINS', {}, [{ currencyCode: 'ARRR' }, { currencyCode: 'BTC' }],
    true, false, false, { available: false, reason: HOME_V2_ARRR_UNTRUSTED_ROUTE_REASON },
  ) as Array<Record<string, Record<string, unknown>>>
  assert.equal(untrusted[1].homeWallet.read, false)
  assert.equal(untrusted[1].homeWallet.receive, false)
  assert.equal(untrusted[1].homeWallet.unavailableReason, HOME_V2_ARRR_UNTRUSTED_ROUTE_REASON)
  assert.ok(!('custodyContract' in untrusted[2].homeWallet))
  assert.ok(!('syncStatus' in untrusted[2].homeWallet))
  assert.ok(!('unavailableReason' in untrusted[2].homeWallet))
  const locked = projectHomeV2CrosschainReadResult(
    'GET_CROSSCHAIN_BLOCKCHAINS', {}, [{ currencyCode: 'ARRR' }],
    true, true, true, { available: false, reason: HOME_V2_ARRR_LOCKED_ACCOUNT_REASON },
  ) as Array<Record<string, Record<string, unknown>>>
  assert.equal(locked[1].homeWallet.read, false)
  assert.equal(locked[1].homeWallet.unavailableReason, HOME_V2_ARRR_LOCKED_ACCOUNT_REASON)
  const android = projectHomeV2CrosschainReadResult(
    'GET_CROSSCHAIN_BLOCKCHAINS', {}, [{ currencyCode: 'ARRR' }, { currencyCode: 'BTC' }],
    true, true, true, { available: false, reason: HOME_V2_ARRR_ANDROID_UNAVAILABLE_REASON },
  ) as Array<Record<string, Record<string, unknown>>>
  assert.equal(android[1].homeWallet.read, false)
  assert.equal(android[1].homeWallet.receive, false)
  assert.equal(android[1].homeWallet.unavailableReason, HOME_V2_ARRR_ANDROID_UNAVAILABLE_REASON)
  // …while the BTC row on the same call still advertises the bitcoiny send.
  assert.equal(android[2].homeWallet.send, true)
  const desktop = projectHomeV2CrosschainReadResult(
    'GET_CROSSCHAIN_BLOCKCHAINS', {}, [{ currencyCode: 'ARRR' }, { currencyCode: 'BTC' }],
    true, true, false, { available: true },
  ) as Array<Record<string, Record<string, unknown>>>
  assert.equal(desktop[1].homeWallet.readMode, 'TRUSTED_CORE_CUSTODY')
  assert.equal(desktop[1].homeWallet.receiveMode, 'TRUSTED_CORE_CUSTODY')
  assert.equal(desktop[1].homeWallet.send, false)
  assert.equal(desktop[1].homeWallet.syncStatus, true)
  assert.equal(desktop[2].homeWallet.readMode, 'TRUSTED_CORE')
  assert.equal(desktop[2].homeWallet.send, false)
  // Omitting the ARRR input (every older caller) leaves ARRR unavailable.
  const legacyCall = projectHomeV2CrosschainReadResult(
    'GET_CROSSCHAIN_BLOCKCHAINS', {}, [{ currencyCode: 'ARRR' }], true, true, true,
  ) as Array<Record<string, Record<string, unknown>>>
  assert.equal(legacyCall[1].homeWallet.read, false)
}

// ---------------------------------------------------------------------------
// 4. Consent family: distinct from foreign-wallet read, pinned to the route

const adminNode = { nodeApiUrl: 'http://127.0.0.1:24891', nodeRoute: 'local|http://127.0.0.1:24891' } as const
assert.equal(HOME_V2_ARRR_CUSTODY_GRANT_FAMILY, 'account.arrr-custody.read')
for (const action of HOME_V2_ARRR_CUSTODY_READ_ACTIONS) {
  assert.equal(homeV2PermissionGrantFamily(action, 'arrr-custody-read'), 'account.arrr-custody.read')
}
assert.equal(homeV2PermissionGrantFamily('GET_WALLET_BALANCE', 'foreign-wallet-read'), 'account.foreign-wallet.read')
assert.equal(homeV2PermissionGrantFamily('GET_USER_WALLET', 'foreign-wallet-read'), 'account.foreign-wallet.read')
assert.notEqual(homeV2PermissionGrantFamily('GET_WALLET_BALANCE', 'arrr-custody-read'), homeV2PermissionGrantFamily('GET_WALLET_BALANCE', 'foreign-wallet-read'))
{
  const consent = homeV2ArrrCustodyConsentBinding({ adminNode })
  assert.equal(consent.kind, 'arrr-custody-read')
  assert.equal(consent.coin, 'ARRR')
  assert.equal(consent.nodeRoute, adminNode.nodeRoute)
  assert.equal(consent.routeLabel, adminNode.nodeApiUrl)
  assert.ok(Object.isFrozen(consent))
  const base = {
    accountId: 'account-1', accountUnlocked: true, appIdentity: 'qdn://APP/Wallet/Wallet',
    principalId: 7, protocol: 'qdnRequest', tabId: 'tab-wallet', target: '',
  }
  const arrrKeys = HOME_V2_ARRR_CUSTODY_READ_ACTIONS.map((action) =>
    homeV2PermissionGrantKey({ ...base, action, nodeRoute: consent.nodeRoute, writeKind: 'arrr-custody-read' }))
  // One tab-session grant covers all four ARRR reads…
  assert.equal(new Set(arrrKeys).size, 1)
  assert.ok(arrrKeys[0].includes('account.arrr-custody.read'))
  assert.ok(arrrKeys[0].includes(adminNode.nodeRoute), 'the grant key carries the pinned admin route')
  // …and it is NOT the foreign-wallet grant for the same action on the same route.
  const foreignConsent = homeV2ForeignWalletReadConsentBinding({ action: 'GET_WALLET_BALANCE', adminNode })
  const foreignKey = homeV2PermissionGrantKey({ ...base, action: 'GET_WALLET_BALANCE', nodeRoute: foreignConsent.nodeRoute, writeKind: 'foreign-wallet-read' })
  assert.notEqual(foreignKey, arrrKeys[0])
  // A different route is a different grant.
  const otherKey = homeV2PermissionGrantKey({ ...base, action: 'GET_WALLET_BALANCE', nodeRoute: 'custom|https://other.example', writeKind: 'arrr-custody-read' })
  assert.notEqual(otherKey, arrrKeys[0])
  // A locked account is a different grant too.
  assert.notEqual(homeV2PermissionGrantKey({ ...base, accountUnlocked: false, action: 'GET_WALLET_BALANCE', nodeRoute: consent.nodeRoute, writeKind: 'arrr-custody-read' }), arrrKeys[0])
}
// No route-independent form: without a trusted node there is no consent.
assert.throws(() => homeV2ArrrCustodyConsentBinding({ adminNode: null }), /authenticated Qortium node/)
assert.throws(() => homeV2ArrrCustodyConsentBinding({ adminNode: { nodeApiUrl: '', nodeRoute: 'x' } }), /authenticated Qortium node/)
// GET_USER_WALLET is permissionless for the NATIVE address; the ARRR request
// is recognised by coin so the bridge can route it to the prompting adapter.
assert.equal(isHomeV2PermissionlessAction('GET_USER_WALLET'), true)
assert.equal(isHomeV2ArrrCustodyRequest('GET_USER_WALLET', { coin: 'ARRR' }), true)
assert.equal(isHomeV2ArrrCustodyRequest('GET_USER_WALLET', { payload: { coin: 'pirate' } }), true)
assert.equal(isHomeV2ArrrCustodyRequest('GET_USER_WALLET', { coin: 'BTC' }), false)
assert.equal(isHomeV2ArrrCustodyRequest('GET_USER_WALLET', {}), false)
assert.equal(isHomeV2ArrrCustodyRequest('GET_WALLET_BALANCE', { blockchain: 'ARRR' }), true)
assert.equal(isHomeV2ArrrCustodyRequest('GET_USER_WALLET_INFO', { coin: 'ARRR' }), false, 'addressinfos is xpub-only; ARRR has none')
assert.equal(isHomeV2ArrrCustodyRequest('SET_CURRENT_FOREIGN_SERVER', { coin: 'ARRR' }), false)
assert.equal(isHomeV2ArrrCustodyRequest(HOME_V2_ARRR_SYNC_STATUS_ACTION, {}), true, 'the sync action defaults its coin to ARRR')
assert.equal(isHomeV2ArrrCustodyRequest(HOME_V2_ARRR_SYNC_STATUS_ACTION, { coin: 'ARRR' }), true)
assert.throws(() => isHomeV2ArrrCustodyRequest(HOME_V2_ARRR_SYNC_STATUS_ACTION, { coin: 'BTC' }), /ARRR wallet only/)
// Prompt copy says plainly what goes where.
assert.equal(HOME_V2_ARRR_CUSTODY_PROMPT_TITLE, 'Allow ARRR wallet custody on your trusted Core?')
{
  const summary = homeV2ArrrCustodyPromptSummary('Wallet', 'http://127.0.0.1:24891')
  assert.match(summary, /derives this account's ARRR spending key/)
  assert.match(summary, /hands it to your trusted Qortium Core at http:\/\/127\.0\.0\.1:24891/)
  assert.match(summary, /keeps a synced copy/)
  assert.match(summary, /receives only the address, balances and history/)
  assert.match(summary, /revokes the app's access, not the copy/)
  const details = homeV2ArrrCustodyPromptDetails({ accountLabel: 'Alice', nodeLabel: 'http://127.0.0.1:24891' })
  assert.deepEqual(details.map((row) => row.label), ['Account', 'Node', 'Shared with Core', 'Shared with app', 'Not shared'])
  assert.equal(details[0].value, 'Alice')
  assert.equal(details[1].value, 'http://127.0.0.1:24891')
  assert.match(details[2].value, /spending key/)
  assert.match(details[3].value, /address, balances and transaction history/)
  assert.match(details[4].value, /seed/)
}

// ---------------------------------------------------------------------------
// 5. Each read's exact request, with a mocked transport

const ENTROPY_V2_N0 = PINNED_VECTORS[0].entropy58
const OK_ADDRESS = 'zs1' + 'q'.repeat(75)

function response(status: number, body: string, data?: unknown): ArrrCustodyResponse {
  return { body, data: data === undefined ? body : data, ok: status >= 200 && status < 300, status }
}

async function run(
  action: typeof HOME_V2_ARRR_CUSTODY_READ_ACTIONS[number],
  reply: ArrrCustodyResponse | Error,
  extra: { verified?: boolean } = {},
) {
  const requests: ArrrCustodyReadRequest[] = []
  const result = await executeArrrCustodyRead({
    action,
    crypto,
    nonce: 0,
    post: async (request) => {
      requests.push(request)
      if (reply instanceof Error) throw reply
      return reply
    },
    seed: SEED_32,
    walletVersion: 2,
    ...extra,
  })
  return { requests, result }
}

assert.deepEqual(buildArrrCustodyReadRequest('walletaddress', 'E'), { body: 'E', contentType: 'text/plain', method: 'POST', pathname: '/crosschain/arrr/walletaddress' })
assert.deepEqual(buildArrrCustodyReadRequest('walletbalance', 'E'), { body: 'E', contentType: 'text/plain', method: 'POST', pathname: '/crosschain/arrr/walletbalance?verified=true' })
assert.deepEqual(buildArrrCustodyReadRequest('walletbalance', 'E', { verified: false }), { body: 'E', contentType: 'text/plain', method: 'POST', pathname: '/crosschain/arrr/walletbalance?verified=false' })
assert.deepEqual(buildArrrCustodyReadRequest('wallettransactions', 'E'), { body: 'E', contentType: 'text/plain', method: 'POST', pathname: '/crosschain/arrr/wallettransactions' })
assert.deepEqual(buildArrrCustodyReadRequest('syncstatus', 'E'), { body: 'E', contentType: 'text/plain', method: 'POST', pathname: '/crosschain/arrr/syncstatus?json=true' })
assert.throws(() => buildArrrCustodyReadRequest('syncstatus', ''), /entropy is required/)

{
  const { requests, result } = await run('GET_USER_WALLET', response(200, `${OK_ADDRESS}\n`))
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0], { body: ENTROPY_V2_N0, contentType: 'text/plain', method: 'POST', pathname: '/crosschain/arrr/walletaddress' })
  assert.deepEqual(result, { address: OK_ADDRESS, coin: 'ARRR' })
  assert.ok(!('xpub58' in (result as object)) && !('publicKey' in (result as object)), 'no xpub field, ever')
}
await assert.rejects(run('GET_USER_WALLET', response(200, 'not-an-address')), /invalid ARRR address/)
await assert.rejects(run('GET_USER_WALLET', response(200, 't1' + 'q'.repeat(33))), /invalid ARRR address/)
{
  const { requests, result } = await run('GET_WALLET_BALANCE', response(200, '123456789012345'))
  assert.equal(requests[0].pathname, '/crosschain/arrr/walletbalance?verified=true')
  assert.equal(requests[0].body, ENTROPY_V2_N0)
  assert.equal(result, '123456789012345', 'the atomic string is preserved, never parsed to a float')
}
{
  const { requests, result } = await run('GET_WALLET_BALANCE', response(200, '0'), { verified: false })
  assert.equal(requests[0].pathname, '/crosschain/arrr/walletbalance?verified=false')
  assert.equal(result, '0')
}
await assert.rejects(run('GET_WALLET_BALANCE', response(200, '12.5')), /invalid ARRR balance/)
await assert.rejects(run('GET_WALLET_BALANCE', response(200, '-1')), /invalid ARRR balance/)
{
  const transactions = [
    { txHash: 'a', timestamp: 1_700_000_000_000, totalAmount: 1, feeAmount: 10_000, inputs: [], outputs: [{ address: 'zs1x', amount: 1, addressInWallet: true }], memo: 'hi', unknownField: 'dropped' },
    { txHash: 'b', totalAmount: -2 },
  ]
  const { requests, result } = await run('GET_USER_WALLET_TRANSACTIONS', response(200, JSON.stringify(transactions), transactions))
  assert.equal(requests[0].pathname, '/crosschain/arrr/wallettransactions')
  assert.equal(requests[0].body, ENTROPY_V2_N0)
  // Projected field by field into fresh literals: unknown keys are dropped,
  // absent optionals are null/0/[], amounts keep Core's numeric contract.
  assert.deepEqual(result, [
    { feeAmount: 10_000, inputs: [], memo: 'hi', outputs: [{ address: 'zs1x', addressInWallet: true, amount: 1 }], timestamp: 1_700_000_000_000, totalAmount: 1, txHash: 'a' },
    { feeAmount: 0, inputs: [], memo: null, outputs: [], timestamp: null, totalAmount: -2, txHash: 'b' },
  ])
  assert.ok(Object.isFrozen(result) && Object.isFrozen((result as unknown[])[0]))
  assert.ok(!('unknownField' in (result as Record<string, unknown>[])[0]))
}
await assert.rejects(run('GET_USER_WALLET_TRANSACTIONS', response(200, '{}', {})), /invalid ARRR transaction list/)
await assert.rejects(run('GET_USER_WALLET_TRANSACTIONS', response(200, '[1]', [1])), /invalid ARRR transaction list/)
await assert.rejects(run('GET_USER_WALLET_TRANSACTIONS', response(200, '', [{ totalAmount: 1 }])), /invalid ARRR transaction list/, 'txHash is required')
await assert.rejects(run('GET_USER_WALLET_TRANSACTIONS', response(200, '', [{ txHash: 'a', totalAmount: '1' }])), /invalid ARRR transaction list/, 'amounts must be numbers')
await assert.rejects(run('GET_USER_WALLET_TRANSACTIONS', response(200, '', [{ txHash: 'a', totalAmount: 1, outputs: [{ amount: 1 }] }])), /invalid ARRR transaction list/, 'party address required')
// Review finding 2: the entropy in a PROPERTY NAME cannot survive projection,
// and a `__proto__` key fails the whole list instead of touching a prototype.
{
  const echoInKey = JSON.parse(`[{"txHash":"a","totalAmount":1,"${ENTROPY_V2_N0}":"echo"}]`) as unknown
  const { result } = await run('GET_USER_WALLET_TRANSACTIONS', response(200, JSON.stringify(echoInKey), echoInKey))
  assert.ok(!JSON.stringify(result).includes(ENTROPY_V2_N0), 'entropy echoed as a key is dropped by the whitelist')
  assert.ok(!Object.keys((result as object[])[0]).some((key) => key.includes(ENTROPY_V2_N0)))
  const protoPayload = JSON.parse('[{"txHash":"a","totalAmount":1,"__proto__":{"polluted":true},"memo":"x"}]') as unknown
  await assert.rejects(run('GET_USER_WALLET_TRANSACTIONS', response(200, '', protoPayload)), /invalid ARRR transaction list/)
  const protoParty = JSON.parse('[{"txHash":"a","totalAmount":1,"outputs":[{"address":"zs1x","amount":1,"constructor":{}}]}]') as unknown
  await assert.rejects(run('GET_USER_WALLET_TRANSACTIONS', response(200, '', protoParty)), /invalid ARRR transaction list/)
  assert.ok(!('polluted' in {}), 'no prototype mutation')
  assert.throws(() => projectArrrTransactions([{ txHash: 'a', totalAmount: 1, prototype: 1 }]), /invalid ARRR transaction list/)
}
assert.equal(homeV2ArrrBalanceVerified({}), true)
assert.equal(homeV2ArrrBalanceVerified({ verified: true }), true)
assert.equal(homeV2ArrrBalanceVerified({ verified: false }), false)
assert.equal(homeV2ArrrBalanceVerified({ payload: { verified: 'false' } }), false)
assert.throws(() => homeV2ArrrBalanceVerified({ verified: 'maybe' }), /verified must be true or false/)

// ---------------------------------------------------------------------------
// 6. Sync snapshot validation

const FULL_STATUS = {
  backendMode: 'unified',
  lastError: null,
  message: 'Synchronizing',
  observedAt: 1_758_400_000_000,
  recoveryState: null,
  restartRequired: false,
  scannedHeight: 2_500_000,
  stale: false,
  state: 'SYNCHRONIZING',
  syncedBlocks: 500_000,
  tipHeight: 2_900_000,
  totalBalanceAtomic: '150000000',
  totalBlocks: 900_000,
  verifiedBalanceAtomic: null,
  walletIdentityHash: 'Hs4kQ2v8',
}
{
  const { requests, result } = await run(HOME_V2_ARRR_SYNC_STATUS_ACTION, response(200, JSON.stringify(FULL_STATUS), FULL_STATUS))
  assert.equal(requests[0].pathname, '/crosschain/arrr/syncstatus?json=true')
  assert.equal(requests[0].body, ENTROPY_V2_N0)
  const snapshot = result as ReturnType<typeof parseArrrSyncSnapshot>
  assert.ok(Object.isFrozen(snapshot))
  assert.equal(snapshot.contract, ARRR_CUSTODY_CONTRACT)
  assert.equal(snapshot.coin, 'ARRR')
  assert.equal(snapshot.state, 'SYNCHRONIZING')
  assert.equal(snapshot.ready, false)
  assert.equal(snapshot.scannedHeight, 2_500_000)
  assert.equal(snapshot.tipHeight, 2_900_000)
  assert.equal(snapshot.totalBalanceAtomic, '150000000')
  assert.equal(snapshot.verifiedBalanceAtomic, null)
  assert.equal(snapshot.observedAt, 1_758_400_000_000)
  assert.equal(snapshot.stale, false)
  assert.equal(snapshot.backendMode, 'unified')
  assert.equal(snapshot.walletIdentityHash, 'Hs4kQ2v8')
  assert.equal(snapshot.lastError, null)
}
const ready = parseArrrSyncSnapshot({ ...FULL_STATUS, state: 'READY', verifiedBalanceAtomic: '149000000' })
assert.equal(ready.ready, true)
assert.equal(ready.verifiedBalanceAtomic, '149000000')
// A stale READY, or one with a restart pending, cannot establish readiness.
assert.equal(parseArrrSyncSnapshot({ ...FULL_STATUS, state: 'READY', stale: true }).ready, false)
assert.equal(parseArrrSyncSnapshot({ ...FULL_STATUS, state: 'READY', stale: true }).state, 'READY', 'Core\'s state is reported as given; `ready` is Home\'s verdict')
assert.equal(parseArrrSyncSnapshot({ ...FULL_STATUS, state: 'READY', restartRequired: true }).ready, false)
for (const state of ['DISABLED', 'LOADING', 'SYNCHRONIZING', 'DEGRADED']) {
  assert.equal(parseArrrSyncSnapshot({ ...FULL_STATUS, state }).ready, false)
  assert.equal(parseArrrSyncSnapshot({ ...FULL_STATUS, state }).state, state)
}
assert.equal(parseArrrSyncSnapshot({ ...FULL_STATUS, state: 'ready' }).state, 'READY', 'case-normalized')
// Unknown → null, never a guess.
{
  const minimal = parseArrrSyncSnapshot({ state: 'LOADING', stale: true })
  assert.equal(minimal.scannedHeight, null)
  assert.equal(minimal.tipHeight, null)
  assert.equal(minimal.totalBalanceAtomic, null)
  assert.equal(minimal.verifiedBalanceAtomic, null)
  assert.equal(minimal.observedAt, null)
  assert.equal(minimal.backendMode, null)
  assert.equal(minimal.walletIdentityHash, null)
  assert.equal(minimal.lastError, null)
  assert.equal(minimal.message, '')
  assert.equal(minimal.restartRequired, false)
  assert.equal(minimal.ready, false)
}
{
  const withError = parseArrrSyncSnapshot({ ...FULL_STATUS, state: 'DEGRADED', lastError: { code: 'LIGHTWALLETD_UNREACHABLE', message: 'no server' } })
  assert.deepEqual(withError.lastError, { code: 'LIGHTWALLETD_UNREACHABLE', message: 'no server' })
  assert.ok(Object.isFrozen(withError.lastError))
}
// Malformed → error, with the field named.
for (const [label, broken] of [
  ['state', { ...FULL_STATUS, state: 'DONE' }],
  ['state', { ...FULL_STATUS, state: 7 }],
  ['body', 'READY'],
  ['body', null],
  ['body', [FULL_STATUS]],
  ['scannedHeight', { ...FULL_STATUS, scannedHeight: -1 }],
  ['scannedHeight', { ...FULL_STATUS, scannedHeight: '2500000' }],
  ['tipHeight', { ...FULL_STATUS, tipHeight: 1.5 }],
  ['syncedBlocks', { ...FULL_STATUS, syncedBlocks: -3 }],
  ['totalBalanceAtomic', { ...FULL_STATUS, totalBalanceAtomic: '1.5' }],
  ['totalBalanceAtomic', { ...FULL_STATUS, totalBalanceAtomic: -1 }],
  ['verifiedBalanceAtomic', { ...FULL_STATUS, verifiedBalanceAtomic: 'lots' }],
  ['observedAt', { ...FULL_STATUS, observedAt: 'yesterday' }],
  ['observedAt', { ...FULL_STATUS, observedAt: -5 }],
  ['lastError', { ...FULL_STATUS, lastError: 'boom' }],
  ['lastError', { ...FULL_STATUS, lastError: { code: 1 } }],
  ['restartRequired', { ...FULL_STATUS, restartRequired: 'yes' }],
  ['message', { ...FULL_STATUS, message: 12 }],
  ['backendMode', { ...FULL_STATUS, backendMode: 3 }],
] as const) {
  assert.throws(() => parseArrrSyncSnapshot(broken), (error: unknown) => {
    assert.ok(isArrrCustodyError(error, 'ARRR_SYNC_STATUS_MALFORMED'), `${label}: coded malformed error`)
    assert.match((error as Error).message, new RegExp(`\\(${label}\\)`), `${label}: names the field`)
    return true
  })
}
// An old Core (no `stale`) is told apart from a malformed one.
assert.throws(() => parseArrrSyncSnapshot({ message: 'Synchronizing', state: 'SYNCHRONIZING', syncedBlocks: 1, totalBlocks: 2, restartRequired: false, recoveryState: null }), (error: unknown) => {
  assert.ok(isArrrCustodyError(error, ARRR_SYNC_CONTRACT_UNSUPPORTED_CODE))
  assert.equal((error as { retryable: boolean }).retryable, false)
  return true
})
await assert.rejects(run(HOME_V2_ARRR_SYNC_STATUS_ACTION, response(200, 'Synchronizing 40%')), (error: unknown) => isArrrCustodyError(error, 'ARRR_SYNC_STATUS_MALFORMED'))

// ---------------------------------------------------------------------------
// 7. Busy (409 / ARRR_WALLET_BUSY) → retryable coded error; other failures

for (const action of HOME_V2_ARRR_CUSTODY_READ_ACTIONS) {
  const busyBody = { error: 9, message: 'ARRR_WALLET_BUSY: another wallet is active' }
  await assert.rejects(run(action, response(409, JSON.stringify(busyBody), busyBody)), (error: unknown) => {
    assert.ok(isArrrCustodyError(error, ARRR_WALLET_BUSY_CODE), `${action} busy code`)
    assert.equal((error as Error).message, ARRR_WALLET_BUSY_MESSAGE)
    assert.equal((error as { retryable: boolean }).retryable, true)
    assert.equal((error as { status?: number }).status, 409)
    return true
  })
}
// Any one of the three signals is enough: a bare 409, error 9 on another
// status, or the marker in the message.
assert.equal(classifyArrrCustodyFailure(response(409, 'busy'), 'walletbalance').code, ARRR_WALLET_BUSY_CODE)
assert.equal(classifyArrrCustodyFailure(response(500, '', { error: 9, message: 'operation already in progress' }), 'syncstatus').code, ARRR_WALLET_BUSY_CODE)
assert.equal(classifyArrrCustodyFailure(response(400, '', { error: 1201, message: 'ARRR_WALLET_BUSY' }), 'walletaddress').code, ARRR_WALLET_BUSY_CODE)
// Verified balance unknown → its own retryable code, only for the balance read.
{
  const unavailable = { error: 1210, message: 'FOREIGN_BLOCKCHAIN_BALANCE_UNAVAILABLE: verified balance unknown' }
  await assert.rejects(run('GET_WALLET_BALANCE', response(503, JSON.stringify(unavailable), unavailable)), (error: unknown) => {
    assert.ok(isArrrCustodyError(error, ARRR_VERIFIED_BALANCE_UNAVAILABLE_CODE))
    assert.equal((error as { retryable: boolean }).retryable, true)
    assert.match((error as Error).message, /GET_ARRR_SYNC_STATUS/)
    assert.match((error as Error).message, /verified: false/)
    return true
  })
  assert.notEqual(classifyArrrCustodyFailure(response(503, '', unavailable), 'walletaddress').code, ARRR_VERIFIED_BALANCE_UNAVAILABLE_CODE)
}
// 1201 keeps the shared backend-unavailable code; the message is Home's, not Core's.
{
  const issue = { error: 1201, message: 'Unable to connect to lightwalletd at 10.0.0.1' }
  const error = classifyArrrCustodyFailure(response(500, '', issue), 'walletbalance')
  assert.equal(error.code, 'FOREIGN_WALLET_BACKEND_UNAVAILABLE')
  assert.equal(error.retryable, true)
  assert.ok(!error.message.includes('10.0.0.1'), 'node-controlled text never reaches the app')
}
{
  const error = classifyArrrCustodyFailure(response(404, 'nope'), 'syncstatus')
  assert.equal(error.code, 'ARRR_CUSTODY_READ_FAILED')
  assert.equal(error.retryable, false)
  assert.equal(classifyArrrCustodyFailure(response(502, ''), 'syncstatus').retryable, true)
}
// A transport failure is coded and retryable.
await assert.rejects(run('GET_USER_WALLET', new Error('fetch failed')), (error: unknown) => isArrrCustodyError(error, 'ARRR_CUSTODY_TRANSPORT_FAILED') && (error as { retryable: boolean }).retryable)

// ---------------------------------------------------------------------------
// 8. The entropy never appears in a log line, an error, a result or the
//    prompt payload

{
  const logged: string[] = []
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
  const originals = Object.fromEntries(methods.map((method) => [method, console[method]])) as Record<typeof methods[number], typeof console.log>
  for (const method of methods) {
    console[method] = (...args: unknown[]) => { logged.push(args.map((arg) => String(arg)).join(' ')) }
  }
  try {
    const echoing = { ...FULL_STATUS, message: `wallet ${ENTROPY_V2_N0} synchronizing`, lastError: { code: 'X', message: `bad ${ENTROPY_V2_N0}` } }
    const { result } = await run(HOME_V2_ARRR_SYNC_STATUS_ACTION, response(200, JSON.stringify(echoing), echoing))
    assert.ok(!JSON.stringify(result).includes(ENTROPY_V2_N0), 'an echoed entropy is scrubbed from the snapshot')
    assert.equal((result as { message: string }).message, 'wallet [redacted] synchronizing')
    await assert.rejects(run('GET_USER_WALLET', new Error(`POST body ${ENTROPY_V2_N0} refused`)), (error: unknown) => {
      assert.ok(!(error as Error).message.includes(ENTROPY_V2_N0), 'a transport error quoting the body is scrubbed')
      return true
    })
    const echoedTx = [{ memo: `paid ${ENTROPY_V2_N0}`, totalAmount: 1, txHash: `tx-${ENTROPY_V2_N0}` }]
    const txResult = await run('GET_USER_WALLET_TRANSACTIONS', response(200, JSON.stringify(echoedTx), echoedTx))
    assert.ok(!JSON.stringify(txResult.result).includes(ENTROPY_V2_N0))
    await run('GET_USER_WALLET', response(200, OK_ADDRESS))
    await run('GET_WALLET_BALANCE', response(200, '5'))
  } finally {
    for (const method of methods) console[method] = originals[method]
  }
  assert.equal(logged.filter((line) => line.includes(ENTROPY_V2_N0)).length, 0, 'no log line carries the entropy')
  assert.equal(logged.length, 0, 'the adapter logs nothing at all')
}
assert.equal(scrubArrrEntropy({ a: [`x${ENTROPY_V2_N0}y`, 1, null], b: { c: ENTROPY_V2_N0 } }, ENTROPY_V2_N0).a[0], 'x[redacted]y')
assert.equal(scrubArrrEntropy('plain', ''), 'plain')
{
  // Property NAMES are scrubbed too, and unsafe keys never reach the rebuilt
  // object even when another field triggers the rebuild.
  const echoKey = JSON.parse(`{"${ENTROPY_V2_N0}":"v","__proto__":{"polluted":true},"m":"${ENTROPY_V2_N0}"}`) as Record<string, unknown>
  const scrubbed = scrubArrrEntropy(echoKey, ENTROPY_V2_N0)
  assert.deepEqual(Object.keys(scrubbed).sort(), ['[redacted]', 'm'])
  assert.equal(scrubbed.m, '[redacted]')
  assert.equal(Object.getPrototypeOf(scrubbed), Object.prototype)
  assert.ok(!('polluted' in scrubbed))
  assert.ok(!('polluted' in {}))
  // A message is redacted BEFORE the snapshot parser truncates it, so a
  // secret at the truncation boundary cannot leave a fragment behind.
  const longMessage = 'x'.repeat(500) + ENTROPY_V2_N0 + 'y'.repeat(100)
  const status = { ...FULL_STATUS, message: longMessage }
  const { result } = await run(HOME_V2_ARRR_SYNC_STATUS_ACTION, response(200, JSON.stringify(status), status))
  const message = (result as { message: string }).message
  assert.ok(!message.includes(ENTROPY_V2_N0.slice(0, 8)), 'no prefix fragment of the entropy survives truncation')
  assert.ok(message.includes('[redacted]'))
}

// The pure seams the bridge wires in, EXECUTED (review round 2):
// route projection, error details, lifecycle cancellation, trust-across-await.
{
  const trustedResolution = {
    apiKey: 'secret-key',
    node: { nodeApiUrl: 'http://127.0.0.1:24891' },
    nodeRoute: 'local|http://127.0.0.1:24891',
    trust: { apiKey: 'secret-key', bindingId: 'binding-1', revision: 'CREDENTIAL-DIGEST-8f3a', trusted: true as const },
  }
  const trusted = projectArrrCustodyRoute(trustedResolution)
  assert.deepEqual(trusted, {
    apiKey: 'secret-key', bindingId: 'binding-1', nodeApiUrl: 'http://127.0.0.1:24891', nodeRoute: 'local|http://127.0.0.1:24891', reason: null, revision: 'CREDENTIAL-DIGEST-8f3a', trusted: true,
  })
  assert.ok(Object.isFrozen(trusted))
  const untrusted = projectArrrCustodyRoute({ ...trustedResolution, trust: { reason: 'public-node', trusted: false as const } })
  assert.deepEqual(untrusted, {
    apiKey: '', bindingId: '', nodeApiUrl: 'http://127.0.0.1:24891', nodeRoute: 'local|http://127.0.0.1:24891', reason: 'public-node', revision: '', trusted: false,
  })
  // Error details never take the route's credential digest as an input:
  // the public runtime revision is what the caller passes.
  const details = arrrCustodyBridgeErrorDetails(
    Object.assign(new Error(ARRR_WALLET_BUSY_MESSAGE), { code: ARRR_WALLET_BUSY_CODE, retryable: true, status: 409 }),
    'GET_WALLET_BALANCE',
    'home-v2-route-v1-0badcafe',
  )
  assert.deepEqual(details, { action: 'GET_WALLET_BALANCE', code: ARRR_WALLET_BUSY_CODE, network: 'qortium', retryable: true, routeRevision: 'home-v2-route-v1-0badcafe' })
  assert.ok(!JSON.stringify(details).includes('CREDENTIAL-DIGEST'))
  const serialized = JSON.stringify(encodeQdnBridgeError(createHomeV2BridgeError(ARRR_WALLET_BUSY_MESSAGE, details)))
  assert.ok(serialized.includes('home-v2-route-v1-0badcafe') && !serialized.includes('CREDENTIAL-DIGEST'))
  // Lifecycle cancellation, applied to a real queue exactly as invalidateRuntime does.
  const mine = { principalKey: '7|tab-1', tags: { hostWebContentsId: 1, tabId: 'tab-1' } }
  const otherTab = { principalKey: '7|tab-2', tags: { hostWebContentsId: 1, tabId: 'tab-2' } }
  const otherHost = { principalKey: '9|tab-1', tags: { hostWebContentsId: 2, tabId: 'tab-1' } }
  for (const kind of ['account-changed', 'locked', 'node-changed']) {
    assert.equal(arrrCustodyCancelsQueuedRead(1, { kind, tabId: null }, mine), true, `${kind} cancels every queued read of the host`)
    assert.equal(arrrCustodyCancelsQueuedRead(1, { kind, tabId: null }, otherTab), true)
    assert.equal(arrrCustodyCancelsQueuedRead(1, { kind, tabId: null }, otherHost), false, `${kind} never touches another host window`)
  }
  for (const kind of ['tab-closed', 'app-replaced', 'navigation-changed']) {
    assert.equal(arrrCustodyCancelsQueuedRead(1, { kind, tabId: 'tab-1' }, mine), true, `${kind} cancels that tab`)
    assert.equal(arrrCustodyCancelsQueuedRead(1, { kind, tabId: 'tab-1' }, otherTab), false, `${kind} leaves other tabs`)
    assert.equal(arrrCustodyCancelsQueuedRead(1, { kind, tabId: null }, mine), false, 'a tab-scoped kind without a tab cancels nothing')
  }
  {
    const queue = createArrrCustodyReadQueue()
    let release!: () => void
    const running = queue.run('local|a', () => new Promise<string>((resolve) => { release = () => resolve('running') }), mine)
    const queuedMine = observed(queue.run('local|a', async () => 'mine', mine))
    const queuedOtherTab = queue.run('local|a', async () => 'other-tab', otherTab)
    const queuedOtherHost = queue.run('local|a', async () => 'other-host', otherHost)
    const invalidation = { kind: 'tab-closed', tabId: 'tab-1' }
    assert.equal(queue.cancelWhere((meta) => arrrCustodyCancelsQueuedRead(1, invalidation, meta)), 1)
    await assert.rejects(queuedMine, (error: unknown) => isArrrCustodyError(error, ARRR_READ_CANCELLED_CODE))
    release()
    assert.equal(await running, 'running')
    assert.equal(await queuedOtherTab, 'other-tab')
    assert.equal(await queuedOtherHost, 'other-host')
  }
  // Trust across the discovery's awaited probe.
  const before = { nodeRoute: 'local|a', trust: { revision: 'r1', trusted: true } }
  assert.equal(adminTrustUnchangedAcrossAwait(before, before), true)
  assert.equal(adminTrustUnchangedAcrossAwait(before, { nodeRoute: 'local|a', trust: { revision: 'r2', trusted: true } }), false, 'a rotated key is a change')
  assert.equal(adminTrustUnchangedAcrossAwait(before, { nodeRoute: 'custom|b', trust: { revision: 'r1', trusted: true } }), false)
  assert.equal(adminTrustUnchangedAcrossAwait(before, { nodeRoute: 'local|a', trust: { trusted: false } }), false)
  assert.equal(adminTrustUnchangedAcrossAwait({ nodeRoute: 'local|a', trust: { trusted: false } }, before), false)
}

// Wiring pins (what a unit test cannot execute: that the Electron bridge
// hands the seams above and nothing else to the orchestrator).
{
  const bridge = readRepoSource('../electron/home-v2-app-bridge.ts', './home-v2-app-bridge.ts')
  const handler = sliceAfter(bridge, 'async function readHomeV2ArrrCustody(', 6000, 'ARRR custody handler')
  const handlerEnd = handler.indexOf('\nasync function setHomeV2ForeignServer(')
  const handlerBody = handlerEnd === -1 ? handler : handler.slice(0, handlerEnd)
  for (const required of [
    'runHomeV2ArrrCustodyRead<QdnViewContext>({',
    'resolveRoute: resolveHomeV2ArrrCustodyRoute',
    "kind: 'arrr-custody-read'",
    'nodeRoute: binding.nodeRoute',
    "family: 'account.arrr-custody.read'",
    'queue: homeV2ArrrCustodyReads',
    'getSeed: (accountId) => getAccountForeignWalletSeed(accountId)',
    'crypto: homeV2ArrrCustodyCrypto',
    'arrrCustodyBridgeErrorDetails(error, action, publicRouteRevision)',
  ]) {
    assert.ok(handlerBody.includes(required), `bridge wiring: ${required}`)
  }
  for (const forbidden of ['trust.revision', 'withArrrEntropy58', 'executeArrrCustodyRead', 'console.', 'entropy58', 'webContents.send']) {
    assert.ok(!handlerBody.includes(forbidden), `bridge wiring must not contain ${forbidden}`)
  }
  assert.ok(bridge.includes("return projectArrrCustodyRoute(await resolveHomeV2AdminNode('qortium'))"))
  assert.ok(bridge.includes('const homeV2ArrrCustodyCrypto = createArrrCustodyNodeCrypto()'))
  assert.ok(bridge.includes('homeV2ArrrCustodyReads.cancelWhere((meta) => arrrCustodyCancelsQueuedRead(hostWebContentsId, invalidation, meta))'))
  assert.ok(bridge.includes('homeV2ArrrSessionReads.cancelWhere((meta) => arrrCustodyCancelsQueuedRead(hostWebContentsId, invalidation, meta))'))
  assert.ok(bridge.includes('if (!adminTrustUnchangedAcrossAwait(resolved, after)) return { send: false, trusted: false }'))
  const post = sliceAfter(bridge, 'async function postHomeV2ArrrCustody(', 1200, 'ARRR transport')
  assert.ok(post.includes("redirect: 'error'") && post.includes("'X-API-KEY': route.apiKey") && post.includes('readBoundedResponse(response') && !post.includes('console.'))
  const payloadArm = sliceAfter(bridge, "writeDetails?.kind === 'arrr-custody-read'\n            ? {", 500, 'ARRR prompt payload')
  const payloadKeys = [...payloadArm.slice(0, payloadArm.indexOf('}')).matchAll(/^\s+(\w+):/gm)].map((match) => match[1])
  assert.deepEqual(payloadKeys, ['arrrCustodyCoin', 'writeKind', 'writeOperationLabel', 'writeRouteLabel', 'writeSingleRequestOnly', 'writeTargetChainLabel'])
  assert.ok(bridge.includes("const arrrCustodyRead = writeDetails?.kind === 'arrr-custody-read'"))
  assert.ok(bridge.includes("if (!arrrCustodyRead && isHomeV2PermissionlessAction(action) && writeDetails?.kind !== 'foreign-wallet-read') return"))
  const routePinning = sliceAfter(bridge, 'const foreignWalletRoute =', 700, 'route pinning')
  assert.ok(routePinning.includes(": writeDetails?.kind === 'arrr-custody-read'\n      ? writeDetails.nodeRoute"))
  const dispatch = bridge.indexOf("if (protocol === 'qdnRequest' && isHomeV2ArrrCustodyRequest(action, requestValue)) {")
  const bitcoiny = bridge.indexOf("if (action === 'GET_USER_WALLET') {\n    if (isHomeV2NativeWalletRequest(requestValue)) {")
  assert.ok(dispatch !== -1 && bitcoiny !== -1 && dispatch < bitcoiny)
  const custodyModule = readRepoSource('../electron/arrr-custody.ts', './arrr-custody.ts')
  assert.equal(custodyModule.split('function withArrrEntropy58<').length - 1, 1, 'one declaration')
  assert.equal(custodyModule.split('withArrrEntropy58(').length - 1, 1, 'exactly one call, in executeArrrCustodyRead')
  const orchestrator = readRepoSource('../electron/home-v2-arrr-custody-read.ts', './home-v2-arrr-custody-read.ts')
  assert.equal(orchestrator.split('executeArrrCustodyRead({').length - 1, 1)
  assert.ok(!orchestrator.includes('console.'))
  for (const [label, source] of [
    ['HomeV2LiveApp.tsx', readRepoSource('../src/home-v2-live/HomeV2LiveApp.tsx', '../src/home-v2-live/HomeV2LiveApp.tsx')],
    ['node-client.ts', readRepoSource('../src/home-v2-live/node-client.ts', '../src/home-v2-live/node-client.ts')],
    ['platform.ts', readRepoSource('../src/platform.ts', '../src/platform.ts')],
  ] as const) {
    for (const forbidden of ['withArrrEntropy58', 'executeArrrCustodyRead', 'runHomeV2ArrrCustodyRead']) {
      assert.ok(!source.includes(forbidden), `${label} must never reach ${forbidden}`)
    }
  }
  const liveApp = readRepoSource('../src/home-v2-live/HomeV2LiveApp.tsx', '../src/home-v2-live/HomeV2LiveApp.tsx')
  assert.ok(liveApp.includes("const isArrrCustodyRead = value.writeKind === 'arrr-custody-read'"))
  assert.ok(liveApp.includes("? 'account.arrr-custody.read'"))
  assert.ok(liveApp.includes('? HOME_V2_ARRR_CUSTODY_PROMPT_TITLE'))
  assert.ok(liveApp.includes('homeV2ArrrCustodyPromptSummary(appTitle, String(value.writeRouteLabel))'))
  assert.ok(liveApp.includes('homeV2ArrrCustodyPromptDetails({'))
  const scopes = sliceAfter(liveApp, ": isArrrCustodyRead\n          ? ['single-request'", 120, 'ARRR scopes')
  assert.ok(scopes.includes("['single-request', 'session']"), 'never "always"')
  const permissions = readRepoSource('../src/v2/bridge-permissions.ts', '../src/v2/bridge-permissions.ts')
  assert.ok(permissions.includes("| 'account.arrr-custody.read'"))
  assert.ok(permissions.includes("grant.capability === 'account.arrr-custody.read' &&\n    prompt.capability === 'account.arrr-custody.read'"))
}

// Review finding 4: the production digest wrapper hands the derivation the
// OWNED node:crypto Buffers, so every digest — including the final SHA-512
// that holds the raw entropy — is zero once the callback returns. The owned
// Base58 encoder matches the shared codec bit for bit.
{
  const real = createArrrCustodyNodeCrypto()
  const produced: Uint8Array[] = []
  const instrumented = {
    sha256: (data: Uint8Array) => { const out = real.sha256(data); produced.push(out); return out },
    sha512: (data: Uint8Array) => { const out = real.sha512(data); produced.push(out); return out },
  }
  const entropy58 = withArrrEntropy58({ crypto: instrumented, nonce: 0, seed: SEED_32, walletVersion: 2 }, (e) => e)
  assert.equal(entropy58, PINNED_VECTORS[0].entropy58, 'the real wrapper derives the pinned vector')
  assert.equal(produced.length, 4, 'two account-seed SHA-512s, the indicator SHA-256, the final SHA-512')
  for (const [index, digest] of produced.entries()) {
    assert.ok(Buffer.isBuffer(digest), `digest ${index} is the Buffer node:crypto produced, not a copy`)
    assert.ok(digest.every((byte) => byte === 0), `digest ${index} is zeroed after derivation`)
  }
  // The owned encoder matches the shared codec on random inputs, leading
  // zeros included, and wipes its digit buffer (it is allocated inside, so
  // the observable property is equivalence plus the source-level fill).
  for (let round = 0; round < 500; round += 1) {
    const bytes = Uint8Array.from({ length: 1 + (round % 48) }, () => Math.floor(Math.random() * 256))
    if (round % 4 === 0) bytes.fill(0, 0, 1 + (round % 3))
    assert.equal(base58EncodeOwned(bytes), base58Encode(bytes))
  }
  assert.equal(base58EncodeOwned(new Uint8Array(0)), '')
  assert.equal(base58EncodeOwned(new Uint8Array(3)), '111')
  // OBSERVE the wipe: hand the encoder its digit buffer. It is used (a
  // too-small one is refused), it is dirty while encoding is under way (a
  // spy alphabet lookup sees non-zero digits), and it is all zero afterwards.
  {
    const entropy = base58Decode(PINNED_VECTORS[0].entropy58)
    assert.throws(() => base58EncodeOwned(entropy, new Uint8Array(base58ScratchLength(entropy.length) - 1)), /scratch buffer is too small/)
    const scratch = new Uint8Array(base58ScratchLength(entropy.length))
    assert.equal(base58EncodeOwned(entropy, scratch), PINNED_VECTORS[0].entropy58)
    assert.ok(scratch.every((digit) => digit === 0), 'the digit buffer is zero after encoding')
    // Shadow `fill` on the buffer itself: the encoder clears it first (call
    // 1) and wipes it in `finally` (call 2); at call 2 the digits must be
    // non-zero for the wipe to mean anything.
    let fills = 0
    let sawDirty = false
    const spy = Object.assign(scratch, {
      fill(this: Uint8Array, value: number, start?: number, end?: number) {
        fills += 1
        if (fills === 2) sawDirty = Uint8Array.prototype.some.call(this, (digit: number) => digit !== 0)
        return Uint8Array.prototype.fill.call(this, value, start, end)
      },
    })
    assert.equal(base58EncodeOwned(entropy, spy), PINNED_VECTORS[0].entropy58)
    assert.equal(fills, 2, 'cleared before use, wiped in finally')
    assert.equal(sawDirty, true, 'the buffer held digits right before the wipe')
    assert.ok(scratch.every((digit) => digit === 0))
  }
  for (const vector of PINNED_VECTORS) {
    assert.equal(base58EncodeOwned(base58Decode(vector.entropy58)), vector.entropy58)
  }
}

// ---------------------------------------------------------------------------
// 9. Per-route serialization, cancellation of obsolete polling, backlog bounds

{
  const queue = createArrrCustodyReadQueue()
  const meta = (principalKey: string, coalesceKey?: string) => ({ coalesceKey, principalKey, tags: { hostWebContentsId: 1, tabId: principalKey } })
  const order: string[] = []
  let releaseFirst!: () => void
  const first = queue.run('local|a', () => new Promise<string>((resolve) => {
    order.push('first-start')
    releaseFirst = () => { order.push('first-end'); resolve('first') }
  }), meta('tab-1'))
  const second = queue.run('local|a', async () => { order.push('second'); return 'second' }, meta('tab-1'))
  const otherRoute = queue.run('custom|b', async () => { order.push('other'); return 'other' }, meta('tab-1'))
  await otherRoute
  assert.deepEqual(order, ['first-start', 'other'], 'another route is not blocked; the same route waits')
  assert.equal(queue.pending('local|a'), 2)
  releaseFirst()
  assert.equal(await first, 'first')
  assert.equal(await second, 'second')
  assert.deepEqual(order, ['first-start', 'other', 'first-end', 'second'])
  assert.equal(queue.pending('local|a'), 0)
  assert.equal(queue.pending(), 0)
  // A failing task, or one that throws synchronously, does not wedge the route.
  await assert.rejects(queue.run('local|a', async () => { throw new Error('nope') }, meta('tab-1')), /nope/)
  await assert.rejects(queue.run('local|a', () => { throw new Error('sync') }, meta('tab-1')), /sync/)
  assert.equal(await queue.run('local|a', async () => 'after', meta('tab-1')), 'after')
  // Coalescing: a newer poll with the same key removes and rejects the one
  // still waiting; the running one and a different key are untouched.
  let releaseBlocker!: () => void
  const blocker = queue.run('local|a', () => new Promise<string>((resolve) => { releaseBlocker = () => resolve('blocker') }), meta('tab-1', 'tab-1|sync'))
  const stalePoll = observed(queue.run('local|a', async () => 'stale', meta('tab-1', 'tab-1|sync')))
  const otherTab = queue.run('local|a', async () => 'other-tab', meta('tab-2', 'tab-2|sync'))
  const freshPoll = queue.run('local|a', async () => 'fresh', meta('tab-1', 'tab-1|sync'))
  await assert.rejects(stalePoll, (error: unknown) => isArrrCustodyError(error, ARRR_READ_SUPERSEDED_CODE))
  assert.equal(queue.pending('local|a'), 3, 'the superseded entry is removed, not merely marked')
  releaseBlocker()
  assert.equal(await blocker, 'blocker', 'the in-flight request is never cancelled')
  assert.equal(await otherTab, 'other-tab')
  assert.equal(await freshPoll, 'fresh')
  assert.equal(queue.pending('local|a'), 0)
  // Review finding 5: 12,000 replacement polls behind one blocker — no
  // RangeError, every promise settles, only the last poll runs.
  {
    let release!: () => void
    const gate = queue.run('local|a', () => new Promise<string>((resolve) => { release = () => resolve('gate') }), meta('tab-9', 'tab-9|sync'))
    const polls: Promise<string>[] = []
    for (let index = 0; index < 12_000; index += 1) {
      polls.push(observed(queue.run('local|a', async () => `poll-${index}`, meta('tab-9', 'tab-9|sync'))))
    }
    assert.equal(queue.pending('local|a'), 2, 'one running, one waiting')
    const settled = await Promise.allSettled(polls.slice(0, -1))
    assert.ok(settled.every((entry) => entry.status === 'rejected' && isArrrCustodyError(entry.reason, ARRR_READ_SUPERSEDED_CODE)))
    release()
    assert.equal(await gate, 'gate')
    assert.equal(await polls[polls.length - 1], 'poll-11999')
    assert.equal(queue.pending(), 0)
  }
  // Backlog bound per principal: the fifth queued request from one app tab is
  // refused, another tab on the same route is not.
  {
    let release!: () => void
    const running = queue.run('local|a', () => new Promise<string>((resolve) => { release = () => resolve('running') }), meta('tab-3'))
    const queued = Array.from({ length: ARRR_READ_BACKLOG_LIMIT }, (_, index) => queue.run('local|a', async () => `q${index}`, meta('tab-3')))
    await assert.rejects(queue.run('local|a', async () => 'too-many', meta('tab-3')), (error: unknown) => {
      assert.ok(isArrrCustodyError(error, ARRR_READ_BACKLOG_CODE))
      assert.equal((error as { retryable: boolean }).retryable, true)
      return true
    })
    const otherPrincipal = queue.run('local|a', async () => 'other', meta('tab-4'))
    release()
    assert.equal(await running, 'running')
    assert.deepEqual(await Promise.all(queued), ['q0', 'q1', 'q2', 'q3'])
    assert.equal(await otherPrincipal, 'other')
  }
  // Lifecycle cancellation: queued work for a host/tab is rejected with
  // ARRR_READ_CANCELLED; the running task and other hosts are untouched.
  {
    let release!: () => void
    const running = queue.run('local|a', () => new Promise<string>((resolve) => { release = () => resolve('running') }), meta('tab-5'))
    const mine = observed(queue.run('local|a', async () => 'mine', meta('tab-5')))
    const otherHost = queue.run('local|a', async () => 'other-host', { principalKey: 'tab-5', tags: { hostWebContentsId: 2, tabId: 'tab-5' } })
    assert.equal(queue.cancelWhere((entry) => entry.tags?.hostWebContentsId === 1 && entry.tags?.tabId === 'tab-5'), 1)
    await assert.rejects(mine, (error: unknown) => isArrrCustodyError(error, ARRR_READ_CANCELLED_CODE))
    release()
    assert.equal(await running, 'running')
    assert.equal(await otherHost, 'other-host')
    assert.equal(queue.pending(), 0)
  }
  await assert.rejects(queue.run('local|a', async () => 'x', { principalKey: '' }), /needs its principal/)
}

// ---------------------------------------------------------------------------
// 10. Advertising: qdnRequest only, trusted route only, never widget/Android

{
  const qdnActions = getHomeV2AppActions('qdnRequest')
  const qortalActions = getHomeV2AppActions('qortalRequest')
  assert.ok(qdnActions.includes(HOME_V2_ARRR_SYNC_STATUS_ACTION))
  assert.ok(!qortalActions.includes(HOME_V2_ARRR_SYNC_STATUS_ACTION))
  const nodes = {
    local: { adminTrusted: true, capabilities: { read: true }, customConfigured: false, mode: 'local', nodeApiUrl: 'http://127.0.0.1:24891' },
    authenticatedCustom: { adminTrusted: true, capabilities: { read: true }, customAuthenticated: true, customConfigured: true, mode: 'custom', nodeApiUrl: 'https://custom.example' },
    unauthenticatedCustom: { adminTrusted: false, capabilities: { read: true }, customAuthenticated: false, customConfigured: true, mode: 'custom', nodeApiUrl: 'https://custom.example' },
    public: { adminTrusted: false, capabilities: { read: true }, customConfigured: false, mode: 'public', nodeApiUrl: 'https://public.example' },
  } as const
  const routeFor = (node: (typeof nodes)[keyof typeof nodes]) => getHomeV2AppHostInfo({
    hostVersion: '2.1.0', node, platform: 'desktop', platformVersion: '2.0', protocol: 'qdnRequest',
  }).route
  for (const node of [nodes.local, nodes.authenticatedCustom]) {
    const route = routeFor(node)
    assert.ok(getHomeV2AvailableAppActions('qdnRequest', { qortal: route, qortium: route }).includes(HOME_V2_ARRR_SYNC_STATUS_ACTION), `${node.mode} trusted route advertises the sync action`)
  }
  for (const node of [nodes.unauthenticatedCustom, nodes.public]) {
    const route = routeFor(node)
    assert.ok(!getHomeV2AvailableAppActions('qdnRequest', { qortal: route, qortium: route }).includes(HOME_V2_ARRR_SYNC_STATUS_ACTION), `${node.mode} untrusted route hides the sync action`)
  }
  assert.ok(!getHomeV2ContextualAppActions(qdnActions, 'widget').includes(HOME_V2_ARRR_SYNC_STATUS_ACTION), 'never offered to a widget')
  assert.ok(getHomeV2ContextualAppActions(qdnActions, 'tab').includes(HOME_V2_ARRR_SYNC_STATUS_ACTION))
  assert.ok(!getHomeV2ContextualAppActions(qdnActions, 'android').includes(HOME_V2_ARRR_SYNC_STATUS_ACTION), 'withheld on Android')
  assert.equal(isHomeV2AndroidUnsupportedAction(HOME_V2_ARRR_SYNC_STATUS_ACTION), true)
  assert.deepEqual(homeV2AndroidActionRefusal(HOME_V2_ARRR_SYNC_STATUS_ACTION, 'qdnRequest'), {
    message: HOME_V2_ARRR_ANDROID_UNAVAILABLE_REASON,
    network: 'qortium',
  })
  assert.equal(homeV2AndroidActionRefusal(HOME_V2_ARRR_SYNC_STATUS_ACTION, 'qortalRequest'), null, 'not advertised there at all')
  // The three shared names stay bitcoiny reads for the bitcoiny path.
  for (const action of ['GET_WALLET_BALANCE', 'GET_USER_WALLET_TRANSACTIONS'] as const) {
    assert.ok(isHomeV2ForeignWalletReadAction(action))
  }
  assert.ok(!isHomeV2ForeignWalletReadAction(HOME_V2_ARRR_SYNC_STATUS_ACTION), 'the sync action is not a bitcoiny read')
  // Android's client projects ARRR unavailable with the reason and refuses
  // ARRR coins before the bitcoiny path.
  const nodeClient = readRepoSource('../src/home-v2-live/node-client.ts', '../src/home-v2-live/node-client.ts')
  assert.ok(nodeClient.includes('{ available: false, reason: HOME_V2_ARRR_ANDROID_UNAVAILABLE_REASON }'))
  const liveApp = readRepoSource('../src/home-v2-live/HomeV2LiveApp.tsx', '../src/home-v2-live/HomeV2LiveApp.tsx')
  const androidArm = sliceAfter(liveApp, 'if (isAndroidHost && foreignWalletRequest) {', 2500, 'android foreign arm')
  assert.ok(androidArm.includes('throw new Error(HOME_V2_ARRR_ANDROID_UNAVAILABLE_REASON)'))
  assert.ok(androidArm.indexOf('normalizeHomeV2ForeignWalletCoin(') !== -1)
  assert.ok(androidArm.indexOf('isArrrCustodyCoin(') < androidArm.indexOf('normalizeHomeV2ForeignWalletCoin('))
}

// ---------------------------------------------------------------------------
// 11. Executable boundary tests: the privileged orchestrator with injected deps
//     (review finding 1). Denial before derivation; trust revoked while
//     queued → no dispatch; lock / route change / consent invalidation during
//     the HTTP round trip → no delivery.

type TestContext = { accountId: string | null; tabId: string; windowId: number; resource: string }

function trustedRoute(overrides: Partial<ArrrCustodyRoute> = {}): ArrrCustodyRoute {
  return {
    apiKey: 'secret-key',
    bindingId: 'binding-1',
    nodeApiUrl: 'http://127.0.0.1:24891',
    nodeRoute: 'local|http://127.0.0.1:24891',
    reason: null,
    revision: 'CREDENTIAL-DIGEST-8f3a',
    trusted: true,
    ...overrides,
  }
}

function harness(overrides: Partial<ArrrCustodyReadDeps<TestContext>> & { readonly reply?: ArrrCustodyResponse } = {}) {
  const grants = createHomeV2SessionGrantStore()
  const state = {
    context: { accountId: 'acct-1', resource: 'qdn://APP/Wallet', tabId: 'tab-1', windowId: 1 } as TestContext,
    live: true,
    route: trustedRoute(),
    unlocked: true,
    viewGone: false,
  }
  const calls = { consent: 0, post: [] as ArrrCustodyReadRequest[], postRoutes: [] as ArrrCustodyRoute[], resolve: 0, seed: 0 }
  const deps: ArrrCustodyReadDeps<TestContext> = {
    action: 'GET_WALLET_BALANCE',
    assertTrusted: (route) => {
      if (!route.trusted) throw createHomeV2BridgeError('untrusted', { action: 'GET_WALLET_BALANCE', code: 'NODE_CAPABILITY_MISSING', network: 'qortium', retryable: false })
    },
    captureConsent: () => grants.capture({ family: 'account.arrr-custody.read', hostWebContentsId: 1, network: 'qortium', tabId: 'tab-1' }),
    context: state.context,
    contextAccountId: (context) => context.accountId,
    crypto,
    freshContext: () => (state.viewGone ? null : { ...state.context }),
    getSeed: (accountId) => { calls.seed += 1; assert.equal(accountId, 'acct-1'); return { addressIndex: 0, seed: Uint8Array.from(SEED_32), walletVersion: 2 } },
    isAccountUnlocked: () => state.unlocked,
    liveResourceMatchesGrant: () => state.live,
    lockedError: () => createHomeV2BridgeError('locked', { action: 'GET_WALLET_BALANCE', code: 'ACCOUNT_LOCKED', network: 'qortium', retryable: false }),
    post: async (route, request) => { calls.post.push(request); calls.postRoutes.push(route); return overrides.reply ?? response(200, '42') },
    principalKey: '7|tab-1',
    queue: createArrrCustodyReadQueue(),
    queueTags: { hostWebContentsId: 1, tabId: 'tab-1' },
    requestValue: { coin: 'ARRR' },
    requireConsent: async () => { calls.consent += 1 },
    resolveRoute: async () => { calls.resolve += 1; return state.route },
    sameViewContext: (before, after) => before.tabId === after.tabId && before.windowId === after.windowId,
    ...overrides,
  }
  return { calls, deps, grants, state }
}

// Happy path: the entropy is posted once, to the re-resolved route, and the
// balance is delivered.
{
  const h = harness()
  assert.equal(await runHomeV2ArrrCustodyRead(h.deps), '42')
  assert.equal(h.calls.consent, 1)
  assert.equal(h.calls.seed, 1)
  assert.equal(h.calls.post.length, 1)
  assert.equal(h.calls.post[0].body, ENTROPY_V2_N0)
  assert.equal(h.calls.post[0].pathname, '/crosschain/arrr/walletbalance?verified=true')
  assert.ok(h.calls.resolve >= 4, 'route resolved before consent, after approval, after the queue wait and after the HTTP await')
}
// Denial: consent refused → no seed access, no derivation, no post.
{
  const h = harness({ requireConsent: async () => { throw new Error('Account access was denied.') } })
  await assert.rejects(runHomeV2ArrrCustodyRead(h.deps), /denied/)
  assert.equal(h.calls.seed, 0)
  assert.equal(h.calls.post.length, 0)
}
// Untrusted or locked before the prompt: no prompt at all.
{
  const h = harness()
  h.state.route = trustedRoute({ apiKey: '', bindingId: '', reason: 'public-node', revision: '', trusted: false })
  await assert.rejects(runHomeV2ArrrCustodyRead(h.deps), (error: unknown) => (error as { code?: string }).code === 'NODE_CAPABILITY_MISSING')
  assert.equal(h.calls.consent, 0)
  const locked = harness()
  locked.state.unlocked = false
  await assert.rejects(runHomeV2ArrrCustodyRead(locked.deps), (error: unknown) => (error as { code?: string }).code === 'ACCOUNT_LOCKED')
  assert.equal(locked.calls.consent, 0)
  assert.equal(locked.calls.seed, 0)
}
// Trust revoked while the request waits in the queue → never dispatched.
{
  const h = harness()
  let release!: () => void
  const blocker = h.deps.queue.run(h.state.route.nodeRoute, () => new Promise<void>((resolve) => { release = () => resolve() }), { principalKey: 'other' })
  const read = observed(runHomeV2ArrrCustodyRead(h.deps))
  // Let the read reach the queue (consent + post-approval checks complete).
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(h.calls.consent, 1)
  h.state.route = trustedRoute({ apiKey: '', bindingId: '', reason: 'key-missing', revision: '', trusted: false })
  release()
  await blocker
  await assert.rejects(read, (error: unknown) => (error as { code?: string }).code === 'NODE_CAPABILITY_MISSING')
  assert.equal(h.calls.seed, 0, 'no seed was read')
  assert.equal(h.calls.post.length, 0, 'nothing was dispatched to the old node')
}
// Route or credential changed (same URL, new key/binding) while queued → not dispatched.
for (const change of [{ bindingId: 'binding-2' }, { revision: 'CREDENTIAL-DIGEST-other' }, { nodeApiUrl: 'https://other.example', nodeRoute: 'custom|https://other.example' }] as const) {
  const h = harness()
  let release!: () => void
  const blocker = h.deps.queue.run(h.state.route.nodeRoute, () => new Promise<void>((resolve) => { release = () => resolve() }), { principalKey: 'other' })
  const read = observed(runHomeV2ArrrCustodyRead(h.deps))
  await new Promise((resolve) => setTimeout(resolve, 0))
  h.state.route = trustedRoute(change)
  release()
  await blocker
  await assert.rejects(read, new RegExp(ARRR_CUSTODY_ROUTE_CHANGED_MESSAGE.slice(0, 30)))
  assert.equal(h.calls.post.length, 0, `no dispatch after ${JSON.stringify(change)}`)
}
// Account locked DURING the HTTP round trip → the balance is not delivered.
{
  const h = harness({ post: undefined })
  h.deps = { ...h.deps, post: async (route, request) => { h.calls.post.push(request); h.state.unlocked = false; return response(200, '42') } }
  await assert.rejects(runHomeV2ArrrCustodyRead(h.deps), new RegExp(ARRR_CUSTODY_CONTEXT_CHANGED_MESSAGE.slice(0, 30)))
  assert.equal(h.calls.post.length, 1, 'the request went out before the lock')
}
// Tab/app context changed or the view is gone during the round trip → not delivered.
{
  const gone = harness()
  gone.deps = { ...gone.deps, post: async () => { gone.state.context = { ...gone.state.context, tabId: 'tab-2' }; return response(200, '42') } }
  await assert.rejects(runHomeV2ArrrCustodyRead(gone.deps), /context changed/)
  const switched = harness()
  switched.deps = { ...switched.deps, post: async () => { switched.state.context = { ...switched.state.context, accountId: 'acct-2' }; return response(200, '42') } }
  await assert.rejects(runHomeV2ArrrCustodyRead(switched.deps), /context changed/)
  const drifted = harness()
  drifted.deps = { ...drifted.deps, post: async () => { drifted.state.live = false; return response(200, '42') } }
  await assert.rejects(runHomeV2ArrrCustodyRead(drifted.deps), /context changed/)
}
// Consent invalidated by a lifecycle event (lock, account change, node change,
// tab closed) during the round trip → not delivered; navigation inside the
// app is not an invalidation of a custody consent's tab, so it still delivers.
for (const [kind, delivered] of [['locked', false], ['account-changed', false], ['node-changed', false], ['tab-closed', false], ['app-replaced', false]] as const) {
  const h = harness()
  h.deps = { ...h.deps, post: async () => {
    h.grants.invalidate(1, { kind, network: 'qortium', tabId: 'tab-1' })
    return response(200, '42')
  } }
  if (delivered) assert.equal(await runHomeV2ArrrCustodyRead(h.deps), '42')
  else await assert.rejects(runHomeV2ArrrCustodyRead(h.deps), /context changed/, `${kind} must block delivery`)
}
{
  const h = harness()
  h.deps = { ...h.deps, post: async () => { h.grants.invalidate(2, { kind: 'locked', network: 'qortium', tabId: 'tab-1' }); return response(200, '42') } }
  assert.equal(await runHomeV2ArrrCustodyRead(h.deps), '42', 'another host window\'s lifecycle does not affect this read')
}
// Route changed DURING the round trip (same trust, new key) → not delivered.
{
  const h = harness()
  h.deps = { ...h.deps, post: async () => { h.state.route = trustedRoute({ revision: 'CREDENTIAL-DIGEST-new' }); return response(200, '42') } }
  await assert.rejects(runHomeV2ArrrCustodyRead(h.deps), /changed before the ARRR wallet read completed/)
}
// Review finding 3: no error the orchestrator throws — busy, transport,
// malformed, context — carries the credential digest, and a serialized bridge
// error built from one carries only the PUBLIC route revision.
{
  const digest = 'CREDENTIAL-DIGEST-8f3a'
  const cases: Array<Partial<ArrrCustodyReadDeps<TestContext>> & { reply?: ArrrCustodyResponse }> = [
    { reply: response(409, '', { error: 9, message: 'ARRR_WALLET_BUSY' }) },
    { post: async () => { throw new Error('fetch failed') } },
    { reply: response(200, 'not-a-number') },
  ]
  for (const overrides of cases) {
    const h = harness(overrides)
    let thrown: unknown
    try { await runHomeV2ArrrCustodyRead(h.deps) } catch (error) { thrown = error }
    assert.ok(thrown instanceof Error)
    const serialized = JSON.stringify(encodeQdnBridgeError(thrown))
    assert.ok(!serialized.includes(digest), 'no credential digest in the serialized error')
    assert.ok(!JSON.stringify({ ...(thrown as object), message: (thrown as Error).message }).includes(digest))
    assert.ok(!serialized.includes(ENTROPY_V2_N0))
  }
  const bridgeError = createHomeV2BridgeError(ARRR_WALLET_BUSY_MESSAGE, {
    action: 'GET_WALLET_BALANCE', code: ARRR_WALLET_BUSY_CODE, network: 'qortium', retryable: true, routeRevision: 'home-v2-route-v1-0badcafe',
  })
  const envelope = encodeQdnBridgeError(bridgeError) as Record<string, Record<string, unknown>>
  const payload = Object.values(envelope)[0]
  assert.equal(payload.routeRevision, 'home-v2-route-v1-0badcafe')
  assert.equal(payload.code, ARRR_WALLET_BUSY_CODE)
}
// Review round 2: a switch that lands DURING the awaited resolveRoute() —
// account, tab, resource, lock, consent — is caught by the full validation
// that follows the await: before the seed is read (no seed, no post) and
// before delivery (result dropped). The resolver is a controllable promise so
// the mutation happens strictly inside the await.
type Mutation = (h: ReturnType<typeof harness>) => void
const mutations: ReadonlyArray<readonly [string, Mutation]> = [
  ['account switched', (h) => { h.state.context = { ...h.state.context, accountId: 'acct-2' } }],
  ['tab changed', (h) => { h.state.context = { ...h.state.context, tabId: 'tab-2' } }],
  ['live resource drifted', (h) => { h.state.live = false }],
  ['account locked', (h) => { h.state.unlocked = false }],
  ['consent invalidated', (h) => { h.grants.invalidate(1, { kind: 'locked', network: 'qortium', tabId: 'tab-1' }) }],
  ['view gone', (h) => { h.state.viewGone = true }],
]
// Pre-seed: the validation that follows the queue wait resolves the route;
// mutate during THAT resolution (the third resolver call).
for (const [label, mutate] of mutations) {
  const h = harness()
  let resolves = 0
  h.deps = { ...h.deps, resolveRoute: () => {
    resolves += 1
    if (resolves === 3) {
      return new Promise<ArrrCustodyRoute>((resolve) => setTimeout(() => { mutate(h); resolve(h.state.route) }, 0))
    }
    return Promise.resolve(h.state.route)
  } }
  await assert.rejects(runHomeV2ArrrCustodyRead(h.deps), /context changed/, `pre-seed: ${label}`)
  assert.equal(resolves, 3, `pre-seed: ${label} — the mutated resolution was the pre-seed one`)
  assert.equal(h.calls.seed, 0, `pre-seed: ${label} — no seed read`)
  assert.equal(h.calls.post.length, 0, `pre-seed: ${label} — nothing posted`)
}
// Pre-delivery: the request went out; mutate during the resolution that
// follows the HTTP await (the fourth resolver call). Nothing is delivered.
for (const [label, mutate] of mutations) {
  const h = harness()
  let resolves = 0
  h.deps = { ...h.deps, resolveRoute: () => {
    resolves += 1
    if (resolves === 4) {
      return new Promise<ArrrCustodyRoute>((resolve) => setTimeout(() => { mutate(h); resolve(h.state.route) }, 0))
    }
    return Promise.resolve(h.state.route)
  } }
  await assert.rejects(runHomeV2ArrrCustodyRead(h.deps), /context changed/, `pre-delivery: ${label}`)
  assert.equal(resolves, 4, `pre-delivery: ${label} — the mutated resolution was the pre-delivery one`)
  assert.equal(h.calls.post.length, 1, `pre-delivery: ${label} — the request had gone out`)
}
// The same two windows for a ROUTE change during the resolution.
for (const call of [3, 4]) {
  const h = harness()
  let resolves = 0
  h.deps = { ...h.deps, resolveRoute: () => {
    resolves += 1
    if (resolves === call) return new Promise<ArrrCustodyRoute>((resolve) => setTimeout(() => resolve(trustedRoute({ bindingId: 'binding-2' })), 0))
    return Promise.resolve(h.state.route)
  } }
  await assert.rejects(runHomeV2ArrrCustodyRead(h.deps), new RegExp(ARRR_CUSTODY_ROUTE_CHANGED_MESSAGE.slice(0, 30)))
  assert.equal(h.calls.post.length, call === 3 ? 0 : 1)
}
// Without a mutation the same controllable resolver delivers.
{
  const h = harness()
  h.deps = { ...h.deps, resolveRoute: () => new Promise<ArrrCustodyRoute>((resolve) => setTimeout(() => resolve(h.state.route), 0)) }
  assert.equal(await runHomeV2ArrrCustodyRead(h.deps), '42')
  assert.equal(h.calls.resolve, 0, 'the default resolver was replaced')
}

// A superseded status poll settles (rejected) and never derives.
{
  const h = harness({ action: HOME_V2_ARRR_SYNC_STATUS_ACTION, reply: response(200, JSON.stringify(FULL_STATUS), FULL_STATUS), requestValue: {} })
  let release!: () => void
  const blocker = h.deps.queue.run(h.state.route.nodeRoute, () => new Promise<void>((resolve) => { release = () => resolve() }), { principalKey: 'other' })
  const stale = observed(runHomeV2ArrrCustodyRead(h.deps))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const fresh = runHomeV2ArrrCustodyRead(h.deps)
  await new Promise((resolve) => setTimeout(resolve, 0))
  release()
  await blocker
  await assert.rejects(stale, (error: unknown) => isArrrCustodyError(error, ARRR_READ_SUPERSEDED_CODE))
  assert.equal((await fresh as { state: string }).state, 'SYNCHRONIZING')
  assert.equal(h.calls.seed, 1, 'only the surviving poll derived')
}

console.log('ARRR custody read adapter tests passed.')

// Partial native history must survive the custody whitelist without becoming zero.
{
  const rows = projectArrrTransactions([
    { txHash: 'pending', metadataComplete: false, pending: true, totalAmount: null, feeAmount: null },
    { txHash: 'restored', metadataComplete: false, pending: false, totalAmount: null, feeAmount: null, totalAmountEstimate: -90, feeAmountEstimate: 10 },
    { txHash: 'known', metadataComplete: true, pending: false, totalAmount: 100, feeAmount: 0 },
  ])
  assert.equal(rows.length, 3)
  assert.equal(rows[0].totalAmount, null)
  assert.equal(rows[0].feeAmount, null)
  assert.equal(rows[0].pending, true)
  assert.equal(rows[1].totalAmountEstimate, -90)
  assert.equal(rows[1].feeAmountEstimate, 10)
  assert.equal(rows[2].totalAmount, 100)
  assert.throws(() => projectArrrTransactions([{ txHash: 'bad', totalAmount: null }]), /invalid ARRR transaction list/)
  assert.throws(() => projectArrrTransactions([{ txHash: 'bad', metadataComplete: true, pending: false, totalAmount: null }]), /invalid ARRR transaction list/)
  assert.throws(() => projectArrrTransactions([{ txHash: 'bad', metadataComplete: false, pending: false, totalAmount: null, totalAmountEstimate: '90' }]), /invalid ARRR transaction list/)
}

assert.throws(() => projectArrrTransactions([{ txHash: 'contradictory', metadataComplete: false, pending: false, totalAmount: 100 }]), /invalid ARRR transaction list/)

// Explicit sessions share the same custody/context boundary, but never post a
// native-selecting read for passive observations.
for (const operation of ['status', 'activate'] as const) {
  const session = { contract: 'qortium-arrr-wallet-session-v1', revision: '11111111-1111-1111-1111-111111111111', enabled: true, relation: 'SELF', lifecycle: 'RUNNING', address: null }
  const h = harness({ action: 'GET_ARRR_WALLET_SESSION', sessionRequest: { operation, ...(operation === 'activate' ? { expectedRevision: session.revision } : {}) }, reply: response(200, JSON.stringify(session), session) })
  assert.deepEqual(await runHomeV2ArrrCustodyRead(h.deps), session)
  assert.equal(h.calls.post[0].pathname, '/crosschain/arrr/walletsession')
  assert.equal(h.calls.post[0].contentType, 'application/json')
  const request = JSON.parse(h.calls.post[0].body)
  assert.equal(request.operation, operation)
  assert.equal(request.entropy58, ENTROPY_V2_N0)
  assert.equal(request.expectedRevision, operation === 'activate' ? session.revision : undefined)
  const denied = harness({ ...h.deps, requireConsent: async () => { throw new Error('denied') } })
  await assert.rejects(runHomeV2ArrrCustodyRead(denied.deps), /denied/)
  assert.equal(denied.calls.seed, 0)
  assert.equal(denied.calls.post.length, 0)
}
{
  const failure = classifyArrrCustodyFailure(response(409, '', { message: 'ARRR_WALLET_NOT_ACTIVE' }), 'syncstatus')
  assert.equal(failure.code, 'ARRR_WALLET_NOT_ACTIVE')
  assert.equal(failure.retryable, false)
}
