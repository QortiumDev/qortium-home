import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { compareAppVersions } from './appUpdates';
import { SETTINGS_TEXT } from './settingsText';

const HOME_RELEASE_TAG_BASE_URL = 'https://github.com/QortiumDev/qortium-home/releases/tag';

export type DetailRow = {
  label: string;
  path?: string;
  value: ReactNode;
};

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
      title={title ?? `Open ${children}`}
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
      title={`Open ${path}`}
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
): QortiumCoreReleaseSummary | null {
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
    return SETTINGS_TEXT.status.checking;
  }

  if (!status.supported) {
    return SETTINGS_TEXT.status.unavailable;
  }

  if (status.installed) {
    return status.installed.tagName;
  }

  return status.runtime.running ? SETTINGS_TEXT.status.detected : SETTINGS_TEXT.status.notInstalled;
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
    return SETTINGS_TEXT.status.downloading;
  }

  if (downloadedUpdate?.canOpen) {
    return SETTINGS_TEXT.status.downloaded;
  }

  if (isChecking || !environment || !result) {
    return SETTINGS_TEXT.status.checking;
  }

  if (result.status === 'available') {
    return SETTINGS_TEXT.status.updateAvailable;
  }

  if (result.status === 'up-to-date') {
    return SETTINGS_TEXT.status.upToDate;
  }

  if (result.status === 'no-compatible-asset') {
    return SETTINGS_TEXT.status.noCompatibleInstaller;
  }

  if (result.status === 'unsupported') {
    return SETTINGS_TEXT.status.unsupported;
  }

  return result.message || SETTINGS_TEXT.status.unavailable;
}
