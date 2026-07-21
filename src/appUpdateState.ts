import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { useEffect, useMemo, useRef, useState } from 'react';
import { checkAppUpdates } from './appUpdates';
import { getTranslationLanguage, t, type TranslationKey } from './i18n';

const UPDATE_CHANNELS: QortiumAppUpdateChannel[] = ['stable', 'prerelease'];
const APP_UPDATE_PREFERENCES_STORAGE_KEY = 'qortium-home-app-update-preferences';
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

export type HomeUpdatePolicy = 'off' | 'notify' | 'auto-download';

type AppUpdatePreferences = {
  downloadedUpdate: QortiumAppUpdateDownloadResult | null;
  homeUpdatePolicy: HomeUpdatePolicy;
  releaseChannel: QortiumAppUpdateChannel | null;
};

const DEFAULT_APP_UPDATE_PREFERENCES: AppUpdatePreferences = {
  downloadedUpdate: null,
  homeUpdatePolicy: 'notify',
  releaseChannel: null,
};

function isUpdatePolicy(value: unknown): value is HomeUpdatePolicy {
  return value === 'off' || value === 'notify' || value === 'auto-download';
}

function isUpdateChannel(value: unknown): value is QortiumAppUpdateChannel {
  return value === 'stable' || value === 'prerelease';
}

function parseDownloadedUpdate(value: unknown): QortiumAppUpdateDownloadResult | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const downloadedUpdate = value as Partial<QortiumAppUpdateDownloadResult>;

  return typeof downloadedUpdate.fileName === 'string' &&
    typeof downloadedUpdate.filePath === 'string' &&
    typeof downloadedUpdate.releaseTag === 'string' &&
    typeof downloadedUpdate.digest === 'string' &&
    downloadedUpdate.digestVerified === true &&
    typeof downloadedUpdate.canOpen === 'boolean' &&
    typeof downloadedUpdate.canReveal === 'boolean' &&
    typeof downloadedUpdate.downloadedAt === 'string' &&
    typeof downloadedUpdate.size === 'number'
    ? downloadedUpdate as QortiumAppUpdateDownloadResult
    : null;
}

function parseAppUpdatePreferences(value: string | null): AppUpdatePreferences {
  if (!value) {
    return DEFAULT_APP_UPDATE_PREFERENCES;
  }

  try {
    const parsedValue = JSON.parse(value) as Record<string, unknown>;

    return {
      downloadedUpdate: parseDownloadedUpdate(parsedValue.downloadedUpdate),
      homeUpdatePolicy: isUpdatePolicy(parsedValue.homeUpdatePolicy)
        ? parsedValue.homeUpdatePolicy
        : DEFAULT_APP_UPDATE_PREFERENCES.homeUpdatePolicy,
      releaseChannel: isUpdateChannel(parsedValue.releaseChannel) ? parsedValue.releaseChannel : null,
    };
  } catch {
    return DEFAULT_APP_UPDATE_PREFERENCES;
  }
}

async function loadAppUpdatePreferences() {
  try {
    const value = Capacitor.isNativePlatform()
      ? (await Preferences.get({ key: APP_UPDATE_PREFERENCES_STORAGE_KEY })).value
      : window.localStorage.getItem(APP_UPDATE_PREFERENCES_STORAGE_KEY);

    return parseAppUpdatePreferences(value);
  } catch {
    return DEFAULT_APP_UPDATE_PREFERENCES;
  }
}

async function saveAppUpdatePreferences(preferences: AppUpdatePreferences) {
  const value = JSON.stringify(preferences);

  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key: APP_UPDATE_PREFERENCES_STORAGE_KEY, value });
    return;
  }

  window.localStorage.setItem(APP_UPDATE_PREFERENCES_STORAGE_KEY, value);
}

export function getMatchingDownloadedUpdate(
  downloadedUpdate: QortiumAppUpdateDownloadResult | null,
  result: QortiumAppUpdateCheckResult | null,
) {
  // An 'up-to-date' result still carries the compatible asset for the installed
  // release, so tag and digest keep matching a download the user has already
  // installed. Without this guard the panel reports "Downloaded" and offers to
  // reveal/install it forever, instead of confirming the app is up to date.
  if (result?.status !== 'available') {
    return null;
  }

  if (
    !downloadedUpdate?.digestVerified ||
    !result?.asset?.digest ||
    !result.release ||
    downloadedUpdate.releaseTag !== result.release.tagName ||
    downloadedUpdate.digest !== result.asset.digest
  ) {
    return null;
  }

  return downloadedUpdate;
}

