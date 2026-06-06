import { Download, Play, RefreshCw, Square } from 'lucide-react';
import {
  getCoreReleaseActionLabel,
  useCoreManager,
} from './coreManagerState';

type CoreManagerPanelProps = {
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onSaveNodeSettings: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;
};

export function CoreManagerPanel({
  onResolvedNodeApiUrl,
  onSaveNodeSettings,
}: CoreManagerPanelProps) {
  const coreManager = useCoreManager({
    onResolvedNodeApiUrl,
    onSaveNodeSettings,
  });

  if (!coreManager.coreApi) {
    return null;
  }

  return (
    <section className="core-manager" aria-label="Qortium Core">
      <div className="core-manager__header">
        <h2 className="core-manager__title">Qortium Core</h2>
        <button
          className="icon-button core-manager__refresh"
          disabled={coreManager.isBusy}
          title="Refresh Core status"
          type="button"
          onClick={coreManager.refreshStatus}
        >
          <RefreshCw aria-hidden="true" size={18} strokeWidth={2} />
          <span className="sr-only">Refresh Core status</span>
        </button>
      </div>

      <dl className="detail-list core-manager__details">
        {coreManager.detailRows.map((row) => (
          <div className="detail-list__row" key={row.label}>
            <dt className="detail-list__label">{row.label}</dt>
            <dd className="detail-list__value">{row.value}</dd>
          </div>
        ))}
      </dl>

      {coreManager.progress && coreManager.progress.action !== 'idle' ? (
        <div className="core-manager__progress">
          <div className="core-manager__progress-bar" aria-hidden="true">
            <span style={{ width: `${coreManager.progressPercent ?? 100}%` }} />
          </div>
          <span className="core-manager__progress-text">
            {coreManager.progressPercent === null
              ? coreManager.progress.message
              : `${coreManager.progress.message} ${coreManager.progressPercent}%`}
          </span>
        </div>
      ) : null}

      <div className="core-manager__actions">
        <button
          className="button button--secondary"
          disabled={coreManager.isBusy || !coreManager.canInstallJava}
          type="button"
          onClick={coreManager.installJava}
        >
          <Download aria-hidden="true" size={18} strokeWidth={2} />
          {coreManager.busyAction === 'installing-java' ? 'Installing Java' : 'Install Java'}
        </button>
        <button
          className="button button--secondary"
          disabled={coreManager.isBusy || !coreManager.canInstallPrerelease}
          type="button"
          onClick={() => coreManager.installCore('prerelease')}
        >
          <Download aria-hidden="true" size={18} strokeWidth={2} />
          {getCoreReleaseActionLabel({
            busyAction: coreManager.busyAction,
            channel: 'prerelease',
            installedCore: coreManager.status?.installed,
            release: coreManager.releases?.prerelease,
          })}
        </button>
        {coreManager.canInstallStable ? (
          <button
            className="button button--secondary"
            disabled={coreManager.isBusy}
            type="button"
            onClick={() => coreManager.installCore('stable')}
          >
            <Download aria-hidden="true" size={18} strokeWidth={2} />
            {getCoreReleaseActionLabel({
              busyAction: coreManager.busyAction,
              channel: 'stable',
              installedCore: coreManager.status?.installed,
              release: coreManager.releases?.stable,
            })}
          </button>
        ) : null}
        <button
          className="button"
          disabled={coreManager.isBusy || !coreManager.canStart}
          type="button"
          onClick={coreManager.startCore}
        >
          <Play aria-hidden="true" size={18} strokeWidth={2} />
          {coreManager.busyAction === 'starting' ? 'Starting' : 'Start'}
        </button>
        <button
          className="button button--secondary"
          disabled={coreManager.isBusy || !coreManager.canStop}
          type="button"
          onClick={coreManager.stopCore}
        >
          <Square aria-hidden="true" size={18} strokeWidth={2} />
          {coreManager.busyAction === 'stopping' ? 'Stopping' : 'Stop'}
        </button>
      </div>

      {coreManager.message ? (
        <p className={`core-manager__message core-manager__message--${coreManager.message.kind}`}>
          {coreManager.message.text}
        </p>
      ) : null}
    </section>
  );
}
