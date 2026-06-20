import { useState } from 'react';
import { t } from './i18n';
import { buildAllowedTransports, type I2pActivity, type I2pStatus, type PeerTransportCounts, type TransportState } from './i2p';
import { useI2pConnections } from './i2pState';
import { DetailList, type DetailRow } from './releaseDisplay';
import { SettingsSection } from './SettingsSection';

type ConnectionsPanelProps = {
  canManageTransports: boolean;
  isExpanded: boolean;
  nodeApiUrl: string;
  onExpandedChange: (isExpanded: boolean) => void;
};

// Core restarts after an allowedTransports change; give it a moment before
// re-reading the status so the refreshed view reflects the new transport.
const RESTART_REFRESH_DELAY_MS = 6000;

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

export function ConnectionsPanel({
  canManageTransports,
  isExpanded,
  nodeApiUrl,
  onExpandedChange,
}: ConnectionsPanelProps) {
  const connections = useI2pConnections(nodeApiUrl);
  const { status, isLoading, isUnavailable } = connections;

  const [isConfirmingHideIp, setIsConfirmingHideIp] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isI2POnly = status?.transport.isI2POnly ?? false;
  const isBusy = isApplying || isRestarting;

  const summary = isUnavailable
    ? t('connections.state.unavailable')
    : status
      ? `I2P · ${getStateLabel(status.activity)}`
      : t('common.checking');

  async function applyMode(mode: 'i2p-only' | 'default') {
    setIsApplying(true);
    setActionError(null);

    try {
      await window.qortiumHome.node.setAllowedTransports(buildAllowedTransports(mode));
      setIsConfirmingHideIp(false);
      setIsRestarting(true);
      window.setTimeout(() => {
        setIsRestarting(false);
        connections.refresh();
      }, RESTART_REFRESH_DELAY_MS);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsApplying(false);
    }
  }

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

        {status && !canManageTransports ? (
          <p className="connections__message">{t('connections.manageHint')}</p>
        ) : null}

        {status && canManageTransports ? (
          <div className="connections__privacy">
            {isI2POnly ? (
              <>
                <p className="connections__privacy-state">{t('connections.privacyOn')}</p>
                <button
                  className="button button--secondary"
                  disabled={isBusy}
                  type="button"
                  onClick={() => void applyMode('default')}
                >
                  {t('connections.showIp')}
                </button>
              </>
            ) : isConfirmingHideIp ? (
              <>
                <p className="connections__privacy-warning">{t('connections.privacyWarning')}</p>
                <div className="connections__actions">
                  <button
                    className="button button--danger"
                    disabled={isBusy}
                    type="button"
                    onClick={() => void applyMode('i2p-only')}
                  >
                    {t('connections.confirmHideIp')}
                  </button>
                  <button
                    className="button button--secondary"
                    disabled={isBusy}
                    type="button"
                    onClick={() => setIsConfirmingHideIp(false)}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </>
            ) : (
              <button
                className="button button--secondary"
                disabled={isBusy}
                type="button"
                onClick={() => setIsConfirmingHideIp(true)}
              >
                {t('connections.hideIp')}
              </button>
            )}

            {isRestarting ? <p className="connections__message">{t('connections.applying')}</p> : null}
            {actionError ? (
              <p className="connections__message connections__message--error">{actionError}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}
