import { Globe2, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CoreMarkIcon, type CoreMarkVariant } from './components/CoreMarkIcon';
import { Popover } from './components/Popover';
import { getTranslationLanguage, t, type TranslationKey } from './i18n';

const STATUS_REFRESH_MS = 15_000;

type NodeStatusResponse = {
  height: number;
  isMintingPossible: boolean;
  isSynchronizing: boolean;
  numberOfConnections: number;
  numberOfDataConnections: number;
  syncBlocksRemaining?: null | number;
  syncPhase?: null | string;
  syncPercent?: null | number;
  syncTargetHeight?: null | number;
};

type NodeStatusState =
  | { state: 'loading' }
  | { data: NodeStatusResponse; nodeApiUrl: string; state: 'available' }
  | { message?: string; nodeApiUrl?: string; state: 'unavailable' };

type DisplayStatus =
  | 'behind'
  | 'connecting'
  | 'minting'
  | 'synced'
  | 'synchronizing'
  | 'unavailable';

const DISPLAY_STATUS_KEYS: Record<DisplayStatus, TranslationKey> = {
  behind: 'node.status.behind',
  connecting: 'node.status.connecting',
  minting: 'node.status.minting',
  synced: 'node.status.synced',
  synchronizing: 'node.status.synchronizing',
  unavailable: 'node.status.unavailable',
};

const DISPLAY_STATUS_MARKS: Record<DisplayStatus, CoreMarkVariant> = {
  behind: 'syncing',
  connecting: 'syncing',
  minting: 'minting',
  synced: 'synced',
  synchronizing: 'syncing',
  unavailable: 'unavailable',
};

const NODE_MODE_KEYS: Record<QortiumNodeSettings['mode'], TranslationKey> = {
  custom: 'node.mode.custom',
  local: 'node.mode.local',
  network: 'node.mode.network',
};

const SYNC_PHASE_KEYS: Record<string, TranslationKey | undefined> = {
  BEHIND: 'node.status.behind',
  CONNECTING: 'node.status.connecting',
  SYNCED: 'node.status.synced',
  SYNCHRONIZING: 'node.status.synchronizing',
};

type DetailRow = {
  label: string;
  value: string;
};

type NodeStatusButtonProps = {
  nodeSettings: QortiumNodeSettings;
  onMenuOpenChange?: (isOpen: boolean) => void;
  onNodeAvailable?: () => void;
  onOpenSettings: () => void;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
};

