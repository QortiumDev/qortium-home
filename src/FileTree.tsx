import { ChevronDown, ChevronRight, Download, File as FileIcon, Folder } from 'lucide-react';
import { useMemo, useState } from 'react';
import { t } from './i18n';
import { formatByteSize } from './qdn';

// A flat file/dir entry, data-source agnostic: the archive browser feeds these
// from in-memory archive entries, the repository browser from metadata file paths.
export type FileTreeEntry = {
  /** Full internal path, e.g. "src/main.rs". */
  path: string;
  /** Whether this entry is a directory. */
  dir: boolean;
  /** Uncompressed size in bytes, when known (omitted for node-served listings). */
  size?: number;
};

type TreeNode = {
  name: string;
  path: string;
  dir: boolean;
  size?: number;
  children: TreeNode[];
};

function basename(path: string): string {
  const normalized = path.replace(/\/+$/, '');
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

// Build a directory tree from a flat entry list, synthesizing intermediate folders
// from file paths (listings don't always include explicit dir entries). Folders
// sort before files; both sort naturally (numeric-aware).
export function buildFileTree(entries: FileTreeEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', dir: true, children: [] };
  const dirs = new Map<string, TreeNode>([['', root]]);

  function ensureDir(path: string): TreeNode {
    const existing = dirs.get(path);
    if (existing) {
      return existing;
    }
    const slash = path.lastIndexOf('/');
    const parentPath = slash >= 0 ? path.slice(0, slash) : '';
    const node: TreeNode = { name: basename(path), path, dir: true, children: [] };
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
    ensureDir(parentPath).children.push({
      name: basename(path),
      path,
      dir: false,
      size: entry.size,
      children: [],
    });
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

function FileTreeRow({
  node,
  depth,
  defaultOpen,
  onOpen,
  onDownload,
}: {
  node: TreeNode;
  depth: number;
  defaultOpen: (depth: number) => boolean;
  onOpen: (path: string) => void;
  onDownload?: (path: string) => void;
}) {
  const [open, setOpen] = useState(() => defaultOpen(depth));
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
              <FileTreeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                defaultOpen={defaultOpen}
                onOpen={onOpen}
                onDownload={onDownload}
              />
            ))
          : null}
      </div>
    );
  }

  return (
    <div className="qdn-archive__row qdn-archive__row--file" style={indent}>
      <button className="qdn-archive__open" type="button" onClick={() => onOpen(node.path)}>
        <FileIcon size={14} aria-hidden="true" />
        <span className="qdn-archive__name">{node.name}</span>
        {typeof node.size === 'number' && node.size > 0 ? (
          <span className="qdn-archive__size">{formatByteSize(node.size)}</span>
        ) : null}
      </button>
      {onDownload ? (
        <button
          className="icon-button qdn-archive__download"
          type="button"
          title={t('archive.download')}
          aria-label={t('archive.download')}
          onClick={() => onDownload(node.path)}
        >
          <Download size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

// Shared collapsible file/directory tree. Used by both the archive browser and the
// GIT repository browser; the caller resolves a clicked path to its own data source
// (in-memory archive entry or a node-served sub-resource).
export function FileTree({
  entries,
  defaultOpen = () => false,
  onOpen,
  onDownload,
}: {
  entries: FileTreeEntry[];
  // Decides whether a folder at a given depth starts expanded. Default collapses
  // every folder (good for large repos); callers can expand shallow levels.
  defaultOpen?: (depth: number) => boolean;
  onOpen: (path: string) => void;
  onDownload?: (path: string) => void;
}) {
  const tree = useMemo(() => buildFileTree(entries), [entries]);

  return (
    <div className="qdn-archive__tree">
      {tree.map((node) => (
        <FileTreeRow
          key={node.path}
          node={node}
          depth={0}
          defaultOpen={defaultOpen}
          onOpen={onOpen}
          onDownload={onDownload}
        />
      ))}
    </div>
  );
}
