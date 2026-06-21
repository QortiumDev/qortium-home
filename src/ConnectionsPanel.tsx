import { useEffect, useState } from 'react';
import { getI2pModeLabel, getI2pPeersValue, getI2pStateLabel } from './connectionsDisplay';
import { t } from './i18n';
import { buildAllowedTransports, type I2pStatus, type TransportState } from './i2p';
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

// The three transport modes the dropdown offers: IP and I2P together, or each on
// its own. Maps directly onto buildAllowedTransports().
type TransportMode = 'default' | 'ip-only' | 'i2p-only';

// Maps Core's effective transport state onto the dropdown's three modes. A
// "prefer I2P" ordering (I2P before IP) reads as the combined default, since Home
// doesn't expose transport ordering as a separate choice.
function currentMode(transport: TransportState): TransportMode {
  if (transport.isI2POnly) {
    return 'i2p-only';
  }

  if (!transport.isI2PEnabled) {
    return 'ip-only';
  }

  return 'default';
}

function getStatusRows(status: I2pStatus): DetailRow[] {
  return [
    { label: t('connections.activityLabel'), value: getI2pStateLabel(status.activity) },
    { label: t('connections.modeLabel'), value: getI2pModeLabel(status.transport) },
    { label: t('connections.networkPeers'), value: getI2pPeersValue(status.chainPeers) },
    { label: t('connections.qdnPeers'), value: getI2pPeersValue(status.dataPeers) },
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

  const [selectedMode, setSelectedMode] = useState<TransportMode | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const activeMode = status ? currentMode(status.transport) : null;

  // Keep the dropdown aligned with the node's actual mode whenever a fresh status
  // arrives — on first load and after a change is applied and Core restarts.
  useEffect(() => {
    if (activeMode) {
      setSelectedMode(activeMode);
    }
  }, [activeMode]);

  const isBusy = isApplying || isRestarting;
  const hasPendingChange =
    selectedMode !== null && activeMode !== null && selectedMode !== activeMode;

  const summary = isUnavailable
    ? t('connections.state.unavailable')
    : status
      ? `I2P · ${getI2pStateLabel(status.activity)}`
      : t('common.checking');

  async function applySelectedMode() {
    if (!selectedMode) {
      return;
    }

    setIsApplying(true);
    setActionError(null);

    try {
      await window.qortiumHome.node.setAllowedTransports(buildAllowedTransports(selectedMode));
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

  // Only the IP-hiding (I2P-only) mode carries a privacy warning; switching off
  // the I2P fallback (IP-only) gets its own note. Returning to the combined
  // default needs no caveat.
  const pendingNote =
    selectedMode === 'i2p-only'
      ? t('connections.privacyWarning')
      : selectedMode === 'ip-only'
        ? t('connections.ipOnlyWarning')
        : null;

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
            <label className="field connections__mode-field">
              <span className="field__label">{t('connections.modeLabel')}</span>
              <select
                className="select"
                disabled={isBusy}
                value={selectedMode ?? activeMode ?? 'default'}
                onChange={(event) => setSelectedMode(event.target.value as TransportMode)}
              >
                <option value="default">{t('connections.mode.default')}</option>
                <option value="ip-only">{t('connections.mode.ipOnly')}</option>
                <option value="i2p-only">{t('connections.mode.i2pOnly')}</option>
              </select>
            </label>

            {hasPendingChange ? (
              <>
                {pendingNote ? (
                  <p
                    className={
                      selectedMode === 'i2p-only'
                        ? 'connections__privacy-warning'
                        : 'connections__message'
                    }
                  >
                    {pendingNote}
                  </p>
                ) : null}
                <div className="connections__actions">
                  <button
                    className={`button ${selectedMode === 'i2p-only' ? 'button--danger' : 'button--primary'}`}
                    disabled={isBusy}
                    type="button"
                    onClick={() => void applySelectedMode()}
                  >
                    {t('common.save')}
                  </button>
                </div>
              </>
            ) : null}

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
