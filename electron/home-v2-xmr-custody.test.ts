import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  HomeXmrCustody,
  withXmrSeed,
  isLocalXmrRoute,
  type XmrDeps,
  type XmrTransport,
} from './home-v2-xmr-custody.js'
import {
  createXmrOwnerStore,
  type XmrOwnerRecord,
  type XmrOwnerStore,
} from './home-v2-xmr-owner-store.js'
import { projectXmrWallet, parseXmrSession, validateXmrRequest } from './xmr-wallet-contract.js'
import { normalizeHomeV2ReadPath } from './home-v2-app-actions.js'
import { getNodeApiPath } from './qdn-request-values.js'
import { homeV2PermissionGrantFamily } from './home-v2-session-grants.js'
const session = '00000000-0000-0000-0000-000000000001'
const laterSession = '00000000-0000-0000-0000-000000000002'
const route = {
  apiKey: 'synthetic-key',
  bindingId: 'binding',
  nodeApiUrl: 'http://127.0.0.1:12391',
  nodeRoute: 'local',
  revision: 'revision',
  trusted: true,
  reason: null,
}
const fixtures = JSON.parse(
  readFileSync(new URL('../electron/fixtures/xmr-derivation-v1.json', import.meta.url), 'utf8'),
).fixtures as {
  masterSeed: string
  coinSeed: string
  spend: string
  nonce: number
  walletVersion: number
  address: string
}[]
const idFor = (spend: string) =>
  createHash('sha256')
    .update(
      Buffer.concat([
        Buffer.from('Qortium/XMR/mainnet/derivation-v1/identity\0'),
        Buffer.from(spend, 'hex'),
      ]),
    )
    .digest('hex')
