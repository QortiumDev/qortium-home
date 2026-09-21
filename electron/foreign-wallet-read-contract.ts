import type { BitcoinyWalletPublicRuntime, ForeignWalletPublicRuntime } from './foreign-wallets.js';
import type { ArrrCustodyRuntime } from './arrr-custody.js';

/**
 * Every wallet runtime the Home 2 bridge can hold, discriminated by `kind`.
 * The bitcoiny runtime (address + xpub, what Core WATCHES) is the only one the
 * xpub request builder below accepts; the ARRR custody runtime carries no key
 * material and is served by arrr-custody.ts, which posts a per-request
 * entropy instead. Branching on `kind` here is what keeps ARRR out of the
 * eight-coin machinery: a caller cannot fabricate an xpub for it because the
 * type has none.
 */
export type HomeV2ForeignWalletRuntime = BitcoinyWalletPublicRuntime | ArrrCustodyRuntime;

export function isArrrCustodyRuntime(runtime: HomeV2ForeignWalletRuntime): runtime is ArrrCustodyRuntime {
  return (runtime as { kind?: unknown }).kind === 'arrr-custody';
}

export type ForeignWalletReadEndpoint = 'addressinfos' | 'walletbalance' | 'wallettransactions';

export type ForeignWalletReadRequest = {
  body: string;
  contentType: 'application/json' | 'text/plain';
  pathname: string;
};

export const FOREIGN_WALLET_BACKEND_UNAVAILABLE_CODE = 'FOREIGN_WALLET_BACKEND_UNAVAILABLE';

export function getForeignWalletPublicResponse(wallet: ForeignWalletPublicRuntime) {
  return {
    address: wallet.address,
    coin: wallet.coin,
    publicKey: wallet.publicKey,
    publickey: wallet.publicKey,
  };
}

export function buildForeignWalletReadRequest(
  wallet: HomeV2ForeignWalletRuntime,
  endpoint: ForeignWalletReadEndpoint,
): ForeignWalletReadRequest {
  if (isArrrCustodyRuntime(wallet)) {
    throw new Error('ARRR has no extended public key; use the ARRR custody read adapter.');
  }
  return {
    body: endpoint === 'addressinfos'
      ? JSON.stringify({ xpub58: wallet.xpub58 })
      : wallet.xpub58,
    contentType: endpoint === 'addressinfos' ? 'application/json' : 'text/plain',
    pathname: `/crosschain/${wallet.coin.toLowerCase()}/${endpoint}`,
  };
}

function getCoreApiErrorCode(error: unknown) {
  if (!(error instanceof Error)) return undefined;

  try {
    const body = JSON.parse(error.message) as unknown;

    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'number') {
      return body.error;
    }
  } catch {
    // Non-JSON errors retain their original message and code.
  }

  return undefined;
}

export function normalizeForeignWalletReadError(error: unknown, coin: ForeignWalletPublicRuntime['coin']) {
  if (getCoreApiErrorCode(error) === 1201) {
    return Object.assign(
      new Error(`${coin} wallet backend is unavailable. Qortium Core could not connect to a wallet-capable server.`),
      { code: FOREIGN_WALLET_BACKEND_UNAVAILABLE_CODE },
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}

export async function executeForeignWalletRead<T>(
  wallet: HomeV2ForeignWalletRuntime,
  endpoint: ForeignWalletReadEndpoint,
  post: (request: ForeignWalletReadRequest) => Promise<T>,
) {
  if (isArrrCustodyRuntime(wallet)) {
    throw new Error('ARRR has no extended public key; use the ARRR custody read adapter.');
  }
  try {
    return await post(buildForeignWalletReadRequest(wallet, endpoint));
  } catch (error) {
    throw normalizeForeignWalletReadError(error, wallet.coin);
  }
}
