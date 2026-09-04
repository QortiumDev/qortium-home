import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  observeManagedI2pdProcess,
  parseI2pdLinuxProcessStartTicks,
  type I2pdManagedProcessOperations,
} from './i2pd-managed-process.js';

const BINARY = '/managed/i2pd/versions/current/i2pd';
const RUNTIME = '/managed/i2pd/runtime';
const CONF = `${RUNTIME}/i2pd.conf`;
const PID_PATH = `${RUNTIME}/i2pd.pid`;
const BOOT_ID = '12345678-1234-1234-1234-123456789abc';

function stat(startTicks: string, command = 'i2pd daemon (one)') {
  const fields = ['S', ...Array.from({ length: 18 }, (_, index) => String(index + 1)), startTicks, '0'];
  return `77 (${command}) ${fields.join(' ')}`;
}

assert.equal(parseI2pdLinuxProcessStartTicks(stat('987654')), '987654');
assert.equal(parseI2pdLinuxProcessStartTicks('invalid'), null);
assert.equal(parseI2pdLinuxProcessStartTicks(stat('not-a-number')), null);

type Fixture = Readonly<{
  argv?: readonly string[];
  executable?: string;
  pidContents?: string;
  securePidFileError?: NodeJS.ErrnoException;
  startTicks?: readonly string[];
  userIds?: readonly number[];
}>;

function operations(fixture: Fixture = {}) {
  let startReads = 0;
  let userReads = 0;
  const operationSet: I2pdManagedProcessOperations = {
    getCurrentUserId: () => 1000,
    readBootId: async () => `${BOOT_ID}\n`,
    readProcessArgv: async () => fixture.argv ?? [
      BINARY,
      `--datadir=${RUNTIME}`,
      `--conf=${CONF}`,
    ],
    readProcessExecutable: async () => fixture.executable ?? BINARY,
    readProcessStartTicks: async () => {
      const value = fixture.startTicks?.[startReads] ?? fixture.startTicks?.at(-1) ?? '456';
      startReads += 1;
      return value;
    },
    readProcessUserId: async () => {
      const value = fixture.userIds?.[userReads] ?? fixture.userIds?.at(-1) ?? 1000;
      userReads += 1;
      return value;
    },
    readSecurePidFile: async () => {
      if (fixture.securePidFileError) throw fixture.securePidFileError;
      return fixture.pidContents ?? '77\n';
    },
    realpath: async (targetPath) => targetPath,
  };
  return { operationSet, reads: () => ({ startReads, userReads }) };
}

async function observe(fixture: Fixture = {}, platform: NodeJS.Platform = 'linux') {
  const { operationSet, reads } = operations(fixture);
  const result = await observeManagedI2pdProcess({
    binaryPath: BINARY,
    confPath: CONF,
    operations: operationSet,
    pidPath: PID_PATH,
    platform,
    runtimePath: RUNTIME,
  });
  return { reads: reads(), result };
}

{
  const { reads, result } = await observe();
  assert.deepEqual(result, {
    kind: 'owned',
    process: { pid: 77, startIdentity: `${BOOT_ID}:456` },
  });
  assert.deepEqual(reads, { startReads: 2, userReads: 2 });
}

assert.equal((await observe({}, 'win32')).result.kind, 'unknown');
// Malformed contents name no adoptable process either — same answer as an
// untrusted or missing file, so the panel never goes inert over it.
assert.equal((await observe({ pidContents: '0\n' })).result.kind, 'absent');
assert.equal((await observe({ pidContents: '77 extra\n' })).result.kind, 'absent');
assert.equal((await observe({ executable: '/external/i2pd' })).result.kind, 'absent');
assert.equal((await observe({ userIds: [2000, 2000] })).result.kind, 'absent');
assert.equal((await observe({
  argv: [BINARY, `--datadir=${RUNTIME}`, `--conf=${CONF}`, '--extra'],
})).result.kind, 'absent');
assert.equal((await observe({
  argv: [BINARY, '--datadir=/external', `--conf=${CONF}`],
})).result.kind, 'absent');
assert.equal((await observe({ startTicks: ['456', '457'] })).result.kind, 'unknown');
assert.equal((await observe({ userIds: [1000, 2000] })).result.kind, 'unknown');
assert.equal((await observe({
  securePidFileError: Object.assign(new Error('gone'), { code: 'ENOENT' }),
})).result.kind, 'absent');
// A PID file Home cannot trust names no process Home may adopt, which is the
// same practical answer as no PID file: decline, do not report "unknown".
// Reporting unknown reached the transport panel and disabled every control,
// including the start action that would have rewritten the file — the dead end
// a tester hit on 2026-09-04 with a umask of 0002.
assert.equal((await observe({
  securePidFileError: Object.assign(new Error('not private'), { code: 'EPERM' }),
})).result.kind, 'absent');
assert.equal((await observe({ pidContents: 'not-a-pid\n' })).result.kind, 'absent');

// The real filesystem path: i2pd writes its own PID file under whatever umask
// the router was launched with, so Home must repair the mode of a file it owns
// rather than distrust it forever.
if (process.platform === 'linux') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'i2pd-pidfile-mode-'));
  try {
    const binary = path.join(root, 'i2pd');
    writeFileSync(binary, 'binary fixture', { mode: 0o700 });
    const runtime = path.join(root, 'runtime');
    mkdirSync(runtime, { mode: 0o700 });
    const conf = path.join(runtime, 'i2pd.conf');
    writeFileSync(conf, 'conf fixture', { mode: 0o600 });
    const pidPath = path.join(runtime, 'i2pd.pid');

    for (const mode of [0o664, 0o660, 0o644]) {
      writeFileSync(pidPath, '2147483646\n');
      chmodSync(pidPath, mode);
      const observation = await observeManagedI2pdProcess({
        binaryPath: binary,
        confPath: conf,
        pidPath,
        runtimePath: runtime,
      });
      assert.equal(
        observation.kind,
        'absent',
        `a ${mode.toString(8)} PID file must not report unknown`,
      );
      assert.equal(
        statSync(pidPath).mode & 0o777,
        0o600,
        `a ${mode.toString(8)} PID file must be repaired to 0600`,
      );
    }

    // An already private file is read without being touched.
    writeFileSync(pidPath, '2147483646\n', { mode: 0o600 });
    assert.equal((await observeManagedI2pdProcess({
      binaryPath: binary,
      confPath: conf,
      pidPath,
      runtimePath: runtime,
    })).kind, 'absent');
    assert.equal(statSync(pidPath).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

console.log('i2pd managed process tests passed');
