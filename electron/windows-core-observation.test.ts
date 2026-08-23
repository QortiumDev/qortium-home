import assert from 'node:assert/strict';
import {
  CORE_NATIVE_OBSERVER_SCHEMA,
  CORE_NATIVE_OBSERVER_SCHEMA_VERSION,
  type CoreNativeObserverResult,
  type CoreNativeWindowsListenerEnvelope,
  type CoreNativeWindowsProcessesEnvelope,
  type CoreNativeWindowsSecureFileEnvelope,
} from './core-native-observer.js';
import {
  formatWindowsProcessStartIdentity,
  observeWindowsCoreListenerOwners,
  observeWindowsQortalProcesses,
  readWindowsSecureFile,
  type WindowsCoreObservationOperations,
} from './windows-core-observation.js';

const SID = 'S-1-5-21-111-222-333-1001';
const HELPER = 'C:\\Program Files\\Qortium\\resources\\native\\windows\\x64\\qortium-core-observer.exe';
const SELECTED = 'C:\\Users\\Alice\\Qortal\\qortal.jar';
const BASE = {
  arch: 'x64',
  effectiveSid: SID,
  platform: 'win32',
  schema: CORE_NATIVE_OBSERVER_SCHEMA,
  schemaVersion: CORE_NATIVE_OBSERVER_SCHEMA_VERSION,
} as const;

function process(pid: number, argv: readonly string[]): CoreNativeWindowsProcessesEnvelope['processes'][number] {
  return {
    argv,
    canonicalCwd: '\\\\?\\C:\\Users\\Alice\\Qortal',
    executablePath: '\\\\?\\C:\\Program Files\\Java\\bin\\java.exe',
    pid,
    rawCommandLine: argv.map((value) => `"${value}"`).join(' '),
    startIdentity: { fileTime: `13370000000000${pid}`, kind: 'windows' },
  };
}

function processesEnvelope(
  processes: CoreNativeWindowsProcessesEnvelope['processes'],
): CoreNativeWindowsProcessesEnvelope {
  return { ...BASE, mode: 'processes', processes, status: 'ok' };
}

function success(
  envelope: CoreNativeWindowsProcessesEnvelope | CoreNativeWindowsListenerEnvelope |
    CoreNativeWindowsSecureFileEnvelope,
): CoreNativeObserverResult<'win32'> {
  return { envelope, kind: 'success' };
}

function operationsFor(
  result: CoreNativeObserverResult<'win32'>,
  realpaths: Readonly<Record<string, string>> = {},
  calls: Array<{ options: unknown; request: unknown }> = [],
): WindowsCoreObservationOperations {
  return {
    realpath: async (targetPath) => {
      const resolved = realpaths[targetPath];
      if (resolved) return resolved;
      const error = new Error('missing') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    },
    runNativeObserver: async (request, options) => {
      calls.push({ options, request });
      return result;
    },
  };
}

assert.equal(
  formatWindowsProcessStartIdentity({ fileTime: '133700000000000001', kind: 'windows' }),
  'windows:filetime=133700000000000001',
);
assert.equal(formatWindowsProcessStartIdentity({ fileTime: '0', kind: 'windows' }), null);
assert.equal(formatWindowsProcessStartIdentity({ fileTime: '18446744073709551616', kind: 'windows' }), null);

{
  const calls: Array<{ options: unknown; request: unknown }> = [];
  const observation = await observeWindowsQortalProcesses({
    helperPath: HELPER,
    operations: operationsFor(success(processesEnvelope([
      process(10, ['java.exe', '-jar', SELECTED, 'settings.json']),
      process(20, ['java.exe', '-jar', 'D:\\Other\\qortal.jar']),
      process(30, ['java.exe', 'org.qortal.ApplyUpdate']),
    ])), {
      [SELECTED]: SELECTED,
      'D:\\Other\\qortal.jar': 'D:\\Other\\qortal.jar',
    }, calls),
    selectedJarPath: SELECTED,
  });
  assert.equal(observation.kind, 'observed');
  if (observation.kind === 'observed') {
    assert.equal(observation.processes.length, 3);
    assert.equal(observation.processes[0].startIdentity, 'windows:filetime=1337000000000010');
    assert.equal(observation.processes[0].canonicalCwd, 'C:\\Users\\Alice\\Qortal');
    assert.deepEqual(observation.processes[0].classification, {
      canonicalJarPath: SELECTED,
      kind: 'qortal-direct-jar',
      rawJarArgument: SELECTED,
      rawSettingsArgument: 'settings.json',
      selected: true,
    });
    assert.equal(observation.processes[1].classification.kind, 'qortal-direct-jar');
    assert.deepEqual(observation.processes[2].classification, {
      helper: 'apply-update', kind: 'qortal-updater-helper',
    });
  }
  assert.deepEqual(calls, [{
    options: { arch: 'x64', helperPath: HELPER, platform: 'win32' },
    request: { mode: 'processes' },
  }]);
}

