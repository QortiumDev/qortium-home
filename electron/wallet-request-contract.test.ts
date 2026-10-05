import assert from 'node:assert/strict'
import {
  advertiseWalletRequestContract,
  resolveWalletRequest,
} from './wallet-request-contract.js'
import { resolveHomeV2AppAlias } from './home-v2-app-actions.js'

const request = {
  action: 'WALLET_REQUEST',
  coin: 'XMR',
  operation: 'send-commit',
  parameters: { handle: 'opaque-handle' },
}
assert.deepEqual(resolveWalletRequest(request, 'qdnRequest'), {
  action: 'COMMIT_XMR_SEND',
  request: { action: 'COMMIT_XMR_SEND', coin: 'XMR', handle: 'opaque-handle' },
})
assert.deepEqual(
  resolveHomeV2AppAlias('WALLET_REQUEST', request, 'qdnRequest'),
  resolveWalletRequest(request, 'qdnRequest'),
)
for (const invalid of [
  { ...request, coin: 'xmr' },
  { ...request, coin: '__proto__' },
  { ...request, operation: 'constructor' },
  { ...request, parameters: { action: 'SEND_COIN' } },
  { ...request, parameters: { coin: 'ARRR' } },
  { ...request, parameters: { privateKey: 'not-accepted' } },
  { ...request, parameters: [] },
  { ...request, handle: 'outer-field' },
  { ...request, coin: 'BTC', operation: 'stop' },
  { ...request, coin: 'XMR', operation: 'send' },
])
  assert.throws(() => resolveWalletRequest(invalid, 'qdnRequest'))
assert.throws(() => resolveWalletRequest(request, 'qortalRequest'))
assert.deepEqual(
  resolveWalletRequest(
    {
      action: 'WALLET_REQUEST',
      coin: 'ARRR',
      operation: 'send',
      parameters: {
        amount: '9007199254740993',
        recipient: 'synthetic',
        memo: 'hello',
      },
    },
    'qdnRequest',
  ).request,
  {
    action: 'SEND_COIN',
    coin: 'ARRR',
    amount: '9007199254740993',
    recipient: 'synthetic',
    memo: 'hello',
  },
)
assert.equal(
  resolveWalletRequest(
    {
      action: 'WALLET_REQUEST',
      coin: 'XMR',
      operation: 'status',
      parameters: { passive: true },
    },
    'qdnRequest',
  ).request.passive,
  true,
)
console.log('wallet request contract tests passed')

assert.deepEqual(
  advertiseWalletRequestContract({
    currencyCode: 'BTC',
    homeWallet: { read: false },
  }),
  {
    currencyCode: 'BTC',
    homeWallet: {
      read: false,
      requestContract: 'qortium-home-wallet-request-v1',
    },
  },
)
const unsupported = { currencyCode: 'UNKNOWN', homeWallet: { read: false } }
assert.equal(advertiseWalletRequestContract(unsupported), unsupported)

// The displayed choice must be the same strict scalar policy dispatched to Core.
const { walletScanStart, walletScanPromptRows } = await import('./wallet-scan-start.js')
assert.deepEqual(walletScanStart({}), { scanMode: 'RESUME' })
for (const mode of [null, ['NEW_AT_CURRENT_TIP'], {}, 0, 'new', ''])
  assert.throws(() => walletScanStart({ scanMode: mode }))
for (const height of [null, '100', -1, 1.5, 500000001])
  assert.throws(() => walletScanStart({ scanMode: 'RESTORE_FROM_HEIGHT', restoreHeight: height }))
for (const scanMode of ['RESUME', 'NEW_AT_CURRENT_TIP'])
  assert.throws(() => walletScanStart({ scanMode, restoreHeight: 0 }))
assert.match(walletScanPromptRows(walletScanStart({ scanMode: 'NEW_AT_CURRENT_TIP' }))[0].value, /NEVER received funds/)
for (const coin of ['ARRR', 'XMR']) {
  const resolved = resolveWalletRequest({ action: 'WALLET_REQUEST', coin, operation: 'activate',
    parameters: { scanMode: 'RESTORE_FROM_HEIGHT', restoreHeight: 123 } }, 'qdnRequest')
  assert.equal(resolved.request.scanMode, 'RESTORE_FROM_HEIGHT')
  assert.equal(resolved.request.restoreHeight, 123)
}
