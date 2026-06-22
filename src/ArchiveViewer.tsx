import { ArrowLeft, ChevronDown, ChevronRight, Download, File as FileIcon, Folder } from 'lucide-react';
import { useEffect, useState } from 'react';
import { openArchive, UnsupportedArchiveError, type ArchiveEntry } from './archive';
import { t } from './i18n';
import { saveBytesToFile } from './platform';
import { formatByteSize, type QdnDisplaySettings, type QdnResource } from './qdn';
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

type TreeNode = {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  entry?: ArchiveEntry;
  children: TreeNode[];
};

// Build a directory tree from the flat entry list, synthesizing intermediate
// folders from file paths (archives don't always store explicit dir entries).
function buildTree(entries: ArchiveEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', dir: true, size: 0, children: [] };
  const dirs = new Map<string, TreeNode>([['', root]]);

  function ensureDir(path: string): TreeNode {
    const existing = dirs.get(path);
    if (existing) {
      return existing;
    }
    const slash = path.lastIndexOf('/');
    const parentPath = slash >= 0 ? path.slice(0, slash) : '';
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    const node: TreeNode = { name, path, dir: true, size: 0, children: [] };
    ensureDir(parentPath).children.push(node);
    dirs.set(path, node);
    return node;
  }

  for (const entry of entries) {
    const path = entry.path.replace(/\/+$/, '');
    if (!path) {
      continue;
    }
    if (entry.dir) {
      ensureDir(path);
      continue;
    }
    const slash = path.lastIndexOf('/');
    const parentPath = slash >= 0 ? path.slice(0, slash) : '';
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    ensureDir(parentPath).children.push({ name, path, dir: false, size: entry.size, entry, children: [] });
  }

  function sortNode(node: TreeNode) {
    node.children.sort((a, b) =>
      a.dir !== b.dir
        ? a.dir
          ? -1
          : 1
        : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    );
    node.children.forEach(sortNode);
  }
  sortNode(root);

  return root.children;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; tree: TreeNode[]; fileCount: number };

type Selection =
  | { entry: ArchiveEntry; phase: 'loading' }
  | { entry: ArchiveEntry; phase: 'error'; message: string }
  | { entry: ArchiveEntry; phase: 'ready'; bytes: Uint8Array };

function ArchiveTreeRow({
  node,
  depth,
  onOpen,
  onDownload,
}: {
  node: TreeNode;
  depth: number;
  onOpen: (entry: ArchiveEntry) => void;
  onDownload: (entry: ArchiveEntry) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const indent = { paddingLeft: `${depth * 16 + 8}px` };

  if (node.dir) {
    return (
      <div className="qdn-archive__node">
        <button
          className="qdn-archive__row qdn-archive__row--dir"
          style={indent}
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          <Folder size={14} aria-hidden="true" />
          <span className="qdn-archive__name">{node.name}</span>
        </button>
        {open
          ? node.children.map((child) => (
              <ArchiveTreeRow key={child.path} node={child} depth={depth + 1} onOpen={onOpen} onDownload={onDownload} />
            ))
          : null}
      </div>
    );
  }

  return (
    <div className="qdn-archive__row qdn-archive__row--file" style={indent}>
      <button className="qdn-archive__open" type="button" onClick={() => node.entry && onOpen(node.entry)}>
        <FileIcon size={14} aria-hidden="true" />
        <span className="qdn-archive__name">{node.name}</span>
        {node.size > 0 ? <span className="qdn-archive__size">{formatByteSize(node.size)}</span> : null}
      </button>
      <button
        className="icon-button qdn-archive__download"
        type="button"
        title={t('archive.download')}
        aria-label={t('archive.download')}
        onClick={() => node.entry && onDownload(node.entry)}
      >
        <Download size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

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
          tree: buildTree(entries),
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

  async function openEntry(entry: ArchiveEntry) {
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

  async function downloadEntry(entry: ArchiveEntry) {
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
              bytes={selection.bytes}
              displaySettings={displaySettings}
              filename={selection.entry.name}
              onActionContextChange={onActionContextChange}
              onBack={back}
              parentResource={resource}
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
      <div className="qdn-archive__tree">
        {load.phase === 'loading' ? (
          <div className="qdn-viewer__empty qdn-viewer__empty--loading">
            <p className="qdn-viewer__message">{t('viewer.loadingResource')}</p>
          </div>
        ) : load.phase === 'error' ? (
          <div className="qdn-viewer__empty qdn-viewer__empty--error">
            <p className="qdn-viewer__message">{load.message}</p>
          </div>
        ) : (
          load.tree.map((node) => (
            <ArchiveTreeRow key={node.path} node={node} depth={0} onOpen={openEntry} onDownload={downloadEntry} />
          ))
        )}
      </div>
    </div>
  );
}
