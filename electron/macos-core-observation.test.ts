import assert from 'node:assert/strict';
import {
  CORE_NATIVE_OBSERVER_SCHEMA,
  CORE_NATIVE_OBSERVER_SCHEMA_VERSION,
  type CoreNativeDarwinListenerEnvelope,
  type CoreNativeDarwinProcessesEnvelope,
  type CoreNativeObserverResult,
} from './core-native-observer.js';
import {
  formatMacosProcessStartIdentity,
  observeMacosCoreListenerOwners,
  observeMacosQortalProcesses,
  type MacosCoreObservationOperations,
} from './macos-core-observation.js';

const BOOT = '12345678-1234-4abc-8def-1234567890ab';
const HELPER = '/Applications/Qortium Home.app/Contents/Resources/qortium-core-observer';
const SELECTED = '/Users/test/Qortal/qortal.jar';
const BASE = {
  arch: 'arm64',
  bootSessionId: BOOT,
  effectiveUid: 501,
  platform: 'darwin',
  schema: CORE_NATIVE_OBSERVER_SCHEMA,
  schemaVersion: CORE_NATIVE_OBSERVER_SCHEMA_VERSION,
} as const;

const processesEnvelope = (processes: CoreNativeDarwinProcessesEnvelope['processes']): CoreNativeDarwinProcessesEnvelope => ({
  ...BASE,
  mode: 'processes',
  processes,
  status: 'ok',
});

const listenerOwnersEnvelope = (
  pids: readonly number[],
  holders: Extract<CoreNativeDarwinListenerEnvelope, { status: 'owners' }>['holders'],
): CoreNativeDarwinListenerEnvelope => ({
  ...BASE,
  holders,
  mode: 'listener',
  pids,
  port: 12391,
  status: 'owners',
});

const process = (
  pid: number,
  argv: readonly string[],
  overrides: Partial<CoreNativeDarwinProcessesEnvelope['processes'][number]> = {},
): CoreNativeDarwinProcessesEnvelope['processes'][number] => ({
  argv,
  canonicalCwd: '/Users/test/Qortal',
  executablePath: '/usr/bin/java',
  pid,
  startIdentity: { kind: 'darwin', microseconds: String(pid), seconds: '1780000000' },
  ...overrides,
});

const success = (envelope: CoreNativeDarwinProcessesEnvelope | CoreNativeDarwinListenerEnvelope): CoreNativeObserverResult => ({
  envelope,
  kind: 'success',
});

