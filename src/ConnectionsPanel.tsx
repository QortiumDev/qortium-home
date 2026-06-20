import { t } from './i18n';
import type { I2pActivity, I2pStatus, PeerTransportCounts, TransportState } from './i2p';
import { useI2pConnections } from './i2pState';
import { DetailList, type DetailRow } from './releaseDisplay';
import { SettingsSection } from './SettingsSection';

type ConnectionsPanelProps = {
  isExpanded: boolean;
  nodeApiUrl: string;
  onExpandedChange: (isExpanded: boolean) => void;
};

function getStateLabel(activity: I2pActivity): string {
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

function getModeLabel(transport: TransportState): string {
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

function getPeersValue(counts: PeerTransportCounts): string {
  return t('connections.peersValue', { total: counts.total, i2p: counts.i2p });
}

function getStatusRows(status: I2pStatus): DetailRow[] {
  return [
    { label: t('connections.activityLabel'), value: getStateLabel(status.activity) },
    { label: t('connections.modeLabel'), value: getModeLabel(status.transport) },
    { label: t('connections.networkPeers'), value: getPeersValue(status.chainPeers) },
    { label: t('connections.qdnPeers'), value: getPeersValue(status.dataPeers) },
  ];
}

export function ConnectionsPanel({ isExpanded, nodeApiUrl, onExpandedChange }: ConnectionsPanelProps) {
  const connections = useI2pConnections(nodeApiUrl);
  const { status, isLoading, isUnavailable } = connections;

  const summary = isUnavailable
    ? t('connections.state.unavailable')
    : status
      ? `I2P · ${getStateLabel(status.activity)}`
      : t('common.checking');

  return (
    <SettingsSection
      isExpanded={isExpanded}
      isRefreshing={isLoading}
      refreshLabel={t('common.refresh')}
      summary={summary}
      title={t('connections.title')}
      onExpandedChange={onExpandedChange}
      onRefresh={connections.refresh}
    >
      <div className="connections">
        {status ? (
          <DetailList className="connections__details" rows={getStatusRows(status)} />
        ) : (
          <p className="connections__message">
            {isUnavailable ? t('connections.unavailable') : t('common.checking')}
          </p>
        )}
      </div>
    </SettingsSection>
  );
}
