import type { PromiseFsClient, ReadCommitResult } from 'isomorphic-git';

const VIRTUAL_ROOT = '/repo';
const MAX_REPOSITORY_PATHS = 10_000;
const MAX_PATH_BYTES = 1_024;
const MAX_GIT_FILE_BYTES = 16 * 1024 * 1024;
const MAX_CACHED_BYTES = 100 * 1024 * 1024;
const MAX_COMMIT_MESSAGE_CHARS = 10_000;
const MAX_COMMIT_SUMMARY_CHARS = 240;
const MAX_AUTHOR_CHARS = 240;
export const MAX_GIT_HISTORY_DEPTH = 50;

type GitModule = typeof import('./qdnGitClient');

export type QdnGitLayout = {
  gitdir: string;
  kind: 'bare' | 'worktree';
};

export type QdnGitCommit = {
  author: string;
  authoredAt: number | null;
  message: string;
  oid: string;
  summary: string;
};

export type QdnGitOverview = {
  branches: string[];
  currentBranch: string | null;
};

export type QdnGitFileResult = {
  contentLength?: number;
  data: string;
  tooLarge?: boolean;
};

export type QdnGitFileFetcher = (path: string, maxBytes: number) => Promise<QdnGitFileResult>;

type FsError = Error & { code: string };

type VirtualStat = {
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
  size: number;
};

let gitModulePromise: Promise<GitModule> | null = null;

function loadGitModule(): Promise<GitModule> {
  gitModulePromise ??= import('./qdnGitClient');
  return gitModulePromise;
}

