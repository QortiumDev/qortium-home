import { useEffect, useRef, useState } from 'react';
import { t } from './i18n';
import { buildAllowedTransports, type TransportState } from './i2p';
import type { useI2pConnections } from './i2pState';
import type { useI2pdManager } from './i2pdManagerState';
import { DetailList, RevealValue, type DetailRow } from './releaseDisplay';

// Shared I2P/transport controls, split out of the old Connections settings panel.
// The transport dropdown now lives in the Qortium Core section (and the Home
// dashboard tile); the managed-router button lives in the Home section (and the
// Home dashboard tile). Both are presentational — the container owns the hooks so
// a single surface can feed both the dropdown and the router button.

export type I2pConnections = ReturnType<typeof useI2pConnections>;
export type I2pdManager = ReturnType<typeof useI2pdManager>;

// Core restarts after an allowedTransports change; wait a beat before re-reading
// status so the refreshed view reflects the new transport.
const RESTART_REFRESH_DELAY_MS = 6000;

// The three transport modes the dropdown offers; maps onto buildAllowedTransports.
type TransportMode = 'default' | 'ip-only' | 'i2p-only';

// Maps Core's effective transport state onto the dropdown's three modes. A
// "prefer I2P" ordering reads as the combined default, since Home doesn't expose
// transport ordering as a separate choice.
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

// The node-transport dropdown. Applies immediately on change (no Save button); a
// Core restart follows, after which the status refresh re-syncs the value. The
// `showWarning` variant (Settings) keeps the I2P-only / IP-only safety notes; the
// compact variant (dashboard) is just the dropdown.
export function TransportModeSelect({
  className,
  connections,
  isManagedNode,
  label,
  manager,
  showWarning = false,
}: {
  className?: string;
  connections: I2pConnections;
  isManagedNode: boolean;
  // When set, the select is wrapped in a labeled field (Settings); omitted on the
  // compact dashboard control.
  label?: string;
  manager: I2pdManager;
  showWarning?: boolean;
}) {
  const { status } = connections;
  const managerSupported = manager.supported && isManagedNode;
  // When Home manages the router, gate the I2P options on it actually running;
  // otherwise (remote/custom node, Android) leave the choice ungated.
  const i2pAvailable = !managerSupported || (manager.status?.running ?? false);
  const i2pOptionsDisabled = managerSupported && !i2pAvailable;

  const [selectedMode, setSelectedMode] = useState<TransportMode | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restartRefreshTimeoutRef = useRef<number | null>(null);

  const activeMode = status ? currentMode(status.transport) : null;

  // Re-sync to the node's real mode whenever a fresh status arrives (first load
  // and after a change is applied and Core restarts).
  useEffect(() => {
    if (activeMode) {
      setSelectedMode(activeMode);
    }
  }, [activeMode]);

  useEffect(() => {
    return () => {
      if (restartRefreshTimeoutRef.current !== null) {
        window.clearTimeout(restartRefreshTimeoutRef.current);
      }
    };
  }, []);

  if (!status) {
    return null;
  }

  const busy = isApplying || isRestarting || manager.isBusy;
  const displayMode = selectedMode ?? activeMode ?? 'default';

  async function apply(mode: TransportMode) {
    setSelectedMode(mode);
    setIsApplying(true);
    setError(null);

    try {
      await window.qortiumHome.node.setAllowedTransports(buildAllowedTransports(mode));
      // Switching to Direct-only? Shut down the router Home runs — the node won't
      // use it anymore. (An external router is left untouched.)
      if (mode === 'ip-only' && managerSupported && manager.status?.mode === 'managed') {
        await manager.disable();
      }
      setIsRestarting(true);
      if (restartRefreshTimeoutRef.current !== null) {
        window.clearTimeout(restartRefreshTimeoutRef.current);
      }
      restartRefreshTimeoutRef.current = window.setTimeout(() => {
        restartRefreshTimeoutRef.current = null;
        setIsRestarting(false);
        connections.refresh();
      }, RESTART_REFRESH_DELAY_MS);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSelectedMode(activeMode);
    } finally {
      setIsApplying(false);
    }
  }

  // Only the I2P-only (IP-hiding) and Direct-only (no fallback) modes carry a note.
  const warning =
    displayMode === 'i2p-only'
      ? t('connections.privacyWarning')
      : displayMode === 'ip-only'
        ? t('connections.ipOnlyWarning')
        : null;

  const select = (
    <select
      aria-label={t('connections.modeLabel')}
      className={className ?? 'field__input'}
      disabled={busy}
      value={displayMode}
      onChange={(event) => void apply(event.target.value as TransportMode)}
    >
      <option value="default" disabled={i2pOptionsDisabled}>
        {t('connections.mode.default')}
      </option>
      <option value="ip-only">{t('connections.mode.ipOnly')}</option>
      <option value="i2p-only" disabled={i2pOptionsDisabled}>
        {t('connections.mode.i2pOnly')}
      </option>
    </select>
  );

  return (
    <div className="transport-control">
      {label ? (
        <label className="field">
          <span className="field__label">{label}</span>
          {select}
        </label>
      ) : (
        select
      )}

      {showWarning && i2pOptionsDisabled ? (
        <p className="connections__message">{t('connections.routerHint')}</p>
      ) : null}
      {showWarning && warning ? (
        <p className={displayMode === 'i2p-only' ? 'connections__privacy-warning' : 'connections__message'}>
          {warning}
        </p>
      ) : null}
      {isRestarting ? <p className="connections__message">{t('connections.applying')}</p> : null}
      {error ? <p className="connections__message connections__message--error">{error}</p> : null}
    </div>
  );
}

