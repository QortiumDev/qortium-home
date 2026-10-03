import type { XmrOwnerStore, XmrOwnerRecord } from './home-v2-xmr-owner-store.js'
import { createHash } from 'node:crypto'
import type { ArrrCustodyRoute } from './home-v2-arrr-custody-read.js'
import {
  isNumericLoopbackXmrUrl,
  compatibleXmrCore,
  inactiveXmrWallet,
  parseXmrSession,
  projectXmrWallet,
  validateXmrRequest,
  XMR_UNAVAILABLE,
  type XmrAction,
} from './xmr-wallet-contract.js'

export function isLocalXmrRoute(route: ArrrCustodyRoute) {
  return route.trusted && isNumericLoopbackXmrUrl(route.nodeApiUrl)
}
export type XmrSeed = { seed: Uint8Array; addressIndex: number; walletVersion: number }
/** Privileged-only derivation. BigInt/String copies cannot be explicitly erased; never persist them. */
export async function withXmrSeed<T>(
  input: XmrSeed,
  use: (coinSeed: string, walletId: string) => Promise<T>,
): Promise<T> {
  const buffers: Buffer[] = []
  try {
    if (
      !Number.isSafeInteger(input.addressIndex) ||
      input.addressIndex < 0 ||
      input.addressIndex > 0xffffffff ||
      !Number.isSafeInteger(input.walletVersion) ||
      input.walletVersion < 1 ||
      !input.seed.length
    )
      throw new Error('Invalid XMR account seed context.')
    const own = (b: Buffer) => {
      buffers.push(b)
      return b
    }
    const hash = (algorithm: string, b: Uint8Array) => own(createHash(algorithm).update(b).digest())
    const master = own(Buffer.from(input.seed))
    const nonce = own(Buffer.alloc(4))
    nonce.writeUInt32BE(input.addressIndex)
    const material = own(Buffer.concat([nonce, master, nonce]))
    const account =
      input.walletVersion === 1
        ? master
        : hash('sha512', own(Buffer.concat([hash('sha512', material), material]))).subarray(0, 32)
    const reversed = own(Buffer.from(account)).reverse()
    const indicator = hash('sha256', own(Buffer.concat([reversed, Buffer.from('XMR')])))
    const coin = hash('sha512', own(Buffer.concat([reversed, indicator]))).subarray(0, 32)
    const order = (1n << 252n) + 27742317777372353535851937790883648493n
    let scalar = 0n
    for (let i = 31; i >= 0; i--) scalar = (scalar << 8n) + BigInt(coin[i])
    scalar %= order
    if (!scalar) throw new Error('Invalid XMR scalar.')
    const spend = own(Buffer.alloc(32))
    for (let i = 0; i < 32; i++) {
      spend[i] = Number(scalar & 255n)
      scalar >>= 8n
    }
    const id = hash(
      'sha256',
      own(Buffer.concat([Buffer.from('Qortium/XMR/mainnet/derivation-v1/identity\0'), spend])),
    ).toString('hex')
    return await use(coin.toString('hex'), id)
  } finally {
    for (const b of buffers) b.fill(0)
    input.seed.fill(0)
  }
}
export type XmrReply = { ok: boolean; status: number; data: unknown }
export type XmrTransport = (
  route: ArrrCustodyRoute,
  path: string,
  method: 'GET' | 'POST',
  body?: string,
  session?: string,
) => Promise<XmrReply>
export type XmrDeps = {
  action: XmrAction
  request: Record<string, unknown>
  accountId: string
  host: number
  tab: string
  resolveRoute: () => Promise<ArrrCustodyRoute>
  validate: () => void
  consent: (route: ArrrCustodyRoute) => Promise<void>
  captureConsent: () => () => boolean
  getSeed: () => XmrSeed
}
type Owner = {
  route: ArrrCustodyRoute
  accountId: string
  host: number
  tab: string
  session: string
  walletId: string
}
const sameRoute = (a: ArrrCustodyRoute, b: ArrrCustodyRoute) =>
  isLocalXmrRoute(b) &&
  a.nodeRoute === b.nodeRoute &&
  a.nodeApiUrl === b.nodeApiUrl &&
  a.revision === b.revision &&
  a.bindingId === b.bindingId

