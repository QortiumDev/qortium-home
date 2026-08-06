import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { decodeQdnBridgeError, encodeQdnBridgeError } from './qdn-bridge-error.js';
import {
  buildForeignWalletReadRequest,
  executeForeignWalletRead,
  FOREIGN_WALLET_BACKEND_UNAVAILABLE_CODE,
  getForeignWalletPublicResponse,
  type ForeignWalletReadEndpoint,
} from './foreign-wallet-read-contract.js';
import type { ForeignWalletRuntime } from './foreign-wallets.js';

const privateSentinel = 'PRIVATE_TEST_SENTINEL';
const wallet: ForeignWalletRuntime = {
  address: 'DTestReceiveAddress',
  coin: 'DGB',
  publicKey: 'xpub-public-key-alias',
  xprv58: privateSentinel,
  xpub58: 'xpub-read-only-wallet',
};

assert.deepEqual(getForeignWalletPublicResponse(wallet), {
  address: wallet.address,
  coin: wallet.coin,
  publicKey: wallet.publicKey,
  publickey: wallet.publicKey,
});
assert.equal(JSON.stringify(getForeignWalletPublicResponse(wallet)).includes(privateSentinel), false);

const expectedRequests: Record<ForeignWalletReadEndpoint, ReturnType<typeof buildForeignWalletReadRequest>> = {
  addressinfos: {
    body: JSON.stringify({ xpub58: wallet.xpub58 }),
    contentType: 'application/json',
    pathname: '/crosschain/dgb/addressinfos',
  },
  walletbalance: {
    body: wallet.xpub58,
    contentType: 'text/plain',
    pathname: '/crosschain/dgb/walletbalance',
  },
  wallettransactions: {
    body: wallet.xpub58,
    contentType: 'text/plain',
    pathname: '/crosschain/dgb/wallettransactions',
  },
};

for (const endpoint of Object.keys(expectedRequests) as ForeignWalletReadEndpoint[]) {
  const expected = expectedRequests[endpoint];

  assert.deepEqual(buildForeignWalletReadRequest(wallet, endpoint), expected);
  assert.equal(JSON.stringify(expected).includes(privateSentinel), false);

  let calls = 0;
  const response = await executeForeignWalletRead(wallet, endpoint, async (request) => {
    calls += 1;
    assert.deepEqual(request, expected);
    return { body: 'mock response', contentType: 'text/plain' };
  });

  assert.equal(calls, 1);
  assert.deepEqual(response, { body: 'mock response', contentType: 'text/plain' });
}

const coreUnavailable = new Error(JSON.stringify({
  error: 1201,
  message: 'foreign blockchain or ElectrumX network issue',
}));
let normalizedUnavailable: Error & { code?: string } | undefined;

try {
  await executeForeignWalletRead(wallet, 'walletbalance', async () => {
    throw coreUnavailable;
  });
} catch (error) {
  normalizedUnavailable = error as Error & { code?: string };
}

assert.ok(normalizedUnavailable);
assert.equal(normalizedUnavailable.code, FOREIGN_WALLET_BACKEND_UNAVAILABLE_CODE);
assert.equal(
  normalizedUnavailable.message,
  'DGB wallet backend is unavailable. Qortium Core could not connect to a wallet-capable server.',
);

const bridgedUnavailable = decodeQdnBridgeError(encodeQdnBridgeError(normalizedUnavailable));
assert.ok(bridgedUnavailable);
assert.equal(
  (bridgedUnavailable as Error & { code?: string }).code,
  FOREIGN_WALLET_BACKEND_UNAVAILABLE_CODE,
);
assert.equal(bridgedUnavailable.message, normalizedUnavailable.message);

const existingCodedError = Object.assign(new Error('Trusted Core required.'), { code: 'PUBLIC_NODE_READ_ONLY' });
await assert.rejects(
  executeForeignWalletRead(wallet, 'wallettransactions', async () => {
    throw existingCodedError;
  }),
  (error: Error & { code?: string }) => error === existingCodedError && error.code === 'PUBLIC_NODE_READ_ONLY',
);

function readRepoSource(...candidates: string[]) {
  const url = candidates.map((candidate) => new URL(candidate, import.meta.url)).find((each) => existsSync(each));
  assert.ok(url, `source not found: tried ${candidates.join(', ')}`);
  return readFileSync(url, 'utf8');
}

for (const [name, source, contractImport] of [
  [
    'electron/qdn.ts',
    readRepoSource('../electron/qdn.ts', './qdn.ts'),
    "from './foreign-wallet-read-contract.js'",
  ],
  [
    'src/platform.ts',
    readRepoSource('../src/platform.ts', './platform.ts'),
    "from '../electron/foreign-wallet-read-contract'",
  ],
] as const) {
  assert(source.includes(contractImport), `${name} must import the shared foreign-wallet read contract.`);
  assert(source.includes('getForeignWalletPublicResponse(wallet)'), `${name} must use the shared public response.`);
  assert(source.includes('executeForeignWalletRead('), `${name} must use the shared read request and error handling.`);
  assert(source.includes("case 'GET_USER_WALLET':"), `${name} must dispatch GET_USER_WALLET.`);
  assert(source.includes("case 'GET_WALLET_BALANCE':"), `${name} must dispatch GET_WALLET_BALANCE.`);
  assert(source.includes("case 'GET_USER_WALLET_INFO':"), `${name} must dispatch GET_USER_WALLET_INFO.`);
  assert(source.includes("case 'GET_USER_WALLET_TRANSACTIONS':"), `${name} must dispatch GET_USER_WALLET_TRANSACTIONS.`);
  assert(source.includes("postForeignWalletReadForApp(request, context, 'walletbalance')"));
  assert(source.includes("postForeignWalletReadForApp(request, context, 'addressinfos')"));
  assert(source.includes("postForeignWalletReadForApp(request, context, 'wallettransactions')"));
}

console.log('Foreign wallet read contract tests passed.');
