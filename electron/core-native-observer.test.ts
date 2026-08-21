import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  buildCoreNativeObserverEnvironment,
  CORE_NATIVE_OBSERVER_SCHEMA,
  parseCoreNativeObserverEnvelope,
  runCoreNativeObserver,
  type CoreNativeObserverChild,
  type CoreNativeObserverOperations,
  type CoreNativeObserverRunnerOptions,
} from './core-native-observer.js';

const DARWIN_OPTIONS = { arch: 'arm64', platform: 'darwin' } as const;
const PROCESSES_REQUEST = { mode: 'processes' } as const;
const LISTENER_REQUEST = { mode: 'listener', port: 12391 } as const;
const BOOT_SESSION_ID = '12345678-1234-4abc-8def-1234567890AB';
const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64');

const PROCESS_WIRE = {
  argvBase64: [b64('/usr/bin/java'), b64(''), b64('-jar'), b64('/Users/test/Qortal/qortal.jar')],
  canonicalCwdBase64: b64('/Users/test/Qortal'),
  executablePathBase64: b64('/usr/bin/java'),
  pid: 42,
  startMicroseconds: '123456',
  startSeconds: '1780000000',
};
const PROCESSES_WIRE = {
  arch: 'arm64',
  bootSessionId: BOOT_SESSION_ID,
  effectiveUid: 501,
  mode: 'processes',
  platform: 'darwin',
  processes: [PROCESS_WIRE],
  schema: CORE_NATIVE_OBSERVER_SCHEMA,
  schemaVersion: 1,
  status: 'ok',
};
const HOLDER_WIRE = {
  pid: 42,
  socketIds: ['00000000000000ab:7', '00000000000000ac:0'],
  startMicroseconds: '123456',
  startSeconds: '1780000000',
};
const LISTENER_OWNERS_WIRE = {
  arch: 'arm64',
  bootSessionId: BOOT_SESSION_ID,
  effectiveUid: 501,
  holders: [HOLDER_WIRE],
  mode: 'listener',
  pids: [42],
  platform: 'darwin',
  port: 12391,
  schema: CORE_NATIVE_OBSERVER_SCHEMA,
  schemaVersion: 1,
  status: 'owners',
};
const LISTENER_ABSENT_WIRE = {
  arch: 'arm64',
  bootSessionId: BOOT_SESSION_ID,
  effectiveUid: 501,
  mode: 'listener',
  platform: 'darwin',
  port: 12391,
  schema: CORE_NATIVE_OBSERVER_SCHEMA,
  schemaVersion: 1,
  status: 'absent',
};

async function failureCode(
  result: Awaited<ReturnType<typeof runCoreNativeObserver>> | ReturnType<typeof runCoreNativeObserver>,
) {
  const resolved = await result;
  assert.equal(resolved.kind, 'failure');
  return resolved.kind === 'failure' ? resolved.code : assert.fail('Expected failure.');
}

{
  const result = parseCoreNativeObserverEnvelope(PROCESSES_WIRE, PROCESSES_REQUEST, DARWIN_OPTIONS);
  assert.equal(result.kind, 'success');
  if (result.kind === 'success') {
    assert.deepEqual(result.envelope, {
      arch: 'arm64',
      bootSessionId: BOOT_SESSION_ID,
      effectiveUid: 501,
      mode: 'processes',
      platform: 'darwin',
      processes: [{
        argv: ['/usr/bin/java', '', '-jar', '/Users/test/Qortal/qortal.jar'],
        canonicalCwd: '/Users/test/Qortal',
        executablePath: '/usr/bin/java',
        pid: 42,
        startIdentity: { kind: 'darwin', microseconds: '123456', seconds: '1780000000' },
      }],
      schema: CORE_NATIVE_OBSERVER_SCHEMA,
      schemaVersion: 1,
      status: 'ok',
    });
  }
}

for (const envelope of [LISTENER_OWNERS_WIRE, LISTENER_ABSENT_WIRE]) {
  assert.equal(parseCoreNativeObserverEnvelope(envelope, LISTENER_REQUEST, DARWIN_OPTIONS).kind, 'success');
}

