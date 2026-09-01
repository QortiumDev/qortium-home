export const HOME_WALLET_CONTRACT = 'qortium-home-wallet-v1' as const;

export type HomeWalletMode =
  | 'HOME_LOCAL'
  | 'PUBLIC_NODE'
  | 'HOME_SIGNED_PUBLIC_NODE'
  | 'TRUSTED_CORE'
  | 'NONE';

export type HomeWalletCapability = {
  contract: typeof HOME_WALLET_CONTRACT;
  implemented: boolean;
  protocol: 'qdnRequest' | 'qortalRequest';
  read: boolean;
  readMode: HomeWalletMode;
  receive: boolean;
  receiveMode: HomeWalletMode;
  requiresUnlockedAccount: boolean;
  send: boolean;
  sendMode: HomeWalletMode;
  serverManagement: boolean;
  serverManagementMode: HomeWalletMode;
};

const QORT_CURRENCY_CODE = 'QORT';
const FOREIGN_CURRENCY_CODES = new Set(['BTC', 'LTC', 'DOGE', 'DGB', 'RVN', 'DASH', 'NMC', 'FIRO']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getCurrencyCode(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function getHomeWalletCapability(
  currencyCode: unknown,
  foreignWalletLocalAvailable = false,
  foreignWalletTrustedCoreAvailable = foreignWalletLocalAvailable,
): HomeWalletCapability {
  const normalizedCurrencyCode = getCurrencyCode(currencyCode);
  const isQort = normalizedCurrencyCode === QORT_CURRENCY_CODE;

  if (isQort) {
    return {
      contract: HOME_WALLET_CONTRACT,
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
  }

  if (foreignWalletLocalAvailable && FOREIGN_CURRENCY_CODES.has(normalizedCurrencyCode)) {
    return {
      contract: HOME_WALLET_CONTRACT,
      implemented: true,
      protocol: 'qdnRequest',
      read: foreignWalletTrustedCoreAvailable,
      readMode: foreignWalletTrustedCoreAvailable ? 'TRUSTED_CORE' : 'NONE',
      receive: true,
      receiveMode: 'HOME_LOCAL',
      requiresUnlockedAccount: true,
      send: false,
      sendMode: 'NONE',
      serverManagement: foreignWalletTrustedCoreAvailable,
      serverManagementMode: foreignWalletTrustedCoreAvailable ? 'TRUSTED_CORE' : 'NONE',
    };
  }

  return {
    contract: HOME_WALLET_CONTRACT,
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
}

export function addHomeWalletCapability(
  blockchain: unknown,
  foreignWalletLocalAvailable = false,
  foreignWalletTrustedCoreAvailable = foreignWalletLocalAvailable,
) {
  if (!isRecord(blockchain)) {
    return blockchain;
  }

  return {
    ...blockchain,
    homeWallet: getHomeWalletCapability(
      blockchain.currencyCode,
      foreignWalletLocalAvailable,
      foreignWalletTrustedCoreAvailable,
    ),
  };
}

export function buildHomeBlockchainDiscovery(
  blockchains: unknown,
  qortalPublicNodeBlockchainInfo: Record<string, unknown>,
  foreignWalletLocalAvailable = false,
  foreignWalletTrustedCoreAvailable = foreignWalletLocalAvailable,
) {
  const addQortAndCapabilities = (rows: unknown[]) =>
    [qortalPublicNodeBlockchainInfo, ...rows].map((row) =>
      addHomeWalletCapability(
        row,
        foreignWalletLocalAvailable,
        foreignWalletTrustedCoreAvailable,
      ));

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
