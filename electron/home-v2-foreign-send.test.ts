// The foreign send orchestrator, driven end to end against fake dependencies.
//
// Nothing here touches a network, a filesystem or a real wallet: the seed is
// the public deterministic test vector shared with the spend-plan tests, the
// spend contexts are hand-built, and every Core call is a scripted recorder.
// What IS real is the planner, the signer, the journal state machine and the
// per-wallet operation lock, because those are the parts a mistake would cost
// money in.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import {
  addSignedForeignWalletPendingTransaction,
  confirmForeignWalletBroadcastSuccess,
  createEmptyForeignWalletTransactionJournal,
  findForeignWalletPendingTransactionConflict,
  markForeignWalletBroadcastAttempted,
  type ForeignWalletPendingTransaction,
  type ForeignWalletTransactionJournal,
} from './foreign-wallet-transaction-journal.js'
import { getForeignWalletMainnetChainId } from './foreign-wallet-spend-context.js'
import {
  deriveForeignWalletLeafPublicData,
  deriveForeignWalletPublicRuntime,
  type ForeignWalletCrypto,
} from './foreign-wallets.js'
import {
  executeHomeV2ForeignSend,
  HomeV2ForeignSendReconciliationError,
  type HomeV2ForeignSendDeps,
} from './home-v2-foreign-send.js'
import { createHomeV2PendingTransactionFromResult } from './home-v2-transaction-journal.js'

const PUBLIC_TEST_SEED = Uint8Array.from({ length: 32 }, (_value, index) => index + 1)
const WALLET_VERSION = 2
const NONCE = 0
const COIN = 'BTC' as const
const CHAIN_ID = getForeignWalletMainnetChainId(COIN)
const SPEND_CONTEXT_PATH = '/crosschain/btc/wallet/public/spend-context'
const BROADCAST_PATH = '/crosschain/btc/send/broadcast'

const cryptoAdapter: ForeignWalletCrypto = {
  ripemd160: (data) => Uint8Array.from(createHash('ripemd160').update(data).digest()),
  sha256: (data) => Uint8Array.from(createHash('sha256').update(data).digest()),
  sha512: (data) => Uint8Array.from(createHash('sha512').update(data).digest()),
}

const walletRuntime = deriveForeignWalletPublicRuntime({
  coin: COIN,
  crypto: cryptoAdapter,
  nonce: NONCE,
  seed: PUBLIC_TEST_SEED,
  walletVersion: WALLET_VERSION,
})
const RECIPIENT = leaf(90).address

// --- fixture builders -------------------------------------------------------

function leaf(index: number) {
  return deriveForeignWalletLeafPublicData({
    chain: 0,
    coin: COIN,
    crypto: cryptoAdapter,
    index,
    nonce: NONCE,
    seed: PUBLIC_TEST_SEED,
    walletVersion: WALLET_VERSION,
  })
}

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function le32(value: number) {
  return Uint8Array.of(
    value & 0xff,
    Math.floor(value / 0x100) & 0xff,
    Math.floor(value / 0x10000) & 0xff,
    Math.floor(value / 0x1000000) & 0xff,
  )
}

