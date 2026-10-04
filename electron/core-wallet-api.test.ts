import assert from 'node:assert/strict'
import {
  createWalletApiProtocolCache,
  coreWalletRequestPath,
  parseWalletApiProtocol,
  CORE_WALLET_API_CONTRACT,
} from './core-wallet-api.js'

const value = {
  contract: CORE_WALLET_API_CONTRACT,
  coin: 'XMR',
  sessionHeader: 'X-WALLET-SESSION',
  reads: ['status', 'send/status'],
  writes: ['activate', 'stop', 'send/commit'],
}
const xmr = parseWalletApiProtocol(value, 'XMR')!
assert(xmr)
assert.equal(parseWalletApiProtocol({ ...value, coin: 'ARRR' }, 'XMR'), null)
assert.equal(
  parseWalletApiProtocol({ ...value, sessionHeader: 'Injected' }, 'XMR'),
  null,
)
assert.equal(
  parseWalletApiProtocol({ ...value, writes: ['../send'] }, 'XMR'),
  null,
)
assert.deepEqual(
  coreWalletRequestPath('/crosschain/xmr/wallet', 'GET', { XMR: xmr }),
  {
    pathname: '/crosschain/wallets/XMR/status',
    sessionHeader: 'X-WALLET-SESSION',
  },
)
assert.equal(
  coreWalletRequestPath('/crosschain/xmr/send/commit', 'POST', { XMR: xmr })
    .pathname,
  '/crosschain/wallets/XMR/send/commit',
)
assert.equal(
  coreWalletRequestPath('/crosschain/xmr/send/commit', 'GET', { XMR: xmr })
    .pathname,
  '/crosschain/xmr/send/commit',
)
assert.equal(
  coreWalletRequestPath('/crosschain/xmr/send/commit', 'POST').pathname,
  '/crosschain/xmr/send/commit',
)
const arrr = parseWalletApiProtocol(
  {
    ...value,
    coin: 'ARRR',
    reads: ['send/status'],
    writes: ['balance', 'stop', 'send', 'send/lookup'],
  },
  'ARRR',
)!
assert.equal(
  coreWalletRequestPath(
    '/crosschain/arrr/walletbalance?verified=true',
    'POST',
    { ARRR: arrr },
  ).pathname,
  '/crosschain/wallets/ARRR/balance?verified=true',
)
const id = '11111111-1111-4111-8111-111111111111'
assert.equal(
  coreWalletRequestPath('/crosschain/arrr/send/' + id, 'GET', { ARRR: arrr })
    .pathname,
  '/crosschain/wallets/ARRR/send/status/' + id,
)
assert.equal(
  coreWalletRequestPath('/crosschain/arrr/sendlookup/' + id, 'POST', {
    ARRR: arrr,
  }).pathname,
  '/crosschain/wallets/ARRR/send/lookup/' + id,
)
const cache = createWalletApiProtocolCache()
let probes = 0
const probe = async () => {
  probes++
  return value
}
await cache('route-one', 'XMR', probe, 0)
await cache('route-one', 'XMR', probe, 1000)
assert.equal(probes, 1)
await cache('route-two', 'XMR', probe, 1000)
assert.equal(probes, 2)
await cache('route-one', 'XMR', probe, 60001)
assert.equal(probes, 3)
const failure = async () => {
  probes++
  throw Error('Unavailable')
}
assert.equal(await cache('legacy-route', 'XMR', failure, 0), null)
assert.equal(await cache('legacy-route', 'XMR', failure, 1000), null)
assert.equal(probes, 4)
assert.equal(await cache('legacy-route', 'XMR', failure, 5001), null)
assert.equal(probes, 5)
console.log('core wallet API negotiation tests passed')
