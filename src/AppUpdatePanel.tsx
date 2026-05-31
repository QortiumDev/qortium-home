import { Download, ExternalLink, FolderOpen, RefreshCw } from 'lucide-react';
import {
  getOpenDownloadedFileLabel,
  useAppUpdates,
} from './appUpdateState';

export function AppUpdatePanel() {
  const updates = useAppUpdates();

  return (
    <section className="app-updates" aria-label="Qortium Home updates">
      <div className="app-updates__header">
        <h2 className="app-updates__title">Qortium Home Updates</h2>
        <button
          className="icon-button app-updates__refresh"
          disabled={updates.isChecking || !updates.environment}
          title="Check for app updates"
          type="button"
          onClick={updates.checkForUpdates}
        >
          <RefreshCw aria-hidden="true" size={18} strokeWidth={2} />
          <span className="sr-only">Check for app updates</span>
        </button>
      </div>

      <label className="field">
        <span className="field__label">Release channel</span>
        <select
          className="field__input"
          disabled={updates.isChecking}
          value={updates.channel}
          onChange={(event) => updates.setChannel(event.target.value as QortiumAppUpdateChannel)}
        >
          <option value="stable">Stable</option>
          <option value="prerelease">Prerelease</option>
        </select>
      </label>

      <dl className="detail-list app-updates__details">
        {updates.detailRows.map((row) => (
          <div className="detail-list__row" key={row.label}>
            <dt className="detail-list__label">{row.label}</dt>
            <dd className="detail-list__value">{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="app-updates__actions">
        <button
          className="button button--secondary"
          disabled={updates.isChecking || updates.isDownloading || !updates.environment}
          type="button"
          onClick={updates.checkForUpdates}
        >
          <RefreshCw aria-hidden="true" size={18} strokeWidth={2} />
          {updates.isChecking ? 'Checking' : 'Check now'}
        </button>
        {updates.updateAvailable && updates.result?.asset && updates.result.release ? (
          <button
            className="button button--secondary"
            disabled={updates.isChecking || updates.isDownloading}
            type="button"
            onClick={updates.downloadUpdate}
          >
            <Download aria-hidden="true" size={18} strokeWidth={2} />
            {updates.isDownloading ? 'Downloading' : 'Download update'}
          </button>
        ) : null}
        {updates.downloadedUpdate?.canOpen ? (
          <button
            className="button button--secondary"
            disabled={updates.isChecking || updates.isDownloading}
            type="button"
            onClick={updates.openDownloadedFile}
          >
            <ExternalLink aria-hidden="true" size={18} strokeWidth={2} />
            {getOpenDownloadedFileLabel(updates.updatePlatform)}
          </button>
        ) : null}
        {updates.downloadedUpdate?.canReveal ? (
          <button
            className="button button--secondary"
            disabled={updates.isChecking || updates.isDownloading}
            type="button"
            onClick={updates.showDownloadedFile}
          >
            <FolderOpen aria-hidden="true" size={18} strokeWidth={2} />
            Show file
          </button>
        ) : null}
        {updates.releasePageUrl ? (
          <button
            className="button"
            disabled={updates.isChecking || updates.isDownloading}
            type="button"
            onClick={updates.openReleasePage}
          >
            <ExternalLink aria-hidden="true" size={18} strokeWidth={2} />
            Open release
          </button>
        ) : null}
      </div>

      {updates.message ? (
        <p className={`app-updates__message app-updates__message--${updates.message.kind}`}>
          {updates.message.text}
        </p>
      ) : null}
    </section>
  );
}