function le64(value: bigint) {
  const result = new Uint8Array(8)
  let remaining = value
  for (let index = 0; index < result.byteLength; index += 1) {
    result[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return result
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function fromHex(value: string) {
  return Uint8Array.from(
    { length: value.length / 2 },
    (_entry, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  )
}

function doubleSha256(bytes: Uint8Array) {
  return cryptoAdapter.sha256(cryptoAdapter.sha256(bytes))
}

function p2pkhScript(hash: Uint8Array) {
  return Uint8Array.of(0x76, 0xa9, 0x14, ...hash, 0x88, 0xac)
}

type FixtureUtxo = {
  address: string
  height: number
  outputIndex: number
  path: readonly number[]
  pathAsString: string
  rawTransactionHex: string
  scriptPubKeyHex: string
  txHash: string
  value: string
}

/**
 * A confirmed output paying the wallet's own leaf at `index`. The previous
 * transaction is a real (if minimal) serialization, so the signer's own
 * attestation — hash matches raw bytes, output matches the derivation path —
 * runs for real rather than against a stub.
 */
function fixtureUtxo(index: number, value: bigint, height: number): FixtureUtxo {
  const key = leaf(index)
  const script = p2pkhScript(cryptoAdapter.ripemd160(cryptoAdapter.sha256(key.publicKey)))
  const previous = concat(
    le32(1),
    Uint8Array.of(1),
    new Uint8Array(32),
    le32(0xffffffff),
    Uint8Array.of(1, 0),
    le32(0xffffffff),
    Uint8Array.of(1),
    le64(value),
    Uint8Array.of(script.byteLength),
    script,
    le32(0),
  )
  return {
    address: key.address,
    height,
    outputIndex: 0,
    path: [0, index],
    pathAsString: `M/0/${index}`,
    rawTransactionHex: toHex(previous),
    scriptPubKeyHex: toHex(script),
    txHash: toHex(Uint8Array.from(doubleSha256(previous)).reverse()),
    value: value.toString(),
  }
}

function spendContext(utxos: readonly FixtureUtxo[], overrides: Record<string, unknown> = {}) {
  const previousTransactions: Record<string, string> = {}
  for (const utxo of utxos) previousTransactions[utxo.txHash] = utxo.rawTransactionHex
  return {
    activeNetwork: 'MAIN',
    blockchain: 'BITCOIN',
    chainId: CHAIN_ID,
    confirmedOnly: true,
    currencyCode: 'BTC',
    lockTime: 0,
    minimumNonDustOutput: '546',
    previousTransactions,
    recommendedFeePerByte: '12',
    sequence: 0xffffffff,
    sighashType: 1,
    tipHeight: 1_000,
    transactionFormat: 'LEGACY',
    transactionVersion: 1,
    utxos: utxos.map((utxo) => ({
      address: utxo.address,
      height: utxo.height,
      outputIndex: utxo.outputIndex,
      path: utxo.path,
      pathAsString: utxo.pathAsString,
      scriptPubKeyHex: utxo.scriptPubKeyHex,
      txHash: utxo.txHash,
      value: utxo.value,
    })),
    version: 1,
    ...overrides,
  }
}

const UTXO_A = fixtureUtxo(0, 100_000n, 10)
const UTXO_B = fixtureUtxo(1, 200_000n, 20)
const UTXO_C = fixtureUtxo(2, 50_000n, 30)
const DEFAULT_CONTEXT = spendContext([UTXO_A, UTXO_B, UTXO_C])

// --- fake dependencies ------------------------------------------------------

type PostCall = { body: string; contentType: string; maxBytes: number; pathname: string }

type HarnessOptions = {
  approve?: (rows: readonly { label: string; value: string }[], meta: unknown) => Promise<void>
  appIdentity?: string
  broadcast?: (attempt: number) => unknown
  cleanupThrows?: boolean
  isStillValid?: () => Promise<boolean>
  recordSignedThrows?: boolean
  routes?: readonly { nodeApiUrl: string; revision: string }[]
  spendContexts?: readonly unknown[]
  startingJournal?: ForeignWalletTransactionJournal
}

function createHarness(options: HarnessOptions = {}) {
  const posts: PostCall[] = []
  const approvals: { meta: unknown; rows: readonly { label: string; value: string }[] }[] = []
  const seedCopies: Uint8Array[] = []
  let journal = options.startingJournal ?? createEmptyForeignWalletTransactionJournal()
  let clock = 1_700_000_000_000
  let spendContextReads = 0
  let broadcasts = 0
  let routeReads = 0

  const routes = options.routes ?? [{ nodeApiUrl: 'http://127.0.0.1:24891', revision: 'rev-1' }]
  const spendContexts = options.spendContexts ?? [DEFAULT_CONTEXT, DEFAULT_CONTEXT]

  const deps: HomeV2ForeignSendDeps = {
    appIdentity: options.appIdentity ?? 'qortium://APP/Wallet',
    approve: async (rows, meta) => {
      approvals.push({ meta, rows })
      if (options.approve) await options.approve(rows, meta)
    },
    crypto: cryptoAdapter,
    isStillValid: options.isStillValid ?? (async () => true),
    journal: {
      confirmBroadcastSuccess: (key, returnedTxId) => {
        if (options.cleanupThrows) {
          return { cleanupError: 'journal file is read-only', journalCleared: false }
        }
        try {
          journal = confirmForeignWalletBroadcastSuccess(journal, key, returnedTxId)
          return { journalCleared: true }
        } catch (error) {
          return {
            cleanupError: error instanceof Error ? error.message : String(error),
            journalCleared: false,
          }
        }
      },
      findConflict: (input) => findForeignWalletPendingTransactionConflict(journal, input),
      recordBroadcastAttempt: (key, now) => {
        journal = markForeignWalletBroadcastAttempted(journal, key, now)
        return journal
      },
      recordSigned: (entry) => {
        if (options.recordSignedThrows) throw new Error('journal write failed')
        journal = addSignedForeignWalletPendingTransaction(journal, entry)
        return journal
      },
    },
    now: () => clock,
    postTrusted: async (pathname, body, contentType, maxBytes) => {
      posts.push({ body, contentType, maxBytes, pathname })
      if (pathname === SPEND_CONTEXT_PATH) {
        const value = spendContexts[Math.min(spendContextReads, spendContexts.length - 1)]
        spendContextReads += 1
        if (value instanceof Error) throw value
        return value
      }
      if (pathname === BROADCAST_PATH) {
        broadcasts += 1
        const answer = options.broadcast ? options.broadcast(broadcasts) : null
        if (answer instanceof Error) throw answer
        return answer
      }
      throw new Error(`unexpected POST to ${pathname}`)
    },
    resolveRoute: async () => {
      const route = routes[Math.min(routeReads, routes.length - 1)]
      routeReads += 1
      return { apiKey: 'test-key', routeLabel: `local · ${route.nodeApiUrl}`, ...route }
    },
    withWalletSeed: (use) => {
      const seed = Uint8Array.from(PUBLIC_TEST_SEED)
      seedCopies.push(seed)
      try {
        return use(seed, NONCE, WALLET_VERSION)
      } finally {
        seed.fill(0)
      }
    },
  }

  return {
    advance: (milliseconds: number) => { clock += milliseconds },
    approvals,
    broadcastCount: () => broadcasts,
    deps,
    entries: () => journal.entries,
    posts,
    seedCopies,
  }
}

function broadcastPosts(posts: readonly PostCall[]) {
  return posts.filter((post) => post.pathname === BROADCAST_PATH)
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise
    assert.fail('expected a rejection')
  } catch (error) {
    return error as Error
  }
}

const FIXED_SEND = { amount: '0.001', coin: 'BTC', recipient: RECIPIENT }

// ---------------------------------------------------------------------------
// Happy path: one approval, one broadcast, the journal cleared.
//
// The txid only exists after signing, so a first run against a node that
// answers nothing reveals the deterministic value, which the real run then
// replays as the node's acknowledgement.

const probe = createHarness({ broadcast: () => null })
const probeResult = await executeHomeV2ForeignSend(FIXED_SEND, probe.deps)
const SIGNED_TX_ID = String(probeResult.txId)
assert.match(SIGNED_TX_ID, /^[0-9a-f]{64}$/)

const success = await (async () => {
  const harness = createHarness({ broadcast: () => SIGNED_TX_ID })
  const result = await executeHomeV2ForeignSend(FIXED_SEND, harness.deps)
  return { harness, result }
})()

assert.equal(success.result.accepted, true)
assert.equal(success.result.action, 'SEND_COIN')
assert.equal(success.result.coin, 'BTC')
assert.equal(success.result.chainId, CHAIN_ID)
assert.equal(success.result.network, 'qortium')
assert.equal(success.result.recipient, RECIPIENT)
assert.equal(success.result.journalCleared, true)
assert.equal(success.result.transactionHash, success.result.txId)
assert.equal(success.harness.entries().length, 0)
assert.equal(success.harness.broadcastCount(), 1)
assert.equal(success.harness.approvals.length, 1)

// The result NEVER carries the two fields the native Base58 journal keys on.
assert.equal('outcome' in success.result, false)
assert.equal('transactionSignature' in success.result, false)

const prepared = success.result.prepared as Record<string, unknown>
assert.equal(prepared.amount, '0.00100000')
assert.equal(prepared.fee, '0.00004512')
assert.equal(prepared.feePerByte, '0.00000012')
assert.equal(prepared.inputAmount, '0.00300000')
assert.equal(prepared.outputAmount, '0.00295488')
assert.equal(prepared.inputCount, 2)
assert.equal(prepared.outputCount, 2)
assert.equal(prepared.sendMax, false)
assert.equal(prepared.receivingAddress, RECIPIENT)
assert.equal(prepared.currencyCode, 'BTC')
assert.equal(prepared.activeNetwork, 'MAIN')
assert.equal(prepared.txHash, success.result.txId)
assert.equal('outcome' in prepared, false)
// Every money field is an 8-place decimal, so the wallet renderer passes it
// through instead of dividing a bare integer by 1e8 a second time.
for (const field of ['amount', 'fee', 'feePerByte', 'inputAmount', 'outputAmount']) {
  assert.match(String(prepared[field]), /^\d+\.\d{8}$/, field)
}

// The approval prompt described the same plan the signature commits to.
const approvalRows = success.harness.approvals[0].rows
assert.equal(approvalRows[0].value, '0.00100000 BTC (100000 satoshis)')
assert.equal(approvalRows[1].value, RECIPIENT)
assert.deepEqual(success.harness.approvals[0].meta, {
  chainId: CHAIN_ID,
  coin: 'BTC',
  kind: 'foreign-send',
  operationLabel: 'Send BTC',
  target: `foreign-send:BTC:${CHAIN_ID}:${RECIPIENT}:100000`,
})

// Case 4b + 11: request bodies pin the chain and carry no key material.
const contextPost = success.harness.posts.find((post) => post.pathname === SPEND_CONTEXT_PATH)
assert.ok(contextPost)
assert.deepEqual(JSON.parse(contextPost.body), {
  expectedChainId: CHAIN_ID,
  xpub58: walletRuntime.xpub58,
})
assert.equal(contextPost.maxBytes, 20 * 1024 * 1024)
const broadcastPost = broadcastPosts(success.harness.posts)[0]
const broadcastBody = JSON.parse(broadcastPost.body) as { expectedChainId: string; rawTransactionHex: string }
assert.equal(broadcastBody.expectedChainId, CHAIN_ID)
assert.match(broadcastBody.rawTransactionHex, /^[0-9a-f]+$/)
// A whitelist, not a blacklist: these are the ONLY two fields Home ever
// posts, so no key material can ride along in a third one.
assert.deepEqual(Object.keys(broadcastBody).sort(), ['expectedChainId', 'rawTransactionHex'])
for (const post of success.harness.posts) {
  assert.equal(post.body.toLowerCase().includes('xprv'), false)
  assert.equal(post.body.includes(toHex(PUBLIC_TEST_SEED)), false)
  assert.equal(post.body.includes(walletRuntime.address), false)
}
// The raw bytes hash back to the txid Home reported, so nothing was rewritten
// between signing and reporting.
assert.equal(
  toHex(Uint8Array.from(doubleSha256(fromHex(broadcastBody.rawTransactionHex))).reverse()),
  success.result.txId,
)
// Every seed copy the orchestrator was handed was zeroed on the way out.
for (const seed of success.harness.seedCopies) {
  assert.ok(seed.every((byte) => byte === 0))
}

// ---------------------------------------------------------------------------
// Case 1: a refused approval signs nothing and broadcasts nothing.

{
  const harness = createHarness({
    approve: async () => { throw new Error('Account access was denied.') },
  })
  const error = await rejection(executeHomeV2ForeignSend(FIXED_SEND, harness.deps))
  assert.match(error.message, /Account access was denied/)
  assert.equal(harness.entries().length, 0)
  assert.equal(broadcastPosts(harness.posts).length, 0)
}

// ---------------------------------------------------------------------------
// Case 2: route revision drift refuses BEFORE signing.

{
  const harness = createHarness({
    routes: [
      { nodeApiUrl: 'http://127.0.0.1:24891', revision: 'rev-1' },
      { nodeApiUrl: 'http://127.0.0.1:24891', revision: 'rev-2' },
    ],
  })
  const error = await rejection(executeHomeV2ForeignSend(FIXED_SEND, harness.deps))
  assert.match(error.message, /node or its API key changed/)
  assert.equal(harness.entries().length, 0)
  assert.equal(broadcastPosts(harness.posts).length, 0)
}

{
  const harness = createHarness({
    routes: [
      { nodeApiUrl: 'http://127.0.0.1:24891', revision: 'rev-1' },
      { nodeApiUrl: 'http://127.0.0.2:24891', revision: 'rev-1' },
    ],
  })
  const error = await rejection(executeHomeV2ForeignSend(FIXED_SEND, harness.deps))
  assert.match(error.message, /node or its API key changed/)
}

{
  const harness = createHarness({ isStillValid: async () => false })
  const error = await rejection(executeHomeV2ForeignSend(FIXED_SEND, harness.deps))
  assert.match(error.message, /changed before the foreign send was staged/)
  assert.equal(broadcastPosts(harness.posts).length, 0)
}

// ---------------------------------------------------------------------------
// Case 3: input drift after approval refuses.

{
  // A planned outpoint disappeared.
  const harness = createHarness({
    spendContexts: [DEFAULT_CONTEXT, spendContext([UTXO_B, UTXO_C])],
  })
  const error = await rejection(executeHomeV2ForeignSend(FIXED_SEND, harness.deps))
  assert.match(error.message, /no longer spendable/)
  assert.equal(harness.entries().length, 0)
}

{
  // A planned outpoint changed value: the same txHash reported with a
  // different amount is a lying node, not a re-plan.
  const mutated = spendContext([UTXO_A, UTXO_B, UTXO_C])
  mutated.utxos[0] = { ...mutated.utxos[0], value: '99999' }
  const harness = createHarness({ spendContexts: [DEFAULT_CONTEXT, mutated] })
  const error = await rejection(executeHomeV2ForeignSend(FIXED_SEND, harness.deps))
  assert.match(error.message, /changed after approval/)
}

{
  const harness = createHarness({
    spendContexts: [
      DEFAULT_CONTEXT,
      spendContext([UTXO_A, UTXO_B, UTXO_C], { recommendedFeePerByte: '13' }),
    ],
  })
  const error = await rejection(executeHomeV2ForeignSend(FIXED_SEND, harness.deps))
  assert.match(error.message, /chain state changed after the send was approved/)
}

{
  const harness = createHarness({
    spendContexts: [DEFAULT_CONTEXT, spendContext([UTXO_A, UTXO_B, UTXO_C], { minimumNonDustOutput: '1000' })],
  })
  const error = await rejection(executeHomeV2ForeignSend(FIXED_SEND, harness.deps))
  assert.match(error.message, /chain state changed after the send was approved/)
}

// ---------------------------------------------------------------------------
// Case 4: a spend context for another chain is refused outright.

{
  const harness = createHarness({
    spendContexts: [spendContext([UTXO_A], { chainId: `bip122:${'44'.repeat(16)}` })],
  })
  const error = await rejection(executeHomeV2ForeignSend(FIXED_SEND, harness.deps))
  assert.match(error.message, /different chain/)
  assert.equal(broadcastPosts(harness.posts).length, 0)
}

// A Core that cannot reach a wallet server must say so, never "no funds".
{
  const coreError = Object.assign(new Error(JSON.stringify({ error: 1201 })), { status: 500 })
  const harness = createHarness({ spendContexts: [coreError] })
  const error = await rejection(executeHomeV2ForeignSend(FIXED_SEND, harness.deps))
  assert.match(error.message, /wallet backend is unavailable/)
  assert.equal((error as { code?: string }).code, 'FOREIGN_WALLET_BACKEND_UNAVAILABLE')
}

// ---------------------------------------------------------------------------
// Case 5: dust. Amounts under the node's floor refuse; dust change is absorbed
// into the fee rather than created as an unspendable output.

{
  const harness = createHarness()
  const error = await rejection(executeHomeV2ForeignSend(
    { amount: '0.00000500', coin: 'BTC', recipient: RECIPIENT },
    harness.deps,
  ))
  assert.match(error.message, /below the minimum non-dust output/)
  assert.equal(harness.approvals.length, 0)
}

{
  // 100,000 in, 97,584 out: the 100-satoshi remainder is below the 546 floor,
  // so it becomes fee and no change output exists.
  const single = spendContext([UTXO_A])
  const harness = createHarness({
    broadcast: () => null,
    spendContexts: [single, single],
  })
  const result = await executeHomeV2ForeignSend(
    { amount: '0.00097584', coin: 'BTC', recipient: RECIPIENT },
    harness.deps,
  )
  const dustPrepared = result.prepared as Record<string, unknown>
  assert.equal(dustPrepared.fee, '0.00002416')
  assert.equal(dustPrepared.outputCount, 1)
  assert.equal(dustPrepared.outputAmount, '0.00097584')
  assert.equal(harness.approvals[0].rows.some((row) => row.label === 'Change back to you'), false)
}

// ---------------------------------------------------------------------------
// Case 6: send max. No change, fee = rate x the estimated maximum size, and a
// balance that cannot cover the fee refuses.

{
  const harness = createHarness({ broadcast: () => null })
  const result = await executeHomeV2ForeignSend(
    { coin: 'BTC', recipient: RECIPIENT, sendMax: true },
    harness.deps,
  )
  const maxPrepared = result.prepared as Record<string, unknown>
  assert.equal(maxPrepared.sendMax, true)
  assert.equal(maxPrepared.inputCount, 3)
  assert.equal(maxPrepared.outputCount, 1)
  assert.equal(maxPrepared.inputAmount, '0.00350000')
  // 3 inputs + 1 P2PKH output = 491 bytes at 12 satoshis per byte.
  assert.equal(maxPrepared.fee, '0.00005892')
  assert.equal(maxPrepared.amount, '0.00344108')
  assert.equal(maxPrepared.outputAmount, '0.00344108')
  assert.ok(harness.approvals[0].rows.some((row) => row.label === 'Send max'))
  assert.equal(harness.approvals[0].rows.some((row) => row.label === 'Change back to you'), false)
}

{
  const tiny = spendContext([fixtureUtxo(3, 1_000n, 40)])
  const harness = createHarness({ spendContexts: [tiny, tiny] })
  const error = await rejection(executeHomeV2ForeignSend(
    { coin: 'BTC', recipient: RECIPIENT, sendMax: true },
    harness.deps,
  ))
  assert.match(error.message, /cannot cover the send-max fee/)
  assert.equal(harness.approvals.length, 0)
}

// A wallet with nothing confirmed says exactly that.
{
  const empty = spendContext([])
  const harness = createHarness({ spendContexts: [empty, empty] })
  const error = await rejection(executeHomeV2ForeignSend(FIXED_SEND, harness.deps))
  assert.match(error.message, /no confirmed spendable inputs/)
}

// ---------------------------------------------------------------------------
// Case 7: exactly one broadcast, whatever the node answers.

for (const failure of [
  Object.assign(new Error('Foreign wallet request returned HTTP 500.'), { status: 500 }),
  Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }),
]) {
  const harness = createHarness({ broadcast: () => failure })
  const result = await executeHomeV2ForeignSend(FIXED_SEND, harness.deps)
  assert.equal(result.accepted, false)
  assert.equal(result.foreignOutcome, 'unknown')
  assert.equal(result.retryable, false)
  assert.equal(result.errorType, 'FOREIGN_BROADCAST_UNKNOWN')
  assert.equal('outcome' in result, false)
  assert.equal('transactionSignature' in result, false)
  assert.equal(harness.broadcastCount(), 1, 'a signed foreign transaction is broadcast at most once')
}

// ---------------------------------------------------------------------------
// Case 8: an ambiguous broadcast retains the entry at broadcast-attempted, and
// a second send over the same outputs refuses until it is reconciled.

{
  const harness = createHarness({
    broadcast: () => Object.assign(new Error('socket hang up'), { status: 0 }),
  })
  const result = await executeHomeV2ForeignSend(FIXED_SEND, harness.deps)
  assert.equal(result.foreignOutcome, 'unknown')
  const [retained] = harness.entries()
  assert.ok(retained)
  assert.equal(retained.stage, 'broadcast-attempted')
  assert.equal(retained.coin, 'BTC')
  assert.equal(retained.chainId, CHAIN_ID)
  assert.equal(retained.appIdentity, 'qortium://APP/Wallet')
  assert.equal(retained.txId, result.txId)
  assert.deepEqual(
    [...retained.outpoints].map((outpoint) => outpoint.txHash).sort(),
    [UTXO_A.txHash, UTXO_B.txHash].sort(),
  )

  const retry = createHarness({ startingJournal: { entries: harness.entries(), version: 1 as const } })
  const error = await rejection(executeHomeV2ForeignSend(FIXED_SEND, retry.deps))
  assert.ok(error instanceof HomeV2ForeignSendReconciliationError)
  assert.equal((error as HomeV2ForeignSendReconciliationError).code, 'FOREIGN_SEND_RECONCILIATION_REQUIRED')
  assert.ok(error.message.includes(String(result.txId)))
  assert.equal(retry.approvals.length, 0, 'a conflicted send never reaches the user')
  assert.equal(broadcastPosts(retry.posts).length, 0)
}

// ---------------------------------------------------------------------------
// Case 9: the node acknowledged a different transaction.

{
  const harness = createHarness({ broadcast: () => 'ab'.repeat(32) })
  const result = await executeHomeV2ForeignSend(FIXED_SEND, harness.deps)
  assert.equal(result.accepted, false)
  assert.equal(result.foreignOutcome, 'mismatch')
  assert.equal(result.retryable, false)
  assert.equal(result.errorType, 'FOREIGN_BROADCAST_MISMATCH')
  assert.equal(harness.entries().length, 1)
  assert.equal(harness.entries()[0].stage, 'broadcast-attempted')
}

// A malformed acknowledgement is a mismatch too, never a silent success.
{
  const harness = createHarness({ broadcast: () => ({ txid: 'nope' }) })
  const result = await executeHomeV2ForeignSend(FIXED_SEND, harness.deps)
  assert.equal(result.foreignOutcome, 'mismatch')
  assert.equal(harness.entries().length, 1)
}

// ---------------------------------------------------------------------------
// Case 10: cleanup failure after an exact match is still an accepted send.

{
  const harness = createHarness({
    broadcast: () => SIGNED_TX_ID,
    cleanupThrows: true,
  })
  const result = await executeHomeV2ForeignSend(FIXED_SEND, harness.deps)
  assert.equal(result.accepted, true)
  assert.equal(result.journalCleared, false)
  assert.equal(result.cleanupError, 'journal file is read-only')
  assert.equal('outcome' in result, false)
}

// ---------------------------------------------------------------------------
// Case 12: a failed write-ahead means nothing is broadcast.

{
  const harness = createHarness({ recordSignedThrows: true })
  const error = await rejection(executeHomeV2ForeignSend(FIXED_SEND, harness.deps))
  assert.match(error.message, /journal write failed/)
  assert.equal(broadcastPosts(harness.posts).length, 0)
  assert.equal(harness.entries().length, 0)
}

// ---------------------------------------------------------------------------
// Case: an approval that sat open too long is never signed.

{
  const harness = createHarness({
    approve: async () => { harness.advance(11 * 60_000) },
  })
  const error = await rejection(executeHomeV2ForeignSend(FIXED_SEND, harness.deps))
  assert.match(error.message, /took too long/)
  assert.equal(broadcastPosts(harness.posts).length, 0)
}

// ---------------------------------------------------------------------------
// Case 13: two sends against the same wallet cannot interleave.

{
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const first = createHarness({ approve: async () => { await gate }, broadcast: () => null })
  const second = createHarness({ broadcast: () => null })
  const firstPromise = executeHomeV2ForeignSend(FIXED_SEND, first.deps)
  // Let the first call reach its approval, then start a second one.
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  const error = await rejection(executeHomeV2ForeignSend(FIXED_SEND, second.deps))
  assert.match(error.message, /already in progress for this wallet and coin/)
  assert.equal(second.approvals.length, 0)
  release()
  await firstPromise
}

// ---------------------------------------------------------------------------
// Case 14: no foreign result shape can ever poison the native Base58 journal.

for (const result of [
  success.result,
  { accepted: false, foreignOutcome: 'unknown', retryable: false, txId: 'ab'.repeat(32) },
  { accepted: false, foreignOutcome: 'mismatch', retryable: false, txId: 'ab'.repeat(32) },
  { accepted: true, journalCleared: false, txId: 'ab'.repeat(32) },
]) {
  assert.equal(
    createHomeV2PendingTransactionFromResult({
      accountId: 'account-1',
      action: 'SEND_COIN',
      appIdentity: 'qortium://APP/Wallet',
      protocol: 'qdnRequest',
      request: FIXED_SEND,
      result,
    }),
    null,
  )
}

console.log('home-v2-foreign-send tests passed.')
