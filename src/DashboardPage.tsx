import { Download, ExternalLink } from 'lucide-react';
import { useMemo } from 'react';
import { AccountsPanel } from './AccountsPanel';
import {
  getOpenDownloadedFileLabel,
  type AppUpdatesState,
} from './appUpdateState';
import type { CoreManagerState } from './coreManagerState';
import {
  getOnChainCoreUpdateSummary,
  isOnChainCoreUpdateAttemptActive,
  type OnChainCoreUpdateController,
  type OnChainCoreUpdateState,
} from './onChainCoreUpdateState';
import {
  areReleaseTagsEqual,
  DetailList,
  formatReleaseTag,
  getCoreReleaseBusyAction,
  getCoreVersionValue,
  getHomeReleaseUrl,
  getHomeUpdateStatusText,
  getPreferredCoreReleaseTarget,
  LinkedValue,
  type DetailRow,
} from './releaseDisplay';
import { SETTINGS_TEXT } from './settingsText';

type DashboardPageProps = {
  accountsError: string;
  accountsState: QortiumAccountsState;
  appUpdates: AppUpdatesState;
  coreManager: CoreManagerState;
  isLoadingAccounts: boolean;
  onChainCoreUpdate: OnChainCoreUpdateController;
  selectedAccountId: string | null;
  onAccountsStateChange: (accountsState: QortiumAccountsState) => void;
  onSelectedAccountChange: (accountId: string | null) => void;
};

function getCoreDashboardStatusText({
  coreMessage,
  onChainCoreUpdate,
  prereleaseUpdateAvailable,
  stableUpdateAvailable,
  status,
}: {
  coreMessage: CoreManagerState['message'];
  onChainCoreUpdate: OnChainCoreUpdateState;
  prereleaseUpdateAvailable: boolean;
  stableUpdateAvailable: boolean;
  status: QortiumCoreStatus | null;
}) {
  if (coreMessage?.kind === 'error') {
    return coreMessage.text;
  }

  if (onChainCoreUpdate.state === 'installing') {
    return 'Starting approved Core update.';
  }

  const onChainUpdateSummary = getOnChainCoreUpdateSummary(onChainCoreUpdate);

  if (onChainUpdateSummary) {
    return onChainUpdateSummary;
  }

  if (!status) {
    return SETTINGS_TEXT.status.checking;
  }

  if (!status.supported) {
    return SETTINGS_TEXT.status.unsupported;
  }

  if (!status.installed && status.runtime.running) {
    return SETTINGS_TEXT.status.localCoreDetected;
  }

  if (!status.installed) {
    return SETTINGS_TEXT.status.notInstalled;
  }

  if (!status.java.available && !status.runtime.running) {
    return SETTINGS_TEXT.status.javaRequired;
  }

  if (stableUpdateAvailable || prereleaseUpdateAvailable) {
    return SETTINGS_TEXT.status.updateAvailable;
  }

  return SETTINGS_TEXT.status.upToDate;
}

function getCoreRows({
  coreMessage,
  onChainCoreUpdate,
  prereleaseUpdateAvailable,
  releases,
  stableUpdateAvailable,
  status,
}: {
  coreMessage: CoreManagerState['message'];
  onChainCoreUpdate: OnChainCoreUpdateState;
  prereleaseUpdateAvailable: boolean;
  releases: QortiumCoreReleases | null;
  stableUpdateAvailable: boolean;
  status: QortiumCoreStatus | null;
}): DetailRow[] {
  const releaseTarget = getPreferredCoreReleaseTarget({
    releases,
    status,
  });
  const latestRelease = releaseTarget?.release ?? null;
  const installedVersion = status?.installed?.tagName ?? '';
  const rows: DetailRow[] = [
    {
      label: SETTINGS_TEXT.labels.status,
      value: getCoreDashboardStatusText({
        coreMessage,
        onChainCoreUpdate,
        prereleaseUpdateAvailable,
        stableUpdateAvailable,
        status,
      }),
    },
    {
      label: SETTINGS_TEXT.labels.version,
      value: (
        <LinkedValue className="dashboard-card__version-link" url={status?.installed?.htmlUrl}>
          {getCoreVersionValue(status)}
        </LinkedValue>
      ),
    },
  ];

  if (latestRelease && !areReleaseTagsEqual(latestRelease.tagName, installedVersion)) {
    rows.push({
      label: SETTINGS_TEXT.labels.latest,
      value: (
        <LinkedValue className="dashboard-card__version-link" url={latestRelease.htmlUrl}>
          {latestRelease.tagName}
        </LinkedValue>
      ),
    });
  }

  return rows;
}

