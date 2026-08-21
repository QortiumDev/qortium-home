import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import path from 'node:path';

const MAX_VERSION_OUTPUT_BYTES = 64 * 1024;
const VERSION_PROBE_TIMEOUT_MS = 5_000;
const MIN_QORTAL_JAVA_MAJOR = 17;

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
) {
  if (platform === 'win32' || !command.trim()) return null;
  const candidates = command.includes(path.sep)
    ? [path.resolve(command)]
    : (environment.PATH ?? '')
      .split(path.delimiter)
      .filter((entry) => entry.length > 0)
      .map((entry) => path.resolve(entry, command));

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return await realpath(candidate);
    } catch {
      // Continue to the next PATH entry.
    }
  }
  return null;
}

export async function resolveVerifiedOpenJdkJava(
  command: string,
  environment: NodeJS.ProcessEnv,
) {
  const executable = await resolveExecutableOnPath(command, environment);
  if (!executable) return null;

  const supported = await new Promise<boolean>((resolve) => {
    const child = spawn(executable, ['-version'], {
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
