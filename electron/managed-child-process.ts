import path from 'node:path';

const APPIMAGE_MARKER_KEYS = ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD'] as const;
const APPIMAGE_PATH_LIST_KEYS = [
  'GIO_EXTRA_MODULES',
  'GTK_PATH',
  'LD_LIBRARY_PATH',
  'PATH',
  'QML2_IMPORT_PATH',
  'QT_PLUGIN_PATH',
  'XDG_DATA_DIRS',
] as const;
const APPIMAGE_SINGLE_PATH_KEYS = ['GSETTINGS_SCHEMA_DIR'] as const;

function isInsidePath(candidate: string, root: string) {
  if (!candidate || !path.isAbsolute(candidate)) return false;
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function withoutAppDirEntries(value: string, appDir: string) {
  return value
    .split(path.delimiter)
    .filter((entry) => !isInsidePath(entry, appDir))
    .join(path.delimiter);
}

/**
 * AppImage augments its own environment so Electron can find bundled libraries
 * and resources. Managed Core and i2pd deliberately outlive Home, so carrying
 * those paths into them keeps the temporary FUSE mount busy after Home exits.
 */
export function sanitizeManagedChildEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment = { ...source };
  const appDir = source.APPDIR?.trim();
  const isAppImage = !!appDir || !!source.APPIMAGE?.trim();

  if (!isAppImage) return environment;

  for (const key of APPIMAGE_MARKER_KEYS) delete environment[key];
  if (!appDir || !path.isAbsolute(appDir)) return environment;

  for (const key of APPIMAGE_PATH_LIST_KEYS) {
    const value = environment[key];
    if (typeof value !== 'string') continue;
    const filtered = withoutAppDirEntries(value, appDir);
    if (filtered) environment[key] = filtered;
    else delete environment[key];
  }
  for (const key of APPIMAGE_SINGLE_PATH_KEYS) {
    const value = environment[key];
    if (typeof value === 'string' && isInsidePath(value, appDir)) {
      delete environment[key];
    }
  }

  return environment;
}

const CLOSE_INHERITED_FDS_SCRIPT = [
  'for descriptor_path in /proc/self/fd/*; do',
  'descriptor=${descriptor_path##*/};',
  'case "$descriptor" in ""|*[!0-9]*) continue ;; esac;',
  'if [ "$descriptor" -gt 2 ]; then eval "exec ${descriptor}>&-" 2>/dev/null || true; fi;',
  'done;',
  'exec "$@"',
].join(' ');

export interface ManagedChildCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * Electron/AppImage can have resource descriptors without close-on-exec set.
 * A detached native process would inherit them even with stdio ignored. The
 * Bash closes every inherited descriptor above stderr, then execs the service
 * in the same PID so existing supervision and pidfiles keep working. Closing
 * only file-backed mount descriptors is insufficient: the AppImage runtime's
 * control pipe also has to reach EOF before its FUSE helper can exit.
 */
export function prepareManagedLongLivedCommand(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  appDir: string | undefined = process.env.APPDIR,
): ManagedChildCommand {
  if (platform !== 'linux' || !appDir || !path.isAbsolute(appDir)) {
    return { command, args: [...args] };
  }
  return {
    // POSIX sh implementations such as dash only accept single-digit file
    // descriptor numbers in redirections. Electron routinely keeps AppImage
    // resources on descriptors such as 37 and 1023, so use Bash here.
    command: '/bin/bash',
    args: [
      '-c',
      CLOSE_INHERITED_FDS_SCRIPT,
      'qortium-home-managed-child',
      command,
      ...args,
    ],
  };
}
