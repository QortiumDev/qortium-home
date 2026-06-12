import { Braces, Download, FolderOpen, Globe2, Settings as SettingsIcon } from 'lucide-react';
import { useMemo } from 'react';
import { AccountsPanel } from './AccountsPanel';
import {
  getOpenDownloadedFileLabel,
  type AppUpdatesState,
} from './appUpdateState';
import { AppUpdateProgress } from './AppUpdateProgress';
import { getCoreRuntimeBlockedMessage, type CoreManagerState } from './coreManagerState';
import { getTranslationLanguage, t } from './i18n';
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

type DashboardPageProps = {
  accountsError: string;
  accountsState: QortiumAccountsState;
  appUpdates: AppUpdatesState;
  coreManager: CoreManagerState;
  isLoadingAccounts: boolean;
  nodeApiUrl: string;
  onChainCoreUpdate: OnChainCoreUpdateController;
  onBrowseQdn: () => void;
  onOpenCoreApiDocs: () => void;
  onOpenSettings: () => void;
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
    return t('core.onChain.installStarting');
  }

  const onChainUpdateSummary = getOnChainCoreUpdateSummary(onChainCoreUpdate);

  if (onChainUpdateSummary) {
    return onChainUpdateSummary;
  }

  if (!status) {
    return t('common.checking');
  }

  if (status.runtime.blocked) {
    return t('core.statusRuntimeBlocked');
  }

  if (!status.supported) {
    return t('common.unsupported');
  }

  if (!status.installed && status.runtime.running) {
    return t('core.statusLocalCoreDetected');
  }

  if (!status.installed) {
    return t('common.notInstalled');
  }

  if (!status.java.available && !status.runtime.running) {
    return t('core.statusJavaRequired');
  }

  if (stableUpdateAvailable || prereleaseUpdateAvailable) {
    return t('common.updateAvailable');
  }

  return t('common.upToDate');
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
      label: t('common.status'),
      value: getCoreDashboardStatusText({
        coreMessage,
        onChainCoreUpdate,
        prereleaseUpdateAvailable,
        stableUpdateAvailable,
        status,
      }),
    },
    {
      label: t('common.version'),
      value: (
        <LinkedValue className="dashboard-card__version-link" url={status?.installed?.htmlUrl}>
          {getCoreVersionValue(status)}
        </LinkedValue>
      ),
    },
  ];

  const runtimeBlockedMessage = getCoreRuntimeBlockedMessage(status);

  if (runtimeBlockedMessage) {
    rows.push({
      label: t('core.runtimeIssue'),
      value: runtimeBlockedMessage,
    });
  }

  if (latestRelease && !areReleaseTagsEqual(latestRelease.tagName, installedVersion)) {
    rows.push({
      label: t('common.latest'),
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
  const language = getTranslationLanguage();
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
      language,
      onChainCoreUpdate.status,
    ],
  );
  const hasAction = showOnChainInstallAction || showReleaseUpdateAction;

  if (!coreManager.coreApi) {
    return null;
  }

  return (
    <section className="dashboard-card dashboard-card--core" aria-label={t('core.sectionTitle')}>
      <div className="dashboard-card__header">
        <h2 className="dashboard-card__title">{t('core.sectionTitle')}</h2>
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
              : t('common.progressWithPercent', {
                  message: coreManager.progress.message,
                  percent: coreManager.progressPercent,
                })}
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
                ? t('common.installing')
                : t('core.installApprovedUpdate')}
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
                ? t('common.installing')
                : t('updates.installUpdate')}
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
      label: t('common.status'),
      value: getHomeUpdateStatusText(updates),
    },
    {
      label: t('common.version'),
      value: (
        <LinkedValue className="dashboard-card__version-link" url={getHomeReleaseUrl(updates.environment?.currentVersion)}>
          {currentReleaseTag || t('common.checking')}
        </LinkedValue>
      ),
    },
  ];

  if (updates.result?.release && !areReleaseTagsEqual(updates.result.release.tagName, currentReleaseTag)) {
    rows.push({
      label: t('common.latest'),
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
    <section className="dashboard-card dashboard-card--updates" aria-label={t('common.appName')}>
      <div className="dashboard-card__header">
        <h2 className="dashboard-card__title">{t('common.appName')}</h2>
      </div>

      <DetailList className="dashboard-card__details" rows={rows} />

      <AppUpdateProgress progress={updates.downloadProgress} />

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
              {updates.isDownloading ? t('common.downloading') : t('updates.downloadUpdate')}
            </button>
          ) : null}
          {showDownloadedAction ? (
            <button
              className="button"
              disabled={updates.isChecking || updates.isDownloading}
              type="button"
              onClick={updates.openDownloadedUpdate}
            >
              <FolderOpen aria-hidden="true" size={18} strokeWidth={2} />
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
  nodeApiUrl,
  onChainCoreUpdate,
  onBrowseQdn,
  onOpenCoreApiDocs,
  onOpenSettings,
  onAccountsStateChange,
  onSelectedAccountChange,
  selectedAccountId,
}: DashboardPageProps) {
  const hasManagedCore = !!window.qortiumHome.core;

  return (
    <div className="dashboard-page">
      <header className="dashboard-page__header">
        <h1>{t('common.dashboard')}</h1>
      </header>

      <div className="dashboard-page__primary-action">
        <button className="button button--primary" type="button" onClick={onBrowseQdn}>
          <Globe2 aria-hidden="true" size={18} strokeWidth={2} />
          {t('explorer.browseQdn')}
        </button>
        <button className="button" type="button" onClick={onOpenCoreApiDocs}>
          <Braces aria-hidden="true" size={18} strokeWidth={2} />
          {t('explorer.coreApi')}
        </button>
        <button className="button" type="button" onClick={onOpenSettings}>
          <SettingsIcon aria-hidden="true" size={18} strokeWidth={2} />
          {t('common.settings')}
        </button>
      </div>

      <section className="dashboard-card dashboard-card--accounts" aria-label={t('account.title')}>
        <div className="dashboard-card__header">
          <h2 className="dashboard-card__title">{t('account.title')}</h2>
        </div>
        <AccountsPanel
          accountsError={accountsError}
          accountsState={accountsState}
          isLoadingAccounts={isLoadingAccounts}
          nodeApiUrl={nodeApiUrl}
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
