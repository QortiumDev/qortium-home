import { getForeignWalletCoins } from './foreign-wallets.js';

export type HomeWalletSendMode = 'HOME_SIGNED_PUBLIC_NODE' | 'TRUSTED_CORE' | 'NONE';

export type HomeWalletCapability = {
  implemented: boolean;
  read: boolean;
  receive: boolean;
  requiresUnlockedAccount: boolean;
  send: boolean;
  sendMode: HomeWalletSendMode;
};

const QORT_CURRENCY_CODE = 'QORT';
const foreignWalletCoins = new Set<string>(getForeignWalletCoins());

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getCurrencyCode(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function getHomeWalletCapability(currencyCode: unknown): HomeWalletCapability {
  const normalizedCurrencyCode = getCurrencyCode(currencyCode);
  const isQort = normalizedCurrencyCode === QORT_CURRENCY_CODE;
  const isSupportedForeignWallet = foreignWalletCoins.has(normalizedCurrencyCode);

  if (isQort || isSupportedForeignWallet) {
    return {
      implemented: true,
      read: true,
      receive: true,
      requiresUnlockedAccount: true,
      send: true,
      sendMode: isQort ? 'HOME_SIGNED_PUBLIC_NODE' : 'TRUSTED_CORE',
    };
  }

  return {
    implemented: false,
    read: false,
    receive: false,
    requiresUnlockedAccount: false,
    send: false,
    sendMode: 'NONE',
  };
}

export function addHomeWalletCapability(blockchain: unknown) {
  if (!isRecord(blockchain)) {
    return blockchain;
  }

  return {
    ...blockchain,
    homeWallet: getHomeWalletCapability(blockchain.currencyCode),
  };
}

export function buildHomeBlockchainDiscovery(
  blockchains: unknown,
  qortalPublicNodeBlockchainInfo: Record<string, unknown>,
) {
  const addQortAndCapabilities = (rows: unknown[]) =>
    [qortalPublicNodeBlockchainInfo, ...rows].map(addHomeWalletCapability);

  if (Array.isArray(blockchains)) {
    return addQortAndCapabilities(blockchains);
  }

  if (isRecord(blockchains) && Array.isArray(blockchains.data)) {
    return {
      ...blockchains,
      data: addQortAndCapabilities(blockchains.data),
    };
  }

  return blockchains;
}
