import { Download, ExternalLink, FolderOpen, Play, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AccountsPanel } from './AccountsPanel';
import {
  getOpenDownloadedFileLabel,
  useAppUpdates,
} from './appUpdateState';
import {
  formatJava,
  getCoreReleaseActionLabel,
  useCoreManager,
} from './coreManagerState';

type DashboardPageProps = {
  accountsError: string;
  accountsState: QortiumAccountsState;
  isLoadingAccounts: boolean;
  nodeSettings: QortiumNodeSettings;
  selectedAccountId: string | null;
  onAccountsStateChange: (accountsState: QortiumAccountsState) => void;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onSaveNodeSettings: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;
  onSelectedAccountChange: (accountId: string | null) => void;
};

type LocalNodeStatus =
  | {
      state: 'idle';
    }
  | {
      state: 'loading';
    }
  | {
      nodeApiUrl: string;
      state: 'available';
    }
  | {
      message: string;
      nodeApiUrl: string;
      state: 'unavailable';
    };

type OnChainCoreUpdateState =
  | {
      state: 'loading';
    }
  | {
      message: string;
      state: 'unavailable';
    }
  | {
      state: 'available';
      status: QortiumCoreOnChainUpdateStatus;
    }
  | {
      status?: QortiumCoreOnChainUpdateStatus;
      state: 'installing';
    };

const ON_CHAIN_CORE_UPDATE_POLL_INTERVAL_MS = 5000;
const ACTIVE_ON_CHAIN_QDN_RESOURCE_STATUSES = new Set(['BUILDING', 'DOWNLOADING']);

