import assert from 'node:assert/strict'
import path from 'node:path'
import { resolvePrivateHomeV2AppUpdateTarget } from './app-update-paths.js'

const root = path.resolve('/private/home/app-updates')
const target = resolvePrivateHomeV2AppUpdateTarget(
  root,
  '../../Qortium Home.AppImage',
  '../../../v2.1.0',
)

assert.equal(target.fileName, '.._.._Qortium_Home.AppImage')
assert.equal(path.resolve(target.finalPath).startsWith(`${root}${path.sep}`), true)
assert.equal(
  target.finalPath,
  path.join(root, '.._.._.._v2.1.0', '.._.._Qortium_Home.AppImage'),
)

console.log('Home 2 private app update path tests passed.')

// --- which install action a downloaded package gets -------------------------
{
  const { downloadedUpdateInstallKind } = await import('./app-update-install-kind.js')
  const appImage = '/home/u/.config/qortium-home/app-updates/v2/Qortium-Home-2.1.0-x86_64.AppImage'
  assert.equal(downloadedUpdateInstallKind(appImage, 'linux', { APPIMAGE: '/home/u/Home.AppImage' }), 'relaunch')
  // Not running from an AppImage (a dev tree, an unpacked build): nothing to replace.
  assert.equal(downloadedUpdateInstallKind(appImage, 'linux', {}), null)
  assert.equal(downloadedUpdateInstallKind(appImage, 'linux', { APPIMAGE: '  ' }), null)
  assert.equal(downloadedUpdateInstallKind('C:\\u\\dl\\Qortium-Home-x64.exe', 'win32', { PORTABLE_EXECUTABLE_FILE: 'C:\\u\\Home.exe' }), 'relaunch')
  assert.equal(downloadedUpdateInstallKind('C:\\u\\dl\\Qortium-Home-x64.exe', 'win32', {}), null)
  assert.equal(downloadedUpdateInstallKind('/Users/u/dl/Qortium-Home-universal.dmg', 'darwin', {}), 'disk-image')
  // The package type must match the platform: an APK on Linux is not installable from Home.
  assert.equal(downloadedUpdateInstallKind('/home/u/dl/Qortium-Home-android-release.apk', 'linux', { APPIMAGE: '/home/u/Home.AppImage' }), null)
  assert.equal(downloadedUpdateInstallKind('/home/u/dl/Qortium-Home.AppImage', 'darwin', {}), null)
}

// --- the relaunched AppImage must not inherit the dying mount ----------------
{
  const { environmentWithoutAppImageMount } = await import('./app-update-install-kind.js')
  const mount = '/tmp/user/1000/.mount_QortiuABCDEF'
  const scrubbed = environmentWithoutAppImageMount({
    APPDIR: mount,
    APPIMAGE: '/home/u/Home.AppImage',
    ARGV0: '/home/u/Home.AppImage',
    OWD: '/home/u',
    GSETTINGS_SCHEMA_DIR: `${mount}/usr/share/glib-2.0/schemas`,
    LD_LIBRARY_PATH: `${mount}/usr/lib:/home/u/.local/lib`,
    PATH: `${mount}:${mount}/usr/sbin:/usr/local/bin:/usr/bin`,
    XDG_DATA_DIRS: `${mount}/usr/share/:/usr/share`,
    DISPLAY: ':0',
    HOME: '/home/u',
  })
  assert.equal(scrubbed.APPDIR, undefined)
  assert.equal(scrubbed.ARGV0, undefined)
  assert.equal(scrubbed.OWD, undefined)
  assert.equal(scrubbed.GSETTINGS_SCHEMA_DIR, undefined, 'a value that was only the mount is dropped')
  assert.equal(scrubbed.LD_LIBRARY_PATH, '/home/u/.local/lib')
  assert.equal(scrubbed.PATH, '/usr/local/bin:/usr/bin')
  assert.equal(scrubbed.XDG_DATA_DIRS, '/usr/share')
  assert.equal(scrubbed.DISPLAY, ':0')
  assert.equal(scrubbed.HOME, '/home/u')
  // APPIMAGE is left for the caller to set to the new package.
  assert.equal(scrubbed.APPIMAGE, '/home/u/Home.AppImage')
  // No APPDIR: nothing to scrub beyond the runtime's own variables.
  assert.deepEqual(environmentWithoutAppImageMount({ PATH: '/usr/bin', OWD: '/x' }), { PATH: '/usr/bin' })
}

// --- the Windows portable helper --------------------------------------------
{
  const { windowsPortableUpdateHelper } = await import('./app-update-install-kind.js')
  const helper = windowsPortableUpdateHelper({
    pid: 4242,
    downloadedFile: 'C:\\Users\\u\\AppData\\Roaming\\qortium-home\\app-updates\\v2\\Qortium-Home-2.1.0-x64.exe',
    runningFile: 'C:\\Users\\u\\Desktop\\Qortium-Home.exe',
    writable: true,
  })
  const lines = helper.split('\r\n')
  assert.equal(lines[0], '@echo off')
  assert.ok(lines.some((line) => line.includes('PID eq 4242')), 'waits for the running Home pid')
  assert.ok(lines.some((line) => line.startsWith('move /y "C:\\Users\\u\\AppData') && line.includes('"C:\\Users\\u\\Desktop\\Qortium-Home.exe"')), 'moves the download over the running exe')
  assert.ok(lines.some((line) => line === 'start "" "C:\\Users\\u\\Desktop\\Qortium-Home.exe"'), 'starts the replaced exe')
  assert.equal(lines.at(-2), 'del "%~f0"', 'removes itself')
  // Read-only install folder: no move; the download is started where it is.
  const readOnly = windowsPortableUpdateHelper({
    pid: 1, downloadedFile: 'D:\\dl\\new.exe', runningFile: 'C:\\Program Files\\Home.exe', writable: false,
  })
  assert.equal(readOnly.includes('move /y'), false)
  assert.ok(readOnly.includes('start "" "D:\\dl\\new.exe"'))
  // A quote or newline in a path would break out of the argument: refused.
  assert.throws(() => windowsPortableUpdateHelper({ pid: 1, downloadedFile: 'C:\\a"b.exe', runningFile: 'C:\\h.exe', writable: true }), /quote/)
  assert.throws(() => windowsPortableUpdateHelper({ pid: 0, downloadedFile: 'C:\\a.exe', runningFile: 'C:\\h.exe', writable: true }), /process id/)
}