const without = (value: Record<string, unknown>, key: string) => Object.fromEntries(
  Object.entries(value).filter(([candidate]) => candidate !== key),
);
const processEnvelope = (process: unknown) => ({ ...PROCESSES_WIRE, processes: [process] });
const invalidProcessEnvelopes: Array<[string, unknown]> = [
  ['extra top-level key', { ...PROCESSES_WIRE, debug: true }],
  ['missing schema', without(PROCESSES_WIRE, 'schema')],
  ['wrong schema', { ...PROCESSES_WIRE, schema: 'other' }],
  ['wrong version', { ...PROCESSES_WIRE, schemaVersion: 2 }],
  ['wrong mode', { ...PROCESSES_WIRE, mode: 'listener' }],
  ['wrong platform', { ...PROCESSES_WIRE, platform: 'win32' }],
  ['wrong arch', { ...PROCESSES_WIRE, arch: 'x64' }],
  ['unknown status', { ...PROCESSES_WIRE, status: 'partial' }],
  ['bad boot session', { ...PROCESSES_WIRE, bootSessionId: 'unavailable' }],
  ['bad effective uid', { ...PROCESSES_WIRE, effectiveUid: -1 }],
  ['extra process key', processEnvelope({ ...PROCESS_WIRE, command: 'secret' })],
  ['zero pid', processEnvelope({ ...PROCESS_WIRE, pid: 0 })],
  ['duplicate pid', { ...PROCESSES_WIRE, processes: [PROCESS_WIRE, PROCESS_WIRE] }],
  ['unsorted pid', { ...PROCESSES_WIRE, processes: [{ ...PROCESS_WIRE, pid: 43 }, PROCESS_WIRE] }],
  ['number start seconds', processEnvelope({ ...PROCESS_WIRE, startSeconds: 1 })],
  ['leading-zero start seconds', processEnvelope({ ...PROCESS_WIRE, startSeconds: '01' })],
  ['overflow start seconds', processEnvelope({ ...PROCESS_WIRE, startSeconds: '9223372036854775808' })],
  ['number start microseconds', processEnvelope({ ...PROCESS_WIRE, startMicroseconds: 1 })],
  ['overflow start microseconds', processEnvelope({ ...PROCESS_WIRE, startMicroseconds: '1000000' })],
  ['empty argv', processEnvelope({ ...PROCESS_WIRE, argvBase64: [] })],
  ['empty argv zero', processEnvelope({ ...PROCESS_WIRE, argvBase64: [b64('')] })],
  ['invalid base64 alphabet', processEnvelope({ ...PROCESS_WIRE, argvBase64: ['***='] })],
  ['noncanonical base64 padding', processEnvelope({ ...PROCESS_WIRE, argvBase64: ['AB=='] })],
  ['invalid base64 length', processEnvelope({ ...PROCESS_WIRE, argvBase64: ['YQ='] })],
  ['invalid utf8 argv', processEnvelope({ ...PROCESS_WIRE, argvBase64: [b64(Buffer.from([0xff]))] })],
  ['nul argv', processEnvelope({ ...PROCESS_WIRE, argvBase64: [b64('/usr/bin/java\0bad')] })],
  ['relative executable', processEnvelope({ ...PROCESS_WIRE, executablePathBase64: b64('java') })],
  ['noncanonical executable', processEnvelope({ ...PROCESS_WIRE, executablePathBase64: b64('/usr/../bin/java') })],
  ['relative cwd', processEnvelope({ ...PROCESS_WIRE, canonicalCwdBase64: b64('Qortal') })],
  ['noncanonical cwd', processEnvelope({ ...PROCESS_WIRE, canonicalCwdBase64: b64('/Users/test/../Qortal') })],
  ['invalid utf8 cwd', processEnvelope({ ...PROCESS_WIRE, canonicalCwdBase64: b64(Buffer.from([0xff])) })],
];
for (const [label, envelope] of invalidProcessEnvelopes) {
  assert.equal(parseCoreNativeObserverEnvelope(envelope, PROCESSES_REQUEST, DARWIN_OPTIONS).kind,
    'failure', label);
}

