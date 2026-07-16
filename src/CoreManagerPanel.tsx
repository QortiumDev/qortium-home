import { Download, Play, Square } from 'lucide-react';
import { useMemo } from 'react';
import {
  formatJava,
  formatRuntime,
  getCoreReleaseComparison,
  getCoreRuntimeAction,
  getCoreRuntimeBlockedMessage,
  type CoreManagerState,
} from './coreManagerState';
import { getTranslationLanguage, t } from './i18n';
import { translateMainProcessMessage } from './mainProcessMessage';
import { useI2pConnections } from './i2pState';
import { useI2pdManager } from './i2pdManagerState';
import { NodeConnectionSettings } from './NodeConnection';
import {
  getOnChainCoreUpdateSummary,
  isOnChainCoreUpdateAttemptActive,
  type OnChainCoreUpdateController,
} from './onChainCoreUpdateState';
import {
  DetailList,
  getCoreLatestRows,
  getCoreReleaseBusyAction,
  getCoreVersionReleaseNotesValue,
  getPreferredCoreReleaseTarget,
  type DetailRow,
} from './releaseDisplay';
import { SettingsSection } from './SettingsSection';
import { TransportModeSelect } from './TransportControls';

type CoreManagerPanelProps = {
  connectionRefreshEpoch: number;
  coreManager: CoreManagerState;
  isExpanded: boolean;
  nodeSettings: QortiumNodeSettings;
  onChainCoreUpdate: OnChainCoreUpdateController;
  onExpandedChange: (isExpanded: boolean) => void;
  onOpenReleaseNotes: (product: 'core' | 'home', tagName: string) => void;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onSaveNodeSettings: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;
  showNodeConnection?: boolean;
  showTransportControls?: boolean;
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

  if (coreManager.busyAction === 'checking') {
    return t('common.checking');
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

  if (coreManager.status.coreUpdate.helpersOutOfSync) {
    return t('core.helpersOutOfSyncStatus');
  }

  if (coreManager.status.coreUpdate.javaUpdatePendingRestart) {
    return t('core.javaUpdatePendingRestart');
  }

  if (coreManager.stableUpdateAvailable || coreManager.prereleaseUpdateAvailable) {
    return t('common.updateAvailable');
  }

  if (
    coreManager.status.coreUpdate.available ||
    (coreManager.status.java.updatePolicy === 'notify' &&
      coreManager.status.java.updateAvailableVersion)
  ) {
    return t('common.updateAvailable');
  }

  return coreManager.status.runtime.running ? t('common.upToDate') : t('common.stopped');
}

function getCoreSettingsRows({
  coreManager,
  onOpenReleaseNotes,
  onChainCoreUpdate,
}: {
  coreManager: CoreManagerState;
  onOpenReleaseNotes: (product: 'core' | 'home', tagName: string) => void;
  onChainCoreUpdate: OnChainCoreUpdateController;
}) {
  const statusText = getCoreSettingsStatusText({ coreManager, onChainCoreUpdate });
  const releaseTarget = getPreferredCoreReleaseTarget({
    releases: coreManager.releases,
    status: coreManager.status,
  });
  const latestRelease = releaseTarget?.release ?? null;
  const installedVersion = coreManager.status?.installed?.jarSemver ?? coreManager.status?.installed?.tagName ?? '';
  const rows: DetailRow[] = [
    {
      label: t('common.status'),
      value: statusText,
    },
  ];

  const runtime = coreManager.status?.runtime;
  const installPath = coreManager.status?.installed?.installPath;
  // The folder where the *running* core lives (directory of its jar, falling
  // back to its runtime dir). Only known when Home can introspect the process,
  // so it may be undefined for an unmanaged core (e.g. on macOS).
  const runningJarPath = runtime?.running ? runtime.jarPath : undefined;
  const runningRuntimePath = runtime?.running ? runtime.runtimePath : undefined;
  const runningFolder = runningJarPath
    ? runningJarPath.replace(/[/\\][^/\\]*$/, '')
    : (runningRuntimePath ?? undefined);
  const isManagedRunning = runtime?.running && runtime.owner === 'home';
  const externalRunning = !!runtime?.running && runtime.owner !== 'home';

  if (isManagedRunning && installPath) {
    // The running core IS the managed install — keep the single folder row.
    rows.push({ label: t('core.folderLabel'), path: installPath });
  } else {
    // Default the location to the running core when its path is known.
    if (runningFolder) {
      rows.push({ label: t('core.runningFolderLabel'), path: runningFolder });
    } else if (externalRunning) {
      // Running core path is unknown and it was not started by Home.
      rows.push({ label: t('core.runningFolderLabel'), value: t('core.externalRunningNote') });
    }

    // Show the managed install as its own clearly-distinct row whenever it
    // exists and differs from the running folder (or the running folder is
    // unknown), so both managed install and running core are visible.
    if (installPath && installPath !== runningFolder) {
      rows.push({ label: t('core.managedInstallLabel'), path: installPath });

      if (externalRunning) {
        rows.push({ label: '', value: t('core.managedDifferentRunningNote') });
      }
    }
  }

  rows.push(
    {
      label: t('common.version'),
      value: getCoreVersionReleaseNotesValue(coreManager.status, undefined, onOpenReleaseNotes),
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
  );

  const runtimeBlockedMessage = getCoreRuntimeBlockedMessage(coreManager.status);

  if (runtimeBlockedMessage) {
    rows.push({
      label: t('core.runtimeIssue'),
      value: runtimeBlockedMessage,
    });
  }

  const onChainStatus =
    onChainCoreUpdate.status.state === 'available' ? onChainCoreUpdate.status.status : null;
  const policyUpdate = coreManager.status?.coreUpdate.available;
  const helpersOutOfSync = coreManager.status?.coreUpdate.helpersOutOfSync;

  if (helpersOutOfSync) {
    rows.push({
      label: t('core.helpersLabel'),
      value: helpersOutOfSync.targetTag
        ? t('core.helpersOutOfSync', { version: helpersOutOfSync.version })
        : t('core.helpersNoMatchingRelease', { version: helpersOutOfSync.version }),
    });
  }

  if (policyUpdate) {
    const channel =
      policyUpdate.channel === 'github'
        ? t('core.updateChannel.github')
        : t('core.updateChannel.onChain');
    const update = t('core.policyUpdateAvailable', {
      channel,
      version: policyUpdate.version,
    });

    rows.push({
      label: t('core.updateAvailableLabel'),
      value:
        policyUpdate.action === 'handled-by-core'
          ? t('core.policyUpdateHandledByCore', { update })
          : policyUpdate.action === 'installing'
            ? t('core.policyUpdateInstalling', { update })
            : update,
    });
  }

  const javaUpdateVersion = coreManager.status?.java.updateAvailableVersion;

  if (coreManager.status?.java.updatePolicy !== 'install' && javaUpdateVersion) {
    rows.push({
      label: t('core.javaUpdateAvailableLabel'),
      value: t('core.javaUpdateAvailable', { version: javaUpdateVersion }),
    });
  }

  if (coreManager.status?.coreUpdate.javaUpdatePendingRestart) {
    rows.push({
      label: t('core.javaUpdateAvailableLabel'),
      value: t('core.javaUpdatePendingRestart'),
    });
  }

  const nodeAutoUpdateMode =
    onChainStatus?.autoUpdateMode ?? coreManager.status?.coreUpdate.nodeAutoUpdateMode;

  if (nodeAutoUpdateMode && nodeAutoUpdateMode !== 'OFF') {
    rows.push({
      label: t('core.nodeAutoUpdateLabel'),
      value:
        nodeAutoUpdateMode === 'INSTALL'
          ? t('core.nodeAutoUpdateHandledByCore', { mode: nodeAutoUpdateMode })
          : t('core.nodeAutoUpdateMode', { mode: nodeAutoUpdateMode }),
    });
  }

  if (coreManager.status?.coreUpdate.error) {
    rows.push({
      label: t('core.updateCheckIssueLabel'),
      value: t('core.updateCheckIssue', {
        message: translateMainProcessMessage(coreManager.status.coreUpdate.error),
      }),
    });
  }

  rows.push(
    ...getCoreLatestRows({
      installedTagName: installedVersion,
      onOpenReleaseNotes,
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
  connectionRefreshEpoch,
  coreManager,
  isExpanded,
  nodeSettings,
  onChainCoreUpdate,
  onExpandedChange,
  onOpenReleaseNotes,
  onResolvedNodeApiUrl,
  onSaveNodeSettings,
  showNodeConnection = true,
  showTransportControls = true,
}: CoreManagerPanelProps) {
  // Transport (IP/I2P) controls — the node's own connection mode. Only managed for
  // a local/custom node (not public network mode).
  const canManageTransports = nodeSettings.mode !== 'network';
  const isManagedNode = nodeSettings.mode === 'local';
  const connections = useI2pConnections(nodeSettings.nodeApiUrl, connectionRefreshEpoch);
  const i2pdManager = useI2pdManager(isManagedNode);

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
  const releaseTargetComparison = releaseTarget
    ? getCoreReleaseComparison(releaseTarget.release, coreManager.status?.installed)
    : null;
  const releaseTargetBusyAction = getCoreReleaseBusyAction(releaseTarget?.channel);
  const showJavaAction = coreManager.canInstallJava;
  const showJavaUpdateAction = coreManager.canUpdateJava;
  const showJavaUpgradeAction = coreManager.canUpgradeJava;
  const showJavaAutoUpdateSetting = coreManager.status?.java.source === 'managed';
  const showCoreInstallAction =
    !showJavaAction &&
    !!releaseTarget &&
    (!coreManager.status?.installed ||
      releaseTargetUpdateAvailable ||
      (coreManager.status.installed.modifiedSinceInstall === true &&
        releaseTargetComparison !== null &&
        releaseTargetComparison < 0));
  const helpersOutOfSync = coreManager.status?.coreUpdate.helpersOutOfSync;
  const showRefreshHelpersAction =
    !!helpersOutOfSync?.targetTag &&
    coreManager.status?.updateSettings.coreUpdatePolicy !== 'install';
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
        onOpenReleaseNotes,
        onChainCoreUpdate,
      }),
    [coreManager, language, onChainCoreUpdate, onOpenReleaseNotes],
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
        {showNodeConnection ? (
          <NodeConnectionSettings
            nodeSettings={nodeSettings}
            onResolvedNodeApiUrl={onResolvedNodeApiUrl}
            onSaveNodeSettings={onSaveNodeSettings}
          />
        ) : null}

        {showTransportControls && canManageTransports ? (
          <TransportModeSelect
            connections={connections}
            isManagedNode={isManagedNode}
            label={t('connections.modeLabel')}
            manager={i2pdManager}
            showWarning
          />
        ) : null}

        <DetailList className="core-manager__details" rows={rows} />

        {coreManager.progress && coreManager.progress.action !== 'idle' ? (
          <div className="core-manager__progress">
            <div className="core-manager__progress-bar" aria-hidden="true">
              <span style={{ width: `${coreManager.progressPercent ?? 100}%` }} />
            </div>
            <span className="core-manager__progress-text">
              {coreManager.progressPercent === null
                ? translateMainProcessMessage(coreManager.progress.message)
                : t('common.progressWithPercent', {
                    message: translateMainProcessMessage(coreManager.progress.message),
                    percent: coreManager.progressPercent,
                  })}
            </span>
          </div>
        ) : null}

        <div className="core-manager__actions">
          {showJavaAction || showJavaUpdateAction ? (
            <button
              className="button"
              disabled={coreManager.isBusy}
              type="button"
              onClick={coreManager.installJava}
            >
              <Download aria-hidden="true" size={18} strokeWidth={2} />
              {coreManager.busyAction === 'installing-java'
                ? t('common.installing')
                : showJavaAction
                  ? t('core.installJava')
                  : t('core.updateJava')}
            </button>
          ) : null}
          {showJavaUpgradeAction ? (
            <button
              className="button"
              disabled={coreManager.isBusy}
              type="button"
              onClick={coreManager.installJava}
            >
              <Download aria-hidden="true" size={18} strokeWidth={2} />
              {coreManager.busyAction === 'installing-java'
                ? t('common.installing')
                : t('core.installManagedJava', {
                    version: coreManager.status?.java.managedJavaTarget ?? '',
                  })}
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
          {showRefreshHelpersAction ? (
            <button
              className="button"
              disabled={coreManager.isBusy}
              type="button"
              onClick={coreManager.refreshHelpers}
            >
              <Download aria-hidden="true" size={18} strokeWidth={2} />
              {coreManager.busyAction === 'refreshing-helpers'
                ? t('core.helpersRefreshing')
                : t('core.helpersRefreshAction', {
                    version: helpersOutOfSync.targetTag ?? helpersOutOfSync.version,
                  })}
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

        {helpersOutOfSync?.targetTag ? (
          <p className="field__hint">{t('core.helpersRestartNote')}</p>
        ) : null}

        <label className="field">
          <span className="field__label">{t('core.coreUpdatePolicyLabel')}</span>
          <select
            className="field__input"
            disabled={coreManager.isBusy}
            value={coreManager.status?.updateSettings.coreUpdatePolicy ?? 'notify'}
            onChange={(event) => {
              void coreManager.setUpdatePolicy(
                'coreUpdatePolicy',
                event.target.value as QortiumCoreUpdatePolicy,
              );
            }}
          >
            <option value="off">{t('core.updatePolicy.off')}</option>
            <option value="notify">{t('core.updatePolicy.notify')}</option>
            <option value="install">{t('core.updatePolicy.install')}</option>
          </select>
        </label>

        {showJavaAutoUpdateSetting ? (
          <label className="field">
            <span className="field__label">{t('core.javaUpdatePolicyLabel')}</span>
            <select
              className="field__input"
              disabled={coreManager.isBusy}
              value={coreManager.status?.updateSettings.javaUpdatePolicy ?? 'notify'}
              onChange={(event) => {
                void coreManager.setUpdatePolicy(
                  'javaUpdatePolicy',
                  event.target.value as QortiumCoreUpdatePolicy,
                );
              }}
            >
              <option value="off">{t('core.updatePolicy.off')}</option>
              <option value="notify">{t('core.updatePolicy.notify')}</option>
              <option value="install">{t('core.updatePolicy.install')}</option>
            </select>
          </label>
        ) : null}

        {coreManager.message ? (
          <p className={`core-manager__message core-manager__message--${coreManager.message.kind}`}>
            {coreManager.message.text}
          </p>
        ) : null}
      </div>
    </SettingsSection>
  );
}
