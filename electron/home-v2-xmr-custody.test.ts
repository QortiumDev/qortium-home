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
import { projectXmrWallet, parseXmrSession, validateXmrRequest, xmrPromptDetails, xmrGrantFamily } from './xmr-wallet-contract.js'
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
    '/crosschain/wallets/XMR',
    '/crosschain/wallets/%58MR/status',
    '/crosschain%2fwallets%2fxmr/stop',
    '/crosschain/wallets/%2558MR/status',
    '/crosschain/wallets;x=1/XMR/status',
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
    assert.equal(actions.includes('STOP_XMR_WALLET'), expected)
    assert(!getHomeV2ContextualAppActions(actions, 'widget').includes('STOP_XMR_WALLET'))
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
      "isXmrCustodyRead && isXmrControlAction(value.action)\n          ? ['single-request']",
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


test('stop has a separate grant and strict body, with honest key-free prompt details', () => {
  assert.equal(homeV2PermissionGrantFamily('STOP_XMR_WALLET', 'xmr-custody-read'), 'account.xmr-custody.stop')
  assert.notEqual(xmrGrantFamily('STOP_XMR_WALLET'), xmrGrantFamily('GET_XMR_WALLET'))
  assert.notEqual(xmrGrantFamily('STOP_XMR_WALLET'), xmrGrantFamily('ACTIVATE_XMR_WALLET'))
  for (const extra of [{session:'app-token'}, {passive:true}, {coinSeed:'app-key'}, {coin:'ARRR'}])
    assert.throws(() => validateXmrRequest('STOP_XMR_WALLET', {action:'STOP_XMR_WALLET', ...extra}))
  const rows = xmrPromptDetails('Selected account', 'Local Core', 'stop')
  assert(rows.some(row => row.value.includes('no keys are transferred')))
  assert(rows.some(row => row.value.includes('current wallet operation finishes')))
  const bridge = readFileSync(new URL('../electron/home-v2-app-bridge.ts', import.meta.url), 'utf8')
  const ui = readFileSync(new URL('../src/home-v2-live/HomeV2LiveApp.tsx', import.meta.url), 'utf8')
  assert(bridge.includes("action === 'STOP_XMR_WALLET' ||"))
  assert(bridge.includes('writeSingleRequestOnly: isXmrControlAction(action)'))
  assert(ui.includes("isXmrCustodyRead && isXmrControlAction(value.action)\n          ? ['single-request']"))
  assert(bridge.includes('stopContract: XMR_STOP_CONTRACT'))
})
test('stop revokes only its known owner, derives no seed, and reads never reactivate', async () => {
  const s = setup()
  const manager = new HomeXmrCustody(async (...args) => {
    const response = await s.transport(...args)
    return args[1].endsWith('/deactivate') ? {...response, data:{sessionId:laterSession,walletId:null,state:'CLOSING'}} : response
  }, s.store)
  await manager.run(deps())
  const before = s.calls.length
  const stop = deps('STOP_XMR_WALLET')
  stop.getSeed = () => { throw Error('stop accessed seed') }
  const reply = await manager.run(stop)
  assert.equal(reply.state, 'STOPPED')
  assert.equal(reply.wallet, null)
  assert.equal(JSON.stringify(reply).includes(session), false)
  assert.equal(s.store.list().length, 0)
  assert.deepEqual(s.calls.slice(before), ['/crosschain/xmr/capabilities','/crosschain/xmr/deactivate'])
  assert.equal((await manager.run(deps('GET_XMR_WALLET'))).state, 'INACTIVE')
  assert.equal(s.calls.filter(p => p.endsWith('/activate')).length, 1)
  await manager.run(deps())
  assert.equal(s.calls.filter(p => p.endsWith('/activate')).length, 2)
})
test('inactive, wrong-account and denied stops cannot stop or recover another wallet', async () => {
  const s = setup()
  assert.equal((await s.manager.run(deps('STOP_XMR_WALLET'))).state, 'INACTIVE')
  await s.manager.run(deps())
  const record = s.store.get(route.nodeApiUrl)
  const stop = deps('STOP_XMR_WALLET')
  stop.accountId = 'other-account'
  assert.equal((await s.manager.run(stop)).state, 'INACTIVE')
  stop.accountId = 'public-account'
  stop.consent = async () => { throw Error('denied') }
  await assert.rejects(s.manager.run(stop), /denied/)
  assert(!s.calls.some(p => p.endsWith('/deactivate')))
  assert.deepEqual(s.store.get(route.nodeApiUrl), record)
})
test('lost stop reply reconciles once without replaying or stopping a replacement owner', async () => {
  for (const replacement of [false,true]) {
    const s = setup()
    let stopped = false
    const manager = new HomeXmrCustody(async (...args) => {
      if (args[1].endsWith('/deactivate')) {
        await s.transport(...args)
        stopped = true
        throw Error('lost reply')
      }
      if (stopped && args[1].endsWith('/session')) {
        s.calls.push(args[1])
        return {ok:true,status:200,data:{sessionId:laterSession,walletId:replacement?'f'.repeat(64):null,state:replacement?'SCANNING':'CLOSING'}}
      }
      return s.transport(...args)
    }, s.store)
    await manager.run(deps())
    const before = s.calls.length
    assert.equal((await manager.run(deps('STOP_XMR_WALLET'))).state, 'STOPPED')
    assert.deepEqual(s.calls.slice(before), ['/crosschain/xmr/capabilities','/crosschain/xmr/deactivate','/crosschain/xmr/session'])
    assert.equal(s.store.list().length, 0)
  }
})
test('unconfirmed stop retains cleanup evidence and owner; only an explicit retry resends', async () => {
  const s = setup()
  let attempts = 0
  const manager = new HomeXmrCustody(async (...args) => {
    if (args[1].endsWith('/deactivate')) {
      attempts++
      throw Error('not dispatched')
    }
    return s.transport(...args)
  }, s.store)
  await manager.run(deps())
  const record = s.store.get(route.nodeApiUrl)
  await assert.rejects(manager.run(deps('STOP_XMR_WALLET')), /could not be confirmed/)
  assert.equal(attempts,1)
  assert.deepEqual(s.store.get(route.nodeApiUrl), record)
  assert.equal((await manager.run(deps('GET_XMR_WALLET'))).state, 'READY')
  assert.equal(attempts,1)
  await assert.rejects(manager.run(deps('STOP_XMR_WALLET')))
  assert.equal(attempts,2)
})
test('stop fences account, consent and route changes before dispatch', async () => {
  for (const change of ['account','consent','route']) {
    const s = setup()
    let changed = false
    const manager = new HomeXmrCustody(async (...args) => {
      const response = await s.transport(...args)
      if (change && args[1].endsWith('/capabilities')) changed = true
      return response
    }, s.store)
    // Arm mutation only after activation.
    await manager.run(deps())
    changed = false
    const stop = deps('STOP_XMR_WALLET')
    stop.validate = () => { if (changed && change === 'account') throw Error('account changed') }
    stop.captureConsent = () => () => !(changed && change === 'consent')
    stop.resolveRoute = async () => changed && change === 'route' ? {...route, revision:'changed'} : route
    await assert.rejects(manager.run(stop))
    assert(!s.calls.some(p => p.endsWith('/deactivate')))
    assert.equal(s.store.list().length,1)
  }
})