const invalidListenerEnvelopes: Array<[string, unknown]> = [
  ['wrong port', { ...LISTENER_OWNERS_WIRE, port: 12392 }],
  ['empty pids', { ...LISTENER_OWNERS_WIRE, holders: [], pids: [] }],
  ['duplicate pids', { ...LISTENER_OWNERS_WIRE, holders: [HOLDER_WIRE, HOLDER_WIRE], pids: [42, 42] }],
  ['unsorted pids', { ...LISTENER_OWNERS_WIRE,
    holders: [{ ...HOLDER_WIRE, pid: 43 }, HOLDER_WIRE], pids: [43, 42] }],
  ['missing holder', { ...LISTENER_OWNERS_WIRE, holders: [] }],
  ['holder PID mismatch', { ...LISTENER_OWNERS_WIRE, holders: [{ ...HOLDER_WIRE, pid: 43 }] }],
  ['extra holder key', { ...LISTENER_OWNERS_WIRE, holders: [{ ...HOLDER_WIRE, fd: 8 }] }],
  ['empty sockets', { ...LISTENER_OWNERS_WIRE, holders: [{ ...HOLDER_WIRE, socketIds: [] }] }],
  ['zero socket handle', { ...LISTENER_OWNERS_WIRE,
    holders: [{ ...HOLDER_WIRE, socketIds: ['0000000000000000:7'] }] }],
  ['uppercase socket handle', { ...LISTENER_OWNERS_WIRE,
    holders: [{ ...HOLDER_WIRE, socketIds: ['00000000000000AB:7'] }] }],
  ['short socket handle', { ...LISTENER_OWNERS_WIRE,
    holders: [{ ...HOLDER_WIRE, socketIds: ['ab:7'] }] }],
  ['leading-zero generation', { ...LISTENER_OWNERS_WIRE,
    holders: [{ ...HOLDER_WIRE, socketIds: ['00000000000000ab:07'] }] }],
  ['overflow generation', { ...LISTENER_OWNERS_WIRE,
    holders: [{ ...HOLDER_WIRE, socketIds: ['00000000000000ab:18446744073709551616'] }] }],
  ['duplicate sockets', { ...LISTENER_OWNERS_WIRE,
    holders: [{ ...HOLDER_WIRE, socketIds: ['00000000000000ab:7', '00000000000000ab:7'] }] }],
  ['unsorted sockets', { ...LISTENER_OWNERS_WIRE,
    holders: [{ ...HOLDER_WIRE, socketIds: ['00000000000000ac:0', '00000000000000ab:7'] }] }],
  ['owners fields on absent', { ...LISTENER_ABSENT_WIRE, holders: [], pids: [] }],
  ['extra absent key', { ...LISTENER_ABSENT_WIRE, reason: 'none' }],
];
for (const [label, envelope] of invalidListenerEnvelopes) {
  assert.equal(parseCoreNativeObserverEnvelope(envelope, LISTENER_REQUEST, DARWIN_OPTIONS).kind,
    'failure', label);
}

const PROCESS_UNKNOWN = {
  arch: 'arm64', bootSessionId: BOOT_SESSION_ID, effectiveUid: 501, mode: 'processes', platform: 'darwin',
  reason: 'candidate-argv-unavailable', schema: CORE_NATIVE_OBSERVER_SCHEMA, schemaVersion: 1, status: 'unknown',
};
const BOOT_UNKNOWN = {
  ...PROCESS_UNKNOWN, bootSessionId: 'unavailable', reason: 'boot-session-unavailable',
};
const LISTENER_UNKNOWN = {
  arch: 'arm64', bootSessionId: BOOT_SESSION_ID, effectiveUid: 501, mode: 'listener', platform: 'darwin',
  port: 12391, reason: 'listener-socket-evidence-unavailable', schema: CORE_NATIVE_OBSERVER_SCHEMA,
  schemaVersion: 1, status: 'unknown',
};
for (const [request, envelope] of [
  [PROCESSES_REQUEST, PROCESS_UNKNOWN],
  [PROCESSES_REQUEST, BOOT_UNKNOWN],
  [LISTENER_REQUEST, LISTENER_UNKNOWN],
] as const) {
  assert.equal(await failureCode(parseCoreNativeObserverEnvelope(envelope, request, DARWIN_OPTIONS)),
    'helper-unknown');
}
for (const envelope of [
  { ...PROCESS_UNKNOWN, reason: 'raw-private-error' },
  { ...PROCESS_UNKNOWN, bootSessionId: 'unavailable' },
  { ...BOOT_UNKNOWN, bootSessionId: BOOT_SESSION_ID },
  { ...LISTENER_UNKNOWN, port: 12392 },
  { ...LISTENER_UNKNOWN, arch: 'x64' },
  { ...LISTENER_UNKNOWN, platform: 'win32' },
]) {
  const request = 'port' in envelope ? LISTENER_REQUEST : PROCESSES_REQUEST;
  assert.equal(parseCoreNativeObserverEnvelope(envelope, request, DARWIN_OPTIONS).kind, 'failure');
}
assert.equal(parseCoreNativeObserverEnvelope(PROCESSES_WIRE, PROCESSES_REQUEST,
  { arch: 'x64', platform: 'darwin' }).kind, 'failure', 'wire arch must match expected arch');
