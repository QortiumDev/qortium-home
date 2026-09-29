import type { ArrrCustodyRoute } from './home-v2-arrr-custody-read.js'
import { bech32 } from '@scure/base'
import { createHash, randomUUID } from 'node:crypto'
import { base58Decode, base58Encode } from './base58.js'
import { homeV2MoneyField, assertHomeV2NoAppFeeOrGroup } from './home-v2-payment-actions.js'
import { withArrrEntropy58, type ArrrCustodyCrypto, type ArrrCustodyResponse } from './arrr-custody.js'
import { ARRR_SEND_ROWS, type ArrrSendOperation } from './arrr-send-contract.js'
import type { ArrrSendStore } from './home-v2-arrr-send-store.js'

/** Only the privileged transport can prove it refused before issuing fetch. */
export class ArrrSendBeforeDispatchError extends Error {}
export class ArrrSendStatusRequiredError extends Error {
  constructor() {
    super('ARRR send outcome needs checking. Do not send this payment again.')
  }
}
/** The production bridge uses this guard before derivation, dispatch and delivery. */
export async function assertArrrSendContext(
  pinned: ArrrCustodyRoute,
  resolveRoute: () => Promise<ArrrCustodyRoute>,
  validateNow: () => void,
) {
  validateNow()
  const current = await resolveRoute()
  validateNow()
  if (
    !pinned.trusted ||
    !current.trusted ||
    current.nodeRoute !== pinned.nodeRoute ||
    current.nodeApiUrl !== pinned.nodeApiUrl ||
    current.bindingId !== pinned.bindingId ||
    current.revision !== pinned.revision
  )
    throw new ArrrSendBeforeDispatchError('The trusted ARRR node changed.')
}
export function classifyArrrSendFailure(error: unknown, attempted: boolean) {
  return error instanceof ArrrSendStatusRequiredError || attempted
    ? { code: 'ARRR_SEND_STATUS_REQUIRED', message: new ArrrSendStatusRequiredError().message }
    : {
        code: 'ARRR_SEND_NOT_STARTED',
        message: 'The ARRR payment was not sent. Check the request, wallet readiness and approval.',
      }
}
export function isArrrSendRequest(action: string, request: Record<string, unknown>) {
  if (action !== 'SEND_COIN') return false
  try {
    return homeV2MoneyField(request, ['coin', 'blockchain'], 'Coin') === 'ARRR'
  } catch {
    return false
  } // The existing foreign normalizer rejects conflicting selectors.
}
export function normalizeArrrSend(request: Record<string, unknown>) {
  assertHomeV2NoAppFeeOrGroup(request)
  if (!isArrrSendRequest('SEND_COIN', request)) throw new Error('ARRR coin is required.')
  for (const field of ['feePerByte', 'sendMax', 'entropy58', 'xprv58', 'idempotencyKey']) {
    if (homeV2MoneyField(request, [field], field) !== undefined) throw new Error(`ARRR send does not accept ${field}.`)
  }
  const recipient = homeV2MoneyField(request, ['recipient', 'receivingAddress'], 'Recipient')
  const amount = homeV2MoneyField(request, ['amount', 'arrrAmount'], 'Amount')
  const memo = homeV2MoneyField(request, ['memo'], 'Memo')
  if (typeof recipient !== 'string' || !/^zs1[023456789acdefghjklmnpqrstuvwxyz]{75}$/.test(recipient))
    throw new Error('A Sapling ARRR address is required.')
  if (typeof amount !== 'string' || amount.length > 24 || !/^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/.test(amount))
    throw new Error('ARRR amount must be exact decimal text with up to 8 decimals.')
  try {
    const decoded = bech32.decode(recipient as `${string}1${string}`)
    if (decoded.prefix !== 'zs' || bech32.fromWords(decoded.words).length !== 43) throw new Error()
  } catch {
    throw new Error('The ARRR address checksum is invalid.')
  }
  const [whole, fraction = ''] = amount.split('.')
  const atomic = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'))
  if (atomic <= 0n || atomic + 10000n > 9223372036854775807n) throw new Error('ARRR amount is out of range.')
  if (
    memo !== undefined &&
    (typeof memo !== 'string' ||
      memo.length > 512 ||
      Buffer.byteLength(memo, 'utf8') > 512 ||
      /[\u0000-\u001f\u007f]/.test(memo) ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(memo))
  )
    throw new Error('ARRR memo must be valid text, at most 512 UTF-8 bytes.')
  return { recipient, amount: `${whole}.${fraction.padEnd(8, '0')}`, atomic, memo: memo as string | undefined }
}
export function parseArrrSendOperation(value: unknown, wallet: string, key: string): ArrrSendOperation {
  const v = value as Record<string, unknown> | null
  if (
    !v ||
    typeof v !== 'object' ||
    v.sendProtocolVersion !== 2 ||
    v.walletIdentityHash !== wallet ||
    v.idempotencyKey !== key ||
    typeof v.operationId !== 'string' ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v.operationId) ||
    v.network !== 'MAIN' ||
    !['ACCEPTED', 'NATIVE_STARTED', 'BROADCAST', 'FAILED', 'UNRESOLVED'].includes(String(v.state)) ||
    v.feePolicy !== 'FIXED' ||
    v.feeAtomic !== '10000' ||
    v.resolutionRequired !== (v.state === 'UNRESOLVED') ||
    (v.state === 'BROADCAST' ? typeof v.txid !== 'string' || !/^[0-9a-f]{64}$/.test(v.txid) : v.txid != null)
  )
    throw new Error('ARRR send response could not be verified. Do not send again.')
  return {
    operationId: v.operationId,
    idempotencyKey: key,
    walletIdentityHash: wallet,
    network: String(v.network),
    state: v.state as ArrrSendOperation['state'],
    txid: v.state === 'BROADCAST' ? (v.txid as string) : null,
    reason: typeof v.reason === 'string' && /^[A-Z0-9_]{1,80}$/.test(v.reason) ? v.reason : null,
    feeAtomic: '10000',
    feePolicy: 'FIXED',
    sendProtocolVersion: 2,
    resolutionRequired: v.state === 'UNRESOLVED',
  }
}
export type ArrrSendDeps = {
  accountId: string
  appIdentity: string
  route: string
  crypto: ArrrCustodyCrypto
  store: ArrrSendStore
  assertValid: () => Promise<void>
  consent: () => Promise<void>
  approve: (rows: readonly { label: string; value: string }[]) => Promise<void>
  getSeed: () => { seed: Uint8Array; addressIndex: number; walletVersion: number }
  post: (pathname: string, body: string, contentType: string) => Promise<ArrrCustodyResponse>
}
function walletIdentity(entropy58: string) {
  const raw = base58Decode(entropy58)
  try {
    return base58Encode(createHash('sha256').update(raw).digest())
  } finally {
    raw.fill(0)
  }
}
async function withAuthority<T>(deps: ArrrSendDeps, run: (entropy: string, wallet: string) => Promise<T>) {
  await deps.assertValid()
  const seed = deps.getSeed()
  try {
    return await withArrrEntropy58(
      { crypto: deps.crypto, nonce: seed.addressIndex, seed: seed.seed, walletVersion: seed.walletVersion },
      (entropy) => run(entropy, walletIdentity(entropy)),
    )
  } finally {
    seed.seed.fill(0)
  }
}
/** Reads never resend, even after a lost HTTP response or process restart. */
export async function readArrrSend(deps: ArrrSendDeps, action: string, consentGranted = false) {
  await deps.assertValid()
  if (!consentGranted) await deps.consent()
  await deps.assertValid()
  const pending = deps.store.get(deps.accountId)
  if (pending && (pending.route !== deps.route || pending.appIdentity !== deps.appIdentity))
    throw new Error('A pending ARRR send must be checked from its original app and trusted node.')
  const result = await withAuthority(deps, async (entropy, wallet) => {
    if (pending && !pending.receipt) {
      const reply = await deps.post(`/crosschain/arrr/sendlookup/${pending.idempotencyKey}`, entropy, 'text/plain')
      if (!reply.ok) throw new Error('The previous ARRR send could not be resolved. Do not send again.')
      const operation = parseArrrSendOperation(reply.data, wallet, pending.idempotencyKey)
      if (operation.state === 'BROADCAST' || operation.state === 'FAILED')
        deps.store.recordReceipt(deps.accountId, pending.idempotencyKey, operation)
      return { sendAllowed: false, operation, sendProtocolVersion: 2 }
    }
    if (action === 'GET_ARRR_SEND_OPERATION') return { operation: pending?.receipt ?? null, sendProtocolVersion: 2 }
    const reply = await deps.post('/crosschain/arrr/sendreadiness', entropy, 'text/plain')
    const data = reply.data as Record<string, unknown> | null
    if (
      !reply.ok ||
      !data ||
      data.sendProtocolVersion !== 2 ||
      typeof data.sendAllowed !== 'boolean' ||
      data.network !== 'MAIN'
    )
      throw new Error('ARRR send readiness is unavailable.')
    return {
      sendAllowed: data.sendAllowed === true && data.blockingOperationId == null,
      sendProtocolVersion: 2,
      operation: pending?.receipt ?? null,
      reason: data.sendAllowed ? null : 'ARRR_WALLET_NOT_READY',
    }
  })
  await deps.assertValid()
  return result
}
export async function executeArrrSend(request: Record<string, unknown>, deps: ArrrSendDeps) {
  const input = normalizeArrrSend(request)
  await deps.assertValid()
  await deps.consent()
  await deps.assertValid()
  const previous = deps.store.get(deps.accountId)
  if (previous && (!previous.receipt || request.acknowledgedOperationId !== previous.receipt.operationId))
    throw new Error('A previous ARRR send needs to be checked before sending again.')
  const readiness = await readArrrSend(deps, 'GET_ARRR_SEND_READINESS', true)
  if (!readiness.sendAllowed) throw new Error('The ARRR wallet is not ready to send.')
  const values = [
    'ARRR',
    'Pirate Chain mainnet',
    input.recipient,
    `${input.amount} ARRR (${input.atomic} atomic)`,
    '0.0001 ARRR (10000 atomic, fixed)',
    `${(input.atomic + 10000n) / 100000000n}.${((input.atomic + 10000n) % 100000000n).toString().padStart(8, '0')} ARRR`,
    input.memo || '(none)',
    previous?.receipt
      ? previous.receipt.state === 'BROADCAST'
        ? `Already broadcast: ${previous.receipt.txid}. This approval sends a NEW payment.`
        : 'Previous operation failed before sending. This is a new payment.'
      : '(none)',
  ]
  await deps.approve(ARRR_SEND_ROWS.map((label, i) => ({ label, value: values[i]! })))
  await deps.assertValid()
  const key = randomUUID()
  const operation = await withAuthority(deps, async (entropy, wallet) => {
    const neverSent = (): ArrrSendOperation => ({
      operationId: key,
      idempotencyKey: key,
      walletIdentityHash: wallet,
      network: 'MAIN',
      state: 'FAILED',
      txid: null,
      reason: 'ARRR_REQUEST_REJECTED',
      feeAtomic: '10000',
      feePolicy: 'FIXED',
      sendProtocolVersion: 2,
      resolutionRequired: false,
    })
    deps.store.reserve(
      { accountId: deps.accountId, appIdentity: deps.appIdentity, route: deps.route, idempotencyKey: key },
      previous?.receipt?.operationId,
    )
    try {
      let reply: ArrrCustodyResponse
      try {
        reply = await deps.post(
          '/crosschain/arrr/send',
          JSON.stringify({
            entropy58: entropy,
            receivingAddress: input.recipient,
            expectedNetwork: 'MAIN',
            arrrAmount: input.amount,
            memo: input.memo,
            idempotencyKey: key,
          }),
          'application/json',
        )
      } catch (error) {
        if (error instanceof ArrrSendBeforeDispatchError) return neverSent()
        throw error
      }
      if (!reply.ok) {
        const recovered = await deps.post(`/crosschain/arrr/sendlookup/${key}`, entropy, 'text/plain')
        if (recovered.ok) return parseArrrSendOperation(recovered.data, wallet, key)
        const rejection = reply.data as { error?: unknown } | null
        const missing = recovered.data as { error?: unknown } | null
        if (
          reply.status === 400 &&
          [102, 115, 125, 128].includes(Number(rejection?.error)) &&
          recovered.status === 404 &&
          missing?.error === 1206
        )
          return neverSent()
        throw new Error('ARRR send outcome needs checking. Do not send again.')
      }
      return parseArrrSendOperation(reply.data, wallet, key)
    } catch {
      throw new ArrrSendStatusRequiredError()
    }
  })
  if (operation.state === 'BROADCAST' || operation.state === 'FAILED')
    deps.store.recordReceipt(deps.accountId, key, operation)
  await deps.assertValid()
  return operation
}