test('invalidated stop replies are suppressed and cleanup intent survives dispatch', async () => {
  for (const change of ['account','consent','route']) {
    const s = setup()
    let changed = false
    const manager = new HomeXmrCustody(async (...args) => {
      const response = await s.transport(...args)
      if (args[1].endsWith('/deactivate')) {
        changed = true
        return {...response,data:{sessionId:laterSession,walletId:null,state:'CLOSING'}}
      }
      return response
    }, s.store)
    await manager.run(deps())
    const stop = deps('STOP_XMR_WALLET')
    const record = s.store.get(route.nodeApiUrl)
    stop.validate = () => { if (changed && change === 'account') throw Error('account changed') }
    stop.captureConsent = () => () => !(changed && change === 'consent')
    stop.resolveRoute = async () => changed && change === 'route' ? {...route,revision:'changed'} : route
    await assert.rejects(manager.run(stop))
    assert.equal(s.calls.filter(p => p.endsWith('/deactivate')).length,1)
    assert.deepEqual(s.store.get(route.nodeApiUrl), record)
  }
})

test('scan choice is capability-gated before seed access and forwarded once', async () => {
  for (const start of [{ scanMode: 'RESUME' }, { scanMode: 'NEW_AT_CURRENT_TIP' }, { scanMode: 'RESTORE_FROM_HEIGHT', restoreHeight: 123 }]) {
    const bodies: Record<string, unknown>[] = []
    let active = false
    const manager = new HomeXmrCustody(async (_r, p, _m, b) => {
      if (p.endsWith('/capabilities')) return { ok: true, status: 200, data: { ...cap, scanStartProtocolVersion: 1, scanModes: ['RESUME', 'RESTORE_FROM_HEIGHT', 'NEW_AT_CURRENT_TIP'] } }
      if (p.endsWith('/activate')) { bodies.push(JSON.parse(b!)); active = true }
      return { ok: true, status: 200, data: active ? ready() : { sessionId: null, walletId: null, state: 'IDLE' } }
    }, memoryStore(), async () => {})
    const d = deps(); d.request = { action: d.action, ...start }
    await manager.run(d)
    assert.equal(bodies.length, 1)
    assert.equal(bodies[0].scanMode, start.scanMode)
    assert.equal(bodies[0].restoreHeight, 'restoreHeight' in start ? start.restoreHeight : undefined)
    d.request = { action: d.action, scanMode: 'NEW_AT_CURRENT_TIP' }
    await assert.rejects(manager.run(d), /Stop the active wallet/)
    assert.equal(bodies.length, 1, 'active wallets cannot silently change or ignore explicit policy')
  }
  const old = setup(), d = deps(); let seeds = 0
  d.getSeed = () => { seeds++; throw Error('must not derive') }
  d.request = { action: d.action, scanMode: 'NEW_AT_CURRENT_TIP' }
  await assert.rejects(old.manager.run(d), /does not support/)
  assert.equal(seeds, 0)
  assert(!old.calls.some(p => p.endsWith('/activate')))
})
test('malformed modes fail before consent or seed access', async () => {
  for (const scanMode of [null, [], ['NEW_AT_CURRENT_TIP'], {}]) {
    const s = setup(), d = deps(); let prompts = 0
    d.request = { action: d.action, scanMode }; d.consent = async () => { prompts++ }
    d.getSeed = () => { throw Error('must not derive') }
    await assert.rejects(s.manager.run(d), /Invalid wallet scan start/)
    assert.equal(prompts, 0); assert.deepEqual(s.calls, [])
  }
})
test('scan metadata and preparation are display-only whitelisted public fields', () => {
  const raw = { ...ready(), restoreHeight: 100, initializationMode: 'NEW_AT_CURRENT_TIP', state: 'SCANNING',
    preparation: { scanId: session, startHeight: 0, height: 50, targetHeight: 100, updatedAt: Date.now(), coinSeed: 'secret' } }
  const result = projectXmrWallet(raw, session, walletId)
  assert.deepEqual(result.scanStart, { mode: 'NEW_AT_CURRENT_TIP', height: 100 })
  assert.equal(result.preparation?.height, 50)
  assert(!JSON.stringify(result).includes('secret'))
  assert.throws(() => projectXmrWallet({ ...raw, preparation: { ...raw.preparation, height: 100 } }, session, walletId), /preparation/)
})


