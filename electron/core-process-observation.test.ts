import assert from 'node:assert/strict';
import {
  observeCurrentUserQortalProcesses,
  parseLinuxProcessStartTicks,
  type CoreProcessObservationOperations,
} from './core-process-observation.js';
import {
  classifyQortalProcess,
  isPotentialQortalProcess,
} from './qortal-process-classification.js';

const SELECTED_JAR = '/managed/qortal/qortal.jar';
const BOOT_ID = '12345678-1234-1234-1234-123456789abc';

function stat(startTicks: string, command = 'java worker (one)') {
  const fields = ['S', ...Array.from({ length: 18 }, (_, index) => String(index + 1)), startTicks, '0', '0'];
  return `77 (${command}) ${fields.join(' ')}`;
}

assert.equal(parseLinuxProcessStartTicks(stat('987654')), '987654');
assert.equal(parseLinuxProcessStartTicks('invalid'), null);
assert.equal(parseLinuxProcessStartTicks(stat('not-a-number')), null);

const identityRealpath = { realpath: async (targetPath: string) => targetPath };

assert.deepEqual(
  await classifyQortalProcess({
    argv: ['java', '-jar', '/external/qortal.jar', '/external/settings.json'],
    canonicalCwd: '/external',
    canonicalSelectedJarPath: SELECTED_JAR,
    operations: identityRealpath,
    platform: 'linux',
  }),
  {
    canonicalJarPath: '/external/qortal.jar',
    kind: 'qortal-direct-jar',
    rawJarArgument: '/external/qortal.jar',
    rawSettingsArgument: '/external/settings.json',
    selected: false,
  },
  'an external qortal.jar remains classified as Qortal without becoming selected',
);

assert.deepEqual(
  await classifyQortalProcess({
    argv: ['java', '-jar', '/tools/unrelated.jar', '--worker'],
    canonicalCwd: '/tools',
    canonicalSelectedJarPath: SELECTED_JAR,
    operations: identityRealpath,
    platform: 'linux',
  }),
  { kind: 'other' },
  'an arbitrary Java JAR must not become a Qortal process',
);

assert.deepEqual(
  await classifyQortalProcess({
    argv: ['java', '-jar', '/tmp/arbitrary-alias.jar', 'settings.json'],
    canonicalCwd: '/managed/qortal',
    canonicalSelectedJarPath: SELECTED_JAR,
    operations: { realpath: async () => SELECTED_JAR },
    platform: 'linux',
  }),
  {
    canonicalJarPath: SELECTED_JAR,
    kind: 'qortal-direct-jar',
    rawJarArgument: '/tmp/arbitrary-alias.jar',
    rawSettingsArgument: 'settings.json',
    selected: true,
  },
  'an arbitrary symlink name that resolves to the selected JAR must remain selected',
);

for (const [argument, helper] of [
  ['ApplyBootstrap', 'apply-bootstrap'],
  ['org.qortal.ApplyRestart', 'apply-restart'],
  ['ORG.QORTAL.APPLYUPDATE', 'apply-update'],
] as const) {
  assert.deepEqual(
    await classifyQortalProcess({
      argv: ['java', argument],
      canonicalCwd: '/managed/qortal',
      canonicalSelectedJarPath: SELECTED_JAR,
      operations: identityRealpath,
      platform: 'linux',
    }),
    { helper, kind: 'qortal-updater-helper' },
  );
}

assert.deepEqual(
  await classifyQortalProcess({
    argv: ['java', '-jar', 'C:\\Qortal Update\\NEW-QORTAL.JAR'],
    canonicalCwd: 'C:\\Qortal Update',
    canonicalSelectedJarPath: 'C:\\Managed Qortal\\qortal.jar',
    operations: identityRealpath,
    platform: 'win32',
  }),
  { helper: 'new-qortal-jar', kind: 'qortal-updater-helper' },
  'Windows path semantics must recognize the updater JAR on a Linux test host',
);

