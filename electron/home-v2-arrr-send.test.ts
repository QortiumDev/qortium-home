import { getHomeWalletCapability } from './qdn-wallet-capabilities.js'
import { getHomeV2ContextualAppActions, isHomeV2AndroidUnsupportedAction } from './home-v2-app-runtime.js'
import { arrrSendApprovalSummary, compatibleArrrSendContract } from './arrr-send-contract.js'
import { bech32 } from '@scure/base'
import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createArrrSendStore } from './home-v2-arrr-send-store.js'
import {
  executeArrrSend,
  readArrrSend,
  normalizeArrrSend,
  ArrrSendBeforeDispatchError,
  assertArrrSendContext,
  classifyArrrSendFailure,
  type ArrrSendDeps,
} from './home-v2-arrr-send.js'
import { createArrrCustodyNodeCrypto } from './home-v2-arrr-custody-read.js'
import { base58Decode, base58Encode } from './base58.js'
const request = {
  coin: 'ARRR',
  amount: '1.25',
  recipient: bech32.encode('zs', bech32.toWords(new Uint8Array(43).fill(7))),
  memo: 'private memo',
}
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arrr-send-test-'))
  let seeds = 0,
    sends = 0,
    key = '',
    entropy = '',
    approved = false
  const deps: ArrrSendDeps = {
    accountId: 'A',
    appIdentity: 'APP/Wallet/Wallet',
    route: 'local|http://node',
    crypto: createArrrCustodyNodeCrypto(),
    store: createArrrSendStore(dir),
    assertValid: async () => {},
    consent: async () => {},
    approve: async (rows) => {
      assert.equal(rows[4]?.value, '0.0001 ARRR (10000 atomic, fixed)')
      approved = true
    },
    getSeed: () => {
      seeds++
      return { seed: new Uint8Array(32).fill(7), addressIndex: 0, walletVersion: 2 }
    },
    post: async (pathname, body) => {
      const response = (data: unknown) => ({ ok: true, status: 200, data, body: JSON.stringify(data) })
      if (pathname.endsWith('sendreadiness'))
        return response({ sendAllowed: true, network: 'MAIN', sendProtocolVersion: 2 })
      if (pathname.endsWith('/send')) {
        assert.equal(approved, true)
        assert.ok(deps.store.get('A'))
        sends++
        const parsed = JSON.parse(body)
        key = parsed.idempotencyKey
        entropy = parsed.entropy58
        throw new Error('HTTP response lost')
      }
      assert.equal(pathname, `/crosschain/arrr/sendlookup/${key}`)
      assert.equal(body, entropy)
      return response({
        idempotencyKey: key,
        operationId: '123e4567-e89b-12d3-a456-426614174000',
        walletIdentityHash: base58Encode(createHash('sha256').update(base58Decode(entropy)).digest()),
        network: 'MAIN',
        state: 'BROADCAST',
        txid: 'ab'.repeat(32),
        feeAtomic: '10000',
        feePolicy: 'FIXED',
        sendProtocolVersion: 2,
        resolutionRequired: false,
      })
    },
  }
  return {
    dir,
    deps,
    seeds: () => seeds,
    sends: () => sends,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  }
}
test('lost response survives restart; recovery reads original key and never resends', async () => {
  const f = fixture()
  try {
    await assert.rejects(executeArrrSend(request, f.deps))
    assert.equal(f.sends(), 1)
    const disk = fs.readFileSync(path.join(f.dir, 'home-v2-arrr-send-reservations.json'), 'utf8')
    assert.ok(!disk.includes(request.recipient))
    assert.ok(!disk.includes(request.memo))
    assert.ok(!disk.includes('entropy'))
    f.deps.store = createArrrSendStore(f.dir)
    await assert.rejects(executeArrrSend(request, f.deps), /previous ARRR send/)
    assert.equal(f.sends(), 1)
    const recovered = await readArrrSend(f.deps, 'GET_ARRR_SEND_OPERATION')
    assert.equal(recovered.operation?.state, 'BROADCAST')
    assert.equal(f.sends(), 1)
    assert.equal(f.deps.store.get('A')?.receipt?.state, 'BROADCAST')
    const again = await readArrrSend(f.deps, 'GET_ARRR_SEND_OPERATION')
    assert.equal(again.operation?.state, 'BROADCAST')
    await assert.rejects(executeArrrSend(request, f.deps), /previous ARRR send/)
  } finally {
    f.cleanup()
  }
})
test('custody denial prevents seed access and send', async () => {
  const f = fixture()
  try {
    f.deps.consent = async () => {
      throw new Error('declined')
    }
    await assert.rejects(executeArrrSend(request, f.deps))
    assert.equal(f.seeds(), 0)
    assert.equal(f.sends(), 0)
  } finally {
    f.cleanup()
  }
})
test('revocation during approval prevents dispatch and reservation', async () => {
  const f = fixture()
  let revoked = false
  try {
    f.deps.approve = async () => {
      revoked = true
    }
    f.deps.assertValid = async () => {
      if (revoked) throw new Error('revoked')
    }
    await assert.rejects(executeArrrSend(request, f.deps), /revoked/)
    assert.equal(f.sends(), 0)
    assert.equal(f.deps.store.get('A'), null)
  } finally {
    f.cleanup()
  }
})
test('journal fault blocks send, route change cannot evade pending reservation', async () => {
  const f = fixture()
  try {
    await assert.rejects(executeArrrSend(request, f.deps))
    f.deps.route = 'other'
    await assert.rejects(readArrrSend(f.deps, 'GET_ARRR_SEND_OPERATION'), /original app/)
    assert.equal(f.sends(), 1)
    fs.writeFileSync(path.join(f.dir, 'home-v2-arrr-send-reservations.json'), 'broken')
    await assert.rejects(executeArrrSend(request, f.deps))
    assert.equal(f.sends(), 1)
  } finally {
    f.cleanup()
  }
})
test('exact amount, fee authority and UTF-8 limits', () => {
  assert.equal(normalizeArrrSend(request).atomic, 125000000n)
  assert.throws(() =>
    normalizeArrrSend({
      ...request,
      recipient: request.recipient.slice(0, -1) + (request.recipient.endsWith('q') ? 'p' : 'q'),
    }),
  )
  for (const amount of [1, '1e2', '-1', '0', '1.123456789', '9'.repeat(100000)])
    assert.throws(() => normalizeArrrSend({ ...request, amount }))
  for (const field of ['feePerByte', 'entropy58', 'idempotencyKey', 'sendMax'])
    assert.throws(() => normalizeArrrSend({ ...request, [field]: 'forged' }))
  assert.throws(() => normalizeArrrSend({ ...request, memo: '\ud800' }))
  assert.throws(() => normalizeArrrSend({ ...request, memo: 'é'.repeat(257) }))
})