export function isDownloadedUpdatePending(
  downloadedUpdate: QortiumAppUpdateDownloadResult | null,
  results: UpdateResultsByChannel,
) {
  return UPDATE_CHANNELS.some((channel) => !!getMatchingDownloadedUpdate(downloadedUpdate, results[channel] ?? null));
}

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
  const [preferences, setPreferences] = useState<AppUpdatePreferences | null>(null);
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
  const homeUpdatePolicy = preferences?.homeUpdatePolicy ?? DEFAULT_APP_UPDATE_PREFERENCES.homeUpdatePolicy;

  useEffect(() => {
    let isDisposed = false;

    Promise.all([
      window.qortiumHome.updates.getEnvironment(),
      loadAppUpdatePreferences(),
    ])
      .then(([nextEnvironment, nextPreferences]) => {
        if (isDisposed) {
          return;
        }

        setEnvironment(nextEnvironment);
        setPreferences(nextPreferences);
        setChannelState(nextPreferences.releaseChannel ?? getDefaultUpdateChannel(nextEnvironment));
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

  async function checkForUpdates({ autoDownload = false }: { autoDownload?: boolean } = {}) {
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
      const storedDownloadedUpdate = preferences?.downloadedUpdate ?? null;
      const existingDownloadedUpdate = getMatchingDownloadedUpdate(storedDownloadedUpdate, nextResult);
      setDownloadedUpdate(existingDownloadedUpdate);

      // Drop the stored download once no channel still offers it — usually
      // because it has been installed. Matching any channel keeps it, so
      // switching channels does not discard a pending download.
      if (storedDownloadedUpdate && !isDownloadedUpdatePending(storedDownloadedUpdate, nextResults)) {
        updatePreferences({ downloadedUpdate: null });
      }

      setMessage({
        kind: nextKind ?? 'error',
        text: existingDownloadedUpdate
          ? getDownloadedUpdateMessage(existingDownloadedUpdate, nextResult?.platform)
          : nextResult?.message ?? t('updates.checkReleasesFailed'),
      });

      if (autoDownload && nextResult?.status === 'available' && nextResult.asset && nextResult.release && !existingDownloadedUpdate) {
        await downloadUpdateForResult(nextResult);
      }
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
    if (!autoCheck || !environment || !preferences || homeUpdatePolicy === 'off') {
      return;
    }

    const autoCheckKey = `${environment.currentVersion}:${environment.platform.os}:${environment.platform.arch}:${homeUpdatePolicy}`;

    if (autoCheckKeyRef.current === autoCheckKey) {
      return;
    }

    autoCheckKeyRef.current = autoCheckKey;
    void checkForUpdates({ autoDownload: homeUpdatePolicy === 'auto-download' });
  }, [autoCheck, environment, homeUpdatePolicy, preferences]);

  function changeChannel(nextChannel: QortiumAppUpdateChannel) {
    setChannelState(nextChannel);
    const nextDownloadedUpdate = getMatchingDownloadedUpdate(preferences?.downloadedUpdate ?? null, results[nextChannel] ?? null);
    setDownloadedUpdate(nextDownloadedUpdate);
    setDownloadProgress(null);
    const nextResult = results[nextChannel] ?? null;
    const nextKind = getUpdateStatusKind(nextResult);

    setMessage(nextResult
      ? {
          kind: nextKind ?? 'error',
          text: nextDownloadedUpdate
            ? getDownloadedUpdateMessage(nextDownloadedUpdate, nextResult.platform)
            : nextResult.message,
        }
      : null);
    updatePreferences({ releaseChannel: nextChannel });
  }

  function updatePreferences(nextValues: Partial<AppUpdatePreferences>) {
    if (!preferences) {
      return;
    }

    const nextPreferences = {
      ...preferences,
      ...nextValues,
    };

    setPreferences(nextPreferences);
    void saveAppUpdatePreferences(nextPreferences).catch((error) => {
      console.warn('Unable to save app update preferences.', error);
    });
  }

  function changeHomeUpdatePolicy(nextPolicy: HomeUpdatePolicy) {
    updatePreferences({ homeUpdatePolicy: nextPolicy });
  }

  async function downloadUpdateForResult(nextResult: QortiumAppUpdateCheckResult) {
    if (!nextResult.asset || !nextResult.release) {
      return;
    }

    setIsDownloading(true);
    setDownloadProgress({
      action: 'downloading',
      fileName: nextResult.asset.name,
      message: t('updates.progressDownloadingHome'),
      percent: nextResult.asset.size > 0 ? 0 : null,
      receivedBytes: 0,
      releaseTag: nextResult.release.tagName,
      totalBytes: nextResult.asset.size > 0 ? nextResult.asset.size : null,
    });
    setMessage(null);

    try {
      const nextDownloadedUpdate = await window.qortiumHome.updates.downloadAsset({
        asset: nextResult.asset,
        platform: nextResult.platform,
        releaseTag: nextResult.release.tagName,
      });

      setDownloadedUpdate(nextDownloadedUpdate);
      updatePreferences({ downloadedUpdate: nextDownloadedUpdate });
      setMessage({
        kind: 'success',
        text: getDownloadedUpdateMessage(nextDownloadedUpdate, nextResult.platform),
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

  async function downloadUpdate() {
    if (!updateAvailable || !result) {
      return;
    }

    await downloadUpdateForResult(result);
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
    homeUpdatePolicy,
    isChecking,
    isDownloading,
    message,
    openDownloadedUpdate,
    openReleasePage,
    releasePageUrl,
    result,
    results,
    setChannel: changeChannel,
    setHomeUpdatePolicy: changeHomeUpdatePolicy,
    preferencesLoaded: preferences !== null,
    showDownloadedFile,
    updatePlatform,
    updateAvailable,
  };
}

export type AppUpdatesState = ReturnType<typeof useAppUpdates>;