function formatLocalNodeError(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Local node was not detected.';
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function formatCoreAdminError(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Unable to check approved on-chain Core updates.';
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function getOnChainCoreUpdateUnavailableMessage(nodeSettings: QortiumNodeSettings) {
  if (nodeSettings.mode === 'network') {
    return 'Requires a local Core or trusted custom node with API key.';
  }

  if (nodeSettings.mode === 'custom' && !nodeSettings.apiKey) {
    return 'Save the custom node API key to check approved on-chain Core updates.';
  }

  return null;
}

function formatAutoUpdateMode(value: string | null | undefined) {
  switch (value) {
    case 'INSTALL':
      return 'Automatic install';
    case 'NOTIFY':
      return 'Notify';
    case 'CHECK_ONLY':
      return 'Check only';
    case 'OFF':
      return 'Off';
    default:
      return value || 'Unknown';
  }
}

function formatCommitHash(value: string | null | undefined) {
  if (!value) {
    return '';
  }

  return value.length > 12 ? value.slice(0, 12) : value;
}

function getOnChainQdnResourceLabel(status: QortiumCoreOnChainUpdateStatus) {
  const service = status.qdnService || status.binaryService || '';
  const name = status.qdnName || status.binaryName || '';
  const identifier = status.qdnIdentifier || status.binaryIdentifier || '';

  if (!service || !name) {
    return '';
  }

  return `${service}/${name}${identifier ? `/${identifier}` : ''}`;
}

function getOnChainQdnStatusLabel(status: QortiumCoreOnChainUpdateStatus) {
  const resourceStatus = status.binaryResourceStatus || '';
  const percent =
    typeof status.binaryResourcePercentLoaded === 'number'
      ? Math.max(0, Math.min(100, Math.round(status.binaryResourcePercentLoaded)))
      : null;

  if (!resourceStatus && percent === null) {
    return '';
  }

  return percent === null ? resourceStatus : `${resourceStatus || 'Loading'} ${percent}%`;
}

function normalizeOnChainUpdateStatusCode(value: string | null | undefined) {
  return (value || '').toUpperCase();
}

function isOnChainQdnResourceActive(status: QortiumCoreOnChainUpdateStatus) {
  const resourceStatus = normalizeOnChainUpdateStatusCode(status.binaryResourceStatus);

  return ACTIVE_ON_CHAIN_QDN_RESOURCE_STATUSES.has(resourceStatus);
}

function isOnChainCoreUpdateAttemptActive(status: QortiumCoreOnChainUpdateStatus) {
  const statusCode = normalizeOnChainUpdateStatusCode(status.status);

  return (
    !!status.installStarted ||
    !!status.installing ||
    statusCode === 'DOWNLOAD_STARTED' ||
    statusCode === 'INSTALL_IN_PROGRESS' ||
    typeof status.nextRetryTimestamp === 'number'
  );
}

function shouldPollOnChainCoreUpdateStatus(status: QortiumCoreOnChainUpdateStatus) {
  return !!status.updateAvailable && (isOnChainCoreUpdateAttemptActive(status) || isOnChainQdnResourceActive(status));
}

function getOnChainCoreUpdateStatusText(updateState: OnChainCoreUpdateState) {
  if (updateState.state === 'loading') {
    return 'Checking approved on-chain Core update.';
  }

  if (updateState.state === 'installing') {
    return 'Starting approved on-chain Core update.';
  }

  if (updateState.state === 'unavailable') {
    return updateState.message;
  }

  const { status } = updateState;

  if (status.updateAvailable) {
    if (status.installStarted) {
      return 'Approved Core update install has been scheduled.';
    }

    if (status.installing) {
      return 'Approved Core update install is in progress.';
    }

    if (isOnChainCoreUpdateAttemptActive(status)) {
      return 'Approved Core update data is downloading from QDN.';
    }

    if (status.autoUpdateMode === 'INSTALL') {
      return 'Approved Core update available; Core auto-update will install it.';
    }

    if (isOnChainQdnResourceActive(status)) {
      return 'Approved Core update data is downloading from QDN.';
    }

    if (status.downloadStarted) {
      return 'Approved Core update data download was requested.';
    }

    return 'Approved Core update available.';
  }

  return status.message || 'No approved on-chain Core update is available.';
}

function getOnChainCoreUpdateSummary(updateState: OnChainCoreUpdateState) {
  if (updateState.state !== 'available' || !updateState.status.updateAvailable) {
    return '';
  }

  if (updateState.status.installStarted) {
    return 'Approved Core update install has been scheduled.';
  }

  if (updateState.status.installing) {
    return 'Approved Core update install is in progress.';
  }

  if (isOnChainCoreUpdateAttemptActive(updateState.status)) {
    return 'Approved Core update data is downloading from QDN. Core will retry the install when the data is local.';
  }

  if (isOnChainQdnResourceActive(updateState.status)) {
    return 'Approved Core update data is downloading from QDN.';
  }

  if (updateState.status.downloadStarted) {
    return 'Approved Core update data download was requested.';
  }

  if (updateState.status.autoUpdateMode === 'INSTALL') {
    return 'Approved Core update available. Core auto-update is enabled and will install it automatically.';
  }

  return 'Approved Core update available.';
}

function useOnChainCoreUpdate(nodeSettings: QortiumNodeSettings) {
  const [status, setStatus] = useState<OnChainCoreUpdateState>({ state: 'loading' });

  const refreshStatus = useCallback(async (options: { quiet?: boolean } = {}) => {
    const unavailableMessage = getOnChainCoreUpdateUnavailableMessage(nodeSettings);

    if (unavailableMessage) {
      setStatus({
        message: unavailableMessage,
        state: 'unavailable',
      });
      return;
    }

    if (!options.quiet) {
      setStatus({ state: 'loading' });
    }

    try {
      setStatus({
        state: 'available',
        status: await window.qortiumHome.node.checkCoreUpdate(),
      });
    } catch (error) {
      setStatus({
        message: formatCoreAdminError(error),
        state: 'unavailable',
      });
    }
  }, [nodeSettings.apiKey, nodeSettings.mode, nodeSettings.nodeApiUrl]);

  const installUpdate = useCallback(async () => {
    const currentStatus = status.state === 'available' ? status.status : undefined;

    setStatus({
      state: 'installing',
      status: currentStatus,
    });

    try {
      setStatus({
        state: 'available',
        status: await window.qortiumHome.node.installCoreUpdate(),
      });
    } catch (error) {
      setStatus({
        message: formatCoreAdminError(error),
        state: 'unavailable',
      });
    }
  }, [status]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (status.state !== 'available' || !shouldPollOnChainCoreUpdateStatus(status.status)) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void refreshStatus({ quiet: true });
    }, ON_CHAIN_CORE_UPDATE_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshStatus, status]);

  return {
    installUpdate,
    isBusy: status.state === 'loading' || status.state === 'installing',
    refreshStatus,
    status,
  };
}

