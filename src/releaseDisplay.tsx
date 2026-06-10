import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { compareAppVersions } from './appUpdates';
import { t } from './i18n';

const HOME_RELEASE_TAG_BASE_URL = 'https://github.com/QortiumDev/qortium-home/releases/tag';

export type DetailRow = {
  label: string;
  path?: string;
  value: ReactNode;
};

type AvailableCoreReleaseSummary = Extract<QortiumCoreReleaseSummary, { available: true }>;

export function formatReleaseTag(version: string | null | undefined) {
  const normalizedVersion = version?.trim();

  if (!normalizedVersion) {
    return '';
  }

  return normalizedVersion.toLowerCase().startsWith('v') ? normalizedVersion : `v${normalizedVersion}`;
}

export function getHomeReleaseUrl(version: string | null | undefined) {
  const tagName = formatReleaseTag(version);

  if (!tagName) {
    return '';
  }

  return `${HOME_RELEASE_TAG_BASE_URL}/${encodeURIComponent(tagName)}`;
}

export function areReleaseTagsEqual(first: string | null | undefined, second: string | null | undefined) {
  const firstValue = first?.trim();
  const secondValue = second?.trim();

  if (!firstValue || !secondValue) {
    return false;
  }

  return compareAppVersions(firstValue, secondValue) === 0;
}

export function LinkedValue({
  children,
  className = 'value-link',
  title,
  url,
}: {
  children: string;
  className?: string;
  title?: string;
  url?: string;
}) {
  if (!url) {
    return <>{children}</>;
  }

  return (
    <button
      className={className}
      title={title ?? t('common.openItem', { target: children })}
      type="button"
      onClick={() => {
        void window.qortiumHome.updates.openReleasePage(url);
      }}
    >
      <span>{children}</span>
      <ExternalLink aria-hidden="true" size={13} strokeWidth={2} />
    </button>
  );
}

export function PathValue({ path }: { path: string }) {
  return (
    <button
      className="value-link value-link--path"
      title={t('common.openItem', { target: path })}
      type="button"
      onClick={() => {
        void window.qortiumHome.system?.openPath(path);
      }}
    >
      <span>{path}</span>
      <ExternalLink aria-hidden="true" size={13} strokeWidth={2} />
    </button>
  );
}

export function DetailList({
  className = '',
  rows,
}: {
  className?: string;
  rows: DetailRow[];
}) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <dl className={`detail-list${className ? ` ${className}` : ''}`}>
      {rows.map((row) => (
        <div className="detail-list__row" key={row.label}>
          <dt className="detail-list__label">{row.label}</dt>
          <dd className="detail-list__value">
            {row.path ? <PathValue path={row.path} /> : row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function getAvailableCoreRelease(
  releases: QortiumCoreReleases | null,
  channel: QortiumCoreChannel,
): AvailableCoreReleaseSummary | null {
  const release = releases?.[channel];

  return release?.available ? release : null;
}

export function getPreferredCoreReleaseTarget({
  releases,
  status,
}: {
  releases: QortiumCoreReleases | null;
  status: QortiumCoreStatus | null;
}) {
  const installedChannel = status?.installed?.channel;

  if (installedChannel) {
    const installedChannelRelease = getAvailableCoreRelease(releases, installedChannel);

    if (installedChannelRelease) {
      return {
        channel: installedChannel,
        release: installedChannelRelease,
      };
    }
  }

  const prerelease = getAvailableCoreRelease(releases, 'prerelease');

  if (prerelease) {
    return {
      channel: 'prerelease' as const,
      release: prerelease,
    };
  }

  const stable = getAvailableCoreRelease(releases, 'stable');

  if (stable) {
    return {
      channel: 'stable' as const,
      release: stable,
    };
  }

  return null;
}

export function getCoreVersionValue(status: QortiumCoreStatus | null) {
  if (!status) {
    return t('common.checking');
  }

  if (!status.supported) {
    return t('common.unavailable');
  }

  if (status.installed) {
    return status.installed.tagName;
  }

  return status.runtime.running ? t('common.detected') : t('common.notInstalled');
}

export function getCoreReleaseBusyAction(channel: QortiumCoreChannel | null | undefined) {
  if (channel === 'stable') {
    return 'installing-stable' as const;
  }

  if (channel === 'prerelease') {
    return 'installing-prerelease' as const;
  }

  return null;
}

export function getHomeUpdateStatusText({
  downloadedUpdate,
  isChecking,
  isDownloading,
  message,
  environment,
  result,
}: {
  downloadedUpdate: QortiumAppUpdateDownloadResult | null;
  environment: QortiumAppUpdateEnvironment | null;
  isChecking: boolean;
  isDownloading: boolean;
  message: { kind: 'error' | 'success'; text: string } | null;
  result: QortiumAppUpdateCheckResult | null;
}) {
  if (message?.kind === 'error') {
    return message.text;
  }

  if (isDownloading) {
    return t('common.downloading');
  }

  if (downloadedUpdate?.canOpen) {
    return t('common.downloaded');
  }

  if (isChecking || !environment || !result) {
    return t('common.checking');
  }

  if (result.status === 'available') {
    return t('common.updateAvailable');
  }

  if (result.status === 'up-to-date') {
    return t('common.upToDate');
  }

  if (result.status === 'no-compatible-asset') {
    return t('updates.statusNoCompatibleInstaller');
  }

  if (result.status === 'unsupported') {
    return t('common.unsupported');
  }

  return result.message || t('common.unavailable');
}
