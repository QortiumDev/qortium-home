import type { ForeignWalletPublicRuntime } from './foreign-wallets.js';

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
  wallet: ForeignWalletPublicRuntime,
  endpoint: ForeignWalletReadEndpoint,
): ForeignWalletReadRequest {
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
  wallet: ForeignWalletPublicRuntime,
  endpoint: ForeignWalletReadEndpoint,
  post: (request: ForeignWalletReadRequest) => Promise<T>,
) {
  try {
    return await post(buildForeignWalletReadRequest(wallet, endpoint));
  } catch (error) {
    throw normalizeForeignWalletReadError(error, wallet.coin);
  }
}
