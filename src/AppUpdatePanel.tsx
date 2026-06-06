import { Download, ExternalLink } from 'lucide-react';
import {
  formatBytes,
  getOpenDownloadedFileLabel,
  useAppUpdates,
} from './appUpdateState';
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

function getHomeUpdateRows(updates: ReturnType<typeof useAppUpdates>) {
  const currentReleaseTag = formatReleaseTag(updates.environment?.currentVersion);
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

  if (updates.availableChannels.length > 1) {
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

  if (updates.result?.asset) {
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

export function AppUpdatePanel() {
  const updates = useAppUpdates({ autoCheck: true });
  const rows = getHomeUpdateRows(updates);
  const showChannelSelect = updates.availableChannels.length > 1;
  const showDownloadedAction = !!updates.downloadedUpdate?.canOpen;
  const showDownloadAction =
    !showDownloadedAction && updates.updateAvailable && !!updates.result?.asset && !!updates.result.release;
  const hasAction = showDownloadAction || showDownloadedAction;
  const summary = getHomeUpdateStatusText(updates);

  return (
    <SettingsSection
      isRefreshing={updates.isChecking}
      refreshLabel={SETTINGS_TEXT.actions.checkForUpdates}
      summary={summary}
      title={SETTINGS_TEXT.sections.qortiumHome}
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
                onClick={updates.openDownloadedFile}
              >
                <ExternalLink aria-hidden="true" size={18} strokeWidth={2} />
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
