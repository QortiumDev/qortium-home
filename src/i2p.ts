// Shared I2P transport logic for Home. This module is pure: it derives Home's view
// of the node's I2P state from two open Core endpoints (GET /admin/settings and
// GET /peers + /peers/data) without performing any I/O, so it works the same on
// desktop and Android. Fetching/wiring lives in the platform layer and UI panels.
//
// Core governs transports through an ordered `allowedTransports` list (Core v1.1.0+).
// A null/empty list means the built-in default ["IP","I2P"] (I2P fallback enabled,
// direct TCP preferred). See the Core i2pd handoff for the authoritative semantics.

export type CoreTransport = 'IP' | 'I2P';

export const DEFAULT_ALLOWED_TRANSPORTS: readonly CoreTransport[] = ['IP', 'I2P'];

// The I2P-related fields of Core's GET /admin/settings response.
export type CoreTransportSettings = {
  allowedTransports: string[] | null;
  i2pSamHost: string;
  i2pSamPort: number;
  i2pChainKeyFile: string;
  i2pDataKeyFile: string;
  i2pEmbeddedRouter: boolean;
};

// Home's derived view of the transport configuration. Mirrors Core's derived
// getters (isI2PEnabled / isI2PPreferred / isI2POnly / isIPAllowed).
export type TransportState = {
  effectiveTransports: CoreTransport[];
  isI2PEnabled: boolean;
  isI2PPreferred: boolean;
  isI2POnly: boolean;
  isIPAllowed: boolean;
};

export type PeerTransportCounts = {
  ip: number;
  i2p: number;
  total: number;
};

export type I2pActivity = 'disabled' | 'idle' | 'active';

export type I2pStatus = {
  activity: I2pActivity;
  chainPeers: PeerTransportCounts;
  dataPeers: PeerTransportCounts;
  transport: TransportState;
};

// Normalizes a raw allowedTransports entry the way Core does: trim + uppercase.
// Unknown values are dropped here (Core rejects them at validation time; for a
// read-only view we simply ignore anything that is not a known transport).
function normalizeTransports(allowedTransports: string[] | null): CoreTransport[] {
  if (!allowedTransports || allowedTransports.length === 0) {
    return [...DEFAULT_ALLOWED_TRANSPORTS];
  }

  const normalized: CoreTransport[] = [];

  for (const entry of allowedTransports) {
    const value = entry.trim().toUpperCase();

    if ((value === 'IP' || value === 'I2P') && !normalized.includes(value)) {
      normalized.push(value);
    }
  }

  // A list that normalizes to nothing usable falls back to Core's default.
  return normalized.length > 0 ? normalized : [...DEFAULT_ALLOWED_TRANSPORTS];
}

export function deriveTransportState(allowedTransports: string[] | null): TransportState {
  const effectiveTransports = normalizeTransports(allowedTransports);
  const ipIndex = effectiveTransports.indexOf('IP');
  const i2pIndex = effectiveTransports.indexOf('I2P');
  const isI2PEnabled = i2pIndex >= 0;
  const isIPAllowed = ipIndex >= 0;

  return {
    effectiveTransports,
    isI2PEnabled,
    isIPAllowed,
    isI2POnly: isI2PEnabled && !isIPAllowed,
    // Preferred when I2P comes before IP in the order, or when IP is absent.
    isI2PPreferred: isI2PEnabled && (!isIPAllowed || i2pIndex < ipIndex),
  };
}

// Builds the allowedTransports list for a desired mode. Home always drives the
// list (never the removed i2pEnabled/i2pPreferred booleans).
export function buildAllowedTransports(mode: 'default' | 'prefer-i2p' | 'i2p-only' | 'ip-only'): CoreTransport[] {
  switch (mode) {
    case 'ip-only':
      return ['IP'];
    case 'i2p-only':
      return ['I2P'];
    case 'prefer-i2p':
      return ['I2P', 'IP'];
    case 'default':
    default:
      return ['IP', 'I2P'];
  }
}

type PeerLike = { transport?: unknown };

export function summarizePeerTransports(peers: readonly PeerLike[]): PeerTransportCounts {
  let ip = 0;
  let i2p = 0;

  for (const peer of peers) {
    if (peer.transport === 'I2P') {
      i2p += 1;
    } else if (peer.transport === 'IP') {
      ip += 1;
    }
  }

  return { ip, i2p, total: peers.length };
}

export function deriveI2pStatus(
  settings: CoreTransportSettings,
  chainPeers: readonly PeerLike[],
  dataPeers: readonly PeerLike[],
): I2pStatus {
  const transport = deriveTransportState(settings.allowedTransports);
  const chain = summarizePeerTransports(chainPeers);
  const data = summarizePeerTransports(dataPeers);

  let activity: I2pActivity;

  if (!transport.isI2PEnabled) {
    activity = 'disabled';
  } else if (chain.i2p > 0 || data.i2p > 0) {
    // At least one live peer is connected over I2P, so the fallback is working.
    activity = 'active';
  } else {
    // I2P is enabled but nothing is connected over it yet: the router may be
    // absent/warming up, or no NAT'd peers currently need the fallback.
    activity = 'idle';
  }

  return { activity, chainPeers: chain, dataPeers: data, transport };
}