function fsError(code: string, message: string): FsError {
  return Object.assign(new Error(message), { code });
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function normalizePublishedPath(path: string): string {
  if (
    !path ||
    path.includes('\0') ||
    path.includes('\\') ||
    path.startsWith('/') ||
    new TextEncoder().encode(path).length > MAX_PATH_BYTES
  ) {
    throw new Error(`Unsafe Git repository path: ${path}`);
  }

  const segments = path.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe Git repository path: ${path}`);
  }

  return segments.join('/');
}

function normalizeVirtualPath(path: string): string {
  const normalized = path.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  if (normalized === VIRTUAL_ROOT) {
    return '';
  }
  if (!normalized.startsWith(`${VIRTUAL_ROOT}/`)) {
    throw fsError('EACCES', `Path is outside the Git repository: ${path}`);
  }
  return normalizePublishedPath(normalized.slice(VIRTUAL_ROOT.length + 1));
}

function isTextEncoding(options: unknown): boolean {
  if (typeof options === 'string') {
    return options !== 'buffer';
  }
  return Boolean(
    options &&
      typeof options === 'object' &&
      'encoding' in options &&
      typeof options.encoding === 'string' &&
      options.encoding !== 'buffer',
  );
}

function makeStat(directory: boolean, size = 0): VirtualStat {
  return {
    isDirectory: () => directory,
    isFile: () => !directory,
    isSymbolicLink: () => false,
    size,
  };
}

function validateRefName(name: string): string {
  if (!name || new TextEncoder().encode(name).length > MAX_PATH_BYTES || /[\0-\x1f\x7f]/.test(name)) {
    throw new Error('Git repository contains an unsafe ref name.');
  }
  return name;
}

export function detectGitRepositoryLayout(files: string[]): QdnGitLayout | null {
  const paths = new Set(files);
  const hasObjects = (prefix: string) =>
    files.some((path) => path.startsWith(`${prefix}objects/`) && path.length > `${prefix}objects/`.length);

  if (paths.has('.git/HEAD') && hasObjects('.git/')) {
    return { gitdir: `${VIRTUAL_ROOT}/.git`, kind: 'worktree' };
  }
  if (paths.has('HEAD') && hasObjects('')) {
    return { gitdir: VIRTUAL_ROOT, kind: 'bare' };
  }
  return null;
}

export class QdnGitRepositoryReader {
  readonly fs: PromiseFsClient;
  readonly layout: QdnGitLayout;

  private readonly cache = new Map<string, Promise<Uint8Array>>();
  private readonly directories = new Set<string>(['']);
  private readonly files: Set<string>;
  private readonly fetchFile: QdnGitFileFetcher;
  private cachedBytes = 0;

  constructor(paths: string[], fetchFile: QdnGitFileFetcher) {
    if (paths.length > MAX_REPOSITORY_PATHS) {
      throw new Error(`Git repository contains more than ${MAX_REPOSITORY_PATHS.toLocaleString()} paths.`);
    }

    const normalizedPaths = paths.map(normalizePublishedPath);
    if (new Set(normalizedPaths).size !== normalizedPaths.length) {
      throw new Error('Git repository contains duplicate paths.');
    }

    const layout = detectGitRepositoryLayout(normalizedPaths);
    if (!layout) {
      throw new Error('The published files do not contain a Git repository.');
    }

    this.files = new Set(normalizedPaths);
    this.fetchFile = fetchFile;
    this.layout = layout;

    for (const path of normalizedPaths) {
      const segments = path.split('/');
      for (let index = 1; index < segments.length; index += 1) {
        this.directories.add(segments.slice(0, index).join('/'));
      }
    }

    const readOnly = async () => {
      throw fsError('EROFS', 'The QDN Git filesystem is read-only.');
    };

    this.fs = {
      promises: {
        chmod: readOnly,
        lstat: (path: string) => this.stat(path),
        mkdir: readOnly,
        readFile: (path: string, options?: unknown) => this.readFile(path, options),
        readlink: async () => {
          throw fsError('EINVAL', 'QDN Git repository entries are not filesystem symlinks.');
        },
        readdir: (path: string) => this.readdir(path),
        rmdir: readOnly,
        stat: (path: string) => this.stat(path),
        symlink: readOnly,
        unlink: readOnly,
        writeFile: readOnly,
      },
    };
  }

  async getOverview(): Promise<QdnGitOverview> {
    const git = await loadGitModule();
    const [branches, currentBranch] = await Promise.all([
      git.listBranches({ fs: this.fs, gitdir: this.layout.gitdir }),
      git.currentBranch({ fs: this.fs, gitdir: this.layout.gitdir, fullname: false }),
    ]);

    return {
      branches: branches.map(validateRefName).sort((left, right) => left.localeCompare(right)),
      currentBranch: currentBranch ? validateRefName(currentBranch) : null,
    };
  }

  async getHistory(ref: string, depth = MAX_GIT_HISTORY_DEPTH): Promise<QdnGitCommit[]> {
    const git = await loadGitModule();
    const commits = await git.log({
      depth: Math.max(1, Math.min(depth, MAX_GIT_HISTORY_DEPTH)),
      fs: this.fs,
      gitdir: this.layout.gitdir,
      ref,
    });
    return commits.map(toQdnGitCommit);
  }

  async listFiles(commitOid: string): Promise<string[]> {
    const git = await loadGitModule();
    const paths = await git.listFiles({ fs: this.fs, gitdir: this.layout.gitdir, ref: commitOid });
    if (paths.length > MAX_REPOSITORY_PATHS) {
      throw new Error(`Commit contains more than ${MAX_REPOSITORY_PATHS.toLocaleString()} files.`);
    }
    const normalizedPaths = paths.map(normalizePublishedPath);
    if (new Set(normalizedPaths).size !== normalizedPaths.length) {
      throw new Error('Commit contains duplicate paths.');
    }
    return normalizedPaths;
  }

  async readBlob(commitOid: string, filepath: string): Promise<Uint8Array> {
    normalizePublishedPath(filepath);
    const git = await loadGitModule();
    const result = await git.readBlob({
      filepath,
      fs: this.fs,
      gitdir: this.layout.gitdir,
      oid: commitOid,
    });
    if (result.blob.length > MAX_GIT_FILE_BYTES) {
      throw fsError('EFBIG', 'Git blob exceeds the in-memory preview limit.');
    }
    return new Uint8Array(result.blob);
  }

  private async getBytes(path: string): Promise<Uint8Array> {
    const existing = this.cache.get(path);
    if (existing) {
      return existing;
    }

    const pending = (async () => {
      const result = await this.fetchFile(path, MAX_GIT_FILE_BYTES);
      if (result.tooLarge) {
        throw fsError('EFBIG', `Git repository file exceeds ${MAX_GIT_FILE_BYTES} bytes: ${path}`);
      }
      const bytes = base64ToBytes(result.data);
      if (bytes.length > MAX_GIT_FILE_BYTES || this.cachedBytes + bytes.length > MAX_CACHED_BYTES) {
        throw fsError('EFBIG', 'Git repository exceeds the in-memory viewer limit.');
      }
      this.cachedBytes += bytes.length;
      return bytes;
    })();

    this.cache.set(path, pending);
    pending.catch(() => this.cache.delete(path));
    return pending;
  }

  private async readFile(path: string, options?: unknown): Promise<Uint8Array | string> {
    const relative = normalizeVirtualPath(path);
    if (!this.files.has(relative)) {
      throw fsError('ENOENT', `Git repository file not found: ${relative}`);
    }
    const bytes = await this.getBytes(relative);
    return isTextEncoding(options) ? new TextDecoder().decode(bytes) : bytes;
  }

  private async readdir(path: string): Promise<string[]> {
    const relative = normalizeVirtualPath(path);
    if (!this.directories.has(relative)) {
      throw fsError(this.files.has(relative) ? 'ENOTDIR' : 'ENOENT', `Directory not found: ${relative}`);
    }

    const prefix = relative ? `${relative}/` : '';
    const children = new Set<string>();
    for (const entry of [...this.files, ...this.directories]) {
      if (!entry.startsWith(prefix) || entry === relative) {
        continue;
      }
      const child = entry.slice(prefix.length).split('/')[0];
      if (child) {
        children.add(child);
      }
    }
    return [...children].sort((left, right) => left.localeCompare(right));
  }

  private async stat(path: string): Promise<VirtualStat> {
    const relative = normalizeVirtualPath(path);
    if (this.directories.has(relative)) {
      return makeStat(true);
    }
    if (this.files.has(relative)) {
      const cached = this.cache.get(relative);
      const size = cached ? (await cached).length : 0;
      return makeStat(false, size);
    }
    throw fsError('ENOENT', `Git repository path not found: ${relative}`);
  }
}

function toQdnGitCommit(result: ReadCommitResult): QdnGitCommit {
  const message = result.commit.message.trimEnd().slice(0, MAX_COMMIT_MESSAGE_CHARS);
  const summary = (message.split(/\r?\n/, 1)[0] || result.oid).slice(0, MAX_COMMIT_SUMMARY_CHARS);
  return {
    author: (result.commit.author.name || result.commit.author.email).slice(0, MAX_AUTHOR_CHARS),
    authoredAt: Number.isFinite(result.commit.author.timestamp) ? result.commit.author.timestamp : null,
    message,
    oid: result.oid,
    summary,
  };
}
