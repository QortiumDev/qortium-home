import { Download, FolderOpen } from 'lucide-react';
import { UPDATE_CHANNEL_LABEL_KEYS } from './appUpdates';
import {
  type AppUpdatesState,
  formatBytes,
  getOpenDownloadedFileLabel,
  type HomeUpdatePolicy,
  UPDATE_CHANNELS,
} from './appUpdateState';
import { AppUpdateProgress } from './AppUpdateProgress';
import { t } from './i18n';
import { useI2pConnections } from './i2pState';
import { useI2pdManager } from './i2pdManagerState';
import {
  areReleaseTagsEqual,
  DetailList,
  formatReleaseTag,
  getHomeUpdateStatusText,
  getHomeVersionReleaseNotesValue,
  ReleaseNotesValue,
  type DetailRow,
} from './releaseDisplay';
import { SettingsSection } from './SettingsSection';
import { I2pRouterButton } from './TransportControls';

type AppUpdatePanelProps = {
  connectionRefreshEpoch: number;
  isExpanded: boolean;
  isManagedNode: boolean;
  nodeApiUrl: string;
  onExpandedChange: (isExpanded: boolean) => void;
  onOpenReleaseNotes: (product: 'core' | 'home', tagName: string) => void;
  onRestartWelcome: () => void;
  updates: AppUpdatesState;
};

function getHomeUpdateRows(
  updates: AppUpdatesState,
  onOpenReleaseNotes: (product: 'core' | 'home', tagName: string) => void,
) {
  const currentReleaseTag = formatReleaseTag(updates.environment?.currentVersion);
  const rows: DetailRow[] = [
    {
      label: t('common.status'),
      value: getHomeUpdateStatusText(updates),
    },
  ];

  if (updates.environment?.installDir) {
    rows.push({ label: t('core.folderLabel'), path: updates.environment.installDir });
  }

  rows.push(
    {
      label: t('common.version'),
      value: getHomeVersionReleaseNotesValue(updates.environment, undefined, onOpenReleaseNotes),
    },
    {
      label: t('common.platform'),
      value: updates.environment?.platform.label ?? t('common.checking'),
    },
  );

  rows.push({
    label: t('updates.channelLabel'),
    value: t(UPDATE_CHANNEL_LABEL_KEYS[updates.channel]),
  });

  if (updates.result?.release && !areReleaseTagsEqual(updates.result.release.tagName, currentReleaseTag)) {
    rows.push({
      label: t('common.latestGithub'),
      value: (
        <ReleaseNotesValue
          product="home"
          tagName={updates.result.release.tagName}
          onOpenReleaseNotes={onOpenReleaseNotes}
        >
          {updates.result.release.tagName}
        </ReleaseNotesValue>
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
  connectionRefreshEpoch,
  isExpanded,
  isManagedNode,
  nodeApiUrl,
  onExpandedChange,
  onOpenReleaseNotes,
  onRestartWelcome,
  updates,
}: AppUpdatePanelProps) {
  const connections = useI2pConnections(nodeApiUrl, connectionRefreshEpoch);
  const i2pdManager = useI2pdManager(isManagedNode);
  const rows = getHomeUpdateRows(updates, onOpenReleaseNotes);
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
        <label className="field">
          <span className="field__label">{t('updates.homeUpdatePolicyLabel')}</span>
          <select
            className="field__input"
            disabled={!updates.preferencesLoaded || updates.isChecking || updates.isDownloading}
            value={updates.homeUpdatePolicy}
            onChange={(event) => updates.setHomeUpdatePolicy(event.target.value as HomeUpdatePolicy)}
          >
            <option value="off">{t('updates.homeUpdatePolicy.off')}</option>
            <option value="notify">{t('updates.homeUpdatePolicy.notify')}</option>
            <option value="auto-download">{t('updates.homeUpdatePolicy.autoDownload')}</option>
          </select>
        </label>

        {/* Always offered, never gated on what the two channels currently
            resolve to. Hiding the control whenever one channel has no release
            to show meant it never appeared at all while every Qortium Home
            release was flagged as a prerelease, which left the choice
            unreachable exactly when it mattered most. */}
        <label className="field">
          <span className="field__label">{t('updates.releaseChannelLabel')}</span>
          <select
            className="field__input"
            disabled={updates.isChecking}
            value={updates.channel}
            onChange={(event) => updates.setChannel(event.target.value as QortiumAppUpdateChannel)}
          >
            {UPDATE_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {t(UPDATE_CHANNEL_LABEL_KEYS[channel])}
              </option>
            ))}
          </select>
        </label>

        <DetailList className="app-updates__details" rows={rows} />

        <I2pRouterButton
          connections={connections}
          isManagedNode={isManagedNode}
          manager={i2pdManager}
          showStatus
        />

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

        <p className="app-updates__message">{t('welcome.restartDescription')}</p>
        <div className="app-updates__actions">
          <button className="button" type="button" onClick={onRestartWelcome}>
            {t('welcome.restart')}
          </button>
        </div>
      </div>
    </SettingsSection>
  );
}
