/**
 * How a downloaded Home package can be installed from inside Home.
 *
 * - `relaunch`: Home can put the new package where the running one is and
 *   restart into it (a Linux AppImage; a Windows portable exe via a helper
 *   that waits for this process to exit, since a running exe cannot be
 *   replaced).
 * - `disk-image`: a macOS DMG. Home mounts it; the user drags the app to
 *   Applications and reopens Home. Replacing an unsigned .app from a DMG
 *   behind the user's back is not attempted -- Gatekeeper and quarantine make
 *   it fragile, and the manual step is what macOS users expect.
 * - null: nothing Home can do beyond showing the file.
 *
 * Pure so it can be tested without Electron: the platform and the two
 * wrapper-provided environment variables are passed in.
 */
import path from 'node:path';

export type DownloadedUpdateInstallKind = 'relaunch' | 'disk-image' | null;

export function downloadedUpdateInstallKind(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
  env: { readonly APPIMAGE?: string; readonly PORTABLE_EXECUTABLE_FILE?: string } = process.env,
): DownloadedUpdateInstallKind {
  const lower = filePath.toLowerCase();
  if (platform === 'linux' && lower.endsWith('.appimage') && env.APPIMAGE?.trim()) {
    return 'relaunch';
  }
  if (platform === 'win32' && lower.endsWith('.exe') && env.PORTABLE_EXECUTABLE_FILE?.trim()) {
    return 'relaunch';
  }
  if (platform === 'darwin' && lower.endsWith('.dmg')) return 'disk-image';
  return null;
}

/**
 * The environment for a relaunched AppImage, with the CURRENT mount scrubbed
 * out. The AppImage's AppRun exports APPDIR, LD_LIBRARY_PATH, PATH,
 * XDG_DATA_DIRS and GSETTINGS_SCHEMA_DIR pointing into /tmp/.mount_XXXX; a
 * child that inherits them looks for its libraries in a mount that is gone
 * once this process exits. The new runtime sets its own. Exported for tests.
 */
export function environmentWithoutAppImageMount(
  env: NodeJS.ProcessEnv,
  appDir = env.APPDIR,
): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = { ...env };
  delete scrubbed.APPDIR;
  delete scrubbed.ARGV0;
  delete scrubbed.OWD;
  if (!appDir) return scrubbed;
  for (const [key, value] of Object.entries(scrubbed)) {
    if (typeof value !== 'string' || !value.includes(appDir)) continue;
    const kept = value
      .split(path.delimiter)
      .filter((entry) => entry && !entry.startsWith(appDir));
    if (kept.length === 0) delete scrubbed[key];
    else scrubbed[key] = kept.join(path.delimiter);
  }
  return scrubbed;
}


// Quoted for a Windows batch file: the paths Home writes here are its own
// (userData and the portable exe location), but a double quote in either
// would still break out of the argument, so it is refused rather than escaped.
function batchQuoted(value: string) {
  if (value.includes('"') || /[\r\n]/.test(value)) {
    throw new Error('A path in the update helper cannot contain a quote or a newline.');
  }
  return `"${value}"`;
}

/**
 * The batch helper that finishes a Windows portable update after Home exits:
 * a running exe cannot be overwritten, so the helper waits for Home's PID
 * to go away, moves the verified download over the running exe (when its
 * folder is writable) and starts it, then removes itself.
 *
 * The portable launcher (the stub that unpacked Home into a temp folder) is a
 * separate process that outlives Home's own PID by a moment and keeps the exe
 * open until it has cleaned up, so the move is retried for up to a minute.
 * If the exe still cannot be replaced, the download is started where it is
 * rather than leaving the user with nothing running. Pure so the text can be
 * checked without Windows.
 */
export function windowsPortableUpdateHelper(options: {
  readonly pid: number;
  readonly downloadedFile: string;
  readonly runningFile: string;
  readonly writable: boolean;
}): string {
  if (!Number.isSafeInteger(options.pid) || options.pid <= 0) {
    throw new Error('The update helper needs the running process id.');
  }
  const downloaded = batchQuoted(options.downloadedFile);
  const running = batchQuoted(options.runningFile);
  const lines = [
    '@echo off',
    'setlocal',
    ':wait',
    `tasklist /FI "PID eq ${options.pid}" 2>nul | find "${options.pid}" >nul`,
    'if not errorlevel 1 (timeout /t 1 /nobreak >nul & goto wait)',
    ...(options.writable
      ? [
          'set tries=0',
          ':move',
          `move /y ${downloaded} ${running} >nul 2>nul`,
          'if not errorlevel 1 goto replaced',
          'set /a tries+=1',
          'if %tries% geq 60 goto fallback',
          'timeout /t 1 /nobreak >nul',
          'goto move',
          ':replaced',
          `start "" ${running}`,
          'goto done',
          ':fallback',
        ]
      : []),
    `start "" ${downloaded}`,
    ':done',
    'del "%~f0"',
  ];
  return `${lines.join('\r\n')}\r\n`;
}