function formatError(error: unknown) {
  if (!(error instanceof Error)) {
    return t('node.updateSettingsFailed');
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function isNodeStatusResponse(value: unknown): value is NodeStatusResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const status = value as Partial<NodeStatusResponse>;

  return (
    typeof status.isMintingPossible === 'boolean' &&
    typeof status.isSynchronizing === 'boolean' &&
    typeof status.numberOfConnections === 'number' &&
    typeof status.numberOfDataConnections === 'number' &&
    typeof status.height === 'number' &&
    (status.syncBlocksRemaining === undefined ||
      status.syncBlocksRemaining === null ||
      typeof status.syncBlocksRemaining === 'number') &&
    (status.syncPhase === undefined ||
      status.syncPhase === null ||
      typeof status.syncPhase === 'string') &&
    (status.syncPercent === undefined ||
      status.syncPercent === null ||
      typeof status.syncPercent === 'number') &&
    (status.syncTargetHeight === undefined ||
      status.syncTargetHeight === null ||
      typeof status.syncTargetHeight === 'number')
  );
}

function getDisplayStatus(status: NodeStatusState): DisplayStatus {
  if (status.state === 'loading') {
    return 'connecting';
  }

  if (status.state === 'unavailable') {
    return 'unavailable';
  }

  const syncPhase = status.data.syncPhase?.toUpperCase();

  if (syncPhase === 'CONNECTING') {
    return 'connecting';
  }

  if (syncPhase === 'SYNCHRONIZING') {
    return 'synchronizing';
  }

  if (syncPhase === 'BEHIND') {
    return 'behind';
  }

  if (syncPhase === 'SYNCED') {
    if (status.data.isSynchronizing || getPositiveNumber(status.data.syncBlocksRemaining) > 0) {
      return 'synchronizing';
    }

    return status.data.isMintingPossible ? 'minting' : 'synced';
  }

  if (syncPhase) {
    return 'synchronizing';
  }

  if (status.data.isSynchronizing) {
    return 'synchronizing';
  }

  if (getPositiveNumber(status.data.syncBlocksRemaining) > 0) {
    return 'behind';
  }

  if (
    typeof status.data.syncTargetHeight === 'number' &&
    Number.isFinite(status.data.syncTargetHeight) &&
    status.data.height < status.data.syncTargetHeight
  ) {
    return 'behind';
  }

  if (
    typeof status.data.syncPercent === 'number' &&
    Number.isFinite(status.data.syncPercent) &&
    status.data.syncPercent < 100
  ) {
    return 'synchronizing';
  }

  return status.data.isMintingPossible ? 'minting' : 'synced';
}

function getPositiveNumber(value: null | number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function formatBoolean(value: boolean) {
  return value ? t('common.yes') : t('common.no');
}

function formatNumber(value: null | number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '-';
}

function formatPercent(syncPercent: null | number | undefined) {
  return typeof syncPercent === 'number' ? `${syncPercent.toFixed(0)}%` : t('common.unknown');
}

function formatSyncPhase(syncPhase: null | string | undefined) {
  if (!syncPhase) {
    return t('node.legacyStatus');
  }

  const knownPhaseKey = SYNC_PHASE_KEYS[syncPhase.toUpperCase()];

  if (knownPhaseKey) {
    return t(knownPhaseKey);
  }

  return syncPhase
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function NodeStatusButton({
  nodeSettings,
  onMenuOpenChange,
  onNodeAvailable,
  onOpenSettings,
  onResolvedNodeApiUrl,
}: NodeStatusButtonProps) {
  const [nodeStatus, setNodeStatus] = useState<NodeStatusState>({ state: 'loading' });
  const wasUnavailableRef = useRef(false);
  const onNodeAvailableRef = useRef(onNodeAvailable);
  const popoverId = 'node-status-details';

  onNodeAvailableRef.current = onNodeAvailable;

  useEffect(() => {
    let isMounted = true;

    setNodeStatus({ state: 'loading' });

    async function loadNodeStatus() {
      try {
        const result = await window.qortiumHome.node.getStatus();

        if (!isMounted) {
          return;
        }

        if (result.ok && isNodeStatusResponse(result.status)) {
          onResolvedNodeApiUrl(result.nodeApiUrl);
          setNodeStatus({ state: 'available', data: result.status, nodeApiUrl: result.nodeApiUrl });

          // Tell the app when the node recovers, so node-derived data loaded
          // while it was unreachable can be refreshed.
          if (wasUnavailableRef.current) {
            wasUnavailableRef.current = false;
            onNodeAvailableRef.current?.();
          }
          return;
        }

        wasUnavailableRef.current = true;
        setNodeStatus({
          state: 'unavailable',
          nodeApiUrl: result.nodeApiUrl,
          message: result.ok ? t('node.statusShapeError') : result.message,
        });
      } catch (error) {
        if (isMounted) {
          wasUnavailableRef.current = true;
          setNodeStatus({
            state: 'unavailable',
            message: formatError(error),
          });
        }
      }
    }

    void loadNodeStatus();
    const refreshInterval = window.setInterval(loadNodeStatus, STATUS_REFRESH_MS);

    return () => {
      isMounted = false;
      window.clearInterval(refreshInterval);
    };
  }, [nodeSettings.nodeApiUrl, onResolvedNodeApiUrl]);

  const displayStatus = getDisplayStatus(nodeStatus);
  const statusLabel = t(DISPLAY_STATUS_KEYS[displayStatus]);
  const language = getTranslationLanguage();
  const activeNodeApiUrl =
    nodeStatus.state === 'available' || nodeStatus.state === 'unavailable'
      ? nodeStatus.nodeApiUrl || nodeSettings.nodeApiUrl
      : nodeSettings.nodeApiUrl;
  const detailRows = useMemo<DetailRow[]>(() => {
    const rows: DetailRow[] =
      nodeStatus.state === 'available'
        ? [
            { label: t('node.nodeLabel'), value: activeNodeApiUrl },
            { label: t('node.modeLabel'), value: t(NODE_MODE_KEYS[nodeSettings.mode]) },
            { label: t('common.status'), value: statusLabel },
            { label: t('node.detail.phase'), value: formatSyncPhase(nodeStatus.data.syncPhase) },
            { label: t('node.detail.progress'), value: formatPercent(nodeStatus.data.syncPercent) },
            { label: t('node.detail.height'), value: nodeStatus.data.height.toLocaleString() },
            { label: t('node.detail.target'), value: formatNumber(nodeStatus.data.syncTargetHeight) },
            { label: t('node.detail.blocksLeft'), value: formatNumber(nodeStatus.data.syncBlocksRemaining) },
            {
              label: t('node.detail.peers'),
              value: t('node.peersValue', {
                chainCount: nodeStatus.data.numberOfConnections.toLocaleString(),
                dataCount: nodeStatus.data.numberOfDataConnections.toLocaleString(),
              }),
            },
            { label: t('node.detail.minting'), value: formatBoolean(nodeStatus.data.isMintingPossible) },
          ]
        : [
            { label: t('node.nodeLabel'), value: activeNodeApiUrl },
            { label: t('node.modeLabel'), value: t(NODE_MODE_KEYS[nodeSettings.mode]) },
            { label: t('common.status'), value: statusLabel },
          ];

    if (nodeStatus.state === 'unavailable' && nodeStatus.message) {
      rows.push({
        label: t('common.error'),
        value: nodeStatus.message,
      });
    }

    return rows;
  }, [activeNodeApiUrl, language, nodeSettings.mode, nodeStatus, statusLabel]);

  const isNetworkMode = nodeSettings.mode === 'network';

  return (
    <Popover
      className="node-status"
      contentClassName="node-status__popover"
      contentId={popoverId}
      contentLabel={t('node.statusPopoverLabel')}
      onOpenChange={onMenuOpenChange}
      renderTrigger={({ contentId, isOpen, toggle }) => (
        <button
          type="button"
          className={`node-status__button node-status__button--${displayStatus}`}
          aria-label={t('node.statusAria', { status: statusLabel })}
          aria-controls={isOpen ? contentId : undefined}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          onClick={toggle}
        >
          <CoreMarkIcon size={26} variant={DISPLAY_STATUS_MARKS[displayStatus]} />
          <span className="node-status__dot" aria-hidden="true" />
          {isNetworkMode ? (
            <span className="node-status__network-badge" title={t('node.networkBadge')}>
              <Globe2 aria-hidden="true" size={10} strokeWidth={2.4} />
            </span>
          ) : null}
        </button>
      )}
    >
      {({ close }) => (
        <div className="node-status__content">
          <div className="node-status__actions">
            <button
              className="button button--secondary"
              type="button"
              onClick={() => {
                close();
                onOpenSettings();
              }}
            >
              <SettingsIcon aria-hidden="true" size={18} strokeWidth={2} />
              {t('common.settings')}
            </button>
          </div>

          <dl className="detail-list">
            {detailRows.map((row) => (
              <div className="detail-list__row" key={row.label}>
                <dt className="detail-list__label">{row.label}</dt>
                <dd className="detail-list__value">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Popover>
  );
}