test('definitive pre-admission rejection retains a FAILED receipt, transport uncertainty does not', async () => {
  const f = fixture()
  try {
    f.deps.post = async (pathname) => {
      if (pathname.endsWith('sendreadiness'))
        return { ok: true, status: 200, body: '', data: { sendAllowed: true, network: 'MAIN', sendProtocolVersion: 2 } }
      return pathname.endsWith('/send')
        ? { ok: false, status: 400, body: '', data: { error: 102 } }
        : { ok: false, status: 404, body: '', data: { error: 1206 } }
    }
    const result = await executeArrrSend(request, f.deps)
    assert.equal(result.state, 'FAILED')
    assert.equal(f.deps.store.get('A')?.receipt?.state, 'FAILED')
  } finally {
    f.cleanup()
  }
})
test('pre-dispatch route refusal is a proven never-sent receipt', async () => {
  const f = fixture()
  const original = f.deps.post
  try {
    f.deps.post = async (path, body, type) => {
      if (path.endsWith('/send')) throw new ArrrSendBeforeDispatchError()
      return original(path, body, type)
    }
    assert.equal((await executeArrrSend(request, f.deps)).state, 'FAILED')
    assert.equal(f.sends(), 0)
  } finally {
    f.cleanup()
  }
})
test('a new payment must acknowledge a retained receipt and approve its prior txid', async () => {
  const f = fixture()
  try {
    await assert.rejects(executeArrrSend(request, f.deps))
    const recovered = await readArrrSend(f.deps, 'GET_ARRR_SEND_OPERATION')
    await assert.rejects(executeArrrSend(request, f.deps))
    assert.equal(f.sends(), 1)
    let approvals = 0
    f.deps.approve = async (rows) => {
      approvals++
      assert.match(rows.at(-1)!.value, /Already broadcast: abab.*NEW payment/)
    }
    await assert.rejects(
      executeArrrSend({ ...request, acknowledgedOperationId: recovered.operation!.operationId }, f.deps),
    )
    assert.equal(approvals, 1)
    assert.equal(f.sends(), 2)
  } finally {
    f.cleanup()
  }
})

