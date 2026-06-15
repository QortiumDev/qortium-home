import { Download, Play, Square } from 'lucide-react';
import { useMemo } from 'react';
import {
  formatJava,
  formatRuntime,
  getCoreRuntimeAction,
  getCoreRuntimeBlockedMessage,
  type CoreManagerState,
} from './coreManagerState';
import { getTranslationLanguage, t } from './i18n';
import {
  getOnChainCoreUpdateSummary,
  isOnChainCoreUpdateAttemptActive,
  type OnChainCoreUpdateController,
} from './onChainCoreUpdateState';
import {
  DetailList,
  getCoreLatestRows,
  getCoreReleaseBusyAction,
  getCoreVersionRowValue,
  getPreferredCoreReleaseTarget,
  type DetailRow,
} from './releaseDisplay';
import { SettingsSection } from './SettingsSection';

type CoreManagerPanelProps = {
  coreManager: CoreManagerState;
  isExpanded: boolean;
  onChainCoreUpdate: OnChainCoreUpdateController;
  onExpandedChange: (isExpanded: boolean) => void;
};

function getCoreSettingsStatusText({
  coreManager,
  onChainCoreUpdate,
}: {
  coreManager: CoreManagerState;
  onChainCoreUpdate: OnChainCoreUpdateController;
}) {
  if (coreManager.message?.kind === 'error') {
    return coreManager.message.text;
  }

  if (onChainCoreUpdate.status.state === 'installing') {
    return t('core.onChain.installStarting');
  }

  const onChainSummary = getOnChainCoreUpdateSummary(onChainCoreUpdate.status);

  if (onChainSummary) {
    return onChainSummary;
  }

  if (!coreManager.status) {
    return t('common.checking');
  }

  if (coreManager.status.runtime.blocked) {
    return t('core.statusRuntimeBlocked');
  }

  if (!coreManager.status.supported) {
    return t('common.unsupported');
  }

  if (!coreManager.status.installed && coreManager.status.runtime.running) {
    return coreManager.status.runtime.owner === 'home'
      ? t('core.statusRunningFilesMissing')
      : t('core.statusLocalCoreDetected');
  }

  if (!coreManager.status.installed) {
    return t('common.notInstalled');
  }

  if (!coreManager.status.java.available && !coreManager.status.runtime.running) {
    return t('core.statusJavaRequired');
  }

  if (coreManager.stableUpdateAvailable || coreManager.prereleaseUpdateAvailable) {
    return t('common.updateAvailable');
  }

  return coreManager.status.runtime.running ? t('common.upToDate') : t('common.stopped');
}

function getCoreSettingsRows({
  coreManager,
  onChainCoreUpdate,
}: {
  coreManager: CoreManagerState;
  onChainCoreUpdate: OnChainCoreUpdateController;
}) {
  const statusText = getCoreSettingsStatusText({ coreManager, onChainCoreUpdate });
  const releaseTarget = getPreferredCoreReleaseTarget({
    releases: coreManager.releases,
    status: coreManager.status,
  });
  const latestRelease = releaseTarget?.release ?? null;
  const installedVersion = coreManager.status?.installed?.tagName ?? '';
  const rows: DetailRow[] = [
    {
      label: t('common.status'),
      value: statusText,
    },
    {
      label: t('common.version'),
      value: getCoreVersionRowValue(coreManager.status),
    },
    {
      label: t('core.javaLabel'),
      value: formatJava(coreManager.status?.java ?? null),
    },
    {
      label: t('core.runtimeLabel'),
      value: formatRuntime(coreManager.status?.runtime ?? null),
    },
    {
      label: t('node.localApi'),
      value: coreManager.status?.runtime.localApiUrl ?? 'http://127.0.0.1:24891',
    },
  ];

  const installPath = coreManager.status?.installed?.installPath;

  if (installPath) {
    rows.push({ label: t('core.folderLabel'), path: installPath });
  }

  const runtimeBlockedMessage = getCoreRuntimeBlockedMessage(coreManager.status);

  if (runtimeBlockedMessage) {
    rows.push({
      label: t('core.runtimeIssue'),
      value: runtimeBlockedMessage,
    });
  }

  const onChainStatus =
    onChainCoreUpdate.status.state === 'available' ? onChainCoreUpdate.status.status : null;

  rows.push(
    ...getCoreLatestRows({
      installedTagName: installedVersion,
      onChain: onChainStatus,
      release: latestRelease,
    }),
  );

  if (onChainCoreUpdate.status.state === 'unavailable') {
    rows.push({
      label: t('core.approvedUpdateLabel'),
      value: onChainCoreUpdate.status.message,
    });
  }

  return rows;
}