function ManagedCoreDashboardCard({
  coreManager,
  onChainCoreUpdate,
}: {
  coreManager: CoreManagerState;
  onChainCoreUpdate: OnChainCoreUpdateController;
}) {
  const onChainStatus =
    onChainCoreUpdate.status.state === 'available' ? onChainCoreUpdate.status.status : null;
  const onChainInstallAttemptActive = !!onChainStatus && isOnChainCoreUpdateAttemptActive(onChainStatus);
  const showOnChainInstallAction =
    !!onChainStatus?.updateAvailable &&
    onChainStatus.autoUpdateMode !== 'INSTALL' &&
    !onChainInstallAttemptActive;
  const releaseTarget = getPreferredCoreReleaseTarget({
    releases: coreManager.releases,
    status: coreManager.status,
  });
  const releaseTargetUpdateAvailable =
    releaseTarget?.channel === 'stable'
      ? coreManager.stableUpdateAvailable
      : releaseTarget?.channel === 'prerelease'
        ? coreManager.prereleaseUpdateAvailable
        : false;
  const showReleaseUpdateAction =
    !showOnChainInstallAction &&
    !!coreManager.status?.installed &&
    !!releaseTarget &&
    releaseTargetUpdateAvailable;
  const releaseTargetBusyAction = getCoreReleaseBusyAction(releaseTarget?.channel);
  const rows = useMemo(
    () =>
      getCoreRows({
        coreMessage: coreManager.message,
        onChainCoreUpdate: onChainCoreUpdate.status,
        prereleaseUpdateAvailable: coreManager.prereleaseUpdateAvailable,
        releases: coreManager.releases,
        stableUpdateAvailable: coreManager.stableUpdateAvailable,
        status: coreManager.status,
      }),
    [
      coreManager.message,
      coreManager.prereleaseUpdateAvailable,
      coreManager.releases,
      coreManager.stableUpdateAvailable,
      coreManager.status,
      onChainCoreUpdate.status,
    ],
  );
  const hasAction = showOnChainInstallAction || showReleaseUpdateAction;

  if (!coreManager.coreApi) {
    return null;
  }

  return (
    <section className="dashboard-card dashboard-card--core" aria-label={SETTINGS_TEXT.sections.qortiumCore}>
      <div className="dashboard-card__header">
        <h2 className="dashboard-card__title">{SETTINGS_TEXT.sections.qortiumCore}</h2>
      </div>

      <DetailList className="dashboard-card__details" rows={rows} />

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

      {hasAction ? (
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
                ? SETTINGS_TEXT.actions.installing
                : SETTINGS_TEXT.actions.installApprovedUpdate}
            </button>
          ) : null}
          {showReleaseUpdateAction && releaseTarget ? (
            <button
              className="button"
              disabled={coreManager.isBusy}
              type="button"
              onClick={() => coreManager.installCore(releaseTarget.channel)}
            >
              <Download aria-hidden="true" size={18} strokeWidth={2} />
              {coreManager.busyAction === releaseTargetBusyAction
                ? SETTINGS_TEXT.actions.installing
                : SETTINGS_TEXT.actions.installUpdate}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function getHomeUpdateRows(updates: AppUpdatesState) {
  const currentReleaseTag = formatReleaseTag(updates.environment?.currentVersion);
  const rows: DetailRow[] = [
    {
      label: SETTINGS_TEXT.labels.status,
      value: getHomeUpdateStatusText(updates),
    },
    {
      label: SETTINGS_TEXT.labels.version,
      value: (
        <LinkedValue className="dashboard-card__version-link" url={getHomeReleaseUrl(updates.environment?.currentVersion)}>
          {currentReleaseTag || SETTINGS_TEXT.status.checking}
        </LinkedValue>
      ),
    },
  ];

  if (updates.result?.release && !areReleaseTagsEqual(updates.result.release.tagName, currentReleaseTag)) {
    rows.push({
      label: SETTINGS_TEXT.labels.latest,
      value: (
        <LinkedValue className="dashboard-card__version-link" url={updates.result.release.htmlUrl}>
          {updates.result.release.tagName}
        </LinkedValue>
      ),
    });
  }

  return rows;
}

function HomeUpdateDashboardCard({ updates }: { updates: AppUpdatesState }) {
  const rows = getHomeUpdateRows(updates);
  const showDownloadedAction = !!updates.downloadedUpdate?.canOpen;
  const showDownloadAction =
    !showDownloadedAction && updates.updateAvailable && !!updates.result?.asset && !!updates.result.release;
  const hasAction = showDownloadAction || showDownloadedAction;

  return (
    <section className="dashboard-card dashboard-card--updates" aria-label={SETTINGS_TEXT.sections.qortiumHome}>
      <div className="dashboard-card__header">
        <h2 className="dashboard-card__title">{SETTINGS_TEXT.sections.qortiumHome}</h2>
      </div>

      <DetailList className="dashboard-card__details" rows={rows} />

      {hasAction ? (
        <div className="dashboard-card__actions">
          {showDownloadAction ? (
            <button
              className="button"
              disabled={updates.isChecking || updates.isDownloading}
              type="button"
              onClick={updates.downloadUpdate}
            >
              <Download aria-hidden="true" size={18} strokeWidth={2} />
              {updates.isDownloading ? SETTINGS_TEXT.actions.downloading : SETTINGS_TEXT.actions.downloadUpdate}
            </button>
          ) : null}
          {showDownloadedAction ? (
            <button
              className="button"
              disabled={updates.isChecking || updates.isDownloading}
              type="button"
              onClick={updates.openDownloadedFile}
            >
              <ExternalLink aria-hidden="true" size={18} strokeWidth={2} />
              {getOpenDownloadedFileLabel(updates.updatePlatform)}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function DashboardPage({
  accountsError,
  accountsState,
  appUpdates,
  coreManager,
  isLoadingAccounts,
  onChainCoreUpdate,
  onAccountsStateChange,
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
            coreManager={coreManager}
            onChainCoreUpdate={onChainCoreUpdate}
          />
        ) : null}
        <HomeUpdateDashboardCard updates={appUpdates} />
      </div>
    </div>
  );
}
