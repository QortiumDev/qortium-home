import { Download, FolderOpen } from 'lucide-react';
import {
  type AppUpdatesState,
  formatBytes,
  getOpenDownloadedFileLabel,
} from './appUpdateState';
import { AppUpdateProgress } from './AppUpdateProgress';
import {
  areReleaseTagsEqual,
  DetailList,
  formatReleaseTag,
  getHomeReleaseUrl,
  getHomeUpdateStatusText,
  LinkedValue,
  type DetailRow,
} from './releaseDisplay';
import { SettingsSection } from './SettingsSection';
import { SETTINGS_TEXT } from './settingsText';

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
      label: SETTINGS_TEXT.labels.status,
      value: getHomeUpdateStatusText(updates),
    },
    {
      label: SETTINGS_TEXT.labels.version,
      value: (
        <LinkedValue url={getHomeReleaseUrl(updates.environment?.currentVersion)}>
          {currentReleaseTag || SETTINGS_TEXT.status.checking}
        </LinkedValue>
      ),
    },
    {
      label: SETTINGS_TEXT.labels.platform,
      value: updates.environment?.platform.label ?? SETTINGS_TEXT.status.checking,
    },
  ];

  if (showChannel) {
    rows.push({
      label: SETTINGS_TEXT.labels.channel,
      value: SETTINGS_TEXT.channels[updates.channel],
    });
  }

  if (updates.result?.release && !areReleaseTagsEqual(updates.result.release.tagName, currentReleaseTag)) {
    rows.push({
      label: SETTINGS_TEXT.labels.latest,
      value: (
        <LinkedValue url={updates.result.release.htmlUrl}>
          {updates.result.release.tagName}
        </LinkedValue>
      ),
    });
  }

  if (updates.updateAvailable && updates.result?.asset) {
    rows.push(
      { label: SETTINGS_TEXT.labels.size, value: formatBytes(updates.result.asset.size) },
      { label: SETTINGS_TEXT.labels.digest, value: updates.result.asset.digest ?? SETTINGS_TEXT.status.unavailable },
    );
  }

  if (updates.downloadedUpdate) {
    rows.push({
      label: SETTINGS_TEXT.status.downloaded,
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
      refreshLabel={SETTINGS_TEXT.actions.checkForUpdates}
      summary={summary}
      title={SETTINGS_TEXT.sections.qortiumHome}
      onExpandedChange={onExpandedChange}
      onRefresh={updates.checkForUpdates}
    >
      <div className="app-updates">
        {showChannelSelect ? (
          <label className="field">
            <span className="field__label">{SETTINGS_TEXT.labels.releaseChannel}</span>
            <select
              className="field__input"
              disabled={updates.isChecking}
              value={updates.channel}
              onChange={(event) => updates.setChannel(event.target.value as QortiumAppUpdateChannel)}
            >
              {updates.availableChannels.map((channel) => (
                <option key={channel} value={channel}>
                  {SETTINGS_TEXT.channels[channel]}
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
                {updates.isDownloading ? SETTINGS_TEXT.actions.downloading : SETTINGS_TEXT.actions.downloadUpdate}
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