assert.equal(parseCoreNativeObserverEnvelope(PROCESSES_WIRE, PROCESSES_REQUEST,
  { arch: 'x64', platform: 'win32' }).kind, 'failure', 'unimplemented target must fail closed');

assert.deepEqual(buildCoreNativeObserverEnvironment('darwin', { HOME: '/secret', PATH: '/untrusted' }), {
  LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
});
assert.deepEqual(buildCoreNativeObserverEnvironment('win32', { HOME: 'C:\\secret', SystemRoot: 'D:\\Windows' }), {
  LANG: 'C', LC_ALL: 'C', PATH: 'D:\\Windows\\System32', SystemRoot: 'D:\\Windows', WINDIR: 'D:\\Windows',
});

type FakeExit = {
  code?: number | null;
  error?: boolean;
  signal?: NodeJS.Signals | null;
  stderr?: Buffer | string;
  stdout?: Buffer | string;
};

function fakeOperations(exit: FakeExit | null, inspect?: (command: string, args: readonly string[], options: unknown) => void) {
  let killed = false;
  const operations: CoreNativeObserverOperations = {
    getEffectiveUid: () => 501,
    lstat: async () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
      mode: 0o100755,
      uid: 501,
    }),
    spawn(command, args, options) {
      inspect?.(command, args, options);
      const events = new EventEmitter();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = events as EventEmitter & CoreNativeObserverChild;
      child.stdout = stdout;
      child.stderr = stderr;
      child.kill = () => { killed = true; return true; };
      if (exit) queueMicrotask(() => {
        if (exit.error) {
          events.emit('error', new Error('sensitive evidence must not escape'));
          return;
        }
        if (exit.stdout !== undefined) stdout.write(exit.stdout);
        if (exit.stderr !== undefined) stderr.write(exit.stderr);
        stdout.end();
        stderr.end();
        events.emit('close', exit.code === undefined ? 0 : exit.code, exit.signal ?? null);
      });
      return child;
    },
  };
  return { killed: () => killed, operations };
}

{
  const helperPath = '/Applications/Qortium Home.app/Contents/Helpers/core-observer';
  const trustCases = [
    ['safe current-user 0755', 501, 0o100755, true, false, 'success'],
    ['safe root 0755', 0, 0o100755, true, false, 'success'],
    ['symlink', 501, 0o120755, false, true, 'invalid-configuration'],
    ['wrong owner', 502, 0o100755, true, false, 'invalid-configuration'],
    ['group writable', 501, 0o100775, true, false, 'invalid-configuration'],
    ['world writable', 501, 0o100757, true, false, 'invalid-configuration'],
    ['setuid', 501, 0o104755, true, false, 'invalid-configuration'],
    ['setgid', 501, 0o102755, true, false, 'invalid-configuration'],
    ['sticky', 501, 0o101755, true, false, 'invalid-configuration'],
    ['not executable', 501, 0o100644, true, false, 'invalid-configuration'],
    ['nonfile', 501, 0o040755, false, false, 'invalid-configuration'],
  ] as const;
  for (const [label, uid, mode, isFile, isSymbolicLink, expected] of trustCases) {
    let spawnCalls = 0;
    const base = fakeOperations({ stdout: JSON.stringify(PROCESSES_WIRE) });
    const result = await runCoreNativeObserver(PROCESSES_REQUEST, {
      ...DARWIN_OPTIONS,
      helperPath,
      operations: {
        ...base.operations,
        lstat: async () => ({
          isFile: () => isFile,
          isSymbolicLink: () => isSymbolicLink,
          mode,
          uid,
        }),
        spawn: (...args) => {
          ++spawnCalls;
          return base.operations.spawn(...args);
        },
      },
    });
    assert.equal(result.kind === 'success' ? 'success' : result.code, expected, label);
    assert.equal(spawnCalls, expected === 'success' ? 1 : 0, `${label} spawn boundary`);
  }

  for (const [label, operations] of [
    ['lstat error', { lstat: async () => { throw new Error('private path'); } }],
    ['missing effective UID', { getEffectiveUid: () => null }],
  ] as const) {
    let spawnCalls = 0;
    const base = fakeOperations({ stdout: JSON.stringify(PROCESSES_WIRE) });
    const result = await runCoreNativeObserver(PROCESSES_REQUEST, {
      ...DARWIN_OPTIONS,
      helperPath,
      operations: {
        ...base.operations,
        ...operations,
        spawn: (...args) => {
          ++spawnCalls;
          return base.operations.spawn(...args);
        },
      },
    });
    assert.equal(await failureCode(result), 'invalid-configuration', label);
    assert.equal(spawnCalls, 0, `${label} must fail before spawn`);
  }
}

