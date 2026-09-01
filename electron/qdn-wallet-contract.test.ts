import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { getForeignWalletCoins } from './foreign-wallets.js';
import {
  getAccountBalancePath,
  getOptionalNonNegativeAssetId,
  type QdnAppRequest,
} from './qdn-request-values.js';
import {
  buildHomeBlockchainDiscovery,
  getHomeWalletCapability,
  type HomeWalletCapability,
} from './qdn-wallet-capabilities.js';

const address = 'QWalletContractTestAddress123456789';
const encodedAddress = encodeURIComponent(address);

for (const request of [
  {},
  { assetId: undefined },
  { assetId: null },
  { assetId: '' },
  { assetId: '   ' },
  { payload: {} },
  { payload: { assetId: '' } },
] as QdnAppRequest[]) {
  assert.equal(getOptionalNonNegativeAssetId(request), undefined);
  assert.equal(getAccountBalancePath(address, request), `/addresses/balance/${encodedAddress}`);
}

for (const [request, expected] of [
  [{ assetId: 0 }, 0],
  [{ assetId: '0' }, 0],
  [{ assetId: 2 }, 2],
  [{ assetId: ' 42 ' }, 42],
  [{ payload: { assetId: 7 } }, 7],
] as Array<[QdnAppRequest, number]>) {
  assert.equal(getOptionalNonNegativeAssetId(request), expected);
  assert.equal(getAccountBalancePath(address, request), `/addresses/balance/${encodedAddress}?assetId=${expected}`);
}

for (const request of [
  { assetId: -1 },
  { assetId: '-1' },
  { assetId: 1.5 },
  { assetId: '1.5' },
  { assetId: Number.MAX_SAFE_INTEGER + 1 },
  { assetId: '9007199254740992' },
  { assetId: 'asset-2' },
  { assetId: [] },
  { assetId: {} },
] as QdnAppRequest[]) {
  assert.throws(
    () => getAccountBalancePath(address, request),
    /Asset id must be a non-negative safe integer\./,
  );
}

const expectedForeignWalletCoins = ['BTC', 'LTC', 'DOGE', 'DGB', 'RVN', 'DASH', 'NMC', 'FIRO'];
assert.deepEqual(getForeignWalletCoins(), expectedForeignWalletCoins);

const qortCapability: HomeWalletCapability = {
  contract: 'qortium-home-wallet-v1',
  implemented: true,
  protocol: 'qortalRequest',
  read: true,
  readMode: 'PUBLIC_NODE',
  receive: true,
  receiveMode: 'HOME_LOCAL',
  requiresUnlockedAccount: true,
  send: true,
  sendMode: 'HOME_SIGNED_PUBLIC_NODE',
  serverManagement: false,
  serverManagementMode: 'NONE',
};

const unavailableCapability: HomeWalletCapability = {
  contract: 'qortium-home-wallet-v1',
  implemented: false,
  protocol: 'qdnRequest',
  read: false,
  readMode: 'NONE',
  receive: false,
  receiveMode: 'NONE',
  requiresUnlockedAccount: false,
  send: false,
  sendMode: 'NONE',
  serverManagement: false,
  serverManagementMode: 'NONE',
};
const trustedForeignCapability: HomeWalletCapability = {
  contract: 'qortium-home-wallet-v1',
  implemented: true,
  protocol: 'qdnRequest',
  read: true,
  readMode: 'TRUSTED_CORE',
  receive: true,
  receiveMode: 'HOME_LOCAL',
  requiresUnlockedAccount: true,
  send: false,
  sendMode: 'NONE',
  serverManagement: true,
  serverManagementMode: 'TRUSTED_CORE',
};
const receiveOnlyForeignCapability: HomeWalletCapability = {
  ...trustedForeignCapability,
  read: false,
  readMode: 'NONE',
  serverManagement: false,
  serverManagementMode: 'NONE',
};
assert.deepEqual(getHomeWalletCapability('QORT'), qortCapability);
for (const coin of expectedForeignWalletCoins) {
  assert.deepEqual(getHomeWalletCapability(coin), unavailableCapability);
  assert.deepEqual(getHomeWalletCapability(coin, true, false), receiveOnlyForeignCapability);
  assert.deepEqual(getHomeWalletCapability(coin, true), trustedForeignCapability);
}
for (const coin of ['BCH', 'PPC', 'KMD', 'VRSC', 'ZEC', 'LBC', 'XVG', 'ARRR', 'UNKNOWN', '', null]) {
  assert.deepEqual(getHomeWalletCapability(coin), unavailableCapability);
}

const qortalInfo = {
  currencyCode: 'QORT',
  displayName: 'Qortal',
  marker: 'home-added',
};
const coreRows = [
  { currencyCode: 'BTC', marker: 'core-preserved', walletEnabled: true },
  { currencyCode: 'BCH', walletEnabled: false },
  { displayName: 'Malformed row without currency code' },
];
const projected = buildHomeBlockchainDiscovery(coreRows, qortalInfo);
assert.ok(Array.isArray(projected));
assert.equal(projected.length, 4);
assert.deepEqual(projected[0], {
  ...qortalInfo,
  homeWallet: qortCapability,
});
assert.deepEqual(projected[1], {
  ...coreRows[0],
  homeWallet: unavailableCapability,
});
assert.deepEqual(projected[2], { ...coreRows[1], homeWallet: unavailableCapability });
assert.deepEqual(projected[3], { ...coreRows[2], homeWallet: unavailableCapability });

const wrapped = {
  data: coreRows,
  headers: { 'x-test': 'preserved' },
  status: 200,
};
const projectedWrapped = buildHomeBlockchainDiscovery(wrapped, qortalInfo);
assert.deepEqual(projectedWrapped, {
  ...wrapped,
  data: projected,
});

const trustedProjected = buildHomeBlockchainDiscovery(coreRows, qortalInfo, true);
assert.ok(Array.isArray(trustedProjected));
assert.deepEqual(trustedProjected[1], {
  ...coreRows[0],
  homeWallet: trustedForeignCapability,
});
assert.deepEqual(trustedProjected[2], { ...coreRows[1], homeWallet: unavailableCapability });

const unexpectedResponse = { status: 204 };
assert.equal(buildHomeBlockchainDiscovery(unexpectedResponse, qortalInfo), unexpectedResponse);

function readRepoSource(...candidates: string[]) {
  const url = candidates.map((candidate) => new URL(candidate, import.meta.url)).find((each) => existsSync(each));
  assert.ok(url, `source not found: tried ${candidates.join(', ')}`);
  return readFileSync(url, 'utf8');
}

for (const [name, source, capabilityImport] of [
  [
    'electron/qdn.ts',
    readRepoSource('../electron/qdn.ts', './qdn.ts'),
    "from './qdn-wallet-capabilities.js'",
  ],
  [
    'src/platform.ts',
    readRepoSource('../src/platform.ts', './platform.ts'),
    "from '../electron/qdn-wallet-capabilities'",
  ],
] as const) {
  assert(source.includes(capabilityImport), `${name} must import the shared Home wallet capability projection.`);
  assert(source.includes('buildHomeBlockchainDiscovery(blockchains, QORTAL_PUBLIC_NODE_BLOCKCHAIN_INFO)'), `${name} must use the shared blockchain discovery projection.`);
  assert(source.includes("case 'GET_BALANCE':"), `${name} must dispatch GET_BALANCE.`);
  assert(source.includes("getAccountBalancePath(await getAddressForQdnRequest(request, context, 'Address'), request)"), `${name} GET_BALANCE must use the shared asset-aware path builder.`);
}

console.log('QDN wallet contract tests passed.');
