import { useEffect, useMemo, useRef, useState } from 'react';
import { checkAppUpdates } from './appUpdates';
import { getTranslationLanguage, t, type TranslationKey } from './i18n';

const UPDATE_CHANNELS: QortiumAppUpdateChannel[] = ['stable', 'prerelease'];
const BYTE_UNIT_KEYS: TranslationKey[] = [
  'common.unit.bytes',
  'common.unit.kb',
  'common.unit.mb',
  'common.unit.gb',
];

export type UpdateMessage = {
  kind: 'error' | 'success';
  text: string;
} | null;

type UpdateResultsByChannel = Partial<Record<QortiumAppUpdateChannel, QortiumAppUpdateCheckResult>>;

export function formatUpdateError(error: unknown) {
  if (!(error instanceof Error)) {
    return t('updates.checkFailed');
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '-';
  }

  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < BYTE_UNIT_KEYS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const formattedValue = value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const unitKey = BYTE_UNIT_KEYS[unitIndex];

  return unitKey === 'common.unit.bytes'
    ? t(unitKey, { count: formattedValue })
    : t(unitKey, { value: formattedValue });
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
    return t('updates.downloadedVerifiedAndroid', {
      fileName: downloadedUpdate.fileName,
      installButton: t('updates.installApk'),
    });
  }

  return downloadedUpdate.digestVerified
    ? t('updates.downloadedVerified', { fileName: downloadedUpdate.fileName })
    : t('updates.downloadedFile', { fileName: downloadedUpdate.fileName });
}

export function getOpenDownloadedFileLabel(platform: QortiumAppUpdatePlatform | undefined) {
  return isAndroidPlatform(platform) ? t('updates.installApk') : t('updates.showFile');
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
    { label: t('common.current'), value: environment?.currentVersion ?? t('common.checking') },
    { label: t('common.platform'), value: environment?.platform.label ?? t('common.checking') },
  ];

  if (result?.release) {
    rows.push({ label: t('common.latest'), value: result.release.tagName });
  }

  if (result?.status === 'available' && result.asset) {
    rows.push(
      { label: t('updates.assetLabel'), value: result.asset.name },
      { label: t('common.size'), value: formatBytes(result.asset.size) },
      { label: t('common.digest'), value: result.asset.digest ?? t('common.unavailable') },
    );
  }

  if (downloadedUpdate) {
    rows.push(
      { label: t('common.downloaded'), value: downloadedUpdate.fileName },
      ...(isAndroidPlatform(updatePlatform)
        ? [
            { label: t('updates.savedLabel'), value: downloadedUpdate.filePath },
            { label: t('updates.installLabel'), value: downloadedUpdate.canOpen ? t('common.ready') : t('common.unavailable') },
          ]
        : []),
      { label: t('updates.verifiedLabel'), value: downloadedUpdate.digestVerified ? t('common.yes') : t('updates.noDigest') },
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
  const [downloadProgress, setDownloadProgress] = useState<QortiumAppUpdateDownloadProgress | null>(null);
  const [message, setMessage] = useState<UpdateMessage>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const autoCheckKeyRef = useRef('');
  const result = results[channel] ?? null;
  const releasePageUrl = getReleasePageUrl(result);
  const updatePlatform = result?.platform ?? environment?.platform;
  const updateAvailable = result?.status === 'available';
  const availableChannels = useMemo(() => getResultChannels(results), [results]);
  const language = getTranslationLanguage();

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

  useEffect(() => window.qortiumHome.updates.onDownloadProgress(setDownloadProgress), []);

  const detailRows = useMemo(
    () =>
      getUpdateDetailRows({
        downloadedUpdate,
        environment,
        result,
        updatePlatform,
      }),
    [channel, downloadedUpdate, environment, language, result, updatePlatform],
  );

  async function checkForUpdates() {
    if (!environment) {
      return;
    }

    setIsChecking(true);
    setDownloadedUpdate(null);
    setDownloadProgress(null);
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
        text: nextResult?.message ?? t('updates.checkReleasesFailed'),
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
    setDownloadProgress(null);
    const nextResult = results[nextChannel] ?? null;
    const nextKind = getUpdateStatusKind(nextResult);

    setMessage(nextResult ? { kind: nextKind ?? 'error', text: nextResult.message } : null);
  }

  async function downloadUpdate() {
    if (!updateAvailable || !result?.asset || !result.release) {
      return;
    }

    setIsDownloading(true);
    setDownloadProgress({
      action: 'downloading',
      fileName: result.asset.name,
      message: t('updates.progressDownloadingHome'),
      percent: result.asset.size > 0 ? 0 : null,
      receivedBytes: 0,
      releaseTag: result.release.tagName,
      totalBytes: result.asset.size > 0 ? result.asset.size : null,
    });
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
      setDownloadProgress(null);
    }
  }

  async function openDownloadedUpdate() {
    if (!downloadedUpdate) {
      return;
    }

    try {
      if (isAndroidPlatform(updatePlatform)) {
        await window.qortiumHome.updates.openDownloadedFile(downloadedUpdate.filePath);
        return;
      }

      await window.qortiumHome.updates.showDownloadedFile(downloadedUpdate.filePath);
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
    downloadProgress,
    downloadUpdate,
    environment,
    isChecking,
    isDownloading,
    message,
    openDownloadedUpdate,
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

export type AppUpdatesState = ReturnType<typeof useAppUpdates>;
