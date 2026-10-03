import { createHash, randomUUID } from 'node:crypto'
import type { HomeXmrCustody, XmrDeps } from './home-v2-xmr-custody.js'
import type { XmrSendRecord, XmrSendStore } from './home-v2-xmr-send-store.js'
import { compatibleXmrSendCore, formatXmrAtomic, XMR_SEND_CONTRACT, XMR_SEND_ROWS, type XmrSendAction } from './xmr-send-contract.js'

const states = new Set(['PREPARING', 'PREPARED', 'CANCELLED', 'EXPIRED', 'PREPARE_FAILED', 'RELAYING', 'BROADCAST', 'UNKNOWN', 'CONFIRMED_WAIT', 'CONFIRMED'])
const terminal = new Set(['CANCELLED', 'EXPIRED', 'PREPARE_FAILED', 'CONFIRMED'])
const tombstone = new Set(['CANCELLED', 'EXPIRED', 'PREPARE_FAILED'])
const hash = (address: string, amount: string) => createHash('sha256').update(JSON.stringify([address, amount])).digest('hex')
const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const hex = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
export function normalizeXmrSend(action: XmrSendAction, input: Record<string, unknown>) {
  const fields = action === 'PREPARE_XMR_SEND' ? ['recipient', 'amount'] : action === 'GET_XMR_SEND_STATUS' ? ['handle', 'passive'] : ['handle']
  if (input.action !== action || Object.keys(input).some(k => !['action', 'coin', ...fields].includes(k)) ||
      (input.coin !== undefined && input.coin !== 'XMR') || (input.passive !== undefined && typeof input.passive !== 'boolean')) throw Error('Invalid XMR send request.')
  if (action !== 'PREPARE_XMR_SEND') {
    if (!(action === 'GET_XMR_SEND_STATUS' && input.handle === undefined) && (typeof input.handle !== 'string' || !uuid.test(input.handle))) throw Error('Invalid XMR operation handle.')
    return { handle: input.handle as string | undefined }
  }
  if (typeof input.recipient !== 'string' || !/^[48][1-9A-HJ-NP-Za-km-z]{94}$/.test(input.recipient) ||
      typeof input.amount !== 'string' || !/^(0|[1-9][0-9]{0,7})(\.[0-9]{1,12})?$/.test(input.amount)) throw Error('Enter an XMR address and exact amount with up to 12 decimals.')
  const [whole, fraction = ''] = input.amount.split('.')
  const amount = String(BigInt(whole) * 1000000000000n + BigInt(fraction.padEnd(12, '0')))
  formatXmrAtomic(amount)
  if (BigInt(amount) <= 0n) throw Error('XMR amount must be positive.')
  return { address: input.recipient, amount }
}
export type XmrOperation = {
  operationId: string; state: string; quoteDigest: string | null; address: string | null
  amountAtomic: string | null; feeAtomic: string | null; txid: string | null; walletHeld: boolean
  expiresAt: number; confirmations: number; unlocked: boolean
}
export function parseXmrOperation(value: unknown, record: XmrSendRecord): XmrOperation {
  const v = value as XmrOperation | null
  if (!v || typeof v !== 'object' || v.operationId !== record.operation || !states.has(v.state) || typeof v.walletHeld !== 'boolean' ||
      !Number.isSafeInteger(v.expiresAt) || v.expiresAt < 0 || !Number.isSafeInteger(v.confirmations) || v.confirmations < 0 || typeof v.unlocked !== 'boolean') throw Error('XMR operation could not be verified.')
  if (tombstone.has(v.state)) {
    if (v.address !== null || v.amountAtomic !== null || v.feeAtomic !== null || v.txid !== null || v.quoteDigest !== null) throw Error('Invalid XMR terminal operation.')
  } else {
    if (typeof v.address !== 'string' || !/^[48][1-9A-HJ-NP-Za-km-z]{94}$/.test(v.address) || typeof v.amountAtomic !== 'string' || hash(v.address, v.amountAtomic) !== record.requestHash) throw Error('XMR recipient or amount changed.')
    formatXmrAtomic(v.amountAtomic)
    if (v.state === 'PREPARING') {
      if (v.feeAtomic !== null || v.txid !== null || v.quoteDigest !== null) throw Error('Invalid XMR preparation.')
    } else {
      if (typeof v.feeAtomic !== 'string' || BigInt(v.feeAtomic) <= 0n || !hex(v.txid)) throw Error('Invalid XMR quote.')
      formatXmrAtomic(v.feeAtomic); formatXmrAtomic(String(BigInt(v.amountAtomic) + BigInt(v.feeAtomic)))
      if (v.state === 'PREPARED' ? !hex(v.quoteDigest) : v.quoteDigest !== null) throw Error('Invalid XMR quote binding.')
    }
  }
  if (v.state === 'CONFIRMED' && (v.confirmations < 10 || !v.unlocked)) throw Error('Unconfirmed XMR release.')
  if (!terminal.has(v.state) && !v.walletHeld) throw Error('Missing XMR recovery hold.')
  return { operationId: v.operationId, state: v.state, quoteDigest: v.quoteDigest, address: v.address, amountAtomic: v.amountAtomic, feeAtomic: v.feeAtomic, txid: v.txid, walletHeld: v.walletHeld, expiresAt: v.expiresAt, confirmations: v.confirmations, unlocked: v.unlocked }
}
const publicView = (r: XmrSendRecord, v: XmrOperation | null) => ({ contract: XMR_SEND_CONTRACT, handle: r.handle,
  state: v?.state ?? 'STATUS_REQUIRED', canCancelPreparation: r.phase === 'PREPARING' && (!v || ['PREPARING', 'PREPARED'].includes(v.state)), recipient: v?.address ?? null, amountAtomic: v?.amountAtomic ?? null,
  feeAtomic: v?.feeAtomic ?? null, txid: v?.txid ?? null, walletHeld: v?.walletHeld ?? true,
  expiresAt: v?.expiresAt ?? null, confirmations: v?.confirmations ?? 0, unlocked: v?.unlocked ?? false })
