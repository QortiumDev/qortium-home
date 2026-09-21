import { ARRR_CUSTODY_CONTRACT } from './arrr-custody.js';

export const HOME_WALLET_CONTRACT = 'qortium-home-wallet-v1' as const;

export type HomeWalletMode =
  | 'HOME_LOCAL'
  | 'PUBLIC_NODE'
  | 'HOME_SIGNED_PUBLIC_NODE'
  | 'TRUSTED_CORE'
  // ARRR only. The user's ADMIN-TRUSTED Core holds a copy of the wallet's
  // spending key (handed over per request by Home, under its own consent)
  // and answers the address, balances and history from its synced copy.
  // Never used for a send: that would be Core spending, which Home does
  // not offer.
  | 'TRUSTED_CORE_CUSTODY'
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
  // ARRR custody rows only. `custodyContract` names the structured contract
  // (request/response shapes and GET_ARRR_SYNC_STATUS's snapshot) so an app
  // gates on a version, and `syncStatus` says the structured status action
  // is served on this host/route. Absent on every other row.
  custodyContract?: typeof ARRR_CUSTODY_CONTRACT;
  syncStatus?: boolean;
  // Why an ARRR row is unavailable, when it is — e.g. Android, a public or
  // untrusted route, or a locked account. Absent when available and on every
  // other coin's row.
  unavailableReason?: string;
};

const QORT_CURRENCY_CODE = 'QORT';
const FOREIGN_CURRENCY_CODES = new Set(['BTC', 'LTC', 'DOGE', 'DGB', 'RVN', 'DASH', 'NMC', 'FIRO']);
const ARRR_CURRENCY_CODE = 'ARRR';

/**
 * Availability of the ARRR custody read adapter for the caller's host/route/
 * account. Computed by the host from ITS OWN facts (desktop, admin-trusted
 * route, unlocked account) — never from the bitcoiny send-route probe, which
 * answers a different question about a different family.
 */
export type HomeWalletArrrCustodyAvailability = Readonly<{
  available: boolean;
  reason?: string;
}>;

export const ARRR_CUSTODY_UNAVAILABLE: HomeWalletArrrCustodyAvailability = Object.freeze({
  available: false,
  reason: 'ARRR custody is not available on this host or route.',
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getCurrencyCode(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/**
 * `foreignWalletSendAvailable` is deliberately NOT derived from the other two
 * flags and defaults to false. Reading a foreign wallet needs a trusted Core;
 * SENDING additionally needs a selected, unlocked account and a host that
 * implements the Home-local signer. A host that has not been taught to send
 * must keep advertising `send: false` rather than inheriting a read
 * capability, so every caller states the send answer explicitly.
 */
export function getHomeWalletCapability(
  currencyCode: unknown,
  foreignWalletLocalAvailable = false,
  foreignWalletTrustedCoreAvailable = foreignWalletLocalAvailable,
  foreignWalletSendAvailable = false,
  arrrCustody: HomeWalletArrrCustodyAvailability = ARRR_CUSTODY_UNAVAILABLE,
): HomeWalletCapability {
  const normalizedCurrencyCode = getCurrencyCode(currencyCode);
  const isQort = normalizedCurrencyCode === QORT_CURRENCY_CODE;

  if (normalizedCurrencyCode === ARRR_CURRENCY_CODE) {
    // The ARRR branch is separate from the eight-coin branch on purpose: it
    // neither inherits the bitcoiny flags nor can be reached by them. Send is
    // ALWAYS false — Core's /send would be Core spending the user's key — and
    // server management stays unavailable in this tranche.
    if (arrrCustody.available) {
      return {
        contract: HOME_WALLET_CONTRACT,
        custodyContract: ARRR_CUSTODY_CONTRACT,
        implemented: true,
        protocol: 'qdnRequest',
        read: true,
        readMode: 'TRUSTED_CORE_CUSTODY',
        receive: true,
        receiveMode: 'TRUSTED_CORE_CUSTODY',
        requiresUnlockedAccount: true,
        send: false,
        sendMode: 'NONE',
        serverManagement: false,
        serverManagementMode: 'NONE',
        syncStatus: true,
      };
    }
    return {
      contract: HOME_WALLET_CONTRACT,
      custodyContract: ARRR_CUSTODY_CONTRACT,
      implemented: false,
      protocol: 'qdnRequest',
      read: false,
      readMode: 'NONE',
      receive: false,
      receiveMode: 'NONE',
      requiresUnlockedAccount: true,
      send: false,
      sendMode: 'NONE',
      serverManagement: false,
      serverManagementMode: 'NONE',
      syncStatus: false,
      unavailableReason: arrrCustody.reason ?? ARRR_CUSTODY_UNAVAILABLE.reason,
    };
  }

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
      // HOME_LOCAL, not TRUSTED_CORE: Home plans, signs and hashes the
      // transaction itself and hands the node finished bytes. The node is a
      // relay for the send, exactly as it is for a QORT send.
      send: foreignWalletSendAvailable,
      sendMode: foreignWalletSendAvailable ? 'HOME_LOCAL' : 'NONE',
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
  foreignWalletSendAvailable = false,
  arrrCustody: HomeWalletArrrCustodyAvailability = ARRR_CUSTODY_UNAVAILABLE,
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
      foreignWalletSendAvailable,
      arrrCustody,
    ),
  };
}

export function buildHomeBlockchainDiscovery(
  blockchains: unknown,
  qortalPublicNodeBlockchainInfo: Record<string, unknown>,
  foreignWalletLocalAvailable = false,
  foreignWalletTrustedCoreAvailable = foreignWalletLocalAvailable,
  foreignWalletSendAvailable = false,
  arrrCustody: HomeWalletArrrCustodyAvailability = ARRR_CUSTODY_UNAVAILABLE,
) {
  const addQortAndCapabilities = (rows: unknown[]) =>
    [qortalPublicNodeBlockchainInfo, ...rows].map((row) =>
      addHomeWalletCapability(
        row,
        foreignWalletLocalAvailable,
        foreignWalletTrustedCoreAvailable,
        foreignWalletSendAvailable,
        arrrCustody,
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