test('reserve failure is definitive and cannot dispatch', async () => {
  const f = fixture()
  try {
    f.deps.store.reserve = () => {
      throw new Error('journal unavailable')
    }
    await assert.rejects(executeArrrSend(request, f.deps), (error) => {
      assert.equal(classifyArrrSendFailure(error, false).code, 'ARRR_SEND_NOT_STARTED')
      return true
    })
    assert.equal(f.sends(), 0)
  } finally {
    f.cleanup()
  }
})
test('custody send is explicitly gated and withheld from widgets', () => {
  assert.equal(getHomeWalletCapability('ARRR', true, true, true, { available: true }).send, false)
  const capability = getHomeWalletCapability('ARRR', true, true, true, { available: true, sendAvailable: true })
  assert.equal(capability.sendContract, 'qortium-home-arrr-send-v2')
  assert.equal(capability.sendMode, 'TRUSTED_CORE_CUSTODY')
  const actions = ['GET_ARRR_SEND_READINESS', 'GET_ARRR_SEND_OPERATION', 'SEND_COIN']
  assert.ok(!getHomeV2ContextualAppActions(actions, 'widget').some((action) => actions.includes(action)))
  assert.ok(isHomeV2AndroidUnsupportedAction('GET_ARRR_SEND_READINESS'))
  assert.ok(isHomeV2AndroidUnsupportedAction('GET_ARRR_SEND_OPERATION'))
  const contract = {
    sendProtocolVersion: 2,
    network: 'MAIN',
    feePolicy: 'FIXED',
    feeAtomic: '10000',
    amountDecimals: 8,
    maxMemoBytes: 512,
    recipientAddressTypes: ['sapling'],
  }
  assert.ok(compatibleArrrSendContract(contract))
  assert.ok(!compatibleArrrSendContract({ ...contract, network: 'TEST3' }))
  assert.ok(!compatibleArrrSendContract({ ...contract, sendProtocolVersion: 1 }))
  assert.equal(getHomeWalletCapability('ARRR', true, true, true, { available: false, sendAvailable: true }).send, false)
  assert.match(arrrSendApprovalSummary('Wallet'), /spending key to your trusted Core/)
  assert.match(arrrSendApprovalSummary('Wallet'), /fixed fee is 0.0001 ARRR/)
  assert.ok(!arrrSendApprovalSummary('Wallet').includes('never receives'))
})

test('production bridge guard detects trust, route and account changes during resolution', async () => {
  const route = {
    apiKey: 'test-key',
    bindingId: 'binding',
    nodeApiUrl: 'http://node',
    nodeRoute: 'local|http://node',
    reason: null,
    revision: 'revision',
    trusted: true,
  }
  for (const change of [
    { trusted: false },
    { bindingId: 'replacement' },
    { revision: 'new-key' },
    { nodeRoute: 'other' },
    { nodeApiUrl: 'http://other' },
  ]) {
    await assert.rejects(
      assertArrrSendContext(
        route,
        async () => ({ ...route, ...change }),
        () => {},
      ),
    )
  }
  let unlocked = true
  await assert.rejects(
    assertArrrSendContext(
      route,
      async () => {
        unlocked = false
        return route
      },
      () => {
        if (!unlocked) throw new Error('locked')
      },
    ),
    /locked/,
  )
})
test('production bridge error mapping distinguishes refusal from possible dispatch', () => {
  assert.equal(classifyArrrSendFailure(new Error('declined'), false).code, 'ARRR_SEND_NOT_STARTED')
  assert.equal(classifyArrrSendFailure(new Error('response lost'), true).code, 'ARRR_SEND_STATUS_REQUIRED')
})
test('revocation during readiness or final pre-dispatch validation prevents send', async () => {
  for (const boundary of ['readiness', 'pre-dispatch']) {
    const f = fixture()
    let revoked = false
    const post = f.deps.post
    try {
      f.deps.post = async (path, body, contentType) => {
        const result = await post(path, body, contentType)
        if (path.endsWith('sendreadiness') && boundary === 'readiness') revoked = true
        return result
      }
      f.deps.assertValid = async () => {
        if (revoked) throw new Error('revoked')
      }
      if (boundary === 'pre-dispatch')
        f.deps.getSeed = () => {
          throw new Error('locked before seed')
        }
      await assert.rejects(executeArrrSend(request, f.deps))
      assert.equal(f.sends(), 0)
    } finally {
      f.cleanup()
    }
  }
})

test('real store lock acquisition and durability failures prevent dispatch', async () => {
  for (const fault of ['lock', 'fsync']) {
    const f = fixture()
    try {
      f.deps.store = createArrrSendStore(
        f.dir,
        fault === 'lock'
          ? {
              ...fs,
              openSync: () => {
                throw new Error('lock inaccessible')
              },
            }
          : {
              ...fs,
              fsyncSync: () => {
                throw new Error('durability unavailable')
              },
            },
      )
      await assert.rejects(executeArrrSend(request, f.deps), (error) => {
        assert.equal(classifyArrrSendFailure(error, false).code, 'ARRR_SEND_NOT_STARTED')
        return true
      })
      assert.equal(f.sends(), 0)
    } finally {
      f.cleanup()
    }
  }
})
