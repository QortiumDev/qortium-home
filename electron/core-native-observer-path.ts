import path from 'node:path';

export type CoreNativeObserverPathContext = {
  appPath: string;
  arch: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  resourcesPath: string;
};

export type CoreNativeObserverPathResolution =
  | { executablePath: string; kind: 'resolved' }
  | { kind: 'unknown'; reason: string };

type SupportedTarget = {
  directory: readonly string[];
  executableName: string;
  pathApi: typeof path.posix;
};

function targetFor(platform: NodeJS.Platform, arch: string): SupportedTarget | null {
  if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) {
    return {
      directory: ['macos', arch],
      executableName: 'qortium-core-observer',
      pathApi: path.posix,
    };
  }
  if (platform === 'win32' && arch === 'x64') {
    return {
      directory: ['windows', 'x64'],
      executableName: 'qortium-core-observer.exe',
      pathApi: path.win32,
    };
  }
  return null;
}

function validRoot(root: unknown, pathApi: typeof path.posix): root is string {
  return typeof root === 'string' && root.length > 0 && !root.includes('\0') &&
    pathApi.isAbsolute(root) && pathApi.normalize(root) === root &&
    (root === pathApi.parse(root).root || !root.endsWith(pathApi.sep));
}

/**
 * Resolves the platform observer from explicit Electron paths only. This is a
 * lexical resolver: filesystem existence, ownership, mode, and code-signing
 * checks belong to the native-observer launch boundary.
 */
export function resolveCoreNativeObserverPath(
  context: CoreNativeObserverPathContext,
): CoreNativeObserverPathResolution {
  const target = targetFor(context.platform, context.arch);
  if (!target) {
    return {
      kind: 'unknown',
      reason: `The native Core observer is unsupported on ${context.platform}/${context.arch}.`,
    };
  }
  if (typeof context.isPackaged !== 'boolean') {
    return { kind: 'unknown', reason: 'The Electron packaging state is invalid.' };
  }
  if (!validRoot(context.appPath, target.pathApi)) {
    return { kind: 'unknown', reason: 'The Electron app path is not a canonical absolute path.' };
  }
  if (!validRoot(context.resourcesPath, target.pathApi)) {
    return { kind: 'unknown', reason: 'The Electron resources path is not a canonical absolute path.' };
  }

  const root = context.isPackaged ? context.resourcesPath : context.appPath;
  const prefix = context.isPackaged ? 'native' : '.native-build';
  return {
    executablePath: target.pathApi.join(root, prefix, ...target.directory, target.executableName),
    kind: 'resolved',
  };
}