{
  const windowsSelectedJar = 'C:\\Users\\Alice\\AppData\\Roaming\\qortium-core\\install\\qortal.jar';
  const extendedUppercaseJar = '\\\\?\\C:\\USERS\\ALICE\\APPDATA\\ROAMING\\QORTIUM-CORE\\INSTALL\\QORTAL.JAR';
  const classification = await classifyQortalProcess({
    argv: ['java.exe', '-jar', extendedUppercaseJar, 'Settings.JSON'],
    canonicalCwd: 'C:\\Users\\Alice\\AppData\\Roaming\\qortium-core\\install',
    canonicalSelectedJarPath: windowsSelectedJar,
    operations: identityRealpath,
    platform: 'win32',
  });
  assert.deepEqual(classification, {
    canonicalJarPath: extendedUppercaseJar,
    kind: 'qortal-direct-jar',
    rawJarArgument: extendedUppercaseJar,
    rawSettingsArgument: 'Settings.JSON',
    selected: true,
  }, 'Windows comparison must be case-insensitive and normalize extended drive prefixes');
}

assert.equal(isPotentialQortalProcess(['java', '-jar', 'worker.jar'], 'linux'), true);
assert.equal(isPotentialQortalProcess(['java', '--jar', 'qortal.jar'], 'linux'), false);
assert.equal(isPotentialQortalProcess(['java', '-JAR', 'qortal.jar'], 'linux'), false);

type Fixture = {
  argv: readonly string[];
  cwd?: string;
  startTicks?: readonly string[];
  userId?: number;
};

function operations(fixtures: Readonly<Record<number, Fixture>>) {
  const reads = new Map<number, number>();
  const operationSet: CoreProcessObservationOperations = {
    getCurrentUserId: () => 1000,
    listProcessIds: async () => [...Object.keys(fixtures).map(Number), 4, 2, 4],
    readBootId: async () => `${BOOT_ID}\n`,
    readProcessArgv: async (pid) => {
      const fixture = fixtures[pid];
      if (!fixture) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      return fixture.argv;
    },
    readProcessCwd: async (pid) => fixtures[pid]?.cwd ?? `/cwd/${pid}`,
    readProcessStartTicks: async (pid) => {
      const fixture = fixtures[pid];
      if (!fixture) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      const read = reads.get(pid) ?? 0;
      reads.set(pid, read + 1);
      return fixture.startTicks?.[read] ?? fixture.startTicks?.at(-1) ?? String(pid * 100);
    },
    readProcessUserId: async (pid) => {
      const fixture = fixtures[pid];
      if (!fixture) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      return fixture.userId ?? 1000;
    },
    realpath: async (targetPath) => targetPath,
  };
  return { operationSet, reads };
}

{
  const { operationSet, reads } = operations({
    10: { argv: ['java', '-jar', SELECTED_JAR, 'settings.json'], cwd: '/managed/qortal' },
    11: { argv: ['java', '-jar', '/external/qortal.jar', '/external/settings.json'], cwd: '/external' },
    12: { argv: ['java', 'org.qortal.ApplyUpdate'], cwd: '/managed/qortal' },
    13: { argv: ['java', 'org.qortal.ApplyRestart'], cwd: '/managed/qortal' },
    14: { argv: ['java', '-jar', 'new-qortal.jar'], cwd: '/managed/qortal' },
    17: { argv: ['java', 'org.qortal.ApplyBootstrap'], cwd: '/managed/qortal' },
    15: { argv: ['other', '--flag'], cwd: '/other' },
    16: { argv: ['java', '-jar', SELECTED_JAR], userId: 2000 },
  });
  const result = await observeCurrentUserQortalProcesses({
    operations: operationSet,
    platform: 'linux',
    selectedJarPath: SELECTED_JAR,
  });
  assert.equal(result.kind, 'observed');
  assert.deepEqual(result.processes.map(({ pid }) => pid), [10, 11, 12, 13, 14, 17]);
  assert.deepEqual(result.processes[0], {
    argv: ['java', '-jar', SELECTED_JAR, 'settings.json'],
    canonicalCwd: '/managed/qortal',
    classification: {
      canonicalJarPath: SELECTED_JAR,
      kind: 'qortal-direct-jar',
      rawJarArgument: SELECTED_JAR,
      rawSettingsArgument: 'settings.json',
      selected: true,
    },
    pid: 10,
    startIdentity: `${BOOT_ID}:1000`,
  });
  assert.deepEqual(result.processes[1].classification, {
    canonicalJarPath: '/external/qortal.jar',
    kind: 'qortal-direct-jar',
    rawJarArgument: '/external/qortal.jar',
    rawSettingsArgument: '/external/settings.json',
    selected: false,
  });
  assert.deepEqual(result.processes.slice(2, 5).map(({ classification }) => classification), [
    { helper: 'apply-update', kind: 'qortal-updater-helper' },
    { helper: 'apply-restart', kind: 'qortal-updater-helper' },
    { helper: 'new-qortal-jar', kind: 'qortal-updater-helper' },
  ]);
  assert.deepEqual(result.processes[5].classification, {
    helper: 'apply-bootstrap',
    kind: 'qortal-updater-helper',
  });
  assert.equal(reads.get(10), 2, 'a complete snapshot must re-read process start identity');
  assert.equal(reads.get(15), 2, 'an unrelated process must still be identity-stable while filtered');
  assert.equal(reads.has(16), false, 'another user process must not be inspected beyond its uid');
}