test('wallet read diagnostics distinguish in-flight work from retries and strip authority', () => {
  for (const read of [
    { state: 'IDLE', phase: null, retryAt: null },
    { state: 'IN_FLIGHT', phase: 'SYNC', retryAt: null },
    { state: 'OVERDUE', phase: 'SAVE', retryAt: null },
    { state: 'RETRY_SCHEDULED', phase: null, retryAt: 123456 },
  ]) {
    const result = projectXmrWallet({ ...ready(), read: { ...read, sessionId: session, error: 'private' } }, session, walletId)
    assert.deepEqual(result.read, read)
    assert(!JSON.stringify(result).includes('private'))
  }
  assert.equal(projectXmrWallet(ready(), session, walletId).read, undefined)
  for (const read of [
    { state: 'UNKNOWN', phase: null, retryAt: null },
    { state: 'OVERDUE', phase: 'private-error', retryAt: null },
    { state: 'OVERDUE', phase: 'SYNC', retryAt: 1 },
    { state: 'IDLE', phase: 'SYNC', retryAt: null },
    { state: 'RETRY_SCHEDULED', phase: null, retryAt: null },
    { state: 'RETRY_SCHEDULED', phase: null, retryAt: -1 },
    { state: ['IDLE'], phase: null, retryAt: null },
    { state: 'OVERDUE', phase: ['SYNC'], retryAt: null },
    { state: null, phase: null, retryAt: null },
  ]) assert.throws(() => projectXmrWallet({ ...ready(), read }, session, walletId))
  assert.throws(() => projectXmrWallet({ ...ready(), read: { state: 'OVERDUE', phase: 'SYNC', retryAt: null } }, laterSession, walletId))
})

