import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { compareAppVersions } from './appUpdates';
import { t } from './i18n';
import type { ReleaseNotesRoute } from './routes';

type ReleaseNotesState =
  | { kind: 'loading' }
  | { kind: 'loaded'; body: string; htmlUrl: string; name: string; publishedAt: string }
  | { kind: 'error'; message: string };

type ReleaseListItem = {
  htmlUrl: string;
  name: string;
  publishedAt: string;
  tagName: string;
};

type DownloadStatus = { kind: 'error' | 'success'; message: string } | null;

type ReleaseLinkHandler = (url: string) => void;

type GithubReleaseResponse = {
  body?: unknown;
  html_url?: unknown;
  name?: unknown;
  published_at?: unknown;
  tag_name?: unknown;
};

function getRepoName(product: ReleaseNotesRoute['product']) {
  return product === 'home' ? 'qortium-home' : 'qortium-core';
}

function getProductLabel(product: ReleaseNotesRoute['product']) {
  return product === 'home' ? 'Qortium Home' : 'Qortium Core';
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRelease(value: GithubReleaseResponse, fallbackTag: string) {
  const htmlUrl = getString(value.html_url);
  const name = getString(value.name) || fallbackTag;
  const body = getString(value.body) || t('releaseNotes.empty');
  const publishedAt = getString(value.published_at);

  return { body, htmlUrl, name, publishedAt };
}

function normalizeReleaseListItem(value: GithubReleaseResponse): ReleaseListItem | null {
  const tagName = getString(value.tag_name);

  if (!tagName) {
    return null;
  }

  return {
    htmlUrl: getString(value.html_url),
    name: getString(value.name) || tagName,
    publishedAt: getString(value.published_at),
    tagName,
  };
}

function formatPublishedAt(value: string) {
  if (!value) {
    return '';
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

async function requestGithubJson(pathname: string) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });

  if (!response.ok) {
    throw new Error(`GitHub returned HTTP ${response.status}.`);
  }

  return response.json() as Promise<unknown>;
}

async function fetchReleaseNotes(route: ReleaseNotesRoute) {
  const data = await requestGithubJson(
    `/repos/QortiumDev/${getRepoName(route.product)}/releases/tags/${encodeURIComponent(route.tagName)}`,
  );

  return normalizeRelease(data as GithubReleaseResponse, route.tagName);
}

async function fetchReleaseList(product: ReleaseNotesRoute['product']) {
  const data = await requestGithubJson(`/repos/QortiumDev/${getRepoName(product)}/releases?per_page=100`);

  return Array.isArray(data)
    ? data
        .map((entry) => normalizeReleaseListItem(entry as GithubReleaseResponse))
        .filter((entry): entry is ReleaseListItem => !!entry)
    : [];
}

function getHighestRelease(releases: ReleaseListItem[]) {
  return releases.reduce<ReleaseListItem | null>((highestRelease, release) => {
    if (!highestRelease) {
      return release;
    }

    const comparison = compareAppVersions(release.tagName, highestRelease.tagName);

    return comparison !== null && comparison > 0 ? release : highestRelease;
  }, null);
}

function openExternalUrl(url: string) {
  if (!/^https?:\/\//i.test(url)) {
    return;
  }

  void window.qortiumHome.updates.openReleasePage(url);
}

const DIRECT_DOWNLOAD_EXTENSIONS = [
  '.aab',
  '.apk',
  '.appimage',
  '.deb',
  '.dmg',
  '.exe',
  '.jar',
  '.pkg',
  '.rpm',
  '.tar.gz',
  '.tgz',
  '.zip',
];

function getGithubReleaseDownload(url: string) {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  if (parsedUrl.hostname !== 'github.com') {
    return null;
  }

  const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
  const downloadIndex = pathParts.findIndex((part, index) => part === 'download' && pathParts[index - 1] === 'releases');

  if (downloadIndex < 0 || pathParts.length < downloadIndex + 3) {
    return null;
  }

  const fileName = decodeURIComponent(pathParts[pathParts.length - 1] || '').trim();
  const releaseTag = decodeURIComponent(pathParts[downloadIndex + 1] || '').trim();
  const lowerFileName = fileName.toLowerCase();
  const isDownloadAsset = DIRECT_DOWNLOAD_EXTENSIONS.some((extension) => lowerFileName.endsWith(extension));

  return fileName && releaseTag && isDownloadAsset ? { fileName, releaseTag } : null;
}

function getUnsupportedDownloadPlatform(): QortiumAppUpdatePlatform {
  return {
    arch: 'unknown',
    label: 'Release asset',
    os: 'unsupported',
    supported: false,
  };
}

function renderUrlLink(url: string, onOpenLink: ReleaseLinkHandler, label = url, key?: string) {
  return (
    <button
      className="release-notes-page__link"
      key={key ?? url}
      title={t('common.openItem', { target: url })}
      type="button"
      onClick={() => onOpenLink(url)}
    >
      {label}
    </button>
  );
}