{
  const { operationSet } = operations({
    20: { argv: ['java', '-jar', SELECTED_JAR, 'settings.json'], startTicks: ['100', '101'] },
  });
  const result = await observeCurrentUserQortalProcesses({ operations: operationSet, platform: 'linux', selectedJarPath: SELECTED_JAR });
  assert.equal(result.kind, 'unknown');
  if (result.kind === 'unknown') assert.match(result.reason, /changed identity/i);
}

{
  const { operationSet } = operations({
    30: { argv: ['java', '-jar', SELECTED_JAR] },
  });
  operationSet.readProcessArgv = async () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); };
  const result = await observeCurrentUserQortalProcesses({ operations: operationSet, platform: 'linux', selectedJarPath: SELECTED_JAR });
  assert.equal(result.kind, 'unknown');
  if (result.kind === 'unknown') assert.match(result.reason, /permission denied/i);
}

{
  let called = false;
  const result = await observeCurrentUserQortalProcesses({
    operations: { listProcessIds: async () => { called = true; return []; } },
    platform: 'darwin',
    selectedJarPath: SELECTED_JAR,
  });
  assert.deepEqual(result, {
    kind: 'unknown',
    processes: [],
    reason: 'Strong process observation is unavailable on darwin.',
  });
  assert.equal(called, false);
}

{
  const { operationSet } = operations({});
  operationSet.readBootId = async () => 'not valid';
  const result = await observeCurrentUserQortalProcesses({ operations: operationSet, platform: 'linux', selectedJarPath: SELECTED_JAR });
  assert.equal(result.kind, 'unknown');
  if (result.kind === 'unknown') assert.match(result.reason, /boot identity is invalid/i);
}

{
  const { operationSet } = operations({
    40: { argv: ['java', '-jar', SELECTED_JAR, 'settings.json'], cwd: '/managed/qortal' },
  });
  operationSet.realpath = async (targetPath) => {
    if (targetPath === SELECTED_JAR) throw Object.assign(new Error('missing target'), { code: 'ENOENT' });
    return targetPath;
  };
  const result = await observeCurrentUserQortalProcesses({ operations: operationSet, platform: 'linux', selectedJarPath: SELECTED_JAR });
  assert.equal(result.kind, 'unknown', 'a running process whose selected JAR disappeared must fail closed');
  if (result.kind === 'unknown') assert.match(result.reason, /evidence could not be read/i);
}

{
  const { operationSet } = operations({ 50: { argv: ['ordinary-process'], cwd: '/other' } });
  operationSet.realpath = async (targetPath) => {
    if (targetPath === SELECTED_JAR) throw Object.assign(new Error('missing target'), { code: 'ENOENT' });
    return targetPath;
  };
  const result = await observeCurrentUserQortalProcesses({ operations: operationSet, platform: 'linux', selectedJarPath: SELECTED_JAR });
  assert.equal(result.kind, 'observed', 'an absent initial-install target must still permit process observation');
}

{
  const aliasPath = '/tmp/unexpected-name.jar';
  const { operationSet } = operations({
    60: { argv: ['java', '-jar', aliasPath, 'settings.json'], cwd: '/managed/qortal' },
  });
  operationSet.realpath = async (targetPath) => targetPath === aliasPath ? SELECTED_JAR : targetPath;
  const result = await observeCurrentUserQortalProcesses({ operations: operationSet, platform: 'linux', selectedJarPath: SELECTED_JAR });
  assert.equal(result.kind, 'observed');
  assert.equal(result.processes[0]?.classification.kind, 'qortal-direct-jar');
  if (result.processes[0]?.classification.kind === 'qortal-direct-jar') {
    assert.equal(result.processes[0].classification.selected, true, 'a selected JAR alias must not evade observation');
  }
}

console.log('core process observation tests passed');