const walletId = idFor(fixtures[0].spend)
const cap = {
  protocolVersion: 1,
  derivationVersion: 1,
  decimals: 12,
  enabled: true,
  platformSupported: true,
  network: 'mainnet',
  localCustodyOnly: true,
  send: false,
}
const ready = () => ({
  sessionId: session,
  walletId,
  state: 'READY',
  send: false,
  updatedAt: 1,
  wallet: {
    address: fixtures[0].address,
    height: 123,
    targetHeight: 123,
    synced: true,
    balanceAtomic: '9007199254740993',
    unlockedAtomic: '1',
    transactions: [],
  },
})
const memoryStore = (): XmrOwnerStore => {
  let value: XmrOwnerRecord | undefined
  return {
    list: () => (value ? [value] : []),
    get: () => value,
    put: (r) => {
      value = { ...r }
    },
    remove: (r) => {
      if (JSON.stringify(value) === JSON.stringify(r)) value = undefined
    },
  }
}
const deps = (action: XmrDeps['action'] = 'ACTIVATE_XMR_WALLET'): XmrDeps => ({
  action,
  request: { action },
  accountId: 'public-account',
  host: 1,
  tab: 'tab',
  resolveRoute: async () => route,
  validate: () => {},
  consent: async () => {},
  captureConsent: () => () => true,
  getSeed: () => ({
    seed: Buffer.from(fixtures[0].masterSeed, 'hex'),
    walletVersion: 1,
    addressIndex: 0,
  }),
})
function setup() {
  const calls: string[] = []
  const store = memoryStore()
  let active = false
  const transport: XmrTransport = async (_r, p, _m, _b, token) => {
    calls.push(p)
    if (p.endsWith('capabilities')) return { ok: true, status: 200, data: cap }
    if (p.endsWith('/activate')) {
      active = true
      return { ok: true, status: 200, data: ready() }
    }
    if (p.endsWith('/session'))
      return {
        ok: true,
        status: 200,
        data: active ? ready() : { sessionId: null, walletId: null, state: 'IDLE' },
      }
    if (p.endsWith('/deactivate')) {
      assert.equal(token, session)
      active = false
      return { ok: true, status: 200, data: {} }
    }
    assert.equal(token, session)
    return { ok: true, status: 200, data: ready() }
  }
  return { calls, store, transport, manager: new HomeXmrCustody(transport, store, async () => {}) }
}
test('all six public derivation fixtures match Core and erase inputs', async () => {
  for (const f of fixtures) {
    const seed = Buffer.from(f.masterSeed, 'hex')
    await withXmrSeed(
      { seed, addressIndex: f.nonce, walletVersion: f.walletVersion },
      async (coin, id) => {
        assert.equal(coin, f.coinSeed)
        assert.equal(id, idFor(f.spend))
      },
    )
    assert(seed.every((b) => b === 0))
  }
  const bad = Buffer.alloc(32, 42)
  await assert.rejects(
    withXmrSeed({ seed: bad, addressIndex: -1, walletVersion: 1 }, async () => {}),
  )
  assert(bad.every((b) => b === 0))
})
test('strict numeric loopback and dedicated paths only, including encoded paths', () => {
  assert(isLocalXmrRoute(route))
  for (const url of [
    'http://localhost:12391',
    'https://remote.invalid',
    'http://127.0.0.1@evil.invalid',
    'http://127.0.0.1/path',
  ])
    assert(!isLocalXmrRoute({ ...route, nodeApiUrl: url }))
  for (const p of [
    '/crosschain/xmr',
    '/crosschain/xmr/wallet',
    '/crosschain/%78mr/session',
    '/crosschain%2fxmr/wallet',
    '/crosschain/%2578mr/session',
    '/crosschain/foo/../xmr',
    '/crosschain;x=1/xmr/wallet',
    '/crosschain//xmr/wallet',
  ]) {
    assert.throws(() => normalizeHomeV2ReadPath(p))
    assert.throws(() => getNodeApiPath(p, route.nodeApiUrl))
  }
  assert.equal(normalizeHomeV2ReadPath('/crosschain/blockchains'), '/crosschain/blockchains')
  assert.notEqual(
    homeV2PermissionGrantFamily('GET_XMR_WALLET', 'xmr-custody-read'),
    homeV2PermissionGrantFamily('ACTIVATE_XMR_WALLET', 'xmr-custody-read'),
  )
  assert.throws(() =>
    validateXmrRequest('ACTIVATE_XMR_WALLET', {
      action: 'ACTIVATE_XMR_WALLET',
      coinSeed: 'untrusted',
    }),
  )
})
test('read never derives or activates; denial occurs before seed access', async () => {
  const s = setup()
  const read = deps('GET_XMR_WALLET')
  read.getSeed = () => {
    throw Error('seed touched')
  }
  assert.equal((await s.manager.run(read)).state, 'INACTIVE')
  assert(!s.calls.some((p) => p.endsWith('/activate')))
  const denied = deps()
  denied.consent = async () => {
    throw Error('denied')
  }
  denied.getSeed = read.getSeed
  const before = s.calls.length
  await assert.rejects(s.manager.run(denied), /denied/)
  assert.equal(s.calls.length, before)
})
test('activation persists intent before dispatch and output strips authority; navigation preserves it', async () => {
  const s = setup()
  const manager = new HomeXmrCustody(async (...args) => {
    if (args[1].endsWith('/activate'))
      assert.equal(s.store.get(route.nodeApiUrl)?.walletId, walletId)
    return s.transport(...args)
  }, s.store)
  const result = await manager.run(deps())
  assert.equal(result.wallet?.balanceAtomic, '9007199254740993')
  assert(!JSON.stringify(result).includes(walletId))
  assert(!JSON.stringify(result).includes(session))
  manager.invalidate(1, 'navigation-changed', 'tab')
  manager.invalidate(1, 'node-changed', null, 'qortal')
  assert.equal((await manager.run(deps('GET_XMR_WALLET'))).state, 'READY')
  assert(!s.calls.some((p) => p.endsWith('/deactivate')))
  manager.invalidate(1, 'locked', null)
  await new Promise((resolve) => setImmediate(resolve))
  assert(s.calls.some((p) => p.endsWith('/deactivate')))
})
test('lock while activation is in flight withholds response and cleans exact session', async () => {
  const s = setup()
  let valid = true
  const d = deps()
  d.validate = () => {
    if (!valid) throw Error('locked')
  }
  const manager = new HomeXmrCustody(
    async (...args) => {
      const r = await s.transport(...args)
      if (args[1].endsWith('/activate')) valid = false
      return r
    },
    s.store,
    async () => {},
  )
  await assert.rejects(manager.run(d), /locked/)
  await new Promise((resolve) => setImmediate(resolve))
  assert(s.calls.some((p) => p.endsWith('/deactivate')))
})
test('restart recovers only the exact owned session and transient failures retain evidence', async () => {
  const s = setup()
  await s.manager.run(deps())
  let failures = 1
  const restarted = new HomeXmrCustody(
    async (...args) => {
      if (failures-- > 0) throw Error('offline')
      return s.transport(...args)
    },
    s.store,
    async () => {},
  )
  assert(await restarted.recover(route))
  assert.equal(s.store.get(route.nodeApiUrl), undefined)
  s.store.put({ nodeApiUrl: route.nodeApiUrl, walletId, session, previousSession: null })
  let deactivated = false
  const otherOwner = new HomeXmrCustody(async (_r, p) => {
    if (p.endsWith('/deactivate')) deactivated = true
    return { ok: true, status: 200, data: { ...ready(), sessionId: laterSession } }
  }, s.store)
  assert(await otherOwner.recover(route))
  assert(!deactivated)
  s.store.put({ nodeApiUrl: route.nodeApiUrl, walletId, session, previousSession: null })
  const offline = new HomeXmrCustody(
    async () => {
      throw Error('offline')
    },
    s.store,
    async () => {},
  )
  assert.equal(await offline.recover(route), false)
  assert(s.store.get(route.nodeApiUrl))
})
test('lost activation reply is fenced against late dispatch, without resending its seed', async () => {
  const store = memoryStore()
  let posts = 0
  let currentSession: string | null = null
  let fenced = false
  const manager = new HomeXmrCustody(
    async (_r, p, _m, _b, token) => {
      if (p.endsWith('/capabilities')) return { ok: true, status: 200, data: cap }
      if (p.endsWith('/activate')) {
        posts++
        throw Error('lost')
      }
      if (p.endsWith('/deactivate')) {
        assert.equal(token, undefined)
        currentSession = laterSession
        fenced = true
        return { ok: true, status: 200, data: {} }
      }
      return {
        ok: true,
        status: 200,
        data: { sessionId: currentSession, walletId: null, state: 'IDLE' },
      }
    },
    store,
    async () => {},
  )
  await assert.rejects(manager.run(deps()))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(posts, 1)
  assert(fenced)
  assert.notEqual(currentSession, null)
  assert.equal(store.get(route.nodeApiUrl), undefined)
})
test('definitive rejection releases intent and an unresolved other route blocks activation', async () => {
  const s = setup()
  const manager = new HomeXmrCustody(
    async (...args) =>
      args[1].endsWith('/activate') ? { ok: false, status: 409, data: {} } : s.transport(...args),
    s.store,
  )
  await assert.rejects(manager.run(deps()))
  assert.equal(s.store.get(route.nodeApiUrl), undefined)
  s.store.put({ nodeApiUrl: 'http://127.0.0.1:12392', walletId, session, previousSession: null })
  assert.equal((await manager.run(deps())).state, 'CLEANUP_REQUIRED')
  assert(!s.calls.some((p) => p.endsWith('/activate')))
})
test('journal is durable, private and rejects malformed records', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xmr-owner-'))
  try {
    const store = createXmrOwnerStore(dir)
    const r = { nodeApiUrl: route.nodeApiUrl, walletId, session, previousSession: null }
    store.put(r)
    assert.deepEqual(createXmrOwnerStore(dir).get(route.nodeApiUrl), r)
    assert.equal(statSync(path.join(dir, 'home-v2-xmr-custody.json')).mode & 0o777, 0o600)
    store.remove(r)
    assert.equal(store.get(route.nodeApiUrl), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('projection rejects wrong owner, malformed UUID, duplicate history and numeric atomic balances', () => {
  assert.throws(() => parseXmrSession({ sessionId: '-'.repeat(36), walletId, state: 'READY' }))
  assert.throws(() => projectXmrWallet(ready(), laterSession, walletId))
  const v = ready()
  assert.throws(() =>
    projectXmrWallet({ ...v, wallet: { ...v.wallet, balanceAtomic: 1 } }, session, walletId),
  )
  const tx = {
    txid: 'a'.repeat(64),
    timestamp: 1,
    height: 1,
    confirmed: true,
    incomingAtomic: '1',
    outgoingAtomic: '0',
    feeAtomic: '0',
  }
  assert.throws(() =>
    projectXmrWallet({ ...v, wallet: { ...v.wallet, transactions: [tx, tx] } }, session, walletId),
  )
})

test('opening cleanup spans the native deadline rather than abandoning custody after four seconds', async () => {
  const store = memoryStore()
  store.put({ nodeApiUrl: route.nodeApiUrl, walletId, session, previousSession: null })
  let closes = 0
  let elapsed = 0
  const manager = new HomeXmrCustody(
    async (_r, p, _m, _b, token) => {
      if (p.endsWith('/deactivate')) {
        assert.equal(token, session)
        closes++
        return { ok: elapsed >= 90000, status: elapsed >= 90000 ? 200 : 409, data: {} }
      }
      return { ok: true, status: 200, data: { ...ready(), state: 'OPENING' } }
    },
    store,
    async () => {
      elapsed += 2000
    },
  )
  assert(await manager.recover(route))
  assert.equal(closes, 46)
  assert.equal(store.get(route.nodeApiUrl), undefined)
})
test('failed durable session update still removes the original intent after successful close', async () => {
  const s = setup()
  let writes = 0
  const store = {
    ...s.store,
    put: (r: XmrOwnerRecord) => {
      if (++writes === 2) throw Error('fsync failed')
      s.store.put(r)
    },
  }
  const manager = new HomeXmrCustody(s.transport, store, async () => {})
  await assert.rejects(manager.run(deps()), /fsync failed/)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(store.get(route.nodeApiUrl), undefined)
  assert(s.calls.some((p) => p.endsWith('/deactivate')))
})
test('exact rejected activation exposes its state and permits a single explicit retry', async () => {
  const s = setup()
  let rejected = false
  const manager = new HomeXmrCustody(async (...args) => {
    if (args[1].endsWith('/wallet') && rejected) return { ok: false, status: 409, data: {} }
    if (args[1].endsWith('/session') && rejected)
      return {
        ok: true,
        status: 200,
        data: { sessionId: session, walletId: null, state: 'ACTIVATION_REJECTED' },
      }
    return s.transport(...args)
  }, s.store)
  await manager.run(deps())
  rejected = true
  assert.equal((await manager.run(deps('GET_XMR_WALLET'))).state, 'ACTIVATION_REJECTED')
  assert.equal(s.store.get(route.nodeApiUrl), undefined)
  rejected = false
  assert.equal((await manager.run(deps())).state, 'READY')
  assert.equal(s.calls.filter((p) => p.endsWith('/activate')).length, 2)
})
test('reading a different account cannot stop or switch the live owner', async () => {
  const s = setup()
  await s.manager.run(deps())
  const other = deps('GET_XMR_WALLET')
  other.accountId = 'other-account'
  assert.equal((await s.manager.run(other)).state, 'INACTIVE')
  assert(!s.calls.some((p) => p.endsWith('/deactivate')))
  assert.equal(s.calls.filter((p) => p.endsWith('/activate')).length, 1)
})

test('XMR advertising requires desktop numeric-loopback custody and excludes widgets', async () => {
  const {
    getHomeV2AppRouteDescriptor,
    getHomeV2AvailableAppActions,
    getHomeV2ContextualAppActions,
  } = await import('./home-v2-app-runtime.js')
  const descriptor = (nodeApiUrl: string, platform: 'desktop' | 'android' = 'desktop') =>
    getHomeV2AppRouteDescriptor({
      platform,
      network: 'qortium',
      protocol: 'qdnRequest',
      accountId: 'public-account',
      node: {
        mode: 'custom',
        customConfigured: true,
        customAuthenticated: true,
        adminTrusted: true,
        capabilities: { read: true },
        nodeApiUrl,
      },
    })
  for (const [url, platform, expected] of [
    ['http://127.0.0.1:12391', 'desktop', true],
    ['http://[::1]:12391', 'desktop', true],
    ['http://127.0.0.1:12391', 'android', false],
    ['https://remote.invalid', 'desktop', false],
  ] as const) {
    const route = descriptor(url, platform)
    const actions = getHomeV2AvailableAppActions('qdnRequest', { qortium: route, qortal: route })
    assert.equal(actions.includes('GET_XMR_WALLET'), expected)
    assert.equal(actions.includes('ACTIVATE_XMR_WALLET'), expected)
    for (const action of ['PREPARE_XMR_SEND', 'COMMIT_XMR_SEND', 'CANCEL_XMR_SEND', 'GET_XMR_SEND_STATUS']) {
      assert.equal(actions.includes(action), expected)
      assert(!getHomeV2ContextualAppActions(actions, 'widget').includes(action))
    }
    assert(!getHomeV2ContextualAppActions(actions, 'widget').includes('GET_XMR_WALLET'))
  }
})

test('permission wiring keeps passive reads promptless and activation single-request', () => {
  const bridge = readFileSync(new URL('../electron/home-v2-app-bridge.ts', import.meta.url), 'utf8')
  const ui = readFileSync(new URL('../src/home-v2-live/HomeV2LiveApp.tsx', import.meta.url), 'utf8')
  assert(bridge.includes("const singleRequestOnly = action === 'ACTIVATE_XMR_WALLET'"))
  const grant = bridge.indexOf(
    'if (!singleRequestOnly && sessionAccountReadGrants.has(grantKey)) return',
  )
  const passive = bridge.indexOf(
    "writeDetails?.kind === 'xmr-custody-read' && writeDetails.passive === true",
  )
  const prompt = bridge.indexOf('const hostWindow = getContextWindow(context)', passive)
  assert(grant >= 0 && passive > grant && prompt > passive)
  assert(ui.includes('!isXmrAction(value.action) &&'))
  assert(
    ui.includes(
      "isXmrCustodyRead && value.action === 'ACTIVATE_XMR_WALLET'\n          ? ['single-request']",
    ),
  )
})

test('definitive replacement rejection preserves the previous wallet cleanup journal', async () => {
  const s = setup()
  let reject = false
  const manager = new HomeXmrCustody(
    async (...args) =>
      reject && args[1].endsWith('/activate')
        ? { ok: false, status: 409, data: {} }
        : s.transport(...args),
    s.store,
  )
  await manager.run(deps())
  const original = s.store.get(route.nodeApiUrl)
  reject = true
  const other = deps()
  other.accountId = 'other-account'
  other.getSeed = () => ({
    seed: Buffer.from(fixtures[3].masterSeed, 'hex'),
    walletVersion: 2,
    addressIndex: 0,
  })
  await assert.rejects(manager.run(other))
  assert.deepEqual(s.store.get(route.nodeApiUrl), original)
  const restarted = new HomeXmrCustody(s.transport, s.store, async () => {})
  assert(await restarted.recover(route))
  assert.equal(s.store.get(route.nodeApiUrl), undefined)
  assert(s.calls.some((p) => p.endsWith('/deactivate')))
})

test('scan progress survives stale balances, is bounded, and strips private extras', () => {
  const progress = { scanId: laterSession, startHeight: 10, height: 50, targetHeight: 100, updatedAt: 1234 }
  const input = { ...ready(), state: 'STALE', wallet: null, progress: { ...progress, secret: 'never-project' } }
  const result = projectXmrWallet(input, session, walletId)
  assert.deepEqual(result.progress, progress)
  assert.equal(result.wallet, null)
  assert.equal('sessionId' in result, false)
  assert.equal(projectXmrWallet(ready(), session, walletId).progress, null)
  for (const patch of [{ scanId: 'bad' }, { startHeight: 51 }, { height: 101 }, { targetHeight: 0 },
    { updatedAt: -1 }, { height: 1.5 }, { targetHeight: 500000001 }]) {
    assert.throws(() => projectXmrWallet({ ...input, progress: { ...progress, ...patch } }, session, walletId))
  }
  assert.throws(() => projectXmrWallet(input, laterSession, walletId))
})
