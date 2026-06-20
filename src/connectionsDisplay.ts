import { t } from './i18n';
import type { I2pActivity, PeerTransportCounts, TransportState } from './i2p';

// Shared human-readable labels for the node's I2P transport state, used by both
// the Settings Connections panel and the dashboard Connections card.

export function getI2pStateLabel(activity: I2pActivity): string {
  switch (activity) {
    case 'active':
      return t('connections.state.active');
    case 'idle':
      return t('connections.state.idle');
    case 'disabled':
    default:
      return t('connections.state.disabled');
  }
}

export function getI2pModeLabel(transport: TransportState): string {
  if (transport.isI2POnly) {
    return t('connections.mode.i2pOnly');
  }

  if (!transport.isI2PEnabled) {
    return t('connections.mode.ipOnly');
  }

  if (transport.isI2PPreferred) {
    return t('connections.mode.preferI2p');
  }

  return t('connections.mode.default');
}

export function getI2pPeersValue(counts: PeerTransportCounts): string {
  return t('connections.peersValue', { total: counts.total, i2p: counts.i2p });
}