function useLocalNodeStatus({
  nodeSettings,
  onResolvedNodeApiUrl,
}: {
  nodeSettings: QortiumNodeSettings;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
}) {
  const [status, setStatus] = useState<LocalNodeStatus>({ state: 'idle' });
  const shouldCheckLocalNode = nodeSettings.mode === 'local';

  async function refreshLocalNodeStatus() {
    if (!shouldCheckLocalNode) {
      setStatus({ state: 'idle' });
      return;
    }

    setStatus({ state: 'loading' });

    try {
      const result = await window.qortiumHome.node.getStatus();

      if (result.ok) {
        onResolvedNodeApiUrl(result.nodeApiUrl);
        setStatus({
          nodeApiUrl: result.nodeApiUrl,
          state: 'available',
        });
        return;
      }

      setStatus({
        message: result.message,
        nodeApiUrl: result.nodeApiUrl,
        state: 'unavailable',
      });
    } catch (error) {
      setStatus({
        message: formatLocalNodeError(error),
        nodeApiUrl: nodeSettings.localUrl,
        state: 'unavailable',
      });
    }
  }

  useEffect(() => {
    let isDisposed = false;

    async function loadLocalNodeStatus() {
      if (!shouldCheckLocalNode) {
        if (!isDisposed) {
          setStatus({ state: 'idle' });
        }
        return;
      }

      setStatus({ state: 'loading' });

      try {
        const result = await window.qortiumHome.node.getStatus();

        if (isDisposed) {
          return;
        }

        if (result.ok) {
          onResolvedNodeApiUrl(result.nodeApiUrl);
          setStatus({
            nodeApiUrl: result.nodeApiUrl,
            state: 'available',
          });
          return;
        }

        setStatus({
          message: result.message,
          nodeApiUrl: result.nodeApiUrl,
          state: 'unavailable',
        });
      } catch (error) {
        if (!isDisposed) {
          setStatus({
            message: formatLocalNodeError(error),
            nodeApiUrl: nodeSettings.localUrl,
            state: 'unavailable',
          });
        }
      }
    }

    void loadLocalNodeStatus();

    return () => {
      isDisposed = true;
    };
  }, [nodeSettings.localUrl, nodeSettings.mode, nodeSettings.nodeApiUrl, onResolvedNodeApiUrl, shouldCheckLocalNode]);

  return {
    refreshLocalNodeStatus,
    shouldCheckLocalNode,
    status,
  };
}

function getLocalNodeStatusText(status: LocalNodeStatus, localUrl: string) {
  if (status.state === 'idle') {
    return 'Local node is not selected.';
  }

  if (status.state === 'loading') {
    return 'Checking local node.';
  }

  if (status.state === 'available') {
    return `Local node detected at ${status.nodeApiUrl}.`;
  }

  return `Local node not detected at ${status.nodeApiUrl || localUrl}.`;
}

function getCoreStatusText({
  localNodeStatus,
  onChainCoreUpdate,
  prereleaseUpdateAvailable,
  stableUpdateAvailable,
  status,
}: {
  localNodeStatus: LocalNodeStatus;
  onChainCoreUpdate: OnChainCoreUpdateState;
  prereleaseUpdateAvailable: boolean;
  stableUpdateAvailable: boolean;
  status: QortiumCoreStatus | null;
}) {
  const onChainUpdateSummary = getOnChainCoreUpdateSummary(onChainCoreUpdate);

  if (onChainUpdateSummary) {
    return onChainUpdateSummary;
  }

  if (!status) {
    return 'Checking managed Core.';
  }

  if (!status.supported) {
    return 'Managed Core is not available for this platform.';
  }

  if (!status.java.available) {
    return 'Java is missing or unsupported.';
  }

  if (!status.installed) {
    return 'Qortium Core is not installed.';
  }

  if (stableUpdateAvailable || prereleaseUpdateAvailable) {
    return 'Qortium Core update available.';
  }

  if (localNodeStatus.state === 'unavailable') {
    return status.runtime.running ? 'Core is running, but the local node was not detected.' : 'Core is installed but stopped.';
  }

  return status.runtime.running ? 'Core is running.' : 'Core is installed but stopped.';
}

