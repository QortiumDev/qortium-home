import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { QDN_APP_BRIDGE_ACTIONS, QDN_PUBLIC_NODE_BRIDGE_ACTIONS } from './qdn-app-actions.js';

function readRepoSource(...candidates: string[]) {
  const url = candidates.map((candidate) => new URL(candidate, import.meta.url)).find((each) => existsSync(each));
  assert.ok(url, `source not found: tried ${candidates.join(', ')}`);
  return readFileSync(url, 'utf8');
}

const desktop = readRepoSource('../electron/qdn.ts', './qdn.ts');
const android = readRepoSource('../src/platform.ts', './platform.ts');

const ASSET_READ_ACTIONS = ['GET_ASSET_INFO', 'GET_ASSET_BALANCES', 'GET_ASSET_TRANSFERS'] as const;

for (const action of ASSET_READ_ACTIONS) {
  assert(QDN_APP_BRIDGE_ACTIONS.includes(action), `${action} must be in QDN_APP_BRIDGE_ACTIONS.`);
  assert(
    QDN_PUBLIC_NODE_BRIDGE_ACTIONS.includes(action),
    `${action} is a read action and must remain in QDN_PUBLIC_NODE_BRIDGE_ACTIONS (not filtered as local-write-only).`,
  );
}

for (const [name, source] of [
  ['electron/qdn.ts', desktop],
  ['src/platform.ts', android],
] as const) {
  for (const action of ASSET_READ_ACTIONS) {
    assert(source.includes(`case '${action}':`), `${name} must dispatch ${action}.`);
  }

  assert(
    source.includes('getOptionalAssetSelector(request)'),
    `${name} GET_ASSET_INFO must resolve assetId/assetName through the shared getOptionalAssetSelector helper.`,
  );

  const balancesStart = source.indexOf("case 'GET_ASSET_BALANCES':");
  const balancesEnd = source.indexOf("case 'GET_ASSET_TRANSFERS':", balancesStart);
  const balancesBody = source.slice(balancesStart, balancesEnd);

  assert(
    !balancesBody.includes('getRequestAssetId('),
    `${name} GET_ASSET_BALANCES must not use getRequestAssetId (it silently drops numeric assetId - see plan doc).`,
  );
}

console.log('QDN asset read-action bridge parity tests passed.');
