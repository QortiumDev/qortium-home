// Exercises the shared request-to-Core-path contract used by both desktop and
// Android. The parity test separately proves both bridges call these builders.
import assert from 'node:assert/strict';
import {
  getAssetBalancesPath,
  getAssetInfoPath,
  getAssetTransfersPath,
  getOptionalAssetSelector,
  getRequestAssetId,
  isNativeAssetRequest,
} from './qdn-request-values.js';

const address = 'Q1111111111111111111111111111111111';

assert.equal(getRequestAssetId({ assetId: 0 }), 0);
assert.equal(getRequestAssetId({ assetId: 5 }), 5);
assert.equal(getRequestAssetId({ assetId: '5' }), 5);
assert.equal(getRequestAssetId({}), undefined);
assert.equal(getRequestAssetId({ assetId: '   ' }), undefined);
assert.throws(
  () => getRequestAssetId({ assetId: -1 }),
  /Asset id must be a non-negative safe integer\./,
);
assert.throws(
  () => getRequestAssetId({ assetId: 'not-an-asset' }),
  /Asset id must be a non-negative safe integer\./,
);
assert.equal(isNativeAssetRequest({ assetId: 0 }), true);
assert.equal(isNativeAssetRequest({ assetId: 5, coin: 'NATIVE' }), false);

assert.deepEqual(
  getOptionalAssetSelector({ action: 'GET_ASSET_INFO', assetId: 5, assetName: 'ignored' }),
  { assetId: 5 },
  'assetId must win when both assetId and assetName are supplied.',
);

assert.deepEqual(
  getOptionalAssetSelector({ action: 'GET_ASSET_INFO', assetName: 'MYASSET' }),
  { assetName: 'MYASSET' },
);

assert.deepEqual(
  getOptionalAssetSelector({ action: 'GET_ASSET_INFO', assetId: 0 }),
  { assetId: 0 },
  'assetId 0 is a real asset id, not an absent value.',
);

assert.deepEqual(
  getOptionalAssetSelector({ action: 'GET_ASSET_INFO', assetId: '5' }),
  { assetId: 5 },
  'a numeric-string assetId must still resolve to a number.',
);

assert.throws(
  () => getOptionalAssetSelector({ action: 'GET_ASSET_INFO' }),
  /Supply either assetId or assetName\./,
);

assert.throws(
  () => getOptionalAssetSelector({ action: 'GET_ASSET_INFO', assetName: '' }),
  /Supply either assetId or assetName\./,
  'an empty-string assetName must not satisfy the selector.',
);

assert.equal(getAssetInfoPath({ assetId: 5 }), '/assets/info?assetId=5');
assert.equal(
  getAssetInfoPath({ assetName: 'MY ASSET/ONE' }),
  '/assets/info?assetName=MY%20ASSET%2FONE',
);
assert.equal(
  getAssetInfoPath({ assetId: 5, assetName: 'ignored' }),
  '/assets/info?assetId=5',
);

assert.equal(
  getAssetBalancesPath({ address }),
  `/assets/balances?address=${address}`,
);
assert.equal(
  getAssetBalancesPath({ assetId: 0 }),
  '/assets/balances?assetid=0',
);
assert.equal(
  getAssetBalancesPath({ address, assetId: '5', excludeZero: false, limit: 0 }),
  `/assets/balances?address=${address}&assetid=5&excludeZero=false&limit=0`,
);
assert.throws(
  () => getAssetBalancesPath({ address, assetId: 'not-an-asset' }),
  /Asset id must be a non-negative safe integer\./,
  'a supplied malformed assetId must be rejected instead of silently widening the address query.',
);
assert.throws(
  () => getAssetBalancesPath({ address, assetId: -1 }),
  /Asset id must be a non-negative safe integer\./,
);
assert.throws(
  () => getAssetBalancesPath({}),
  /Supply either an address or an assetId\./,
);

assert.equal(
  getAssetTransfersPath({ assetId: '5', address, limit: 20, reverse: false }),
  `/assets/transfers/5?address=${address}&limit=20&reverse=false`,
);
assert.equal(getAssetTransfersPath({ assetId: 0 }), '/assets/transfers/0');
assert.throws(() => getAssetTransfersPath({}), /Asset id is required\./);
assert.throws(
  () => getAssetTransfersPath({ assetId: 'invalid' }),
  /Asset id must be a non-negative safe integer\./,
);

console.log('QDN asset request path tests passed.');