// Enable/disable Home's managed i2pd router. Only rendered for the managed local
// Core (the only node whose router Home can run); returns null otherwise. The
// `showStatus` variant (Settings) adds the router state row.
export function I2pRouterButton({
  connections,
  isManagedNode,
  manager,
  showStatus = false,
}: {
  connections: I2pConnections;
  isManagedNode: boolean;
  manager: I2pdManager;
  showStatus?: boolean;
}) {
  const managerSupported = manager.supported && isManagedNode;

  if (!managerSupported) {
    return null;
  }

  const isManaged = manager.status?.mode === 'managed';
  const isExternal = manager.status?.mode === 'external';
  const hasBusyMessage = manager.isBusy && !!manager.progress;
  const hasError = !!manager.error;
  const detailRows: DetailRow[] = [
    { label: t('connections.routerLabel'), value: getRouterStateLabel(manager.status) },
  ];
  if (isExternal && manager.status?.externalBinaryPath) {
    // The external i2pd is a binary file, so reveal it in its folder (like the jar
    // reveal) rather than open-path, which would try to execute it.
    detailRows.push({
      label: t('core.folderLabel'),
      value: (
        <RevealValue path={manager.status.externalBinaryPath}>
          {manager.status.externalBinaryPath}
        </RevealValue>
      ),
    });
  }

  // On the compact dashboard control (showStatus=false) an external router has no
  // button, status row, busy message or error to show — render nothing rather than
  // an empty .i2p-router-control, which would otherwise leave a phantom flex slot.
  if (isExternal && !showStatus && !hasBusyMessage && !hasError) {
    return null;
  }

  async function toggle() {
    if (isManaged) {
      await manager.disable();
    } else {
      await manager.enable();
    }
    // The node's I2P session/peers change once the router comes up or down.
    connections.refresh();
  }

  return (
    <div className="i2p-router-control">
      {showStatus ? (
        <DetailList className="connections__details" rows={detailRows} />
      ) : null}
      {isExternal ? null : (
        <button
          className={`button ${isManaged ? 'button--secondary' : 'button--primary'}`}
          disabled={manager.isBusy}
          type="button"
          onClick={() => void toggle()}
        >
          {isManaged ? t('connections.disableI2p') : t('connections.enableI2p')}
        </button>
      )}
      {manager.isBusy && manager.progress ? <p className="connections__message">{manager.progress}</p> : null}
      {manager.error ? <p className="connections__message connections__message--error">{manager.error}</p> : null}
    </div>
  );
}