function renderRawLinks(text: string, keyPrefix: string, onOpenLink: ReleaseLinkHandler): ReactNode[] {
  const nodes: ReactNode[] = [];
  const urlPattern = /https?:\/\/[^\s<)]+/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = urlPattern.exec(text))) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }

    nodes.push(renderUrlLink(match[0], onOpenLink, match[0], `${keyPrefix}-url-${match.index}`));
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function renderCodeAndRawLinks(text: string, keyPrefix: string, onOpenLink: ReleaseLinkHandler): ReactNode[] {
  const nodes: ReactNode[] = [];
  const codePattern = /`([^`]+)`/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = codePattern.exec(text))) {
    if (match.index > cursor) {
      nodes.push(...renderRawLinks(text.slice(cursor, match.index), `${keyPrefix}-text-${cursor}`, onOpenLink));
    }

    nodes.push(
      <code className="release-notes-page__inline-code" key={`${keyPrefix}-code-${match.index}`}>
        {match[1]}
      </code>,
    );
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    nodes.push(...renderRawLinks(text.slice(cursor), `${keyPrefix}-text-${cursor}`, onOpenLink));
  }

  return nodes;
}

function renderInlineMarkdown(text: string, keyPrefix: string, onOpenLink: ReleaseLinkHandler): ReactNode[] {
  const nodes: ReactNode[] = [];
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(text))) {
    if (match.index > cursor) {
      nodes.push(...renderCodeAndRawLinks(text.slice(cursor, match.index), `${keyPrefix}-text-${cursor}`, onOpenLink));
    }

    nodes.push(renderUrlLink(match[2], onOpenLink, match[1], `${keyPrefix}-md-${match.index}`));
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    nodes.push(...renderCodeAndRawLinks(text.slice(cursor), `${keyPrefix}-text-${cursor}`, onOpenLink));
  }

  return nodes;
}

function renderReleaseBody(body: string, onOpenLink: ReleaseLinkHandler) {
  return body.split(/\r?\n/).map((line, index) => {
    const key = `line-${index}`;
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);

    if (heading) {
      const HeadingTag = heading[1].length <= 2 ? 'h2' : 'h3';

      return (
        <HeadingTag className="release-notes-page__body-heading" key={key}>
          {renderInlineMarkdown(heading[2], key, onOpenLink)}
        </HeadingTag>
      );
    }

    if (!line.trim()) {
      return <span aria-hidden="true" className="release-notes-page__spacer" key={key} />;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(line);

    if (bullet) {
      return (
        <p className="release-notes-page__line release-notes-page__line--bullet" key={key}>
          <span aria-hidden="true">•</span>
          <span>{renderInlineMarkdown(bullet[1], key, onOpenLink)}</span>
        </p>
      );
    }

    return (
      <p className="release-notes-page__line" key={key}>
        {renderInlineMarkdown(line, key, onOpenLink)}
      </p>
    );
  });
}

export function ReleaseNotesPage({
  onOpenReleaseNotes,
  route,
}: {
  onOpenReleaseNotes: (product: 'core' | 'home', tagName: string) => void;
  route: ReleaseNotesRoute;
}) {
  const [state, setState] = useState<ReleaseNotesState>({ kind: 'loading' });
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>(null);
  const [releases, setReleases] = useState<ReleaseListItem[]>([]);
  const [releaseListError, setReleaseListError] = useState<string | null>(null);

  useEffect(() => {
    let isDisposed = false;

    setState({ kind: 'loading' });
    setDownloadStatus(null);
    fetchReleaseNotes(route)
      .then((release) => {
        if (!isDisposed) {
          setState({ kind: 'loaded', ...release });
        }
      })
      .catch((error: unknown) => {
        if (!isDisposed) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : t('releaseNotes.loadFailed'),
          });
        }
      });

    return () => {
      isDisposed = true;
    };
  }, [route.product, route.tagName]);

  useEffect(() => {
    let isDisposed = false;

    setReleaseListError(null);
    fetchReleaseList(route.product)
      .then((nextReleases) => {
        if (!isDisposed) {
          setReleases(nextReleases);
        }
      })
      .catch((error: unknown) => {
        if (!isDisposed) {
          setReleaseListError(error instanceof Error ? error.message : t('releaseNotes.loadFailed'));
        }
      });

    return () => {
      isDisposed = true;
    };
  }, [route.product]);

  const releaseOptions = useMemo(() => {
    if (releases.some((release) => release.tagName === route.tagName)) {
      return releases;
    }

    return [
      {
        htmlUrl: state.kind === 'loaded' ? state.htmlUrl : '',
        name: state.kind === 'loaded' ? state.name : route.tagName,
        publishedAt: state.kind === 'loaded' ? state.publishedAt : '',
        tagName: route.tagName,
      },
      ...releases,
    ];
  }, [releases, route.tagName, state]);

  const currentIndex = releaseOptions.findIndex((release) => release.tagName === route.tagName);
  const newerRelease = currentIndex > 0 ? releaseOptions[currentIndex - 1] : null;
  const olderRelease =
    currentIndex >= 0 && currentIndex < releaseOptions.length - 1 ? releaseOptions[currentIndex + 1] : null;
  const productLabel = getProductLabel(route.product);
  const publishedAt = state.kind === 'loaded' ? formatPublishedAt(state.publishedAt) : '';

  async function openReleaseLink(url: string) {
    const downloadAsset = getGithubReleaseDownload(url);

    if (!downloadAsset) {
      openExternalUrl(url);
      return;
    }

    try {
      setDownloadStatus(null);
      const downloadedAsset = await window.qortiumHome.updates.downloadReleaseAsset({
        asset: {
          digest: null,
          downloadUrl: url,
          name: downloadAsset.fileName,
          size: 0,
        },
        platform: getUnsupportedDownloadPlatform(),
        releaseTag: downloadAsset.releaseTag,
      });

      setDownloadStatus({
        kind: 'success',
        message: t('updates.downloadedFile', { fileName: downloadedAsset.fileName }),
      });
    } catch (error) {
      if (error instanceof Error && /canceled/i.test(error.message)) {
        return;
      }

      setDownloadStatus({ kind: 'error', message: t('archive.downloadFailed') });
    }
  }

  function handleReleaseLink(url: string) {
    void openReleaseLink(url);
  }

  async function handleProductChange(product: ReleaseNotesRoute['product']) {
    if (product === route.product) {
      return;
    }

    try {
      setReleaseListError(null);
      const targetReleases = await fetchReleaseList(product);
      const exactRelease = targetReleases.find((release) => release.tagName === route.tagName);
      const fallbackRelease = exactRelease ?? getHighestRelease(targetReleases);

      if (fallbackRelease) {
        onOpenReleaseNotes(product, fallbackRelease.tagName);
      }
    } catch (error) {
      setReleaseListError(error instanceof Error ? error.message : t('releaseNotes.loadFailed'));
    }
  }

  return (
    <section className="release-notes-page" aria-label={t('releaseNotes.ariaLabel', { product: productLabel })}>
      <header className="release-notes-page__header">
        <div className="release-notes-page__version-controls">
          <select
            aria-label={t('releaseNotes.productLabel')}
            className="field__input release-notes-page__product-select"
            value={route.product}
            onChange={(event) => {
              void handleProductChange(event.target.value as ReleaseNotesRoute['product']);
            }}
          >
            <option value="home">{getProductLabel('home')}</option>
            <option value="core">{getProductLabel('core')}</option>
          </select>
          <select
            aria-label={t('releaseNotes.versionLabel')}
            className="field__input release-notes-page__version-select"
            value={route.tagName}
            onChange={(event) => onOpenReleaseNotes(route.product, event.target.value)}
          >
            {releaseOptions.map((release) => (
              <option key={release.tagName} value={release.tagName}>
                {release.tagName}
              </option>
            ))}
          </select>
          {olderRelease ? (
            <button
              aria-label={t('releaseNotes.older')}
              className="icon-button"
              title={t('releaseNotes.older')}
              type="button"
              onClick={() => onOpenReleaseNotes(route.product, olderRelease.tagName)}
            >
              <ChevronLeft aria-hidden="true" size={18} strokeWidth={2} />
            </button>
          ) : null}
          {newerRelease ? (
            <button
              aria-label={t('releaseNotes.newer')}
              className="icon-button"
              title={t('releaseNotes.newer')}
              type="button"
              onClick={() => onOpenReleaseNotes(route.product, newerRelease.tagName)}
            >
              <ChevronRight aria-hidden="true" size={18} strokeWidth={2} />
            </button>
          ) : null}
        </div>
        {state.kind === 'loaded' && state.htmlUrl ? (
          <button
            className="button button--secondary"
            type="button"
            onClick={() => openExternalUrl(state.htmlUrl)}
          >
            <ExternalLink aria-hidden="true" size={18} strokeWidth={2} />
            {t('releaseNotes.openGithub')}
          </button>
        ) : null}
      </header>

      {releaseListError ? <p className="release-notes-page__status">{releaseListError}</p> : null}
      {downloadStatus ? (
        <p
          className={`release-notes-page__status${
            downloadStatus.kind === 'error' ? ' release-notes-page__status--error' : ''
          }`}
          role={downloadStatus.kind === 'error' ? 'alert' : 'status'}
        >
          {downloadStatus.message}
        </p>
      ) : null}

      {state.kind === 'loading' ? (
        <p className="release-notes-page__status" role="status">
          {t('releaseNotes.loading')}
        </p>
      ) : state.kind === 'error' ? (
        <p className="release-notes-page__status release-notes-page__status--error" role="alert">
          {state.message}
        </p>
      ) : (
        <>
          <section className="release-notes-page__title-block">
            <h1>
              <span>{productLabel}</span>
              <span>{route.tagName}</span>
              {publishedAt ? <span>{publishedAt}</span> : null}
            </h1>
          </section>
          <article className="release-notes-page__body" aria-label={state.name}>
            {renderReleaseBody(state.body, handleReleaseLink)}
          </article>
        </>
      )}
    </section>
  );
}