test('stale display uses owner allowlist without restoring live financial readiness', () => {
  const data = { ...ready().wallet, nativeSecret: 'discard', transactions: [{ txid: 'a'.repeat(64), timestamp: 1, height: 1, confirmed: true, incomingAtomic: '0', outgoingAtomic: '0', feeAtomic: '0', sessionId: 'discard' }] }
  const input = { ...ready(), state: 'UNAVAILABLE', wallet: null, display: { data, updatedAt: 1, authority: 'discard' } }
  const projected = projectXmrWallet(input, session, walletId)
  assert.equal(projected.wallet, null); assert.equal(projected.send, false)
  assert.equal(projected.state, 'UNAVAILABLE'); assert.equal(projected.display?.data?.address, fixtures[0].address)
  assert(!JSON.stringify(projected).includes('discard')); assert(!JSON.stringify(projected).includes('sessionId'))
  assert.throws(() => projectXmrWallet(input, laterSession, walletId))
  for (const display of [{ data, updatedAt: -1 }, { data: null, updatedAt: 1 }, { data: { ...data, balanceAtomic: 0 }, updatedAt: 1 }, { data: { ...data, transactions: [...data.transactions, ...data.transactions] }, updatedAt: 1 }])
    assert.throws(() => projectXmrWallet({ ...input, display }, session, walletId))
  assert.equal(projectXmrWallet(ready(), session, walletId).display, undefined)
})

test('ETA history survives reload as display only and cannot cross scan or owner boundaries', () => {
  const progress = { scanId: laterSession, startHeight: 10, height: 50, targetHeight: 100, updatedAt: 61000 }
  const scanHistory = { identity: laterSession, samples: [{ at: 1000, blocks: 10, total: 90 }, { at: 61000, blocks: 40, total: 90 }] }
  const input = { ...ready(), state: 'STALE', wallet: null, progress, scanHistory: { ...scanHistory, sessionId: 'secret' } }
  const result = projectXmrWallet(input, session, walletId)
  assert.deepEqual(result.scanHistory, scanHistory)
  assert.equal(result.wallet, null); assert.equal(result.send, false)
  assert.throws(() => projectXmrWallet(input, laterSession, walletId))
  for (const history of [
    {...scanHistory, identity: session}, {...scanHistory, samples: []},
    {...scanHistory, samples: [...scanHistory.samples].reverse()},
    {...scanHistory, samples: [{at: 61001, blocks: 40, total: 90}]},
    {...scanHistory, samples: [{at: 61000, blocks: 41, total: 90}]},
    {...scanHistory, samples: Array(129).fill(scanHistory.samples[0])},
  ]) assert.throws(() => projectXmrWallet({...input, scanHistory: history}, session, walletId))
  assert.equal(projectXmrWallet({...input, scanHistory: undefined}, session, walletId).scanHistory, undefined)
})