export type XmrSendDeps = Pick<XmrDeps, 'accountId' | 'host' | 'tab' | 'validate' | 'resolveRoute'> & {
  manager: HomeXmrCustody; store: XmrSendStore; app: string
  approve: (rows: readonly { label: string; value: string }[], operation: string, preparing?: boolean) => Promise<void>
}
export async function runXmrSend(action: XmrSendAction, input: Record<string, unknown>, deps: XmrSendDeps) {
  const request = normalizeXmrSend(action, input)
  return deps.manager.withSendOwner(deps, async io => {
    const call = (path: string, method: 'GET' | 'POST', body?: object) => io.call(io.route, '/crosschain/xmr/' + path, method, body ? JSON.stringify(body) : undefined, io.session)
    const capability = await call('capabilities', 'GET')
    if (!capability.ok || !compatibleXmrSendCore(capability.data)) throw Error('This Core does not support the reviewed XMR send protocol.')
    let record = deps.store.get(deps.accountId)
    const bound = (r: XmrSendRecord) => {
      if (r.app !== deps.app || r.tab !== deps.tab || r.route !== io.route.nodeApiUrl || r.wallet !== io.walletId ||
          (request.handle !== undefined && request.handle !== r.handle)) throw Error('An XMR operation belongs to another app, tab or node. Return there to check it.')
    }
    const read = async (r: XmrSendRecord, reconcile = true) => {
      const response = await call('send/status/' + r.operation, 'GET')
      if (!response.ok) return null
      let value = parseXmrOperation(response.data, r)
      if (reconcile && (!tombstone.has(value.state) || value.walletHeld) && !['PREPARING', 'PREPARED', 'RELAYING'].includes(value.state)) {
        const fresh = await call('send/reconcile', 'POST', { operationId: r.operation })
        if (fresh.status !== 200) return null
        value = parseXmrOperation(fresh.data, r)
      }
      return value
    }
    if (record) {
      if (record.route !== io.route.nodeApiUrl || record.wallet !== io.walletId) throw Error('Recover the XMR operation on its original node.')
      if (record.app !== deps.app || record.tab !== deps.tab) {
        if (action === 'GET_XMR_SEND_STATUS' && input.passive !== true && record.app === deps.app) {
          // Foreground recovery transfers the tab lease, never relay authority.
          const adopted = { ...record, tab: deps.tab }
          deps.store.put(adopted, record.handle); record = adopted; bound(record)
        } else if (action === 'PREPARE_XMR_SEND') {
          const previous = await read(record)
          if (!previous || !terminal.has(previous.state) || previous.walletHeld) throw Error('Recover the existing XMR operation in its originating app.')
        } else bound(record)
      } else bound(record)
    }
    if (action === 'GET_XMR_SEND_STATUS') return record ? publicView(record, await read(record)) : { contract: XMR_SEND_CONTRACT, handle: null, state: 'NONE', walletHeld: false }
    if (action === 'PREPARE_XMR_SEND') {
      if (record) {
        const prior = await read(record)
        if (!prior || !terminal.has(prior.state) || prior.walletHeld) { bound(record); return publicView(record, prior) }
      }
      const preparation = ['Monero (XMR)', 'Mainnet', request.address!, `${formatXmrAtomic(request.amount!)} XMR`, 'Calculated during preparation', 'Amount plus the prepared network fee', 'Native NORMAL priority; no broadcast', 'A separate exact-quote approval is required before relay.']
      await deps.approve(XMR_SEND_ROWS.map((label, i) => ({ label, value: preparation[i] })), 'prepare', true)
      await io.check()
      const next: XmrSendRecord = { account: deps.accountId, app: deps.app, tab: deps.tab, route: io.route.nodeApiUrl, wallet: io.walletId,
        handle: randomUUID(), operation: randomUUID(), session: io.session, phase: 'PREPARING', requestHash: hash(request.address!, request.amount!) }
      deps.store.put(next, record?.handle ?? null); record = next
      try {
        const response = await call('send/prepare', 'POST', { operationId: record.operation, address: request.address, amountAtomic: request.amount })
        return publicView(record, response.status === 200 ? parseXmrOperation(response.data, record) : null)
      } catch { await io.check(); return publicView(record, null) }
    }
    if (!record) throw Error('No XMR operation is available.')
    if (action === 'CANCEL_XMR_SEND') {
      const response = await call('send/cancel', 'POST', { operationId: record.operation })
      return publicView(record, response.status === 200 ? parseXmrOperation(response.data, record) : await read(record))
    }
    let quote = await read(record, false)
    if (record.phase === 'COMMITTING' || !quote || quote.state !== 'PREPARED') return publicView(record, quote)
    if (record.session !== io.session || quote.expiresAt <= Date.now()) throw Error('XMR quote expired; prepare again after cancellation.')
    const values = ['Monero (XMR)', 'Mainnet', quote.address!, `${formatXmrAtomic(quote.amountAtomic!)} XMR`, `${formatXmrAtomic(quote.feeAtomic!)} XMR`, `${formatXmrAtomic(String(BigInt(quote.amountAtomic!) + BigInt(quote.feeAtomic!)))} XMR`, 'Native NORMAL priority', 'Do not retry an uncertain outcome; wait for ten confirmations and unlocked inputs.']
    await deps.approve(XMR_SEND_ROWS.map((label, i) => ({ label, value: values[i] })), record.handle)
    await io.check()
    const current = await read(record, false)
    if (!current || current.state !== 'PREPARED' || JSON.stringify(current) !== JSON.stringify(quote) || current.expiresAt <= Date.now()) throw Error('XMR quote changed or expired after approval.')
    const committing: XmrSendRecord = { ...record, phase: 'COMMITTING' }
    deps.store.put(committing, record.handle); record = committing
    try {
      const response = await call('send/commit', 'POST', { operationId: record.operation, quoteDigest: quote.quoteDigest })
      return publicView(record, response.status === 200 ? parseXmrOperation(response.data, record) : null)
    } catch { await io.check(); return publicView(record, null) }
  })
}
