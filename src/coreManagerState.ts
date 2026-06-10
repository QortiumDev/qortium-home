import { useEffect, useMemo, useState } from 'react';
import { compareAppVersions, UPDATE_CHANNEL_LABEL_KEYS } from './appUpdates';
import { getTranslationLanguage, t } from './i18n';

export type CoreMessage = {
  kind: 'error' | 'success';
  text: string;
} | null;

export type CoreBusyAction =
  | 'checking'
  | 'installing-java'
  | 'installing-prerelease'
  | 'installing-stable'
  | 'starting'
  | 'stopping'
  | null;

type CoreManagerOptions = {
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onSaveNodeSettings: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;
};

export type DetailRow = {
  label: string;
  path?: string;
  value: string;
};

export function formatCoreError(error: unknown) {
  if (!(error instanceof Error)) {
    return t('core.actionFailed');
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

export function formatInstalledCore(installedCore: QortiumInstalledCore | null) {
  return installedCore ? installedCore.tagName : t('common.notInstalled');
}

export function formatJava(javaStatus: QortiumCoreJavaStatus | null) {
  if (!javaStatus) {
    return t('common.checking');
  }

  if (!javaStatus.version) {
    return t('core.javaMissing');
  }

  const source =
    javaStatus.source === 'managed'
      ? t('core.javaSourceManaged')
      : javaStatus.source === 'system'
        ? t('core.javaSourceSystem')
        : '';

  if (javaStatus.available) {
    return source
      ? t('core.javaVersionWithSource', { source, version: javaStatus.version })
      : t('core.javaVersion', { version: javaStatus.version });
  }

  return t('core.javaUnsupported', { version: javaStatus.version });
}

export function formatRuntime(runtime: QortiumCoreRuntimeStatus | null) {
  if (!runtime) {
    return t('common.checking');
  }

  if (runtime.blocked) {
    return t('core.statusRuntimeBlocked');
  }

  return runtime.running ? t('core.runtimeRunning') : t('common.stopped');
}

export function getCoreRuntimeBlockedMessage(status: QortiumCoreStatus | null) {
  return status?.runtime.blocked?.message ?? '';
}

export function getReleaseLabel(release: QortiumCoreReleaseSummary | undefined) {
  if (!release) {
    return t('core.checkReleases');
  }

  return release.available ? release.tagName : t('common.unavailable');
}

export function getProgressPercent(progress: QortiumCoreProgress | null) {
  if (!progress || typeof progress.percent !== 'number') {
    return null;
  }

  return Math.max(0, Math.min(100, progress.percent));
}

export function getCoreReleaseComparison(
  release: QortiumCoreReleaseSummary | undefined,
  installedCore: QortiumInstalledCore | null | undefined,
) {
  if (!release?.available || !installedCore?.tagName) {
    return null;
  }

  return compareAppVersions(release.tagName, installedCore.tagName);
}

export function isCoreReleaseUpdateAvailable(
  release: QortiumCoreReleaseSummary | undefined,
  installedCore: QortiumInstalledCore | null | undefined,
) {
  const comparison = getCoreReleaseComparison(release, installedCore);

  return typeof comparison === 'number' && comparison > 0;
}

export function getCoreReleaseActionLabel({
  busyAction,
  channel,
  installedCore,
  release,
}: {
  busyAction: CoreBusyAction;
  channel: QortiumCoreChannel;
  installedCore: QortiumInstalledCore | null | undefined;
  release: QortiumCoreReleaseSummary | undefined;
}) {
  if (busyAction === 'installing-stable' && channel === 'stable') {
    return t('common.installing');
  }

  if (busyAction === 'installing-prerelease' && channel === 'prerelease') {
    return t('common.installing');
  }

  const label = t(UPDATE_CHANNEL_LABEL_KEYS[channel]);
  const comparison = getCoreReleaseComparison(release, installedCore);

  if (comparison === 0) {
    return t('core.releaseActionCurrent', { channel: label });
  }

  return isCoreReleaseUpdateAvailable(release, installedCore)
    ? t('core.releaseActionUpdate', { channel: label })
    : t('core.releaseActionInstall', { channel: label });
}

function getCoreDetailRows(status: QortiumCoreStatus | null, releases: QortiumCoreReleases | null) {
  const installedVersion = status?.installed?.tagName ?? '';
  const installedChannel = status?.installed?.channel;
  const release = installedChannel
    ? releases?.[installedChannel]
    : releases?.prerelease.available
      ? releases.prerelease
      : releases?.stable;
  const rows = [
    {
      label: t('common.version'),
      value: status?.installed ? formatInstalledCore(status.installed) : status?.runtime.running ? t('common.detected') : t('common.notInstalled'),
    },
    { label: t('core.javaLabel'), value: formatJava(status?.java ?? null) },
    { label: t('core.runtimeLabel'), value: formatRuntime(status?.runtime ?? null) },
    { label: t('node.localApi'), value: status?.runtime.localApiUrl ?? 'http://127.0.0.1:24891' },
  ];

  if (status?.runtime.blocked) {
    rows.push({
      label: t('core.runtimeIssue'),
      value: status.runtime.blocked.message,
    });
  }

  if (
    release?.available &&
    installedVersion &&
    isCoreReleaseUpdateAvailable(release, status?.installed)
  ) {
    rows.push({ label: t('common.latest'), value: getReleaseLabel(release) });
  }

  return rows;
}

export function useCoreManager({ onResolvedNodeApiUrl, onSaveNodeSettings }: CoreManagerOptions) {
  const coreApi = window.qortiumHome.core;
  const [status, setStatus] = useState<QortiumCoreStatus | null>(null);
  const [releases, setReleases] = useState<QortiumCoreReleases | null>(null);
  const [progress, setProgress] = useState<QortiumCoreProgress | null>(null);
  const [message, setMessage] = useState<CoreMessage>(null);
  const [busyAction, setBusyAction] = useState<CoreBusyAction>(null);
  const isBusy = busyAction !== null;
  const language = getTranslationLanguage();

  useEffect(() => {
    if (!coreApi) {
      return undefined;
    }

    return coreApi.onProgress((nextProgress) => {
      setProgress(nextProgress);
    });
  }, [coreApi]);

  useEffect(() => {
    if (!coreApi) {
      return;
    }

    let isDisposed = false;

    Promise.all([coreApi.getStatus(), coreApi.checkReleases()])
      .then(([nextStatus, nextReleases]) => {
        if (!isDisposed) {
          setStatus(nextStatus);
          setReleases(nextReleases);
        }
      })
      .catch((error) => {
        if (!isDisposed) {
          setMessage({
            kind: 'error',
            text: formatCoreError(error),
          });
        }
      });

    return () => {
      isDisposed = true;
    };
  }, [coreApi]);

  const detailRows = useMemo(() => getCoreDetailRows(status, releases), [language, releases, status]);
  const progressPercent = getProgressPercent(progress);
  const runtimeBlocked = !!status?.runtime.blocked;
  const canInstallPrerelease = !!releases?.prerelease.available;
  const canInstallStable = !!releases?.stable.available;
  const canInstallJava = !!status && !runtimeBlocked && !status.java.available && status.supported;
  const canStart = !!status?.installed && !runtimeBlocked && !!status.java.available && !status.runtime.running;
  const canStop = !!status?.installed && !!status.runtime.running && status.runtime.owner !== 'external';
  const stableUpdateAvailable = isCoreReleaseUpdateAvailable(releases?.stable, status?.installed);
  const prereleaseUpdateAvailable = isCoreReleaseUpdateAvailable(releases?.prerelease, status?.installed);
  const canInstallOrUpdatePrerelease =
    !runtimeBlocked && canInstallPrerelease && (!status?.installed || prereleaseUpdateAvailable);
  const canInstallOrUpdateStable =
    !runtimeBlocked && canInstallStable && (!status?.installed || stableUpdateAvailable);

  async function refreshStatus() {
    if (!coreApi) {
      return;
    }

    setBusyAction('checking');
    setMessage(null);

    try {
      const [nextReleases, nextStatus] = await Promise.all([
        coreApi.checkReleases(),
        coreApi.getStatus(),
      ]);

      setReleases(nextReleases);
      setStatus(nextStatus);
      setMessage({
        kind: 'success',
        text: t('core.releaseCheckComplete'),
      });
    } catch (error) {
      setMessage({
        kind: 'error',
        text: formatCoreError(error),
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function installCore(channel: QortiumCoreChannel) {
    if (!coreApi) {
      return;
    }

    setBusyAction(channel === 'stable' ? 'installing-stable' : 'installing-prerelease');
    setMessage(null);

    try {
      const nextStatus = await coreApi.install({ channel });

      setStatus(nextStatus);
      setMessage({
        kind: 'success',
        text: t('core.installedName', { name: nextStatus.installed?.tagName ?? 'Qortium Core' }),
      });
    } catch (error) {
      setMessage({
        kind: 'error',
        text: formatCoreError(error),
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function installJava() {
    if (!coreApi) {
      return;
    }

    setBusyAction('installing-java');
    setMessage(null);

    try {
      const nextStatus = await coreApi.installJava();

      setStatus(nextStatus);
      setMessage({
        kind: 'success',
        text: t('core.installedName', { name: formatJava(nextStatus.java) }),
      });
    } catch (error) {
      setMessage({
        kind: 'error',
        text: formatCoreError(error),
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function startCore() {
    if (!coreApi) {
      return;
    }

    setBusyAction('starting');
    setMessage(null);

    try {
      const nextStatus = await coreApi.start();

      setStatus(nextStatus);

      if (nextStatus.runtime.running) {
        const settings = await onSaveNodeSettings({ mode: 'local' });

        onResolvedNodeApiUrl(settings.nodeApiUrl);
      }

      setMessage({
        kind: 'success',
        text: nextStatus.runtime.running
          ? t('core.runningAt', { url: nextStatus.runtime.localApiUrl })
          : t('core.startCompleted'),
      });
    } catch (error) {
      setMessage({
        kind: 'error',
        text: formatCoreError(error),
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function stopCore() {
    if (!coreApi) {
      return;
    }

    setBusyAction('stopping');
    setMessage(null);

    try {
      const nextStatus = await coreApi.stop();

      setStatus(nextStatus);
      setMessage({
        kind: 'success',
        text: nextStatus.runtime.running ? t('core.stopCompleted') : t('core.stoppedMessage'),
      });
    } catch (error) {
      setMessage({
        kind: 'error',
        text: formatCoreError(error),
      });
    } finally {
      setBusyAction(null);
    }
  }

  return {
    busyAction,
    canInstallJava,
    canInstallPrerelease: canInstallOrUpdatePrerelease,
    canInstallStable: canInstallOrUpdateStable,
    canStart,
    canStop,
    coreApi,
    detailRows,
    installCore,
    installJava,
    isBusy,
    message,
    prereleaseUpdateAvailable,
    progress,
    progressPercent,
    refreshStatus,
    releases,
    stableUpdateAvailable,
    startCore,
    status,
    stopCore,
  };
}

export type CoreManagerState = ReturnType<typeof useCoreManager>;