export function CoreManagerPanel({
  coreManager,
  isExpanded,
  onChainCoreUpdate,
  onExpandedChange,
}: CoreManagerPanelProps) {
  const onChainStatus =
    onChainCoreUpdate.status.state === 'available' ? onChainCoreUpdate.status.status : null;
  const onChainInstallAttemptActive = !!onChainStatus && isOnChainCoreUpdateAttemptActive(onChainStatus);
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
  const releaseTargetBusyAction = getCoreReleaseBusyAction(releaseTarget?.channel);
  const showJavaAction = coreManager.canInstallJava;
  const showCoreInstallAction =
    !showJavaAction &&
    !!releaseTarget &&
    (!coreManager.status?.installed || releaseTargetUpdateAvailable);
  const showOnChainInstallAction =
    !showJavaAction &&
    !!onChainStatus?.updateAvailable &&
    onChainStatus.autoUpdateMode !== 'INSTALL' &&
    !onChainInstallAttemptActive;
  const runtimeAction = getCoreRuntimeAction(coreManager, showJavaAction);
  const language = getTranslationLanguage();
  const rows = useMemo(
    () =>
      getCoreSettingsRows({
        coreManager,
        onChainCoreUpdate,
      }),
    [coreManager, language, onChainCoreUpdate],
  );
  const summary = getCoreSettingsStatusText({ coreManager, onChainCoreUpdate });

  if (!coreManager.coreApi) {
    return null;
  }

  function handleRefresh() {
    void coreManager.refreshStatus();
    void onChainCoreUpdate.refreshStatus();
  }

  return (
    <SettingsSection
      isExpanded={isExpanded}
      isRefreshing={coreManager.isBusy || onChainCoreUpdate.isBusy}
      refreshLabel={t('updates.checkForUpdates')}
      summary={summary}
      title={t('core.sectionTitle')}
      onExpandedChange={onExpandedChange}
      onRefresh={handleRefresh}
    >
      <div className="core-manager">
        <DetailList className="core-manager__details" rows={rows} />

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

        <div className="core-manager__actions">
          {showJavaAction ? (
            <button
              className="button"
              disabled={coreManager.isBusy}
              type="button"
              onClick={coreManager.installJava}
            >
              <Download aria-hidden="true" size={18} strokeWidth={2} />
              {coreManager.busyAction === 'installing-java'
                ? t('common.installing')
                : t('core.installJava')}
            </button>
          ) : null}
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
          {showCoreInstallAction && releaseTarget ? (
            <button
              className="button"
              disabled={coreManager.isBusy}
              type="button"
              onClick={() => coreManager.installCore(releaseTarget.channel)}
            >
              <Download aria-hidden="true" size={18} strokeWidth={2} />
              {coreManager.busyAction === 'updating'
                ? t('common.updating')
                : coreManager.busyAction === releaseTargetBusyAction
                  ? t('common.installing')
                  : coreManager.status?.installed
                    ? t('updates.installUpdate')
                    : t('core.installCore')}
            </button>
          ) : null}
          {runtimeAction ? (
            <button
              className="button button--secondary"
              disabled={runtimeAction.disabled}
              title={runtimeAction.title}
              type="button"
              onClick={runtimeAction.onClick}
            >
              {runtimeAction.kind === 'start' ? (
                <Play aria-hidden="true" size={18} strokeWidth={2} />
              ) : (
                <Square aria-hidden="true" size={18} strokeWidth={2} />
              )}
              {runtimeAction.label}
            </button>
          ) : null}
        </div>

        {coreManager.message ? (
          <p className={`core-manager__message core-manager__message--${coreManager.message.kind}`}>
            {coreManager.message.text}
          </p>
        ) : null}
      </div>
    </SettingsSection>
  );
}
