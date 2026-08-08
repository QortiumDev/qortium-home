// Guards the assetId/assetName resolution three read actions and one write
// action all depend on. Deliberately does not reuse getRequestAssetId (see
// docs/superpowers/plans/2026-08-07-qortium-asset-wallet-integration.md for
// why): that helper silently returns undefined for a numeric assetId, so this
// one resolves the raw request value with getInteger directly instead.
import assert from 'node:assert/strict';
import { getOptionalAssetSelector } from './qdn-request-values.js';

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

console.log('getOptionalAssetSelector tests passed.');
