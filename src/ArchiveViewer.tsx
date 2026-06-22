import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { openArchive, UnsupportedArchiveError, type ArchiveEntry } from './archive';
import { FileTree, type FileTreeEntry } from './FileTree';
import { t } from './i18n';
import { saveBytesToFile } from './platform';
import type { QdnDisplaySettings, QdnResource } from './qdn';
import { QdnEntryContent, type SetViewerActionContext } from './QdnViewer';

// Matches the DocumentViewer ceiling — archives are fetched whole before listing.
const ARCHIVE_MAX_BYTES = 100 * 1024 * 1024;
// Bound nested-archive recursion so a crafted archive can't blow the stack/memory.
const MAX_ARCHIVE_DEPTH = 8;

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function isNestedArchiveName(name: string): boolean {
  return /\.(zip|rar)$/i.test(name);
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready';
      entryByPath: Map<string, ArchiveEntry>;
      fileTreeEntries: FileTreeEntry[];
      fileCount: number;
    };

type Selection =
  | { entry: ArchiveEntry; phase: 'loading' }
  | { entry: ArchiveEntry; phase: 'error'; message: string }
  | { entry: ArchiveEntry; phase: 'ready'; bytes: Uint8Array };

// Browses a general ZIP/RAR archive as a collapsible file tree, previewing each
// entry in-place with the matching content viewer (and recursing into nested
// archives, depth-capped). Used both at top level (fetches the resource bytes) and
// recursively for a nested archive entry (bytes provided).
export function ArchiveViewer({
  bytes: providedBytes,
  depth = 0,
  displaySettings,
  onActionContextChange,
  resource,
}: {
  bytes?: Uint8Array;
  depth?: number;
  displaySettings: QdnDisplaySettings;
  onActionContextChange: SetViewerActionContext;
  resource: QdnResource;
}) {
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setLoad({ phase: 'loading' });
    setSelection(null);

    async function run() {
      try {
        let bytes = providedBytes;

        if (!bytes) {
          const result = await window.qortiumHome.qdn.fetchResourceData({
            identifier: resource.identifier,
            maxBytes: ARCHIVE_MAX_BYTES,
            name: resource.name,
            path: resource.path || undefined,
            service: resource.service,
          });

          if (canceled) {
            return;
          }

          if (result.tooLarge) {
            const limit = `${Math.round(ARCHIVE_MAX_BYTES / (1024 * 1024))} MB`;
            setLoad({ phase: 'error', message: t('docViewer.tooLarge', { limit }) });
            return;
          }

          bytes = base64ToBytes(result.data);
        }

        const { entries } = await openArchive(bytes);
        if (canceled) {
          return;
        }

        setLoad({
          phase: 'ready',
          // Key by the normalized path (no trailing slash) so lookups match the
          // paths FileTree emits from buildFileTree.
          entryByPath: new Map(entries.map((entry) => [entry.path.replace(/\/+$/, ''), entry])),
          fileTreeEntries: entries.map((entry) => ({ path: entry.path, dir: entry.dir, size: entry.size })),
          fileCount: entries.filter((entry) => !entry.dir).length,
        });
      } catch (error) {
        if (canceled) {
          return;
        }
        setLoad({
          phase: 'error',
          message:
            error instanceof UnsupportedArchiveError ? t('archive.multiVolumeRar') : t('archive.openFailed'),
        });
      }
    }

    void run();

    return () => {
      canceled = true;
    };
  }, [providedBytes, resource]);

  function entryForPath(path: string): ArchiveEntry | undefined {
    return load.phase === 'ready' ? load.entryByPath.get(path) : undefined;
  }

  async function openPath(path: string) {
    const entry = entryForPath(path);
    if (!entry || entry.dir) {
      return;
    }
    setSelection({ entry, phase: 'loading' });
    try {
      const bytes = await entry.read();
      // The top-level fetch is bounded by ARCHIVE_MAX_BYTES, but an entry's
      // *uncompressed* size (or a nested archive) can be far larger — guard each
      // extracted entry independently so a zip bomb can't exhaust memory.
      if (bytes.length > ARCHIVE_MAX_BYTES) {
        const limit = `${Math.round(ARCHIVE_MAX_BYTES / (1024 * 1024))} MB`;
        setSelection({ entry, phase: 'error', message: t('docViewer.tooLarge', { limit }) });
        return;
      }
      setSelection({ entry, phase: 'ready', bytes });
    } catch {
      setSelection({ entry, phase: 'error', message: t('archive.entryReadFailed') });
    }
  }

  async function downloadPath(path: string) {
    const entry = entryForPath(path);
    if (!entry || entry.dir) {
      return;
    }
    setDownloadError(null);
    try {
      const bytes = await entry.read();
      await saveBytesToFile(entry.name, bytes);
    } catch {
      setDownloadError(t('archive.downloadFailed'));
    }
  }

  if (selection) {
    const back = () => setSelection(null);
    const tooDeep = depth + 1 >= MAX_ARCHIVE_DEPTH;

    return (
      <div className="qdn-archive">
        <div className="qdn-archive__bar">
          <button className="button button--ghost qdn-archive__back" type="button" onClick={back}>
            <ArrowLeft size={16} aria-hidden="true" />
            {t('archive.back')}
          </button>
          <span className="qdn-archive__crumb" title={selection.entry.path}>
            {selection.entry.path}
          </span>
        </div>
        <div className="qdn-archive__entry">
          {selection.phase === 'loading' ? (
            <div className="qdn-viewer__empty qdn-viewer__empty--loading">
              <p className="qdn-viewer__message">{t('viewer.preview.loading')}</p>
            </div>
          ) : selection.phase === 'error' ? (
            <div className="qdn-viewer__empty qdn-viewer__empty--error">
              <p className="qdn-viewer__message">{selection.message}</p>
            </div>
          ) : isNestedArchiveName(selection.entry.name) ? (
            tooDeep ? (
              <div className="qdn-viewer__empty qdn-viewer__empty--ready">
                <p className="qdn-viewer__message">{t('archive.nestedTooDeep')}</p>
              </div>
            ) : (
              <ArchiveViewer
                bytes={selection.bytes}
                depth={depth + 1}
                displaySettings={displaySettings}
                onActionContextChange={onActionContextChange}
                resource={{ ...resource, path: selection.entry.path }}
              />
            )
          ) : (
            <QdnEntryContent
              displaySettings={displaySettings}
              filename={selection.entry.name}
              onActionContextChange={onActionContextChange}
              onBack={back}
              resource={{ ...resource, path: selection.entry.path }}
              source={{ kind: 'bytes', bytes: selection.bytes }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="qdn-archive">
      <div className="qdn-archive__bar">
        <span className="qdn-viewer__type-label">{t('archive.title')}</span>
        {downloadError ? (
          <span className="qdn-archive__count qdn-viewer__message--error">{downloadError}</span>
        ) : load.phase === 'ready' ? (
          <span className="qdn-archive__count">{t('archive.fileCount', { count: String(load.fileCount) })}</span>
        ) : null}
      </div>
      {load.phase === 'loading' ? (
        <div className="qdn-viewer__empty qdn-viewer__empty--loading">
          <p className="qdn-viewer__message">{t('viewer.loadingResource')}</p>
        </div>
      ) : load.phase === 'error' ? (
        <div className="qdn-viewer__empty qdn-viewer__empty--error">
          <p className="qdn-viewer__message">{load.message}</p>
        </div>
      ) : (
        <FileTree
          entries={load.fileTreeEntries}
          defaultOpen={(treeDepth) => treeDepth < 1}
          onOpen={openPath}
          onDownload={downloadPath}
        />
      )}
    </div>
  );
}
