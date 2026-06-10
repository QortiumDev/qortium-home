import { formatBytes } from './appUpdateState';
import { t } from './i18n';

function getProgressText(progress: QortiumAppUpdateDownloadProgress) {
  if (progress.percent !== null && progress.totalBytes !== null) {
    return t('updates.progressPercentBytes', {
      message: progress.message,
      percent: progress.percent,
      received: formatBytes(progress.receivedBytes),
      total: formatBytes(progress.totalBytes),
    });
  }

  if (progress.percent !== null) {
    return t('common.progressWithPercent', {
      message: progress.message,
      percent: progress.percent,
    });
  }

  return t('updates.progressBytes', {
    message: progress.message,
    received: formatBytes(progress.receivedBytes),
  });
}

export function AppUpdateProgress({
  progress,
}: {
  progress: QortiumAppUpdateDownloadProgress | null;
}) {
  if (!progress) {
    return null;
  }

  return (
    <div className="app-updates__progress">
      <div
        aria-label={progress.message}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress.percent ?? undefined}
        className="app-updates__progress-bar"
        role="progressbar"
      >
        <span style={{ width: `${progress.percent ?? 100}%` }} />
      </div>
      <span className="app-updates__progress-text">{getProgressText(progress)}</span>
    </div>
  );
}
