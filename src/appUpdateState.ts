import { useEffect, useMemo, useRef, useState } from 'react';
import { checkAppUpdates } from './appUpdates';

const UPDATE_CHANNELS: QortiumAppUpdateChannel[] = ['stable', 'prerelease'];

export type UpdateMessage = {
  kind: 'error' | 'success';
  text: string;
} | null;

type UpdateResultsByChannel = Partial<Record<QortiumAppUpdateChannel, QortiumAppUpdateCheckResult>>;

export function formatUpdateError(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Unable to check app updates.';
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '-';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unitIndex]}`;
}

export function getDefaultUpdateChannel(
  environment: QortiumAppUpdateEnvironment | null,
): QortiumAppUpdateChannel {
  return environment?.currentVersion.includes('-') ? 'prerelease' : 'stable';
}

export function getUpdateStatusKind(
  result: QortiumAppUpdateCheckResult | null,
): NonNullable<UpdateMessage>['kind'] | null {
  if (!result) {
    return null;
  }

  return result.status === 'available' || result.status === 'up-to-date' ? 'success' : 'error';
}

export function getReleasePageUrl(result: QortiumAppUpdateCheckResult | null) {
  return result?.release?.htmlUrl || '';
}

export function isAndroidPlatform(platform: QortiumAppUpdatePlatform | undefined) {
  return platform?.os === 'android';
}

export function getDownloadedUpdateMessage(
  downloadedUpdate: QortiumAppUpdateDownloadResult,
  platform: QortiumAppUpdatePlatform | undefined,
) {
  if (isAndroidPlatform(platform)) {
    return `Downloaded and verified ${downloadedUpdate.fileName}. Tap Install APK to continue with Android's installer.`;
  }

  return downloadedUpdate.digestVerified
    ? `Downloaded and verified ${downloadedUpdate.fileName}.`
    : `Downloaded ${downloadedUpdate.fileName}.`;
}

export function getOpenDownloadedFileLabel(platform: QortiumAppUpdatePlatform | undefined) {
  return isAndroidPlatform(platform) ? 'Install APK' : 'Open file';
}

function getUpdateDetailRows({
  downloadedUpdate,
  environment,
  result,
  updatePlatform,
}: {
  downloadedUpdate: QortiumAppUpdateDownloadResult | null;
  environment: QortiumAppUpdateEnvironment | null;
  result: QortiumAppUpdateCheckResult | null;
  updatePlatform: QortiumAppUpdatePlatform | undefined;
}) {
  const rows = [
    { label: 'Current', value: environment?.currentVersion ?? 'Checking' },
    { label: 'Platform', value: environment?.platform.label ?? 'Checking' },
  ];

  if (result?.release) {
    rows.push({ label: 'Latest', value: result.release.tagName });
  }

  if (result?.asset) {
    rows.push(
      { label: 'Asset', value: result.asset.name },
      { label: 'Size', value: formatBytes(result.asset.size) },
      { label: 'Digest', value: result.asset.digest ?? 'Unavailable' },
    );
  }

  if (downloadedUpdate) {
    rows.push(
      { label: 'Downloaded', value: downloadedUpdate.fileName },
      ...(isAndroidPlatform(updatePlatform)
        ? [
            { label: 'Saved', value: downloadedUpdate.filePath },
            { label: 'Install', value: downloadedUpdate.canOpen ? 'Ready' : 'Unavailable' },
          ]
        : []),
      { label: 'Verified', value: downloadedUpdate.digestVerified ? 'Yes' : 'No digest' },
    );
  }

  return rows;
}

function getResultChannels(results: UpdateResultsByChannel) {
  return UPDATE_CHANNELS.filter((channel) => !!results[channel]?.release);
}

function getPreferredResultChannel({
  currentChannel,
  environment,
  results,
}: {
  currentChannel: QortiumAppUpdateChannel;
  environment: QortiumAppUpdateEnvironment;
  results: UpdateResultsByChannel;
}) {
  if (results[currentChannel]?.release) {
    return currentChannel;
  }

  const defaultChannel = getDefaultUpdateChannel(environment);

  if (results[defaultChannel]?.release) {
    return defaultChannel;
  }

  if (results.prerelease?.release) {
    return 'prerelease';
  }

  if (results.stable?.release) {
    return 'stable';
  }

  return currentChannel;
}