function getCoreRows({
  localNodeStatus,
  nodeSettings,
  onChainCoreUpdate,
  releases,
  status,
}: {
  localNodeStatus: LocalNodeStatus;
  nodeSettings: QortiumNodeSettings;
  onChainCoreUpdate: OnChainCoreUpdateState;
  releases: QortiumCoreReleases | null;
  status: QortiumCoreStatus | null;
}) {
  const rows = [
    { label: 'Node mode', value: nodeSettings.mode === 'local' ? 'Local node' : 'Not local' },
    { label: 'Local node', value: getLocalNodeStatusText(localNodeStatus, nodeSettings.localUrl) },
    { label: 'Core', value: status?.installed?.tagName ?? 'Not installed' },
    { label: 'Java', value: formatJava(status?.java ?? null) },
    { label: 'Runtime', value: status?.runtime.running ? 'Running' : status ? 'Stopped' : 'Checking' },
    { label: 'On-chain update', value: getOnChainCoreUpdateStatusText(onChainCoreUpdate) },
  ];

  if (onChainCoreUpdate.state === 'available') {
    const onChainStatus = onChainCoreUpdate.status;
    const qdnResourceLabel = getOnChainQdnResourceLabel(onChainStatus);
    const qdnStatusLabel = getOnChainQdnStatusLabel(onChainStatus);

    rows.push({ label: 'Core auto-update', value: formatAutoUpdateMode(onChainStatus.autoUpdateMode) });

    if (onChainStatus.updateAvailable && onChainStatus.commitHash) {
      rows.push({ label: 'Approved commit', value: formatCommitHash(onChainStatus.commitHash) });
    }

    if (qdnResourceLabel) {
      rows.push({ label: 'Approved QDN', value: qdnResourceLabel });
    }

    if (qdnStatusLabel) {
      rows.push({ label: 'QDN status', value: qdnStatusLabel });
    }
  }

  if (releases?.stable.available) {
    rows.push({ label: 'Stable', value: releases.stable.tagName });
  }

  if (releases?.prerelease.available) {
    rows.push({ label: 'Prerelease', value: releases.prerelease.tagName });
  }

  if (localNodeStatus.state === 'unavailable') {
    rows.push({ label: 'Error', value: localNodeStatus.message });
  }

  return rows;
}