function operationsFor(
  result: CoreNativeObserverResult,
  realpaths: Readonly<Record<string, string>> = {},
  calls: Array<{ options: unknown; request: unknown }> = [],
): MacosCoreObservationOperations {
  return {
    getCurrentEffectiveUid: () => 501,
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

{
  assert.equal(
    formatMacosProcessStartIdentity(BOOT.toUpperCase(), {
      kind: 'darwin', microseconds: '42', seconds: '1780000000',
    }),
    `darwin:boot=${BOOT}:seconds=1780000000:microseconds=000042`,
  );
  assert.equal(formatMacosProcessStartIdentity('not-a-uuid', {
    kind: 'darwin', microseconds: '42', seconds: '1780000000',
  }), null);
  assert.equal(formatMacosProcessStartIdentity(BOOT, {
    kind: 'darwin', microseconds: '1000000', seconds: '1780000000',
  }), null);
}

{
  const calls: Array<{ options: unknown; request: unknown }> = [];
  const envelope = processesEnvelope([
    process(10, ['/usr/bin/java', '-jar', SELECTED, '/Users/test/settings.json']),
    process(20, ['/usr/bin/java', '-jar', '/opt/Qortal/qortal.jar']),
    process(30, ['/usr/bin/java', '-jar', '/Users/test/alias.jar']),
    process(40, ['/usr/bin/java', '-jar', '/Users/test/unrelated.jar']),
    process(50, ['/usr/bin/java', 'org.qortal.ApplyUpdate']),
    process(60, ['/usr/bin/java', 'ApplyRestart']),
    process(70, ['/usr/bin/java', 'ApplyBootstrap']),
    process(80, ['/usr/bin/java', '-jar', '/Users/test/new-qortal.jar']),
  ]);
  const observation = await observeMacosQortalProcesses({
    arch: 'arm64',
    helperPath: HELPER,
    operations: operationsFor(success(envelope), {
      [SELECTED]: SELECTED,
      '/opt/Qortal/qortal.jar': '/opt/Qortal/qortal.jar',
      '/Users/test/alias.jar': SELECTED,
      '/Users/test/unrelated.jar': '/Users/test/unrelated.jar',
    }, calls),
    selectedJarPath: SELECTED,
  });
  assert.equal(observation.kind, 'observed');
  if (observation.kind === 'observed') {
    assert.equal(observation.processes.length, 8);
    assert.deepEqual(observation.processes[0].classification, {
      canonicalJarPath: SELECTED,
      kind: 'qortal-direct-jar',
      rawJarArgument: SELECTED,
      rawSettingsArgument: '/Users/test/settings.json',
      selected: true,
    });
    assert.equal(observation.processes[1].classification.kind, 'qortal-direct-jar');
    assert.equal(observation.processes[2].classification.kind, 'qortal-direct-jar');
    assert.deepEqual(observation.processes[3].classification, { kind: 'other' });
    assert.deepEqual(observation.processes.slice(4).map(({ classification }) => classification), [
      { helper: 'apply-update', kind: 'qortal-updater-helper' },
      { helper: 'apply-restart', kind: 'qortal-updater-helper' },
      { helper: 'apply-bootstrap', kind: 'qortal-updater-helper' },
      { helper: 'new-qortal-jar', kind: 'qortal-updater-helper' },
    ]);
    assert.equal(
      observation.processes[0].startIdentity,
      `darwin:boot=${BOOT}:seconds=1780000000:microseconds=000010`,
    );
  }
  assert.deepEqual(calls, [{
    options: { arch: 'arm64', helperPath: HELPER, platform: 'darwin' },
    request: { mode: 'processes' },
  }]);
}

{
  // x64 evidence uses the same platform-neutral classification contract.
  const selected = '/Users/test/Install/qortal.jar';
  const observation = await observeMacosQortalProcesses({
    arch: 'x64',
    helperPath: HELPER,
    operations: operationsFor(success({ ...processesEnvelope([
      process(10, ['/usr/bin/java', '-jar', selected], { canonicalCwd: '/Users/test/Install' }),
    ]), arch: 'x64' }), {
      '/Users/test/Install': '/Volumes/Data/Install',
      [selected]: '/Volumes/Data/Install/qortal.jar',
    }),
    selectedJarPath: selected,
  });
  assert.equal(observation.kind, 'observed');
  if (observation.kind === 'observed') {
    assert.equal(observation.processes[0].classification.kind, 'qortal-direct-jar');
    if (observation.processes[0].classification.kind === 'qortal-direct-jar') {
      assert.equal(observation.processes[0].classification.selected, true);
    }
  }
}

{
  // Initial-install observation succeeds when the selected JAR is prospectively canonicalized.
  const selected = '/Users/test/Install/qortal.jar';
  const observation = await observeMacosQortalProcesses({
    arch: 'arm64',
    helperPath: HELPER,
    operations: operationsFor(success(processesEnvelope([])), {
      '/Users/test/Install': '/Volumes/Data/Install',
    }),
    selectedJarPath: selected,
  });
  assert.deepEqual(observation, { kind: 'observed', processes: [] });
}

{
  const secret = '/Users/test/private-token';
  const failure: CoreNativeObserverResult = {
    code: 'spawn-failed', kind: 'failure', message: secret,
  };
  const observation = await observeMacosQortalProcesses({
    arch: 'arm64', helperPath: HELPER, operations: operationsFor(failure), selectedJarPath: SELECTED,
  });
  assert.equal(observation.kind, 'unknown');
  if (observation.kind === 'unknown') assert.equal(observation.reason.includes(secret), false);
}

for (const envelope of [
  { ...processesEnvelope([]), effectiveUid: 502 },
  { ...processesEnvelope([]), bootSessionId: 'invalid' },
  { ...processesEnvelope([]), arch: 'x64' },
  processesEnvelope([
    process(20, ['/usr/bin/java', 'ApplyUpdate']),
    process(10, ['/usr/bin/java', 'ApplyRestart']),
  ]),
  processesEnvelope([process(10, ['/usr/bin/java', 'ApplyUpdate'], {
    startIdentity: { kind: 'darwin', microseconds: '1000000', seconds: '1780000000' },
  })]),
]) {
  const observation = await observeMacosQortalProcesses({
    arch: 'arm64',
    helperPath: HELPER,
    operations: operationsFor(success(envelope as CoreNativeDarwinProcessesEnvelope)),
    selectedJarPath: SELECTED,
  });
  assert.equal(observation.kind, 'unknown');
}

{
  const absent: CoreNativeDarwinListenerEnvelope = {
    ...BASE, mode: 'listener', port: 12391, status: 'absent',
  };
  assert.deepEqual(await observeMacosCoreListenerOwners(12391, {
    arch: 'arm64', helperPath: HELPER, operations: operationsFor(success(absent)),
  }), { kind: 'absent' });
}

{
  const owners = listenerOwnersEnvelope([42, 99], [
    {
      pid: 42,
      socketIds: ['00000000000000ab:7'],
      startIdentity: { kind: 'darwin', microseconds: '42', seconds: '1780000000' },
    },
    {
      pid: 99,
      socketIds: ['00000000000000cd:1'],
      startIdentity: { kind: 'darwin', microseconds: '99', seconds: '1780000000' },
    },
  ]);
  assert.deepEqual(await observeMacosCoreListenerOwners(12391, {
    arch: 'arm64', helperPath: HELPER, operations: operationsFor(success(owners)),
  }), { kind: 'owners', pids: [42, 99] });
}

for (const envelope of [
  { ...listenerOwnersEnvelope([42], [{
    pid: 42,
    socketIds: ['00000000000000ab:7'],
    startIdentity: { kind: 'darwin' as const, microseconds: '42', seconds: '1780000000' },
  }]), effectiveUid: 502 },
  { ...listenerOwnersEnvelope([42], [{
    pid: 42,
    socketIds: ['00000000000000ab:7'],
    startIdentity: { kind: 'darwin' as const, microseconds: '42', seconds: '1780000000' },
  }]), bootSessionId: 'not-a-boot-id' },
  listenerOwnersEnvelope([42], [{
    pid: 43,
    socketIds: ['00000000000000ab:7'],
    startIdentity: { kind: 'darwin', microseconds: '42', seconds: '1780000000' },
  }]),
  listenerOwnersEnvelope([42], [{
    pid: 42,
    socketIds: ['00000000000000ab:7'],
    startIdentity: { kind: 'darwin', microseconds: '1000000', seconds: '1780000000' },
  }]),
  listenerOwnersEnvelope([42], [{
    pid: 42,
    socketIds: [],
    startIdentity: { kind: 'darwin', microseconds: '42', seconds: '1780000000' },
  }]),
]) {
  const observation = await observeMacosCoreListenerOwners(12391, {
    arch: 'arm64',
    helperPath: HELPER,
    operations: operationsFor(success(envelope as CoreNativeDarwinListenerEnvelope)),
  });
  assert.equal(observation.kind, 'unknown');
}

{
  const envelope = processesEnvelope([]);
  const observation = await observeMacosQortalProcesses({
    arch: 'arm64',
    helperPath: HELPER,
    operations: {
      ...operationsFor(success(envelope)),
      getCurrentEffectiveUid: () => null,
    },
    selectedJarPath: SELECTED,
  });
  assert.equal(observation.kind, 'unknown');
}

{
  const calls: unknown[] = [];
  const observation = await observeMacosCoreListenerOwners(12391, {
    arch: 'arm64',
    helperPath: 'relative/helper',
    operations: {
      ...operationsFor(success(listenerOwnersEnvelope([], []))),
      runNativeObserver: async (...args) => {
        calls.push(args);
        return success(listenerOwnersEnvelope([], []));
      },
    },
  });
  assert.equal(observation.kind, 'unknown');
  assert.deepEqual(calls, []);
}

console.log('macos core observation tests passed');
