import { Download, Play, Square } from 'lucide-react';
import { useMemo } from 'react';
import { useCoreManager } from './coreManagerState';
import {
  getOnChainCoreUpdateSummary,
  isOnChainCoreUpdateAttemptActive,
  useOnChainCoreUpdate,
} from './onChainCoreUpdateState';
import {
  DetailList,
  getCoreReleaseBusyAction,
  getPreferredCoreReleaseTarget,
  type DetailRow,
} from './releaseDisplay';
import { SettingsSection } from './SettingsSection';
import { SETTINGS_TEXT } from './settingsText';

type CoreManagerPanelProps = {
  nodeSettings: QortiumNodeSettings;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onSaveNodeSettings: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;
};

function getCoreSettingsStatusText({
  coreManager,
  onChainCoreUpdate,
}: {
  coreManager: ReturnType<typeof useCoreManager>;
  onChainCoreUpdate: ReturnType<typeof useOnChainCoreUpdate>;
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

  return coreManager.status.runtime.running ? SETTINGS_TEXT.status.ready : SETTINGS_TEXT.status.stopped;
}

function getCoreSettingsRows({
  coreManager,
  onChainCoreUpdate,
}: {
  coreManager: ReturnType<typeof useCoreManager>;
  onChainCoreUpdate: ReturnType<typeof useOnChainCoreUpdate>;
}) {
  const statusText = getCoreSettingsStatusText({ coreManager, onChainCoreUpdate });
  const rows: DetailRow[] = [
    {
      label: SETTINGS_TEXT.labels.status,
      value: statusText,
    },
    ...coreManager.detailRows,
  ];

  if (onChainCoreUpdate.status.state === 'unavailable') {
    rows.push({
      label: SETTINGS_TEXT.labels.approvedUpdate,
      value: onChainCoreUpdate.status.message,
    });
  }

  return rows;
}

export function CoreManagerPanel({
  nodeSettings,
  onResolvedNodeApiUrl,
  onSaveNodeSettings,
}: CoreManagerPanelProps) {
  const coreManager = useCoreManager({
    onResolvedNodeApiUrl,
    onSaveNodeSettings,
  });
  const onChainCoreUpdate = useOnChainCoreUpdate(nodeSettings);
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
      isRefreshing={coreManager.isBusy || onChainCoreUpdate.isBusy}
      refreshLabel={SETTINGS_TEXT.actions.checkForUpdates}
      summary={summary}
      title={SETTINGS_TEXT.sections.qortiumCore}
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
