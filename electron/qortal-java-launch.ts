import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

const MAX_VERSION_OUTPUT_BYTES = 64 * 1024;
const VERSION_PROBE_TIMEOUT_MS = 5_000;
const MIN_QORTAL_JAVA_MAJOR = 17;

export interface JavaExecutableFileOperations {
  access(candidate: string, mode?: number): Promise<void>;
  lstat(candidate: string): Promise<{
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }>;
  realpath(candidate: string): Promise<string>;
}

const defaultFileOperations: JavaExecutableFileOperations = {
  access,
  lstat,
  realpath,
};

export interface VerifiedJavaResolutionOptions {
  platform?: NodeJS.Platform;
  fileOperations?: JavaExecutableFileOperations;
  spawnProcess?: typeof spawn;
}

export function isOpenJdkVersionOutput(value: string) {
  return /\bopenjdk\b/i.test(value);
}

export function isSupportedOpenJdkVersionOutput(value: string) {
  const version = /(?:java|openjdk) version\s+"([^"]+)"/i.exec(value)?.[1];
  if (!version || !isOpenJdkVersionOutput(value)) return false;
  const [first, second] = version.split('.');
  const major = first === '1' ? Number(second) : Number(first);
  return Number.isSafeInteger(major) && major >= MIN_QORTAL_JAVA_MAJOR;
}

/** Resolve the exact executable that a shell-free child sees in the supplied environment. */
export async function resolveExecutableOnPath(
  command: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  fileOperations: JavaExecutableFileOperations = defaultFileOperations,
) {
  if (!command.trim() || command.includes('\0')) return null;

  if (platform === 'win32') {
    return resolveWindowsJavaExecutable(command, environment, fileOperations);
  }

  const candidates = command.includes(path.sep)
    ? [path.resolve(command)]
    : (environment.PATH ?? '')
      .split(path.delimiter)
      .filter((entry) => entry.length > 0)
      .map((entry) => path.resolve(entry, command));

  for (const candidate of candidates) {
    try {
      await fileOperations.access(candidate, constants.X_OK);
      return await fileOperations.realpath(candidate);
    } catch {
      // Continue to the next PATH entry.
    }
  }
  return null;
}

function windowsPathEnvironment(environment: NodeJS.ProcessEnv) {
  const entry = Object.entries(environment).find(([key]) => key.toLowerCase() === 'path');
  return entry?.[1] ?? '';
}

async function resolveWindowsJavaExecutable(
  command: string,
  environment: NodeJS.ProcessEnv,
  fileOperations: JavaExecutableFileOperations,
) {
  const pathApi = path.win32;
  const hasSeparator = command.includes('\\') || command.includes('/');
  let candidates: string[];

  if (hasSeparator || pathApi.isAbsolute(command)) {
    if (!pathApi.isAbsolute(command) || pathApi.basename(command).toLowerCase() !== 'java.exe') {
      return null;
    }
    candidates = [pathApi.normalize(command)];
  } else {
    const lowerCommand = command.toLowerCase();
    if (lowerCommand !== 'java' && lowerCommand !== 'java.exe') return null;
    const executableName = 'java.exe';
    candidates = windowsPathEnvironment(environment)
      .split(pathApi.delimiter)
      .filter((entry) => (
        entry.length > 0
        && !entry.includes('\0')
        && pathApi.isAbsolute(entry)
        && pathApi.normalize(entry) === entry
      ))
      .map((entry) => pathApi.resolve(entry, executableName));
  }

  for (const candidate of candidates) {
    try {
      const candidateStatus = await fileOperations.lstat(candidate);
      if (!candidateStatus.isFile() || candidateStatus.isSymbolicLink()) continue;
      await fileOperations.access(candidate, constants.F_OK);
      const canonical = await fileOperations.realpath(candidate);
      if (
        !pathApi.isAbsolute(canonical)
        || canonical.includes('\0')
        || pathApi.normalize(canonical) !== canonical
        || pathApi.basename(canonical).toLowerCase() !== 'java.exe'
      ) continue;
      const canonicalStatus = await fileOperations.lstat(canonical);
      if (!canonicalStatus.isFile() || canonicalStatus.isSymbolicLink()) continue;
      return canonical;
    } catch {
      // Continue to the next PATH entry.
    }
  }
  return null;
}

export async function resolveVerifiedOpenJdkJava(
  command: string,
  environment: NodeJS.ProcessEnv,
  options: VerifiedJavaResolutionOptions = {},
) {
  const executable = await resolveExecutableOnPath(
    command,
    environment,
    options.platform,
    options.fileOperations,
  );
  if (!executable) return null;

  const supported = await new Promise<boolean>((resolve) => {
    const child = (options.spawnProcess ?? spawn)(executable, ['-version'], {
      env: environment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const append = (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > MAX_VERSION_OUTPUT_BYTES) {
        child.kill();
        finish(false);
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', () => finish(false));
    child.once('close', () => finish(isSupportedOpenJdkVersionOutput(Buffer.concat(chunks).toString('utf8'))));
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, VERSION_PROBE_TIMEOUT_MS);
  });
  return supported ? executable : null;
}
