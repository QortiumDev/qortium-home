import { Download, FolderOpen } from 'lucide-react';
import { UPDATE_CHANNEL_LABEL_KEYS } from './appUpdates';
import {
  type AppUpdatesState,
  formatBytes,
  getOpenDownloadedFileLabel,
} from './appUpdateState';
import { AppUpdateProgress } from './AppUpdateProgress';
import { t } from './i18n';
import {
  areReleaseTagsEqual,
  DetailList,
  formatReleaseTag,
  getHomeUpdateStatusText,
  getHomeVersionRowValue,
  LinkedValue,
  type DetailRow,
} from './releaseDisplay';
import { SettingsSection } from './SettingsSection';

type AppUpdatePanelProps = {
  isExpanded: boolean;
  onExpandedChange: (isExpanded: boolean) => void;
  updates: AppUpdatesState;
};

function hasDistinctAvailableChannels(updates: AppUpdatesState) {
  const stableTag = updates.results.stable?.release?.tagName;
  const prereleaseTag = updates.results.prerelease?.release?.tagName;

  return !!stableTag && !!prereleaseTag && !areReleaseTagsEqual(stableTag, prereleaseTag);
}

function getHomeUpdateRows(updates: AppUpdatesState) {
  const currentReleaseTag = formatReleaseTag(updates.environment?.currentVersion);
  const showChannel = hasDistinctAvailableChannels(updates);
  const rows: DetailRow[] = [
    {
      label: t('common.status'),
      value: getHomeUpdateStatusText(updates),
    },
    {
      label: t('common.version'),
      value: getHomeVersionRowValue(updates.environment),
    },
    {
      label: t('common.platform'),
      value: updates.environment?.platform.label ?? t('common.checking'),
    },
  ];

  if (updates.environment?.installDir) {
    rows.push({ label: t('core.folderLabel'), path: updates.environment.installDir });
  }

  if (showChannel) {
    rows.push({
      label: t('updates.channelLabel'),
      value: t(UPDATE_CHANNEL_LABEL_KEYS[updates.channel]),
    });
  }

  if (updates.result?.release && !areReleaseTagsEqual(updates.result.release.tagName, currentReleaseTag)) {
    rows.push({
      label: t('common.latestGithub'),
      value: (
        <LinkedValue url={updates.result.release.htmlUrl}>
          {updates.result.release.tagName}
        </LinkedValue>
      ),
    });
  }

  if (updates.updateAvailable && updates.result?.asset) {
    rows.push(
      { label: t('common.size'), value: formatBytes(updates.result.asset.size) },
      { label: t('common.digest'), value: updates.result.asset.digest ?? t('common.unavailable') },
    );
  }

  if (updates.downloadedUpdate) {
    rows.push({
      label: t('common.downloaded'),
      value: updates.downloadedUpdate.fileName,
    });
  }

  return rows;
}

export function AppUpdatePanel({
  isExpanded,
  onExpandedChange,
  updates,
}: AppUpdatePanelProps) {
  const rows = getHomeUpdateRows(updates);
  const showChannelSelect = hasDistinctAvailableChannels(updates);
  const showDownloadedAction = !!updates.downloadedUpdate?.canOpen;
  const showDownloadAction =
    !showDownloadedAction && updates.updateAvailable && !!updates.result?.asset && !!updates.result.release;
  const hasAction = showDownloadAction || showDownloadedAction;
  const summary = getHomeUpdateStatusText(updates);

  return (
    <SettingsSection
      isExpanded={isExpanded}
      isRefreshing={updates.isChecking}
      refreshLabel={t('updates.checkForUpdates')}
      summary={summary}
      title={t('common.appName')}
      onExpandedChange={onExpandedChange}
      onRefresh={updates.checkForUpdates}
    >
      <div className="app-updates">
        {showChannelSelect ? (
          <label className="field">
            <span className="field__label">{t('updates.releaseChannelLabel')}</span>
            <select
              className="field__input"
              disabled={updates.isChecking}
              value={updates.channel}
              onChange={(event) => updates.setChannel(event.target.value as QortiumAppUpdateChannel)}
            >
              {updates.availableChannels.map((channel) => (
                <option key={channel} value={channel}>
                  {t(UPDATE_CHANNEL_LABEL_KEYS[channel])}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <DetailList className="app-updates__details" rows={rows} />

        <AppUpdateProgress progress={updates.downloadProgress} />

        {hasAction ? (
          <div className="app-updates__actions">
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

        {updates.message ? (
          <p className={`app-updates__message app-updates__message--${updates.message.kind}`}>
            {updates.message.text}
          </p>
        ) : null}
      </div>
    </SettingsSection>
  );
}
