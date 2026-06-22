import { useEffect, useState } from 'react';
import { getI2pModeLabel, getI2pPeersValue, getI2pStateLabel } from './connectionsDisplay';
import { t } from './i18n';
import { buildAllowedTransports, type I2pStatus, type TransportState } from './i2p';
import { useI2pConnections } from './i2pState';
import { useI2pdManager } from './i2pdManagerState';
import { DetailList, type DetailRow } from './releaseDisplay';
import { SettingsSection } from './SettingsSection';

type ConnectionsPanelProps = {
  canManageTransports: boolean;
  // True only for the local Core that Home manages — the one whose i2pd Home can
  // install and run. Custom/remote nodes manage their own router.
  isManagedNode: boolean;
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

function getRouterStateLabel(status: QortiumI2pdStatus | null): string {
  if (!status) {
    return t('common.checking');
  }

  if (status.mode === 'managed') {
    return t('connections.routerRunning');
  }

  if (status.mode === 'external') {
    return t('connections.routerExternal');
  }

  return t('connections.routerOff');
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
  isManagedNode,
  isExpanded,
  nodeApiUrl,
  onExpandedChange,
}: ConnectionsPanelProps) {
  const connections = useI2pConnections(nodeApiUrl);
  const { status, isLoading, isUnavailable } = connections;

  const manager = useI2pdManager(isManagedNode);
  // The managed-router controls only apply to the local Core on a desktop build
  // with the i2pd bridge present.
  const managerSupported = manager.supported && isManagedNode;
  // When Home can manage the router, gate I2P on it actually being available;
  // otherwise (remote/custom node, Android) leave the transport choice ungated.
  const i2pAvailable = !managerSupported || (manager.status?.running ?? false);
  const i2pOptionsDisabled = managerSupported && !i2pAvailable;

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

  const controlsBusy = isApplying || isRestarting || manager.isBusy;
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
      // Switching the node to Direct-only? Shut down the router Home runs — the
      // node won't use it anymore. (An external router is left untouched.)
      if (selectedMode === 'ip-only' && managerSupported && manager.status?.mode === 'managed') {
        await manager.disable();
      }
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

  async function toggleRouter() {
    if (manager.status?.mode === 'managed') {
      await manager.disable();
    } else {
      await manager.enable();
    }
    // The node's I2P session/peers change once the router comes up or down.
    connections.refresh();
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
            {managerSupported ? (
              <div className="connections__router">
                <DetailList
                  className="connections__details"
                  rows={[{ label: t('connections.routerLabel'), value: getRouterStateLabel(manager.status) }]}
                />
                {manager.status?.mode === 'external' ? null : (
                  <div className="connections__actions">
                    <button
                      className={`button ${manager.status?.mode === 'managed' ? 'button--secondary' : 'button--primary'}`}
                      disabled={controlsBusy}
                      type="button"
                      onClick={() => void toggleRouter()}
                    >
                      {manager.status?.mode === 'managed'
                        ? t('connections.disableI2p')
                        : t('connections.enableI2p')}
                    </button>
                  </div>
                )}
                {manager.isBusy && manager.progress ? (
                  <p className="connections__message">{manager.progress}</p>
                ) : null}
                {manager.error ? (
                  <p className="connections__message connections__message--error">{manager.error}</p>
                ) : null}
              </div>
            ) : null}

            <label className="field connections__mode-field">
              <span className="field__label">{t('connections.modeLabel')}</span>
              <select
                className="select"
                disabled={controlsBusy}
                value={selectedMode ?? activeMode ?? 'default'}
                onChange={(event) => setSelectedMode(event.target.value as TransportMode)}
              >
                <option value="default" disabled={i2pOptionsDisabled}>
                  {t('connections.mode.default')}
                </option>
                <option value="ip-only">{t('connections.mode.ipOnly')}</option>
                <option value="i2p-only" disabled={i2pOptionsDisabled}>
                  {t('connections.mode.i2pOnly')}
                </option>
              </select>
            </label>

            {i2pOptionsDisabled ? (
              <p className="connections__message">{t('connections.routerHint')}</p>
            ) : null}

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
                    disabled={controlsBusy}
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
