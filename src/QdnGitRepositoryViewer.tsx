import { ArrowLeft, GitBranch, History } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileTree, type FileTreeEntry } from './FileTree';
import { t } from './i18n';
import {
  QdnGitRepositoryReader,
  type QdnGitCommit,
  type QdnGitOverview,
} from './qdnGitRepository';
import type { QdnDisplaySettings, QdnResource } from './qdn';
import { QdnEntryContent, type SetViewerActionContext } from './QdnViewer';

type AsyncState<T> =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; value: T };

type BlobSelection =
  | { path: string; phase: 'loading' }
  | { path: string; phase: 'error'; message: string }
  | { bytes: Uint8Array; path: string; phase: 'ready' };

function pathBasename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function formatCommitDate(timestamp: number | null): string {
  if (timestamp === null) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(timestamp * 1_000),
  );
}

export function QdnGitRepositoryViewer({
  displaySettings,
  files,
  onActionContextChange,
  onCloseRoutedFile,
  onFallback,
  resource,
}: {
  displaySettings: QdnDisplaySettings;
  files: string[];
  onActionContextChange: SetViewerActionContext;
  onCloseRoutedFile?: () => void;
  onFallback: (message: string) => void;
  resource: QdnResource;
}) {
  const readerResult = useMemo(() => {
    try {
      return {
        reader: new QdnGitRepositoryReader(files, async (path, maxBytes) =>
          window.qortiumHome.qdn.fetchResourceData({
            identifier: resource.identifier,
            maxBytes,
            name: resource.name,
            path,
            service: resource.service,
          }),
        ),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [files, resource.identifier, resource.name, resource.service]);

  const [overview, setOverview] = useState<AsyncState<QdnGitOverview>>({ phase: 'loading' });
  const [branch, setBranch] = useState('');
  const [history, setHistory] = useState<AsyncState<QdnGitCommit[]>>({ phase: 'idle' });
  const [commitOid, setCommitOid] = useState('');
  const [tree, setTree] = useState<AsyncState<FileTreeEntry[]>>({ phase: 'idle' });
  const [selection, setSelection] = useState<BlobSelection | null>(null);
  const initialRouteHandledRef = useRef('');
  const blobRequestRef = useRef(0);

  const reader = 'reader' in readerResult ? readerResult.reader : null;
  const initialRoutePath = useMemo(
    () => (resource.path ?? '').split('?')[0]?.replace(/^\/+/, '') ?? '',
    [resource.path],
  );
  const initialRouteKey = `${resource.service}:${resource.name}:${resource.identifier ?? 'default'}:${initialRoutePath}`;

  useEffect(() => {
    if ('error' in readerResult && readerResult.error) {
      onFallback(readerResult.error);
      return;
    }
    if (!reader) {
      return;
    }

    let canceled = false;
    blobRequestRef.current += 1;
    setOverview({ phase: 'loading' });
    void reader
      .getOverview()
      .then((value) => {
        if (canceled) return;
        setOverview({ phase: 'ready', value });
        setBranch(value.currentBranch ?? value.branches[0] ?? '');
      })
      .catch((error) => {
        if (canceled) return;
        onFallback(error instanceof Error ? error.message : String(error));
      });
    return () => {
      canceled = true;
    };
  }, [onFallback, reader, readerResult]);

  useEffect(() => {
    if (!reader || !branch) {
      setHistory({ phase: branch ? 'loading' : 'idle' });
      setCommitOid('');
      return;
    }

    let canceled = false;
    blobRequestRef.current += 1;
    setHistory({ phase: 'loading' });
    setCommitOid('');
    setSelection(null);
    void reader
      .getHistory(branch)
      .then((value) => {
        if (canceled) return;
        setHistory({ phase: 'ready', value });
        setCommitOid(value[0]?.oid ?? '');
      })
      .catch((error) => {
        if (!canceled) {
          onFallback(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      canceled = true;
    };
  }, [branch, onFallback, reader]);

  useEffect(() => {
    if (!reader || !commitOid) {
      setTree({ phase: 'idle' });
      return;
    }

    let canceled = false;
    blobRequestRef.current += 1;
    setTree({ phase: 'loading' });
    setSelection(null);
    void reader
      .listFiles(commitOid)
      .then(async (paths) => {
        if (canceled) return;
        setTree({ phase: 'ready', value: paths.map((path) => ({ path, dir: false })) });

        if (
          initialRoutePath &&
          initialRouteHandledRef.current !== initialRouteKey &&
          paths.includes(initialRoutePath)
        ) {
          initialRouteHandledRef.current = initialRouteKey;
          const requestId = ++blobRequestRef.current;
          setSelection({ path: initialRoutePath, phase: 'loading' });
          try {
            const bytes = await reader.readBlob(commitOid, initialRoutePath);
            if (!canceled && requestId === blobRequestRef.current) {
              setSelection({ bytes, path: initialRoutePath, phase: 'ready' });
            }
          } catch (error) {
            if (!canceled && requestId === blobRequestRef.current) {
              setSelection({
                message: error instanceof Error ? error.message : String(error),
                path: initialRoutePath,
                phase: 'error',
              });
            }
          }
        }
      })
      .catch((error) => {
        if (!canceled) {
          setTree({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      canceled = true;
    };
  }, [commitOid, initialRouteKey, initialRoutePath, reader]);

  useEffect(() => {
    if (!selection) {
      onActionContextChange({ isMultiFile: true });
    } else if (selection.phase !== 'ready') {
      onActionContextChange({ hideDownload: true });
    }
  }, [onActionContextChange, selection]);

  const onHistoricalActionContextChange = useCallback<SetViewerActionContext>(
    (context) => onActionContextChange({ ...context, hideDownload: true }),
    [onActionContextChange],
  );

  // Keep the byte-backed entry viewer inputs stable. Its preview effects key on
  // these objects, and recreating them during action-context updates would keep
  // restarting the text decode instead of ever reaching the ready state.
  const selectedResource = useMemo(
    () => (selection ? { ...resource, path: selection.path } : resource),
    [resource, selection?.path],
  );
  const selectedSource = useMemo(
    () => (selection?.phase === 'ready' ? { bytes: selection.bytes, kind: 'bytes' as const } : null),
    [selection],
  );

  async function openPath(path: string) {
    if (!reader || !commitOid) return;
    const requestId = ++blobRequestRef.current;
    setSelection({ path, phase: 'loading' });
    try {
      const bytes = await reader.readBlob(commitOid, path);
      if (requestId === blobRequestRef.current) {
        setSelection({ bytes, path, phase: 'ready' });
      }
    } catch (error) {
      if (requestId === blobRequestRef.current) {
        setSelection({
          message: error instanceof Error ? error.message : String(error),
          path,
          phase: 'error',
        });
      }
    }
  }

  function closeSelection() {
    blobRequestRef.current += 1;
    if (initialRoutePath && onCloseRoutedFile) {
      onCloseRoutedFile();
    } else {
      setSelection(null);
    }
  }

  if (overview.phase !== 'ready') {
    return (
      <div className="qdn-viewer__empty qdn-viewer__empty--loading">
        <p className="qdn-viewer__message">{t('viewer.loadingResource')}</p>
      </div>
    );
  }

  const commits = history.phase === 'ready' ? history.value : [];
  const shortOid = commitOid.slice(0, 8);

  return (
    <div className="qdn-git">
      <div className="qdn-git__bar">
        <span className="qdn-viewer__type-label">
          <GitBranch size={15} aria-hidden="true" />
          {t('repository.gitTitle')}
        </span>
        <label className="qdn-git__branch">
          <span>{t('repository.branch')}</span>
          <select value={branch} onChange={(event) => setBranch(event.target.value)}>
            {overview.value.branches.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {history.phase === 'ready' ? (
          <span className="qdn-archive__count">
            {t('repository.commitCount', { count: String(commits.length) })}
          </span>
        ) : null}
      </div>

      {!branch || (history.phase === 'ready' && commits.length === 0) ? (
        <div className="qdn-viewer__empty qdn-viewer__empty--ready">
          <p className="qdn-viewer__message">{t('repository.noCommits')}</p>
        </div>
      ) : (
        <div className="qdn-git__body">
          <aside className="qdn-git__history" aria-label={t('repository.commitHistory')}>
            <div className="qdn-git__section-title">
              <History size={14} aria-hidden="true" />
              {t('repository.commitHistory')}
            </div>
            {history.phase === 'loading' ? (
              <p className="qdn-viewer__message qdn-git__message">{t('viewer.loadingResource')}</p>
            ) : (
              commits.map((commit) => (
                <button
                  className={`qdn-git__commit${commit.oid === commitOid ? ' qdn-git__commit--selected' : ''}`}
                  key={commit.oid}
                  type="button"
                  title={commit.message}
                  onClick={() => setCommitOid(commit.oid)}
                >
                  <span className="qdn-git__commit-summary">{commit.summary}</span>
                  <span className="qdn-git__commit-meta">
                    {commit.author} · {formatCommitDate(commit.authoredAt)}
                  </span>
                  <code>{commit.oid.slice(0, 8)}</code>
                </button>
              ))
            )}
          </aside>

          <section className="qdn-git__files">
            <div className="qdn-git__section-title">
              {selection ? (
                <button className="button button--ghost qdn-archive__back" type="button" onClick={closeSelection}>
                  <ArrowLeft size={16} aria-hidden="true" />
                  {t('archive.back')}
                </button>
              ) : null}
              <span title={selection?.path ?? commitOid}>
                {selection?.path ?? t('repository.filesAtCommit', { commit: shortOid })}
              </span>
            </div>
            {selection ? (
              <div className="qdn-git__preview">
                {selection.phase === 'loading' ? (
                  <div className="qdn-viewer__empty qdn-viewer__empty--loading">
                    <p className="qdn-viewer__message">{t('viewer.preview.loading')}</p>
                  </div>
                ) : selection.phase === 'error' ? (
                  <div className="qdn-viewer__empty qdn-viewer__empty--error">
                    <p className="qdn-viewer__message">{selection.message}</p>
                  </div>
                ) : selectedSource ? (
                  <QdnEntryContent
                    displaySettings={displaySettings}
                    filename={pathBasename(selection.path)}
                    onActionContextChange={onHistoricalActionContextChange}
                    onBack={closeSelection}
                    resource={selectedResource}
                    source={selectedSource}
                  />
                ) : null}
              </div>
            ) : tree.phase === 'loading' || tree.phase === 'idle' ? (
              <div className="qdn-viewer__empty qdn-viewer__empty--loading">
                <p className="qdn-viewer__message">{t('viewer.loadingResource')}</p>
              </div>
            ) : tree.phase === 'error' ? (
              <div className="qdn-viewer__empty qdn-viewer__empty--error">
                <p className="qdn-viewer__message">{tree.message}</p>
              </div>
            ) : (
              <FileTree entries={tree.value} defaultOpen={(depth) => depth === 0} onOpen={openPath} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
