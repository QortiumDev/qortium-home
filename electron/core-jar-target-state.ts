import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  readCoreJarIdentityUncached,
  type CoreJarIdentity,
} from './core-jar-identity.js';

type JarStat = {
  dev: number;
  ino: number;
  isDirectory(): boolean;
  isFile(): boolean;
  mtimeMs: number;
  size: number;
};

export type CoreJarTargetState =
  | {
      canonicalPath: string;
      kind: 'missing';
      parentDev: number;
      parentIno: number;
    }
  | {
      canonicalPath: string;
      dev: number;
      identity: CoreJarIdentity | null;
      ino: number;
      kind: 'file';
      mtimeMs: number;
      sha256: string;
      size: number;
    };

export type CoreJarTargetStateOperations = {
  hashFile(targetPath: string): Promise<string>;
  lstat(targetPath: string): Promise<JarStat>;
  readIdentity(targetPath: string): Promise<CoreJarIdentity | null>;
  realpath(targetPath: string): Promise<string>;
};

const DEFAULT_OPERATIONS: CoreJarTargetStateOperations = {
  async hashFile(targetPath) {
    const hash = createHash('sha256');

    for await (const chunk of createReadStream(targetPath)) {
      hash.update(chunk as Buffer);
    }

    return `sha256:${hash.digest('hex')}`;
  },
  lstat,
  readIdentity: readCoreJarIdentityUncached,
  realpath,
};

function getErrorCode(error: unknown) {
  return error instanceof Error && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function fileIdentity(stats: JarStat) {
  return {
    dev: stats.dev,
    ino: stats.ino,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

function fileStatsMatch(first: JarStat, second: JarStat) {
  return (
    first.isFile() &&
    second.isFile() &&
    first.dev === second.dev &&
    first.ino === second.ino &&
    first.mtimeMs === second.mtimeMs &&
    first.size === second.size
  );
}

export async function readCoreJarTargetState(
  targetPath: string,
  options: { operations?: Partial<CoreJarTargetStateOperations> } = {},
): Promise<CoreJarTargetState> {
  const operations: CoreJarTargetStateOperations = {
    ...DEFAULT_OPERATIONS,
    ...options.operations,
  };
  const resolvedTarget = path.resolve(targetPath);
  let initialStats: JarStat;

  try {
    initialStats = await operations.lstat(resolvedTarget);
  } catch (error) {
    if (getErrorCode(error) !== 'ENOENT') {
      throw error;
    }

    const canonicalParent = await operations.realpath(path.dirname(resolvedTarget));
    const parentStats = await operations.lstat(canonicalParent);

    if (!parentStats.isDirectory()) {
      throw new Error('The Core JAR target parent must be a directory.');
    }

    const canonicalPath = path.join(canonicalParent, path.basename(resolvedTarget));

    try {
      await operations.lstat(canonicalPath);
      throw new Error('The Core JAR target appeared while its missing state was being inspected.');
    } catch (finalError) {
      if (getErrorCode(finalError) !== 'ENOENT') throw finalError;
    }

    return {
      canonicalPath,
      kind: 'missing',
      parentDev: parentStats.dev,
      parentIno: parentStats.ino,
    };
  }

  if (!initialStats.isFile()) {
    throw new Error('The Core JAR target must be absent or a regular file, not a symlink or directory.');
  }

  const canonicalPath = await operations.realpath(resolvedTarget);
  const canonicalStats = await operations.lstat(canonicalPath);

  if (!fileStatsMatch(initialStats, canonicalStats)) {
    throw new Error('The Core JAR target changed while its canonical path was resolved.');
  }

  const sha256 = await operations.hashFile(canonicalPath);
  const afterHashStats = await operations.lstat(canonicalPath);

  if (!fileStatsMatch(canonicalStats, afterHashStats)) {
    throw new Error('The Core JAR target changed while it was being fingerprinted.');
  }

  const identity = await operations.readIdentity(canonicalPath);
  const finalStats = await operations.lstat(canonicalPath);

  if (!fileStatsMatch(afterHashStats, finalStats)) {
    throw new Error('The Core JAR target changed while it was being fingerprinted.');
  }

  if (!/^sha256:[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('The Core JAR fingerprint operation returned an invalid SHA-256 digest.');
  }

  return {
    canonicalPath,
    ...fileIdentity(finalStats),
    identity,
    kind: 'file',
    sha256,
  };
}

export function coreJarTargetStatesMatch(
  first: CoreJarTargetState,
  second: CoreJarTargetState,
  platform: NodeJS.Platform = process.platform,
) {
  const normalizePath = (value: string) =>
    platform === 'win32' ? value.toLowerCase() : value;

  if (
    first.kind !== second.kind ||
    normalizePath(first.canonicalPath) !== normalizePath(second.canonicalPath)
  ) {
    return false;
  }

  if (first.kind === 'missing' && second.kind === 'missing') {
    return first.parentDev === second.parentDev && first.parentIno === second.parentIno;
  }

  if (first.kind === 'file' && second.kind === 'file') {
    return (
      first.dev === second.dev &&
      first.ino === second.ino &&
      first.mtimeMs === second.mtimeMs &&
      first.size === second.size &&
      first.sha256 === second.sha256 &&
      JSON.stringify(first.identity) === JSON.stringify(second.identity)
    );
  }

  return false;
}