function ManagedCoreDashboardCard({
  nodeSettings,
  onResolvedNodeApiUrl,
  onSaveNodeSettings,
}: {
  nodeSettings: QortiumNodeSettings;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onSaveNodeSettings: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;
}) {
  const coreManager = useCoreManager({
    onResolvedNodeApiUrl,
    onSaveNodeSettings,
  });
  const localNode = useLocalNodeStatus({
    nodeSettings,
    onResolvedNodeApiUrl,
  });
  const onChainCoreUpdate = useOnChainCoreUpdate(nodeSettings);
  const localNodeUnavailable = localNode.status.state === 'unavailable';
  const onChainStatus =
    onChainCoreUpdate.status.state === 'available' ? onChainCoreUpdate.status.status : null;
  const onChainInstallAttemptActive = !!onChainStatus && isOnChainCoreUpdateAttemptActive(onChainStatus);
  const showOnChainInstallAction =
    !!onChainStatus?.updateAvailable &&
    onChainStatus.autoUpdateMode !== 'INSTALL' &&
    !onChainInstallAttemptActive;
  const showJavaAction = coreManager.canInstallJava;
  const showPrereleaseAction =
    coreManager.canInstallPrerelease &&
    (!coreManager.status?.installed || coreManager.prereleaseUpdateAvailable);
  const showStableAction =
    coreManager.canInstallStable &&
    (!coreManager.status?.installed || coreManager.stableUpdateAvailable);
  const showStartAction = coreManager.canStart && (localNodeUnavailable || !coreManager.status?.runtime.running);
  const rows = useMemo(
    () =>
      getCoreRows({
        localNodeStatus: localNode.status,
        nodeSettings,
        onChainCoreUpdate: onChainCoreUpdate.status,
        releases: coreManager.releases,
        status: coreManager.status,
      }),
    [coreManager.releases, coreManager.status, localNode.status, nodeSettings, onChainCoreUpdate.status],
  );
  const summary = getCoreStatusText({
    localNodeStatus: localNode.status,
    onChainCoreUpdate: onChainCoreUpdate.status,
    prereleaseUpdateAvailable: coreManager.prereleaseUpdateAvailable,
    stableUpdateAvailable: coreManager.stableUpdateAvailable,
    status: coreManager.status,
  });

  if (!coreManager.coreApi) {
    return null;
  }

  return (
    <section className="dashboard-card dashboard-card--core" aria-label="Local node and Core">
      <div className="dashboard-card__header">
        <h2 className="dashboard-card__title">Local Node</h2>
        <button
          className="icon-button dashboard-card__refresh"
          disabled={coreManager.isBusy || onChainCoreUpdate.isBusy}
          title="Refresh local node and Core status"
          type="button"
          onClick={() => {
            void localNode.refreshLocalNodeStatus();
            void coreManager.refreshStatus();
            void onChainCoreUpdate.refreshStatus();
          }}
        >
          <RefreshCw aria-hidden="true" size={18} strokeWidth={2} />
          <span className="sr-only">Refresh local node and Core status</span>
        </button>
      </div>

      <p className="dashboard-card__message">{summary}</p>

      <dl className="detail-list dashboard-card__details">
        {rows.map((row) => (
          <div className="detail-list__row" key={row.label}>
            <dt className="detail-list__label">{row.label}</dt>
            <dd className="detail-list__value">{row.value}</dd>
          </div>
        ))}
      </dl>

      {coreManager.progress && coreManager.progress.action !== 'idle' ? (
        <div className="core-manager__progress">
          <div className="core-manager__progress-bar" aria-hidden="true">
            <span style={{ width: `${coreManager.progressPercent ?? 100}%` }} />
          </div>
          <span className="core-manager__progress-text">
            {coreManager.progressPercent === null
              ? coreManager.progress.message
              : `${coreManager.progress.message} ${coreManager.progressPercent}%`}
          </span>
        </div>
      ) : null}

      <div className="dashboard-card__actions">
        {showOnChainInstallAction ? (
          <button
            className="button"
            disabled={coreManager.isBusy || onChainCoreUpdate.isBusy || onChainInstallAttemptActive}
            type="button"
            onClick={onChainCoreUpdate.installUpdate}
          >
            <Download aria-hidden="true" size={18} strokeWidth={2} />
            {onChainCoreUpdate.status.state === 'installing' || onChainStatus?.installing
              ? 'Installing approved update'
              : 'Install approved update'}
          </button>
        ) : null}
        {showJavaAction ? (
          <button
            className="button button--secondary"
            disabled={coreManager.isBusy}
            type="button"
            onClick={coreManager.installJava}
          >
            <Download aria-hidden="true" size={18} strokeWidth={2} />
            {coreManager.busyAction === 'installing-java' ? 'Installing Java' : 'Install Java'}
          </button>
        ) : null}
        {showPrereleaseAction ? (
          <button
            className="button button--secondary"
            disabled={coreManager.isBusy}
            type="button"
            onClick={() => coreManager.installCore('prerelease')}
          >
            <Download aria-hidden="true" size={18} strokeWidth={2} />
            {getCoreReleaseActionLabel({
              busyAction: coreManager.busyAction,
              channel: 'prerelease',
              installedCore: coreManager.status?.installed,
              release: coreManager.releases?.prerelease,
            })}
          </button>
        ) : null}
        {showStableAction ? (
          <button
            className="button button--secondary"
            disabled={coreManager.isBusy}
            type="button"
            onClick={() => coreManager.installCore('stable')}
          >
            <Download aria-hidden="true" size={18} strokeWidth={2} />
            {getCoreReleaseActionLabel({
              busyAction: coreManager.busyAction,
              channel: 'stable',
              installedCore: coreManager.status?.installed,
              release: coreManager.releases?.stable,
            })}
          </button>
        ) : null}
        {showStartAction ? (
          <button
            className="button"
            disabled={coreManager.isBusy}
            type="button"
            onClick={coreManager.startCore}
          >
            <Play aria-hidden="true" size={18} strokeWidth={2} />
            {coreManager.busyAction === 'starting' ? 'Starting' : 'Start'}
          </button>
        ) : null}
      </div>

      {coreManager.message ? (
        <p className={`dashboard-card__message dashboard-card__message--${coreManager.message.kind}`}>
          {coreManager.message.text}
        </p>
      ) : null}
    </section>
  );
}

