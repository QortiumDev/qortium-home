import { useEffect, useMemo, useState } from 'react';
import { compareAppVersions } from './appUpdates';
import { SETTINGS_TEXT } from './settingsText';

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
    return 'Core action failed.';
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

export function formatInstalledCore(installedCore: QortiumInstalledCore | null) {
  return installedCore ? installedCore.tagName : 'Not installed';
}

export function formatJava(javaStatus: QortiumCoreJavaStatus | null) {
  if (!javaStatus) {
    return 'Checking';
  }

  if (!javaStatus.version) {
    return 'Missing';
  }

  const source =
    javaStatus.source === 'managed'
      ? 'managed'
      : javaStatus.source === 'system'
        ? 'system'
        : '';

  if (javaStatus.available) {
    return source ? `Java ${javaStatus.version} (${source})` : `Java ${javaStatus.version}`;
  }

  return `Java ${javaStatus.version} unsupported`;
}

export function formatRuntime(runtime: QortiumCoreRuntimeStatus | null) {
  if (!runtime) {
    return 'Checking';
  }

  return runtime.running ? 'Running' : 'Stopped';
}

export function getReleaseLabel(release: QortiumCoreReleaseSummary | undefined) {
  if (!release) {
    return 'Check releases';
  }

  return release.available ? release.tagName : 'Unavailable';
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
    return 'Installing';
  }

  if (busyAction === 'installing-prerelease' && channel === 'prerelease') {
    return 'Installing';
  }

  const label = channel === 'stable' ? 'stable' : 'prerelease';
  const comparison = getCoreReleaseComparison(release, installedCore);

  if (comparison === 0) {
    return `Current ${label}`;
  }

  return isCoreReleaseUpdateAvailable(release, installedCore) ? `Update ${label}` : `Install ${label}`;
}

function getCoreDetailRows(status: QortiumCoreStatus | null, releases: QortiumCoreReleases | null) {
  const rows = [
    {
      label: SETTINGS_TEXT.labels.version,
      value: status?.installed ? formatInstalledCore(status.installed) : status?.runtime.running ? 'Detected' : 'Not installed',
    },
    { label: SETTINGS_TEXT.labels.java, value: formatJava(status?.java ?? null) },
    { label: SETTINGS_TEXT.labels.runtime, value: formatRuntime(status?.runtime ?? null) },
    { label: SETTINGS_TEXT.labels.localApi, value: status?.runtime.localApiUrl ?? 'http://127.0.0.1:24891' },
  ];

  if (status?.installed?.logPaths) {
    rows.push(
      {
        label: SETTINGS_TEXT.labels.runtimeDirectory,
        path: status.installed.runtimePath,
        value: status.installed.runtimePath,
      },
      {
        label: SETTINGS_TEXT.labels.coreLog,
        path: status.installed.logPaths.appLogPath,
        value: status.installed.logPaths.appLogPath,
      },
      {
        label: SETTINGS_TEXT.labels.runLog,
        path: status.installed.logPaths.launcherLogPath,
        value: status.installed.logPaths.launcherLogPath,
      },
    );

    if (status.installed.logPaths.windowsErrorLogPath) {
      rows.push({
        label: SETTINGS_TEXT.labels.errorLog,
        path: status.installed.logPaths.windowsErrorLogPath,
        value: status.installed.logPaths.windowsErrorLogPath,
      });
    }
  }

  if (releases?.stable.available) {
    rows.push({ label: SETTINGS_TEXT.channels.stable, value: getReleaseLabel(releases.stable) });
  }

  if (releases?.prerelease.available) {
    rows.push({ label: SETTINGS_TEXT.channels.prerelease, value: getReleaseLabel(releases.prerelease) });
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

  const detailRows = useMemo(() => getCoreDetailRows(status, releases), [releases, status]);
  const progressPercent = getProgressPercent(progress);
  const canInstallPrerelease = !!releases?.prerelease.available;
  const canInstallStable = !!releases?.stable.available;
  const canInstallJava = !!status && !status.java.available && status.supported;
  const canStart = !!status?.installed && !!status.java.available && !status.runtime.running;
  const canStop = !!status?.installed && !!status.runtime.running && status.runtime.owner !== 'external';
  const stableUpdateAvailable = isCoreReleaseUpdateAvailable(releases?.stable, status?.installed);
  const prereleaseUpdateAvailable = isCoreReleaseUpdateAvailable(releases?.prerelease, status?.installed);
  const canInstallOrUpdatePrerelease =
    canInstallPrerelease && (!status?.installed || prereleaseUpdateAvailable);
  const canInstallOrUpdateStable =
    canInstallStable && (!status?.installed || stableUpdateAvailable);

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
        text: 'Core release check complete.',
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
        text: `Installed ${nextStatus.installed?.tagName ?? 'Qortium Core'}.`,
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
        text: `Installed ${formatJava(nextStatus.java)}.`,
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
          ? `Core is running at ${nextStatus.runtime.localApiUrl}.`
          : 'Core start command completed.',
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
        text: nextStatus.runtime.running ? 'Core stop command completed.' : 'Core is stopped.',
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