/** One bounded lane per trusted Core; normal reads never activate or seize its active wallet. */
export class HomeXmrCustody {
  private owners = new Map<string, Owner>()
  private tails = new Map<string, Promise<unknown>>()
  private counts = new Map<string, number>()
  private epochs = new Map<number, number>()
  private cleanups = new Map<string, Promise<boolean>>()
  constructor(
    private transport: XmrTransport,
    private store: XmrOwnerStore,
    private delay: () => Promise<void> = () =>
      new Promise((resolve) => {
        const timer = setTimeout(resolve, 2000)
        timer.unref()
      }),
    private cleanupAttempts = 46,
  ) {}
  /** Startup recovery only ever contacts the currently trusted local route. */
  async recover(route: ArrrCustodyRoute) {
    if (!isLocalXmrRoute(route)) return false
    const record = this.store.get(route.nodeApiUrl)
    return !record || (await this.releaseRecord(route, record))
  }
  private async lane<T>(key: string, work: () => Promise<T>): Promise<T> {
    const count = this.counts.get(key) ?? 0
    if (count >= 8) throw new Error('An XMR wallet request is already waiting. Please wait.')
    this.counts.set(key, count + 1)
    const pending = (this.tails.get(key) ?? Promise.resolve()).catch(() => {}).then(work)
    this.tails.set(key, pending)
    try {
      return await pending
    } finally {
      this.counts.set(key, (this.counts.get(key) ?? 1) - 1)
      if (this.tails.get(key) === pending) {
        this.tails.delete(key)
        this.counts.delete(key)
      }
    }
  }
  async run(deps: XmrDeps) {
    validateXmrRequest(deps.action, deps.request)
    deps.validate()
    const epoch = this.epochs.get(deps.host) ?? 0
    const initial = await deps.resolveRoute()
    deps.validate()
    if (!isLocalXmrRoute(initial)) throw new Error(XMR_UNAVAILABLE)
    await deps.consent(initial)
    const current = deps.captureConsent()
    const validate = async () => {
      const check = () => {
        deps.validate()
        if (!current() || (this.epochs.get(deps.host) ?? 0) !== epoch)
          throw new Error('XMR account access changed.')
      }
      check()
      const route = await deps.resolveRoute()
      check()
      if (!sameRoute(initial, route)) throw new Error('The XMR custody node changed.')
    }
    await validate()
    return this.lane(initial.nodeRoute, async () => {
      await validate()
      const capability = await this.transport(initial, '/crosschain/xmr/capabilities', 'GET')
      await validate()
      if (!capability.ok || !compatibleXmrCore(capability.data)) throw new Error(XMR_UNAVAILABLE)
      const liveOwner = this.owners.get(initial.nodeRoute)
      let owner = liveOwner
      if (owner && (owner.accountId !== deps.accountId || !sameRoute(owner.route, initial)))
        owner = undefined
      if (this.store.list().some((record) => record.nodeApiUrl !== initial.nodeApiUrl))
        return inactiveXmrWallet('CLEANUP_REQUIRED')
      if (!owner && liveOwner && deps.action === 'GET_XMR_WALLET') return inactiveXmrWallet()
      if (!owner && this.cleanups.has(initial.nodeApiUrl))
        return inactiveXmrWallet('CLEANUP_REQUIRED')
      if (!owner && !liveOwner && !(await this.recover(initial)))
        return inactiveXmrWallet('CLEANUP_REQUIRED')
      await validate()
      if (deps.action === 'ACTIVATE_XMR_WALLET' && !owner) {
        const before = await this.transport(initial, '/crosschain/xmr/session', 'GET')
        await validate()
        if (!before.ok) throw new Error('XMR wallet service is unavailable.')
        const previous = parseXmrSession(before.data)
        if (previous.state === 'OPENING' || previous.state === 'CLOSING')
          return inactiveXmrWallet('SWITCHING')
        const priorRecord = this.store.get(initial.nodeApiUrl)
        let activated: Owner | undefined
        let reservation: XmrOwnerRecord | undefined
        try {
          await withXmrSeed(deps.getSeed(), async (coinSeed, walletId) => {
            // Persist cleanup intent before handing any spending authority to Core.
            reservation = {
              nodeApiUrl: initial.nodeApiUrl,
              walletId,
              session: null,
              previousSession: previous.sessionId,
            }
            this.store.put(reservation)
            let response: XmrReply
            let unknown = false
            try {
              response = await this.transport(
                initial,
                '/crosschain/xmr/activate',
                'POST',
                JSON.stringify({
                  coinSeed,
                  derivationVersion: 1,
                  restoreHeight: 0,
                  expectedSession: previous.sessionId,
                }),
              )
            } catch {
              unknown = true
              // An activation response can be lost; reconcile once, never resend the secret request.
              response = await this.transport(initial, '/crosschain/xmr/session', 'GET')
            }
            if (!response.ok) {
              if (!unknown) {
                if (priorRecord) this.store.put(priorRecord)
                else this.store.remove(reservation)
                reservation = undefined
              }
              throw new Error('XMR activation did not complete. Check status before trying again.')
            }
            const session = parseXmrSession(response.data)
            if (session.walletId !== walletId || !session.sessionId)
              throw new Error('XMR activation ownership could not be verified.')
            activated = {
              route: initial,
              accountId: deps.accountId,
              host: deps.host,
              tab: deps.tab,
              session: session.sessionId,
              walletId,
            }
            reservation = { ...reservation, session: session.sessionId }
            this.store.put(reservation)
            await validate()
          })
          owner = activated
          if (owner) this.owners.set(initial.nodeRoute, owner)
        } catch (e) {
          if (reservation) void this.releaseRecord(initial, reservation).catch(() => {})
          throw e
        }
      }
      if (!owner) return inactiveXmrWallet()
      const response = await this.transport(
        initial,
        '/crosschain/xmr/wallet',
        'GET',
        undefined,
        owner.session,
      )
      await validate()
      if (response.status === 409) {
        this.owners.delete(initial.nodeRoute)
        const status = await this.transport(initial, '/crosschain/xmr/session', 'GET')
        await validate()
        if (status.ok) {
          const current = parseXmrSession(status.data)
          if (
            current.sessionId === owner.session &&
            current.state === 'ACTIVATION_REJECTED' &&
            current.walletId === null
          ) {
            const record = this.store.get(initial.nodeApiUrl)
            if (record?.session === owner.session) this.store.remove(record)
            return inactiveXmrWallet('ACTIVATION_REJECTED')
          }
        }
        return inactiveXmrWallet()
      }
      if (!response.ok) throw new Error('XMR wallet status is temporarily unavailable.')
      return projectXmrWallet(response.data, owner.session, owner.walletId)
    })
  }
  /** Send operations reuse already-approved custody; never derive or activate implicitly. */
  async withSendOwner<T>(deps: Pick<XmrDeps, 'accountId' | 'host' | 'tab' | 'validate' | 'resolveRoute'>,
    work: (io: { session: string; walletId: string; route: ArrrCustodyRoute; check: () => Promise<void>; call: XmrTransport }) => Promise<T>): Promise<T> {
    const epoch = this.epochs.get(deps.host) ?? 0
    const initial = await deps.resolveRoute()
    deps.validate()
    if (!isLocalXmrRoute(initial)) throw Error(XMR_UNAVAILABLE)
    return this.lane(initial.nodeRoute, async () => {
      const owner = this.owners.get(initial.nodeRoute)
      if (!owner || owner.accountId !== deps.accountId || !sameRoute(owner.route, initial)) throw Error('Activate this XMR wallet before sending.')
      const check = async () => {
        const verify = () => {
          deps.validate()
          if ((this.epochs.get(deps.host) ?? 0) !== epoch || this.owners.get(initial.nodeRoute) !== owner) throw Error('XMR custody changed.')
        }
        verify()
        const current = await deps.resolveRoute()
        verify()
        if (!sameRoute(initial, current)) throw Error('XMR node changed.')
      }
      const call: XmrTransport = async (route, path, method, body, session) => {
        if (route !== initial || session !== owner.session) throw Error('Invalid XMR send route.')
        await check()
        const result = await this.transport(route, path, method, body, session)
        await check()
        return result
      }
      await check()
      const result = await work({ session: owner.session, walletId: owner.walletId, route: initial, check, call })
      await check()
      return result
    })
  }
  /** Navigation preserves the scan; account/lock invalidation revokes app access immediately. */
  invalidate(host: number, kind: string, tab: string | null, network: string | null = null) {
    if (kind === 'navigation-changed' || (kind === 'node-changed' && network !== 'qortium')) return
    const global = ['account-changed', 'locked', 'node-changed'].includes(kind)
    if (global) this.epochs.set(host, (this.epochs.get(host) ?? 0) + 1)
    for (const [key, owner] of this.owners) {
      if (owner.host !== host || (!global && owner.tab !== tab)) continue
      this.owners.delete(key)
      void this.recover(owner.route).catch(() => {})
    }
  }
  shutdown() {
    for (const owner of this.owners.values()) void this.recover(owner.route).catch(() => {})
    this.owners.clear()
  }
  private releaseRecord(route: ArrrCustodyRoute, record: XmrOwnerRecord): Promise<boolean> {
    const existing = this.cleanups.get(route.nodeApiUrl)
    if (existing) return existing
    const work = this.cleanup(route, record).finally(() => this.cleanups.delete(route.nodeApiUrl))
    this.cleanups.set(route.nodeApiUrl, work)
    return work
  }
  private async cleanup(route: ArrrCustodyRoute, record: XmrOwnerRecord) {
    // Retry transient failures; an unresolved record blocks activation and survives Home restarts.
    for (let attempt = 0; attempt < this.cleanupAttempts; attempt++) {
      try {
        const reply = await this.transport(route, '/crosschain/xmr/session', 'GET')
        if (!reply.ok) throw new Error('XMR cleanup status is unavailable.')
        const current = parseXmrSession(reply.data)
        const owned = record.session
          ? current.sessionId === record.session
          : current.walletId === record.walletId || current.sessionId === record.previousSession
        const forget = () => {
          const stored = this.store.get(record.nodeApiUrl)
          // A failed session update can leave the original intent on disk. Remove only this reservation.
          if (
            stored &&
            stored.walletId === record.walletId &&
            stored.previousSession === record.previousSession &&
            (stored.session === null || stored.session === record.session)
          )
            this.store.remove(stored)
        }
        if (!owned) {
          forget()
          return true
        }
        // Fence an ambiguous POST against its old session, including initial null. Core rotates
        // the revision on deactivate; a late activation with expectedSession=old is then rejected.
        const closed = await this.transport(
          route,
          '/crosschain/xmr/deactivate',
          'POST',
          undefined,
          current.sessionId ?? undefined,
        )
        if (closed.ok) {
          forget()
          return true
        }
      } catch {
        /* Keep durable evidence; never assume a transport failure closed the wallet. */
      }
      if (attempt + 1 < this.cleanupAttempts) await this.delay()
    }
    return false
  }
}
