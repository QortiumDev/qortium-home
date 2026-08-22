import path from 'node:path';

export type QortalProcessClassification =
  | { kind: 'other' }
  | {
      canonicalJarPath: string;
      kind: 'qortal-direct-jar';
      rawJarArgument: string;
      rawSettingsArgument: string | null;
      selected: boolean;
    }
  | {
      helper: 'apply-bootstrap' | 'apply-restart' | 'apply-update' | 'new-qortal-jar';
      kind: 'qortal-updater-helper';
    };

export type QortalProcessPathOperations = {
  realpath(targetPath: string): Promise<string>;
};

type PathApi = typeof path.posix;

/** Host-independent path semantics let native collectors be fixture-tested anywhere. */
export function getQortalProcessPathApi(platform: NodeJS.Platform): PathApi {
  return platform === 'win32' ? path.win32 : path.posix;
}

function normalizeWindowsExtendedPath(value: string) {
  const normalized = path.win32.normalize(value);
  if (normalized.toLowerCase().startsWith('\\\\?\\unc\\')) return `\\\\${normalized.slice(8)}`;
  if (normalized.startsWith('\\\\?\\')) return normalized.slice(4);
  return normalized;
}

function normalizeCanonicalPath(value: string, platform: NodeJS.Platform) {
  if (platform === 'win32') return normalizeWindowsExtendedPath(value).toLowerCase();
  return path.posix.normalize(value);
}

function helperClassification(
  argv: readonly string[],
  platform: NodeJS.Platform,
): QortalProcessClassification | null {
  const pathApi = getQortalProcessPathApi(platform);
  for (const argument of argv) {
    const className = argument.toLowerCase();
    if (className === 'applybootstrap' || className === 'org.qortal.applybootstrap') {
      return { helper: 'apply-bootstrap', kind: 'qortal-updater-helper' };
    }
    if (className === 'applyupdate' || className === 'org.qortal.applyupdate') {
      return { helper: 'apply-update', kind: 'qortal-updater-helper' };
    }
    if (className === 'applyrestart' || className === 'org.qortal.applyrestart') {
      return { helper: 'apply-restart', kind: 'qortal-updater-helper' };
    }
    if (pathApi.basename(argument).toLowerCase() === 'new-qortal.jar') {
      return { helper: 'new-qortal-jar', kind: 'qortal-updater-helper' };
    }
  }
  return null;
}

export function isPotentialQortalProcess(
  argv: readonly string[],
  platform: NodeJS.Platform,
) {
  if (helperClassification(argv, platform)) return true;
  const jarFlagIndex = argv.indexOf('-jar');
  // Any Java -jar process is plausible until its argument is canonicalized:
  // the selected qortal.jar can be launched through an arbitrary symlink name.
  return jarFlagIndex >= 0 && !!argv[jarFlagIndex + 1];
}

export async function classifyQortalProcess(input: {
  argv: readonly string[];
  canonicalCwd: string;
  canonicalSelectedJarPath: string;
  operations: QortalProcessPathOperations;
  platform: NodeJS.Platform;
}): Promise<QortalProcessClassification> {
  const { argv, canonicalCwd, canonicalSelectedJarPath, operations, platform } = input;
  const helper = helperClassification(argv, platform);
  if (helper) return helper;

  const jarFlagIndex = argv.indexOf('-jar');
  const rawJarArgument = jarFlagIndex >= 0 ? argv[jarFlagIndex + 1] ?? '' : '';
  if (!rawJarArgument) return { kind: 'other' };

  const pathApi = getQortalProcessPathApi(platform);
  const lexicalJarPath = pathApi.isAbsolute(rawJarArgument)
    ? pathApi.resolve(rawJarArgument)
    : pathApi.resolve(canonicalCwd, rawJarArgument);
  const selectedLexically = normalizeCanonicalPath(lexicalJarPath, platform) ===
    normalizeCanonicalPath(canonicalSelectedJarPath, platform);
  const canonicalJarPath = await operations.realpath(lexicalJarPath);
  const selected = normalizeCanonicalPath(canonicalJarPath, platform) ===
    normalizeCanonicalPath(canonicalSelectedJarPath, platform);
  if (!selectedLexically && !selected && pathApi.basename(rawJarArgument).toLowerCase() !== 'qortal.jar') {
    return { kind: 'other' };
  }

  return {
    canonicalJarPath,
    kind: 'qortal-direct-jar',
    rawJarArgument,
    rawSettingsArgument: argv[jarFlagIndex + 2] ?? null,
    selected,
  };
}