function runner(
  exit: FakeExit | null,
  overrides: Partial<CoreNativeObserverRunnerOptions> = {},
  inspect?: (command: string, args: readonly string[], options: unknown) => void,
) {
  const fake = fakeOperations(exit, inspect);
  return { fake, result: runCoreNativeObserver(PROCESSES_REQUEST, {
    ...DARWIN_OPTIONS,
    helperPath: '/Applications/Qortium Home.app/Contents/Helpers/core-observer',
    operations: fake.operations,
    ...overrides,
  }) };
}

{
  let inspected = false;
  const { result } = runner({ stdout: `${JSON.stringify(PROCESSES_WIRE)}\n` }, {}, (command, args, options) => {
    inspected = true;
    assert.equal(command, '/Applications/Qortium Home.app/Contents/Helpers/core-observer');
    assert.deepEqual(args, ['processes']);
    assert.equal((options as { shell?: boolean }).shell, false);
    assert.deepEqual((options as { env?: NodeJS.ProcessEnv }).env,
      { LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin:/usr/sbin:/sbin' });
  });
  assert.equal((await result).kind, 'success');
  assert.equal(inspected, true);
}

{
  let inspected = false;
  const fake = fakeOperations({ stdout: JSON.stringify(LISTENER_ABSENT_WIRE) }, (_command, args) => {
    inspected = true;
    assert.deepEqual(args, ['listener', '--port', '12391']);
  });
  const result = await runCoreNativeObserver(LISTENER_REQUEST, {
    ...DARWIN_OPTIONS, helperPath: '/helper', operations: fake.operations,
  });
  assert.equal(result.kind, 'success');
  assert.equal(inspected, true);
}

for (const [label, exit, expected] of [
  ['nonzero', { code: 2, stdout: JSON.stringify(PROCESSES_WIRE) }, 'nonzero-exit'],
  ['signal', { code: null, signal: 'SIGTERM' as NodeJS.Signals }, 'abnormal-exit'],
  ['stderr', { stderr: 'warning', stdout: JSON.stringify(PROCESSES_WIRE) }, 'helper-stderr'],
  ['malformed', { stdout: '{not json' }, 'malformed-json'],
  ['invalid utf8', { stdout: Buffer.from([0xff]) }, 'malformed-json'],
  ['invalid schema', { stdout: JSON.stringify({ ...PROCESSES_WIRE, schemaVersion: 2 }) }, 'invalid-envelope'],
  ['spawn event', { error: true }, 'spawn-failed'],
] as const) {
  assert.equal(await failureCode(runner(exit).result), expected, label);
}

{
  const stdout = runner({ stdout: 'x'.repeat(33) }, { stdoutLimitBytes: 32 });
  assert.equal(await failureCode(stdout.result), 'stdout-overflow');
  assert.equal(stdout.fake.killed(), true);
  const stderr = runner({ stderr: 'x'.repeat(17) }, { stderrLimitBytes: 16 });
  assert.equal(await failureCode(stderr.result), 'stderr-overflow');
  assert.equal(stderr.fake.killed(), true);
}

{
  const timeout = runner(null, { timeoutMs: 5 });
  assert.equal(await failureCode(timeout.result), 'timeout');
  assert.equal(timeout.fake.killed(), true);
}

assert.equal(await failureCode(runCoreNativeObserver(PROCESSES_REQUEST, {
  ...DARWIN_OPTIONS, helperPath: 'relative/helper', operations: fakeOperations(null).operations,
})), 'invalid-configuration');
assert.equal(await failureCode(runCoreNativeObserver(PROCESSES_REQUEST, {
  arch: 'x64', platform: 'win32', helperPath: 'C:\\Qortium\\core-observer.exe',
  operations: fakeOperations(null).operations,
})), 'invalid-configuration');
assert.equal(await failureCode(runCoreNativeObserver({ mode: 'listener', port: 0 }, {
  ...DARWIN_OPTIONS, helperPath: '/helper', operations: fakeOperations(null).operations,
})), 'invalid-configuration');
assert.equal(await failureCode(runCoreNativeObserver(PROCESSES_REQUEST, {
  ...DARWIN_OPTIONS,
  helperPath: '/helper',
  operations: { ...fakeOperations(null).operations, spawn: () => { throw new Error('private'); } },
})), 'spawn-failed');

console.log('Core native observer protocol checks passed.');
