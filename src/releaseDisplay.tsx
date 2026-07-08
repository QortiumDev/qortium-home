import { ArrowRight, ExternalLink, FolderOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { compareAppVersions } from './appUpdates';
import { t } from './i18n';

const HOME_RELEASE_TAG_BASE_URL = 'https://github.com/QortiumDev/qortium-home/releases/tag';
const CORE_RELEASE_TAG_BASE_URL = 'https://github.com/QortiumDev/qortium-core/releases/tag';

export type DetailRow = {
  label: string;
  path?: string;
  value?: ReactNode;
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

export function getCoreReleaseUrl(version: string | null | undefined) {
  const tagName = formatReleaseTag(version);

  if (!tagName) {
    return '';
  }

  return `${CORE_RELEASE_TAG_BASE_URL}/${encodeURIComponent(tagName)}`;
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

export function ReleaseNotesValue({
  children,
  className = '',
  product,
  tagName,
  onOpenReleaseNotes,
}: {
  children: string;
  className?: string;
  product: 'core' | 'home';
  tagName: string;
  onOpenReleaseNotes: (product: 'core' | 'home', tagName: string) => void;
}) {
  if (!tagName) {
    return <>{children}</>;
  }

  return (
    <span className={`release-notes-value${className ? ` ${className}` : ''}`}>
      <span className="release-notes-value__text">{children}</span>
      <button
        aria-label={t('releaseNotes.open')}
        className="icon-button release-notes-value__button"
        title={t('releaseNotes.open')}
        type="button"
        onClick={() => onOpenReleaseNotes(product, tagName)}
      >
        <ArrowRight aria-hidden="true" size={15} strokeWidth={2} />
      </button>
    </span>
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
      <FolderOpen aria-hidden="true" size={13} strokeWidth={2} />
    </button>
  );
}

export function RevealValue({
  children,
  className = 'value-link',
  path,
  title,
}: {
  children: string;
  className?: string;
  path: string;
  title?: string;
}) {
  return (
    <button
      className={className}
      title={title ?? t('common.revealItem', { target: children })}
      type="button"
      onClick={() => {
        void window.qortiumHome.system?.revealPath(path);
      }}
    >
      <span>{children}</span>
      <FolderOpen aria-hidden="true" size={13} strokeWidth={2} />
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

  // The build commit is parsed from the running core's /admin/info buildVersion,
  // so it is only known while the core is running. Append it as a build suffix
  // (e.g. "v1.1.0-b886a78") so the exact running build is identifiable.
  const commit = status.runtime.runningCommit?.trim();
  const withCommit = (tag: string) => (commit ? `${tag}-${commit}` : tag);

  // The installed jar tag is the most specific identifier, so prefer it. When
  // the jar metadata is gone but a core is still running, fall back to the
  // version reported by the running core API so the user still sees something
  // useful (and can tell it apart from "not installed").
  if (status.installed) {
    return withCommit(status.installed.tagName);
  }

  if (status.runtime.running) {
    if (status.runtime.runningVersion) {
      return withCommit(formatReleaseTag(status.runtime.runningVersion));
    }

    return t('common.detected');
  }

  return t('common.notInstalled');
}

function commitsMatch(first: string | null | undefined, second: string | null | undefined) {
  const a = first?.trim().toLowerCase();
  const b = second?.trim().toLowerCase();

  if (!a || !b) {
    return false;
  }

  return a.startsWith(b) || b.startsWith(a);
}

type CoreLatestEntry = {
  label: string;
  source: 'github' | 'qdn';
  tagName?: string;
  url?: string;
};

// Builds the "Latest" detail rows for the Core, annotated by source. Shows only
// the newer of the GitHub and QDN releases, unless both point at the same commit
// — in which case both are shown so the user can choose where to install from.
export function getCoreLatestRows({
  installedTagName,
  linkClassName,
  onOpenReleaseNotes,
  onChain,
  release,
}: {
  installedTagName: string | null | undefined;
  linkClassName?: string;
  onOpenReleaseNotes?: (product: 'core' | 'home', tagName: string) => void;
  onChain: QortiumCoreOnChainUpdateStatus | null;
  release: AvailableCoreReleaseSummary | null;
}): DetailRow[] {
  const showGithub = !!release && !areReleaseTagsEqual(release.tagName, installedTagName);
  const showQdn = !!onChain?.updateAvailable;
  const sameCommit = !!release && !!onChain && commitsMatch(release.commit, onChain.commitHash);

  // Show the build commit suffix alongside the GitHub release tag (e.g.
  // "v1.1.0-b886a78"), matching how the running Core version is displayed.
  const githubLabel = release
    ? release.commit
      ? `${release.tagName}-${release.commit.slice(0, 7)}`
      : release.tagName
    : '';
  const githubEntry: CoreLatestEntry | null = release
    ? { label: githubLabel, source: 'github', tagName: release.tagName, url: release.htmlUrl || undefined }
    : null;
  const qdnCommitLabel = onChain?.commitHash ? onChain.commitHash.slice(0, 7) : t('common.available');
  const qdnEntry: CoreLatestEntry | null = onChain
    ? { label: sameCommit && release ? githubLabel : qdnCommitLabel, source: 'qdn' }
    : null;

  let entries: CoreLatestEntry[] = [];

  if (showGithub && showQdn && githubEntry && qdnEntry) {
    if (sameCommit) {
      entries = [githubEntry, qdnEntry];
    } else {
      const githubTime = release ? Date.parse(release.publishedAt) : Number.NaN;
      // Use only the available update's timestamp — never the running build's
      // (currentBuildTimestamp), which would make the QDN update look older and
      // wrongly drop it. Unknown QDN time falls through to showing both rows.
      const qdnTime = onChain?.updateTimestamp ?? Number.NaN;

      entries =
        Number.isFinite(githubTime) && Number.isFinite(qdnTime)
          ? githubTime >= qdnTime
            ? [githubEntry]
            : [qdnEntry]
          : [githubEntry, qdnEntry];
    }
  } else if (showGithub && githubEntry) {
    entries = [githubEntry];
  } else if (showQdn && qdnEntry) {
    entries = [qdnEntry];
  }

  return entries.map((entry) => ({
    label: entry.source === 'github' ? t('common.latestGithub') : t('common.latestQdn'),
    value: entry.source === 'github' && entry.tagName && onOpenReleaseNotes ? (
      <ReleaseNotesValue
        product="core"
        tagName={entry.tagName}
        onOpenReleaseNotes={onOpenReleaseNotes}
      >
        {entry.label}
      </ReleaseNotesValue>
    ) : entry.url ? (
      <LinkedValue className={linkClassName} url={entry.url}>
        {entry.label}
      </LinkedValue>
    ) : (
      entry.label
    ),
  }));
}

export function getCoreVersionRowValue(status: QortiumCoreStatus | null, linkClassName?: string): ReactNode {
  const text = getCoreVersionValue(status);
  const jarPath = status?.runtime.jarPath ?? status?.installed?.jarPath ?? '';

  if (!jarPath) {
    return text;
  }

  return (
    <RevealValue className={linkClassName} path={jarPath}>
      {text}
    </RevealValue>
  );
}

export function getCoreVersionReleaseNotesValue(
  status: QortiumCoreStatus | null,
  linkClassName?: string,
  onOpenReleaseNotes?: (product: 'core' | 'home', tagName: string) => void,
): ReactNode {
  const text = getCoreVersionValue(status);
  const releaseTag = formatReleaseTag(status?.installed?.tagName ?? status?.runtime.runningVersion ?? '');
  const releaseUrl = status?.installed?.htmlUrl || getCoreReleaseUrl(releaseTag);

  if (onOpenReleaseNotes && releaseTag) {
    return (
      <ReleaseNotesValue
        className={linkClassName}
        product="core"
        tagName={releaseTag}
        onOpenReleaseNotes={onOpenReleaseNotes}
      >
        {text}
      </ReleaseNotesValue>
    );
  }

  return (
    <LinkedValue className={linkClassName} url={releaseUrl}>
      {text}
    </LinkedValue>
  );
}

export function getHomeVersionRowValue(
  environment: QortiumAppUpdateEnvironment | null,
  linkClassName?: string,
): ReactNode {
  const tag = formatReleaseTag(environment?.currentVersion);
  const text = tag || t('common.checking');
  // Prefer the install file so the file manager highlights the actual app
  // (e.g. the .AppImage), falling back to the containing directory.
  const revealTarget = environment?.installFile || environment?.installDir || '';

  if (!revealTarget) {
    return text;
  }

  return (
    <RevealValue className={linkClassName} path={revealTarget}>
      {text}
    </RevealValue>
  );
}

export function getHomeVersionReleaseNotesValue(
  environment: QortiumAppUpdateEnvironment | null,
  linkClassName?: string,
  onOpenReleaseNotes?: (product: 'core' | 'home', tagName: string) => void,
): ReactNode {
  const tag = formatReleaseTag(environment?.currentVersion);
  const text = tag || t('common.checking');

  if (onOpenReleaseNotes && tag) {
    return (
      <ReleaseNotesValue
        className={linkClassName}
        product="home"
        tagName={tag}
        onOpenReleaseNotes={onOpenReleaseNotes}
      >
        {text}
      </ReleaseNotesValue>
    );
  }

  return (
    <LinkedValue className={linkClassName} url={getHomeReleaseUrl(tag)}>
      {text}
    </LinkedValue>
  );
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