export function useAppUpdates({ autoCheck = false }: { autoCheck?: boolean } = {}) {
  const [environment, setEnvironment] = useState<QortiumAppUpdateEnvironment | null>(null);
  const [channel, setChannelState] = useState<QortiumAppUpdateChannel>('stable');
  const [results, setResults] = useState<UpdateResultsByChannel>({});
  const [downloadedUpdate, setDownloadedUpdate] = useState<QortiumAppUpdateDownloadResult | null>(null);
  const [message, setMessage] = useState<UpdateMessage>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const autoCheckKeyRef = useRef('');
  const result = results[channel] ?? null;
  const releasePageUrl = getReleasePageUrl(result);
  const updatePlatform = result?.platform ?? environment?.platform;
  const updateAvailable = result?.status === 'available';
  const availableChannels = useMemo(() => getResultChannels(results), [results]);

  useEffect(() => {
    let isDisposed = false;

    window.qortiumHome.updates
      .getEnvironment()
      .then((nextEnvironment) => {
        if (isDisposed) {
          return;
        }

        setEnvironment(nextEnvironment);
        setChannelState(getDefaultUpdateChannel(nextEnvironment));
      })
      .catch((error) => {
        if (!isDisposed) {
          setMessage({
            kind: 'error',
            text: formatUpdateError(error),
          });
        }
      });

    return () => {
      isDisposed = true;
    };
  }, []);

  const detailRows = useMemo(
    () =>
      getUpdateDetailRows({
        downloadedUpdate,
        environment,
        result,
        updatePlatform,
      }),
    [channel, downloadedUpdate, environment, result, updatePlatform],
  );

  async function checkForUpdates() {
    if (!environment) {
      return;
    }

    setIsChecking(true);
    setDownloadedUpdate(null);
    setMessage(null);

    try {
      const nextEntries = await Promise.all(
        UPDATE_CHANNELS.map(async (nextChannel) => [
          nextChannel,
          await checkAppUpdates(environment, nextChannel),
        ] as const),
      );
      const nextResults = Object.fromEntries(nextEntries) as UpdateResultsByChannel;
      const nextChannel = getPreferredResultChannel({
        currentChannel: channel,
        environment,
        results: nextResults,
      });
      const nextResult = nextResults[nextChannel] ?? null;
      const nextKind = getUpdateStatusKind(nextResult);

      setResults(nextResults);
      setChannelState(nextChannel);
      setMessage({
        kind: nextKind ?? 'error',
        text: nextResult?.message ?? 'Unable to check Qortium Home releases.',
      });
    } catch (error) {
      setMessage({
        kind: 'error',
        text: formatUpdateError(error),
      });
    } finally {
      setIsChecking(false);
    }
  }

  useEffect(() => {
    if (!autoCheck || !environment) {
      return;
    }

    const autoCheckKey = `${environment.currentVersion}:${environment.platform.os}:${environment.platform.arch}`;

    if (autoCheckKeyRef.current === autoCheckKey) {
      return;
    }

    autoCheckKeyRef.current = autoCheckKey;
    void checkForUpdates();
  }, [autoCheck, environment]);

  function changeChannel(nextChannel: QortiumAppUpdateChannel) {
    setChannelState(nextChannel);
    setDownloadedUpdate(null);
    const nextResult = results[nextChannel] ?? null;
    const nextKind = getUpdateStatusKind(nextResult);

    setMessage(nextResult ? { kind: nextKind ?? 'error', text: nextResult.message } : null);
  }

  async function downloadUpdate() {
    if (!updateAvailable || !result?.asset || !result.release) {
      return;
    }

    setIsDownloading(true);
    setMessage(null);

    try {
      const nextDownloadedUpdate = await window.qortiumHome.updates.downloadAsset({
        asset: result.asset,
        platform: result.platform,
        releaseTag: result.release.tagName,
      });

      setDownloadedUpdate(nextDownloadedUpdate);
      setMessage({
        kind: 'success',
        text: getDownloadedUpdateMessage(nextDownloadedUpdate, result.platform),
      });
    } catch (error) {
      setMessage({
        kind: 'error',
        text: formatUpdateError(error),
      });
    } finally {
      setIsDownloading(false);
    }
  }

  async function openDownloadedFile() {
    if (!downloadedUpdate) {
      return;
    }

    try {
      await window.qortiumHome.updates.openDownloadedFile(downloadedUpdate.filePath);
    } catch (error) {
      setMessage({
        kind: 'error',
        text: formatUpdateError(error),
      });
    }
  }

  async function showDownloadedFile() {
    if (!downloadedUpdate) {
      return;
    }

    try {
      await window.qortiumHome.updates.showDownloadedFile(downloadedUpdate.filePath);
    } catch (error) {
      setMessage({
        kind: 'error',
        text: formatUpdateError(error),
      });
    }
  }

  async function openReleasePage() {
    if (!releasePageUrl) {
      return;
    }

    try {
      await window.qortiumHome.updates.openReleasePage(releasePageUrl);
    } catch (error) {
      setMessage({
        kind: 'error',
        text: formatUpdateError(error),
      });
    }
  }

  return {
    availableChannels,
    channel,
    checkForUpdates,
    detailRows,
    downloadedUpdate,
    downloadUpdate,
    environment,
    isChecking,
    isDownloading,
    message,
    openDownloadedFile,
    openReleasePage,
    releasePageUrl,
    result,
    results,
    setChannel: changeChannel,
    showDownloadedFile,
    updatePlatform,
    updateAvailable,
  };
}