function HomeUpdateDashboardCard() {
  const updates = useAppUpdates({ autoCheck: true });

  return (
    <section className="dashboard-card dashboard-card--updates" aria-label="Qortium Home updates">
      <div className="dashboard-card__header">
        <h2 className="dashboard-card__title">Home Updates</h2>
        <button
          className="icon-button dashboard-card__refresh"
          disabled={updates.isChecking || !updates.environment}
          title="Check for app updates"
          type="button"
          onClick={updates.checkForUpdates}
        >
          <RefreshCw aria-hidden="true" size={18} strokeWidth={2} />
          <span className="sr-only">Check for app updates</span>
        </button>
      </div>

      {updates.message ? (
        <p className={`dashboard-card__message dashboard-card__message--${updates.message.kind}`}>
          {updates.message.text}
        </p>
      ) : (
        <p className="dashboard-card__message">
          {updates.isChecking ? 'Checking Qortium Home releases.' : 'Preparing update check.'}
        </p>
      )}

      <dl className="detail-list dashboard-card__details">
        {updates.detailRows.map((row) => (
          <div className="detail-list__row" key={row.label}>
            <dt className="detail-list__label">{row.label}</dt>
            <dd className="detail-list__value">{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="dashboard-card__actions">
        <button
          className="button button--secondary"
          disabled={updates.isChecking || updates.isDownloading || !updates.environment}
          type="button"
          onClick={updates.checkForUpdates}
        >
          <RefreshCw aria-hidden="true" size={18} strokeWidth={2} />
          {updates.isChecking ? 'Checking' : 'Check now'}
        </button>
        {updates.updateAvailable && updates.result?.asset && updates.result.release ? (
          <button
            className="button button--secondary"
            disabled={updates.isChecking || updates.isDownloading}
            type="button"
            onClick={updates.downloadUpdate}
          >
            <Download aria-hidden="true" size={18} strokeWidth={2} />
            {updates.isDownloading ? 'Downloading' : 'Download update'}
          </button>
        ) : null}
        {updates.downloadedUpdate?.canOpen ? (
          <button
            className="button button--secondary"
            disabled={updates.isChecking || updates.isDownloading}
            type="button"
            onClick={updates.openDownloadedFile}
          >
            <ExternalLink aria-hidden="true" size={18} strokeWidth={2} />
            {getOpenDownloadedFileLabel(updates.updatePlatform)}
          </button>
        ) : null}
        {updates.downloadedUpdate?.canReveal ? (
          <button
            className="button button--secondary"
            disabled={updates.isChecking || updates.isDownloading}
            type="button"
            onClick={updates.showDownloadedFile}
          >
            <FolderOpen aria-hidden="true" size={18} strokeWidth={2} />
            Show file
          </button>
        ) : null}
        {updates.releasePageUrl ? (
          <button
            className="button"
            disabled={updates.isChecking || updates.isDownloading}
            type="button"
            onClick={updates.openReleasePage}
          >
            <ExternalLink aria-hidden="true" size={18} strokeWidth={2} />
            Open release
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function DashboardPage({
  accountsError,
  accountsState,
  isLoadingAccounts,
  nodeSettings,
  onAccountsStateChange,
  onResolvedNodeApiUrl,
  onSaveNodeSettings,
  onSelectedAccountChange,
  selectedAccountId,
}: DashboardPageProps) {
  const hasManagedCore = !!window.qortiumHome.core;

  return (
    <div className="dashboard-page">
      <header className="dashboard-page__header">
        <h1>Dashboard</h1>
      </header>

      <section className="dashboard-card dashboard-card--accounts" aria-label="Accounts">
        <AccountsPanel
          accountsError={accountsError}
          accountsState={accountsState}
          isLoadingAccounts={isLoadingAccounts}
          selectedAccountId={selectedAccountId}
          onAccountsStateChange={onAccountsStateChange}
          onSelectedAccountChange={onSelectedAccountChange}
        />
      </section>

      <div className={`dashboard-page__grid${hasManagedCore ? '' : ' dashboard-page__grid--single'}`}>
        {hasManagedCore ? (
          <ManagedCoreDashboardCard
            nodeSettings={nodeSettings}
            onResolvedNodeApiUrl={onResolvedNodeApiUrl}
            onSaveNodeSettings={onSaveNodeSettings}
          />
        ) : null}
        <HomeUpdateDashboardCard />
      </div>
    </div>
  );
}
