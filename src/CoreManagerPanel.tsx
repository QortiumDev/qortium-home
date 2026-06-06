import { Download, Play, Square } from 'lucide-react';
import { useMemo } from 'react';
import { formatJava, formatRuntime, type CoreManagerState } from './coreManagerState';
import {
  getOnChainCoreUpdateSummary,
  isOnChainCoreUpdateAttemptActive,
  type OnChainCoreUpdateController,
} from './onChainCoreUpdateState';
import {
  areReleaseTagsEqual,
  DetailList,
  getCoreReleaseBusyAction,
  getCoreVersionValue,
  getPreferredCoreReleaseTarget,
  LinkedValue,
  type DetailRow,
} from './releaseDisplay';
import { SettingsSection } from './SettingsSection';
import { SETTINGS_TEXT } from './settingsText';

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
    return 'Starting approved Core update.';
  }

  const onChainSummary = getOnChainCoreUpdateSummary(onChainCoreUpdate.status);

  if (onChainSummary) {
    return onChainSummary;
  }

  if (!coreManager.status) {
    return SETTINGS_TEXT.status.checking;
  }

  if (!coreManager.status.supported) {
    return SETTINGS_TEXT.status.unsupported;
  }

  if (!coreManager.status.installed && coreManager.status.runtime.running) {
    return SETTINGS_TEXT.status.localCoreDetected;
  }

  if (!coreManager.status.installed) {
    return SETTINGS_TEXT.status.notInstalled;
  }

  if (!coreManager.status.java.available && !coreManager.status.runtime.running) {
    return SETTINGS_TEXT.status.javaRequired;
  }

  if (coreManager.stableUpdateAvailable || coreManager.prereleaseUpdateAvailable) {
    return SETTINGS_TEXT.status.updateAvailable;
  }

  return coreManager.status.runtime.running ? SETTINGS_TEXT.status.upToDate : SETTINGS_TEXT.status.stopped;
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
      label: SETTINGS_TEXT.labels.status,
      value: statusText,
    },
    {
      label: SETTINGS_TEXT.labels.version,
      value: (
        <LinkedValue url={coreManager.status?.installed?.htmlUrl}>
          {getCoreVersionValue(coreManager.status)}
        </LinkedValue>
      ),
    },
    {
      label: SETTINGS_TEXT.labels.java,
      value: formatJava(coreManager.status?.java ?? null),
    },
    {
      label: SETTINGS_TEXT.labels.runtime,
      value: formatRuntime(coreManager.status?.runtime ?? null),
    },
    {
      label: SETTINGS_TEXT.labels.localApi,
      value: coreManager.status?.runtime.localApiUrl ?? 'http://127.0.0.1:24891',
    },
  ];

  if (latestRelease && !areReleaseTagsEqual(latestRelease.tagName, installedVersion)) {
    rows.push({
      label: SETTINGS_TEXT.labels.latest,
      value: (
        <LinkedValue url={latestRelease.htmlUrl}>
          {latestRelease.tagName}
        </LinkedValue>
      ),
    });
  }

  if (onChainCoreUpdate.status.state === 'unavailable') {
    rows.push({
      label: SETTINGS_TEXT.labels.approvedUpdate,
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
  const runtimeAction = !showJavaAction && coreManager.canStart
    ? {
        icon: <Play aria-hidden="true" size={18} strokeWidth={2} />,
        label: coreManager.busyAction === 'starting' ? SETTINGS_TEXT.actions.starting : SETTINGS_TEXT.actions.startCore,
        onClick: coreManager.startCore,
      }
    : !showJavaAction && coreManager.canStop
      ? {
          icon: <Square aria-hidden="true" size={18} strokeWidth={2} />,
          label: coreManager.busyAction === 'stopping' ? SETTINGS_TEXT.actions.stopping : SETTINGS_TEXT.actions.stopCore,
          onClick: coreManager.stopCore,
        }
      : null;
  const rows = useMemo(
    () =>
      getCoreSettingsRows({
        coreManager,
        onChainCoreUpdate,
      }),
    [coreManager, onChainCoreUpdate],
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
      refreshLabel={SETTINGS_TEXT.actions.checkForUpdates}
      summary={summary}
      title={SETTINGS_TEXT.sections.qortiumCore}
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
                : `${coreManager.progress.message} ${coreManager.progressPercent}%`}
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
                ? SETTINGS_TEXT.actions.installing
                : SETTINGS_TEXT.actions.installJava}
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
                ? SETTINGS_TEXT.actions.installing
                : SETTINGS_TEXT.actions.installApprovedUpdate}
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
              {coreManager.busyAction === releaseTargetBusyAction
                ? SETTINGS_TEXT.actions.installing
                : coreManager.status?.installed
                  ? SETTINGS_TEXT.actions.installUpdate
                  : SETTINGS_TEXT.actions.installCore}
            </button>
          ) : null}
          {runtimeAction ? (
            <button
              className="button button--secondary"
              disabled={coreManager.isBusy}
              type="button"
              onClick={runtimeAction.onClick}
            >
              {runtimeAction.icon}
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