{
  const observation = await observeWindowsQortalProcesses({
    helperPath: HELPER,
    operations: operationsFor(success(processesEnvelope([])), {
      'C:\\Users\\Alice\\Qortal': 'D:\\Canonical Qortal',
    }),
    selectedJarPath: SELECTED,
  });
  assert.deepEqual(observation, { kind: 'observed', processes: [] });
}

for (const envelope of [
  { ...processesEnvelope([]), effectiveSid: 'invalid' },
  { ...processesEnvelope([]), arch: 'arm64' },
  processesEnvelope([process(20, ['java.exe', 'ApplyUpdate']), process(10, ['java.exe', 'ApplyRestart'])]),
  processesEnvelope([{ ...process(10, ['java.exe', 'ApplyUpdate']), rawCommandLine: '' }]),
]) {
  const observation = await observeWindowsQortalProcesses({
    helperPath: HELPER,
    operations: operationsFor(success(envelope as CoreNativeWindowsProcessesEnvelope)),
    selectedJarPath: SELECTED,
  });
  assert.equal(observation.kind, 'unknown');
}

{
  const absent: CoreNativeWindowsListenerEnvelope = {
    ...BASE, mode: 'listener', port: 12391, status: 'absent',
  };
  assert.deepEqual(await observeWindowsCoreListenerOwners(12391, {
    helperPath: HELPER, operations: operationsFor(success(absent)),
  }), { kind: 'absent' });
}

{
  const owners: CoreNativeWindowsListenerEnvelope = {
    ...BASE,
    holders: [
      { pid: 42, startIdentity: { fileTime: '133700000000000042', kind: 'windows' } },
      { pid: 99, startIdentity: { fileTime: '133700000000000099', kind: 'windows' } },
    ],
    mode: 'listener',
    pids: [42, 99],
    port: 12391,
    status: 'owners',
  };
  assert.deepEqual(await observeWindowsCoreListenerOwners(12391, {
    helperPath: HELPER, operations: operationsFor(success(owners)),
  }), { kind: 'owners', pids: [42, 99] });
  assert.equal((await observeWindowsCoreListenerOwners(0, {
    helperPath: HELPER, operations: operationsFor(success(owners)),
  })).kind, 'unknown');
}

{
  const secret = 'C:\\private\\token';
  const failure: CoreNativeObserverResult<'win32'> = { code: 'spawn-failed', kind: 'failure', message: secret };
  const result = await observeWindowsQortalProcesses({
    helperPath: HELPER, operations: operationsFor(failure), selectedJarPath: SELECTED,
  });
  assert.equal(result.kind, 'unknown');
  if (result.kind === 'unknown') assert.equal(result.reason.includes(secret), false);
}

{
  const keyPath = 'C:\\Users\\Alice\\Qortal\\apikey.txt';
  const canonicalKeyPath = '\\\\?\\C:\\Users\\Alice\\Qortal\\apikey.txt';
  const bytes = Buffer.from('123456789ABCDEFG');
  const secure: CoreNativeWindowsSecureFileEnvelope = {
    ...BASE,
    bytes,
    canonicalPath: canonicalKeyPath,
    fileId: '00112233445566778899aabbccddeeff',
    maxBytes: 128,
    mode: 'secure-file',
    size: bytes.byteLength,
    status: 'ok',
    volumeSerialNumber: '12345',
  };
  const calls: Array<{ options: unknown; request: unknown }> = [];
  const read = await readWindowsSecureFile(keyPath, 128, {
    helperPath: HELPER,
    operations: operationsFor(success(secure), { [keyPath]: keyPath }, calls),
  });
  assert.deepEqual(read.bytes, bytes);
  assert.equal(read.stats.isFile(), true);
  assert.equal(read.stats.isSymbolicLink(), false);
  assert.equal(read.stats.size, bytes.byteLength);
  assert.deepEqual(calls, [{
    options: { arch: 'x64', helperPath: HELPER, platform: 'win32' },
    request: { maxBytes: 128, mode: 'secure-file', path: keyPath },
  }]);

  await assert.rejects(readWindowsSecureFile(keyPath, 128, {
    helperPath: HELPER,
    operations: operationsFor(success({ ...secure, canonicalPath: 'D:\\Other\\apikey.txt' }), {
      [keyPath]: keyPath,
    }),
  }), /identity changed/);
  await assert.rejects(readWindowsSecureFile('relative\\apikey.txt', 128, {
    helperPath: HELPER, operations: operationsFor(success(secure)),
  }), /request is invalid/);
}

console.log('Windows Core observation checks passed.');
