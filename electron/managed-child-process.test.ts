import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  prepareManagedLongLivedCommand,
  sanitizeManagedChildEnvironment,
} from './managed-child-process.js';

const appDir = '/tmp/user/1000/.mount_QortiumFixture';
const source = {
  APPDIR: appDir,
  APPIMAGE: '/opt/Qortium-Home.AppImage',
  ARGV0: '/opt/Qortium-Home.AppImage',
  OWD: '/opt',
  GSETTINGS_SCHEMA_DIR: `${appDir}/usr/share/glib-2.0/schemas`,
  LD_LIBRARY_PATH: `${appDir}/usr/lib:/opt/operator/lib`,
  PATH: `/managed/java/bin:${appDir}:${appDir}/usr/sbin:/usr/bin`,
  XDG_DATA_DIRS: `${appDir}/usr/share:/home/user/.local/share:/usr/share`,
  QORTIUM_HOME_SETTING: 'preserved',
};

const sanitized = sanitizeManagedChildEnvironment(source);
assert.equal(sanitized.APPDIR, undefined);
assert.equal(sanitized.APPIMAGE, undefined);
assert.equal(sanitized.ARGV0, undefined);
assert.equal(sanitized.OWD, undefined);
assert.equal(sanitized.GSETTINGS_SCHEMA_DIR, undefined);
assert.equal(sanitized.LD_LIBRARY_PATH, '/opt/operator/lib');
assert.equal(sanitized.PATH, '/managed/java/bin:/usr/bin');
assert.equal(sanitized.XDG_DATA_DIRS, '/home/user/.local/share:/usr/share');
assert.equal(sanitized.QORTIUM_HOME_SETTING, 'preserved');
assert.equal(source.APPDIR, appDir, 'the caller environment is not mutated');

assert.deepEqual(
  sanitizeManagedChildEnvironment({ PATH: '/usr/bin', OWD: '/work' }),
  { PATH: '/usr/bin', OWD: '/work' },
  'ordinary development environments remain unchanged',
);

const linuxCommand = prepareManagedLongLivedCommand(
  '/opt/i2pd',
  ['--datadir=/data path', '--conf=/conf'],
  'linux',
  appDir,
);
assert.equal(linuxCommand.command, '/bin/bash');
assert.deepEqual(linuxCommand.args.slice(-3), [
  '/opt/i2pd',
  '--datadir=/data path',
  '--conf=/conf',
]);
assert.match(linuxCommand.args[1], /\/proc\/self\/fd/);
assert.match(linuxCommand.args[1], /exec "\$@"/);

const testFilePath = fileURLToPath(import.meta.url);
const testAppDir = path.dirname(testFilePath);
const appImageFd = openSync(testFilePath, 'r');
const unrelatedFd = openSync('/etc/hosts', 'r');
try {
  const highFd = 37;
  const stdio = Array(highFd + 1).fill('ignore');
  stdio[1] = 'pipe';
  stdio[2] = 'pipe';
  stdio[3] = appImageFd;
  stdio[4] = unrelatedFd;
  stdio[highFd] = appImageFd;
  const probe = prepareManagedLongLivedCommand(
    '/bin/sh',
    ['-c', 'test ! -e /proc/self/fd/3 && test ! -e /proc/self/fd/4 && test ! -e /proc/self/fd/37'],
    'linux',
    testAppDir,
  );
  const result = spawnSync(probe.command, probe.args, {
    stdio,
  });
  assert.equal(
    result.status,
    0,
    `the managed child inherited an Electron descriptor: ${result.stderr.toString()}`,
  );
} finally {
  closeSync(appImageFd);
  closeSync(unrelatedFd);
}

assert.deepEqual(
  prepareManagedLongLivedCommand('/opt/i2pd', ['--conf=/conf'], 'linux', undefined),
  { command: '/opt/i2pd', args: ['--conf=/conf'] },
  'ordinary Linux development runs do not need a shell wrapper',
);

assert.deepEqual(
  prepareManagedLongLivedCommand('C:\\i2pd.exe', ['--conf=C:\\conf'], 'win32'),
  { command: 'C:\\i2pd.exe', args: ['--conf=C:\\conf'] },
);

console.log('Managed child-process environment tests passed.');
