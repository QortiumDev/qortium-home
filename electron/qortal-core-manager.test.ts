import assert from 'node:assert/strict';
import path from 'node:path';
import { CoreJarInstallCleanupError } from './core-jar-install-transaction.js';
import type { CoreJarTargetState } from './core-jar-target-state.js';
import { CoreOperationLockReleaseError } from './core-operation-lock.js';
import {
  QortalCoreManager,
  type QortalCoreManagerOperations,
  type QortalInstallObservation,
  type QortalRuntimeAuthority,
  type QortalRuntimeObservation,
  type QortalRuntimeTarget,
  type QortalSpawnOptions,
} from './qortal-core-manager.js';
import type { QortalManagedInstallRecordV1 } from './qortal-managed-install.js';
import type { QortalAdoptedInstallRecordV1, QortalInstallCandidate } from './qortal-install-source.js';
import type { QortalJarRelease } from './qortal-release-policy.js';
import type { QortalUpdateOwnershipDecision } from './qortal-settings-policy.js';

const ROOT = path.resolve('/qortium-home-test/qortal');
const PATHS = {
  apiKeyPath: path.join(ROOT, 'install', 'apikey.txt'),
  backupJarPath: path.join(ROOT, 'install', '.qortium-home-qortal-backup.jar'),
  basePath: ROOT,
  candidateJarPath: path.join(ROOT, 'install', '.qortium-home-qortal-candidate.jar'),
  currentMetadataPath: path.join(ROOT, 'current.json'),
  installPath: path.join(ROOT, 'install'),
  jarPath: path.join(ROOT, 'install', 'qortal.jar'),
  runtimePath: path.join(ROOT, 'install'),
  settingsPath: path.join(ROOT, 'install', 'settings.json'),
};
const UNIQUE_CANDIDATE = path.join(PATHS.installPath, '.qortium-home-qortal-candidate-abc123.jar');
const LOCK_ROOT = path.join(ROOT, 'locks');
const ADOPTED_RECORD_PATH = path.join(ROOT, 'adopted.json');
const IDENTITY = {
  buildTimestamp: '20260708200403',
  buildVersion: '6.1.9-108bf191d4',
  commit: '108bf191d42d710ec617f535af30cfd82fc03c87',
  semver: '6.1.9',
};
const UPDATE_COMMIT = `abcdef1234${'0'.repeat(30)}`;
const UPDATE_IDENTITY = { ...IDENTITY, buildVersion: '6.2.0-abcdef1234', commit: UPDATE_COMMIT, semver: '6.2.0' };
const RELEASE: QortalJarRelease = {
  asset: { digest: `sha256:${'a'.repeat(64)}`,
    downloadUrl: 'https://github.com/Qortal/qortal/releases/download/v6.1.9/qortal.jar',
    name: 'qortal.jar', size: 100 },
  commit: IDENTITY.commit,
  tagName: 'v6.1.9',
};
const UPDATE_RELEASE: QortalJarRelease = {
  asset: { ...RELEASE.asset, digest: `sha256:${'d'.repeat(64)}`,
    downloadUrl: 'https://github.com/Qortal/qortal/releases/download/v6.2.0/qortal.jar' },
  commit: UPDATE_COMMIT,
  tagName: 'v6.2.0',
};
const RECORD: QortalManagedInstallRecordV1 = {
  installPath: PATHS.installPath, installedAt: '2026-08-21T20:00:00.000Z', jarIdentity: IDENTITY,
  jarPath: PATHS.jarPath, networkId: 'qortal', release: RELEASE, settingsPath: PATHS.settingsPath,
  source: 'home-managed', version: 1,
};
const UPDATED_RECORD: QortalManagedInstallRecordV1 = { ...RECORD, jarIdentity: UPDATE_IDENTITY, release: UPDATE_RELEASE };
const MISSING_TARGET: CoreJarTargetState = { canonicalPath: PATHS.jarPath, kind: 'missing', parentDev: 1, parentIno: 2 };
const FILE_TARGET: CoreJarTargetState = { canonicalPath: PATHS.jarPath, dev: 1, identity: IDENTITY,
  ino: 3, kind: 'file', mtimeMs: 4, sha256: RELEASE.asset.digest, size: RELEASE.asset.size };
const CANDIDATE_TARGET: CoreJarTargetState = { ...FILE_TARGET, canonicalPath: UNIQUE_CANDIDATE, ino: 5 };
const UPDATE_CANDIDATE_TARGET: CoreJarTargetState = { ...CANDIDATE_TARGET, identity: UPDATE_IDENTITY,
  sha256: UPDATE_RELEASE.asset.digest };
const HOME_INSTALL: QortalInstallObservation = { kind: 'home-managed', record: RECORD };
const HOME_TARGET: QortalRuntimeTarget = {
  installPath: PATHS.installPath,
  jarPath: PATHS.jarPath,
  owner: 'home-managed',
};
const STOPPED: QortalRuntimeObservation = { state: 'stopped' };
const AUTHORITY: QortalRuntimeAuthority = {
  canonicalCwd: PATHS.installPath,
  canonicalJarPath: PATHS.jarPath,
  listenerPort: 12391,
  owner: 'home-managed',
  pid: 4321,
  rawSettingsArgument: 'settings.json',
  readiness: 'ready',
  startIdentity: 'linux-start-99',
};
const RUNNING: QortalRuntimeObservation = { authority: AUTHORITY, state: 'running' };
const FALSE_POLICY: QortalUpdateOwnershipDecision = {
  detection: { checkedAt: '2026-08-21T20:00:00.000Z', defaultEnabled: true, enabled: false,
    source: 'settings-file', usedDefault: false }, ownership: 'home-github',
};
const TRUE_POLICY: QortalUpdateOwnershipDecision = {
  detection: { checkedAt: '2026-08-21T20:00:00.000Z', defaultEnabled: true, enabled: true,
    source: 'settings-file', usedDefault: false }, ownership: 'node-native',
};

type Lifecycle = Pick<QortalCoreManagerOperations, 'inspectRuntime' | 'readApiKey' | 'readLiveAutoUpdate' |
  'resolveJava' | 'spawnProcess' | 'stopWithApiKey' | 'waitForReadiness' | 'waitForStopped'> &
  Partial<QortalCoreManagerOperations>;

function stateFor(targetPath: string, update = false): CoreJarTargetState {
  if (path.resolve(targetPath) === path.resolve(UNIQUE_CANDIDATE)) {
    return update ? UPDATE_CANDIDATE_TARGET : CANDIDATE_TARGET;
  }
  return FILE_TARGET;
}

function manager(
  overrides: Partial<QortalCoreManagerOperations> = {},
  update = false,
  configOverrides: Partial<ConstructorParameters<typeof QortalCoreManager>[0]> = {},
) {
  const lifecycle: Lifecycle = {
    createCandidatePaths: () => ({ candidateJarPath: UNIQUE_CANDIDATE, partialPath: `${UNIQUE_CANDIDATE}.partial` }),
    detectStoppedOwnership: async () => FALSE_POLICY,
    ensureDirectory: async () => {},
    inspectInstall: async () => HOME_INSTALL,
    inspectRuntime: async () => STOPPED,
    prepareCommand: (command, args) => ({ command, args }),
    prepareInstall: async (input) => ({ afterRollback: async () => {}, afterSwap: async () => {},
      record: input.kind === 'update' ? UPDATED_RECORD : RECORD }),
    readApiKey: async () => 'private-test-key',
    readLiveAutoUpdate: async () => false,
    readTargetState: async (targetPath) => stateFor(targetPath, update),
    resolveJava: async () => ({ command: '/usr/bin/java', source: 'system' }),
    runInstallTransaction: async (input) => ({ kind: path.resolve(input.targetJarPath) === path.resolve(PATHS.jarPath) &&
      update ? 'update' : 'initial-install', targetJarPath: input.targetJarPath }),
    selectRelease: (value) => value === 'release' ? (update ? UPDATE_RELEASE : RELEASE) : null,
    spawnProcess: async () => ({ pid: AUTHORITY.pid, startIdentity: AUTHORITY.startIdentity, unref: () => {} }),
    stageCandidate: async (input) => ({ candidateJarPath: input.candidateJarPath,
      digest: update ? UPDATE_RELEASE.asset.digest : RELEASE.asset.digest,
      identity: update ? UPDATE_IDENTITY : IDENTITY, size: RELEASE.asset.size }),
    statesMatch: (left, right) => left.kind === right.kind && left.canonicalPath === right.canonicalPath &&
      (left.kind !== 'file' || right.kind !== 'file' || left.sha256 === right.sha256),
    stopWithApiKey: async () => {},
    validateDirectories: async () => ({ baseIdentity: { dev: 1, ino: 1 }, installIdentity: { dev: 1, ino: 2 } }),
    waitForReadiness: async () => RUNNING,
    waitForStopped: async () => STOPPED,
    withOperationLock: async (_request, operation) => await operation({ canonicalTarget: PATHS.jarPath,
      key: 'key', lockPath: path.join(LOCK_ROOT, 'key.lock'), ownerToken: 'a'.repeat(64) }),
    ...overrides,
  };
  return new QortalCoreManager({ adoptedRecordPath: ADOPTED_RECORD_PATH,
    lockRoot: LOCK_ROOT, paths: PATHS, userAgent: 'QortiumHome/test', ...configOverrides }, lifecycle);
}

{
  const status = await manager({ inspectInstall: async () => ({ kind: 'missing' }) }).getStatus();
  assert.deepEqual(status.capabilities, { canInitialInstall: true, canStart: false, canStop: false, canUpdate: false });
  assert.equal(status.runtime.state, 'stopped');
}

{
  const status = await manager({ inspectRuntime: async () => RUNNING,
    detectLiveOwnership: () => TRUE_POLICY, readLiveAutoUpdate: async () => true }).getStatus();
  assert.deepEqual(status.capabilities, { canInitialInstall: false, canStart: false, canStop: true, canUpdate: false });
  assert.equal(status.updateOwnership, TRUE_POLICY);
}

{
  const wrongAuthority: QortalRuntimeObservation = { state: 'running', authority: { ...AUTHORITY, canonicalJarPath: '/foreign/qortal.jar' } };
  const status = await manager({ inspectRuntime: async () => wrongAuthority }).getStatus();
  assert.equal(status.capabilities.canStop, false);
  assert.equal(status.updateOwnership.ownership, 'observe-only');
}

{
  const events: string[] = [];
  const result = await manager({
    inspectInstall: async () => ({ kind: 'missing' }),
    readTargetState: async (targetPath) => path.resolve(targetPath) === path.resolve(PATHS.jarPath) ? MISSING_TARGET : CANDIDATE_TARGET,
    stageCandidate: async (input) => { events.push(`stage:${path.basename(input.candidateJarPath)}`); return {
      candidateJarPath: input.candidateJarPath, digest: RELEASE.asset.digest, identity: IDENTITY, size: RELEASE.asset.size }; },
    runInstallTransaction: async (input) => { events.push(`transaction:${path.basename(input.candidateJarPath)}`);
      return { kind: 'initial-install', targetJarPath: input.targetJarPath }; },
    validateDirectories: async () => { events.push('validate'); return { baseIdentity: { dev: 1, ino: 1 }, installIdentity: { dev: 1, ino: 2 } }; },
  }).install('release');
  assert.equal(result.kind, 'installed');
  assert.deepEqual(events.filter((event) => event.startsWith('stage:')), [`stage:${path.basename(UNIQUE_CANDIDATE)}`]);
  assert.equal(events.at(-1), `transaction:${path.basename(UNIQUE_CANDIDATE)}`);
  assert(events.filter((event) => event === 'validate').length >= 3);
}

{
  let collisionReads = 0;
  let transactionRan = false;
  const result = await manager({
    inspectExternalInstallCollision: async () => (++collisionReads === 1 ? 'clear' : 'detected'),
    inspectInstall: async () => ({ kind: 'missing' }),
    readTargetState: async (targetPath) => path.resolve(targetPath) === path.resolve(PATHS.jarPath)
      ? MISSING_TARGET
      : CANDIDATE_TARGET,
    runInstallTransaction: async () => {
      transactionRan = true;
      throw new Error('must not transact after an external install appears');
    },
  }).install('release');
  assert.equal(result.kind, 'blocked');
  if (result.kind === 'blocked') assert.equal(result.code, 'external-install-detected');
  assert.equal(collisionReads, 2, 'external-install collision must be rechecked after staging/preparation');
  assert.equal(transactionRan, false);
}

{
  let staged = false;
  const result = await manager({ detectStoppedOwnership: async () => TRUE_POLICY,
    stageCandidate: async () => { staged = true; throw new Error('must not stage'); } }, true).update('release');
  assert.equal(result.kind, 'blocked');
  if (result.kind === 'blocked') assert.equal(result.code, 'update-node-native');
  assert.equal(staged, false);
}

{
  let policyReads = 0;
  let runtimeReads = 0;
  const boundaryEvents: string[] = [];
  let transactionCandidate = '';
  const result = await manager({
    detectStoppedOwnership: async () => { policyReads += 1; return FALSE_POLICY; },
    inspectRuntime: async () => { runtimeReads += 1; boundaryEvents.push('runtime'); return STOPPED; },
    runInstallTransaction: async (input) => { transactionCandidate = input.candidateJarPath;
      boundaryEvents.push('transaction');
      return { kind: 'update', targetJarPath: input.targetJarPath }; },
  }, true).update('release');
  assert.equal(result.kind, 'updated');
  assert.equal(transactionCandidate, UNIQUE_CANDIDATE);
  assert(policyReads >= 3, 'settings policy must be checked again at the final barrier');
  assert(runtimeReads >= 4, 'runtime absence must be checked again at the final barrier');
  assert.deepEqual(boundaryEvents.slice(-2), ['runtime', 'transaction']);
}

{
  let candidateReads = 0;
  const lockError = new Error('lock unavailable');
  const result = await manager({
    readTargetState: async (targetPath) => {
      if (path.resolve(targetPath) !== path.resolve(UNIQUE_CANDIDATE)) return FILE_TARGET;
      candidateReads += 1;
      return candidateReads === 1 ? UPDATE_CANDIDATE_TARGET :
        { ...UPDATE_CANDIDATE_TARGET, sha256: `sha256:${'e'.repeat(64)}` };
    },
    withOperationLock: async () => { throw lockError; },
  }, true).update('release');
  assert.equal(result.kind, 'failed');
  assert.equal(candidateReads, 1, 'an unconsumed candidate is retained without pathname cleanup');
}

{
  const cleanupError = new CoreJarInstallCleanupError(new Error('busy backup'), PATHS.backupJarPath);
  const result = await manager({ runInstallTransaction: async () => { throw cleanupError; } }, true).update('release');
  assert.equal(result.kind, 'completed-with-warning');
  if (result.kind === 'completed-with-warning') {
    assert.equal(result.outcome.kind, 'updated');
    assert.equal(result.cause, cleanupError);
  }
}

{
  const cleanupError = new CoreJarInstallCleanupError(new Error('busy backup'), PATHS.backupJarPath);
  const releaseError = new CoreOperationLockReleaseError(path.join(LOCK_ROOT, 'key.lock'), new Error('unlink lock failed'));
  const result = await manager({
    runInstallTransaction: async () => { throw cleanupError; },
    withOperationLock: async (_request, operation) => {
      try {
        await operation({ canonicalTarget: PATHS.jarPath, key: 'key', lockPath: releaseError.lockPath,
          ownerToken: 'a'.repeat(64) });
      } catch (error) {
        throw new AggregateError([new AggregateError([error]), releaseError], 'operation and release failed');
      }
      throw new Error('operation unexpectedly returned');
    },
  }, true).update('release');
  assert.equal(result.kind, 'completed-with-warning');
  if (result.kind === 'completed-with-warning') assert.equal(result.outcome.kind, 'updated');
}

{
  let preparedArgs: readonly string[] = [];
  const spawnCalls: Array<{ command: string; args: readonly string[]; options: QortalSpawnOptions }> = [];
  let receiptSeen = false;
  const result = await manager({
    prepareCommand: (command, args) => { assert.equal(command, '/usr/bin/java'); preparedArgs = args;
      return { command: '/bin/bash', args: ['-c', 'exec "$@"', 'managed', command, ...args] }; },
    spawnProcess: async (_target, command, args, options) => { spawnCalls.push({ command, args, options });
      return { pid: AUTHORITY.pid, startIdentity: AUTHORITY.startIdentity, unref: () => {} }; },
    waitForReadiness: async (_paths, receipt) => { receiptSeen = receipt.pid === AUTHORITY.pid &&
      receipt.startIdentity === AUTHORITY.startIdentity; return RUNNING; },
  }).start();
  assert.equal(result.kind, 'started');
  assert.equal(receiptSeen, true);
  assert.equal(spawnCalls[0]?.command, '/bin/bash');
  assert.equal(spawnCalls[0]?.options.shell, false);
  assert.equal(spawnCalls[0]?.options.cwd, PATHS.installPath);
  assert.equal(spawnCalls[0]?.options.detached, true);
  assert.equal(spawnCalls[0]?.options.stdio, 'ignore');
  assert.equal(spawnCalls[0]?.options.windowsHide, true);
  assert.equal(typeof spawnCalls[0]?.options.env, 'object');
  assert.deepEqual(preparedArgs.slice(-3), ['-jar', PATHS.jarPath, 'settings.json']);
}

{
  let unrefCalled = false;
  const result = await manager({ spawnProcess: async () => ({ pid: 0, startIdentity: '',
    unref: () => { unrefCalled = true; } }) }).start();
  assert.equal(result.kind, 'start-unconfirmed');
  if (result.kind === 'start-unconfirmed') assert.equal(result.receipt, null);
  assert.equal(unrefCalled, true);
}

{
  const result = await manager({ waitForReadiness: async () => { throw new Error('probe failed'); } }).start();
  assert.equal(result.kind, 'start-unconfirmed');
  if (result.kind === 'start-unconfirmed') {
    assert.deepEqual(result.receipt, { pid: AUTHORITY.pid, startIdentity: AUTHORITY.startIdentity });
    assert.equal(result.runtime.state, 'unknown');
  }
}

{
  const result = await manager({ waitForReadiness: async () => ({ state: 'running',
    authority: { ...AUTHORITY, pid: AUTHORITY.pid + 1 } }) }).start();
  assert.equal(result.kind, 'start-unconfirmed');
  if (result.kind === 'start-unconfirmed') assert.equal(result.receipt?.pid, AUTHORITY.pid);
}

{
  const result = await manager({ inspectRuntime: async () => RUNNING,
    waitForStopped: async () => { throw new Error('wait failed'); } }).stop();
  assert.equal(result.kind, 'stop-unconfirmed');
  if (result.kind === 'stop-unconfirmed') assert.equal(result.runtime.state, 'unknown');
}

{
  let stopAuthority: QortalRuntimeAuthority | null = null;
  let waitAuthority: QortalRuntimeAuthority | null = null;
  const result = await manager({
    inspectRuntime: async () => RUNNING,
    readApiKey: async (target, authority) => {
      assert.deepEqual(target, HOME_TARGET);
      assert.equal(authority, AUTHORITY);
      return 'private-test-key';
    },
    stopWithApiKey: async (input) => { assert.equal(input.apiKey, 'private-test-key');
      assert.deepEqual(input.target, HOME_TARGET);
      assert.equal(input.url, 'http://127.0.0.1:12391/admin/stop'); stopAuthority = input.expectedAuthority; },
    waitForStopped: async (_paths, authority) => { waitAuthority = authority; return STOPPED; },
  }).stop();
  assert.equal(result.kind, 'stopped');
  assert.equal(stopAuthority, AUTHORITY);
  assert.equal(waitAuthority, AUTHORITY);
}

{
  let reads = 0;
  let called = false;
  const result = await manager({
    inspectRuntime: async () => { reads += 1; return reads === 1 ? RUNNING :
      { state: 'running', authority: { ...AUTHORITY, startIdentity: 'replacement-process' } }; },
    stopWithApiKey: async () => { called = true; },
  }).stop();
  assert.equal(result.kind, 'blocked');
  if (result.kind === 'blocked') assert.equal(result.code, 'process-ownership-unproven');
  assert.equal(called, false);
}

{
  const releaseError = new CoreOperationLockReleaseError(path.join(LOCK_ROOT, 'key.lock'), new Error('unlink failed'));
  const result = await manager({ withOperationLock: async (_request, operation) => {
    await operation({ canonicalTarget: PATHS.jarPath, key: 'key', lockPath: releaseError.lockPath,
      ownerToken: 'a'.repeat(64) });
    throw releaseError;
  } }).start();
  assert.equal(result.kind, 'completed-with-warning');
  if (result.kind === 'completed-with-warning') {
    assert.equal(result.action, 'start');
    assert.equal(result.outcome.kind, 'started');
  }
}

{
  let mutated = false;
  const adoptedRecord = {
    adoptedAt: '2026-08-21T20:00:00.000Z',
    adoptedJar: { buildVersion: IDENTITY.buildVersion, canonicalPath: '/foreign/qortal.jar',
      semver: IDENTITY.semver, sha256: RELEASE.asset.digest, size: RELEASE.asset.size },
    adoptedSettings: { canonicalPath: '/foreign/settings.json', mtimeMs: 1,
      sha256: `sha256:${'b'.repeat(64)}`, size: 2 },
    detectedBy: 'user-selected', installPath: '/foreign', jarPath: '/foreign/qortal.jar',
    networkId: 'qortal', settingsPath: '/foreign/settings.json', source: 'adopted', version: 1,
  } satisfies QortalAdoptedInstallRecordV1;
  const adoptedCandidate = {
    canonicalInstallPath: '/foreign', hubHint: false,
    jarState: { ...FILE_TARGET, canonicalPath: '/foreign/qortal.jar' }, origins: ['user-selected'],
    runningProcessMatch: false,
    settingsState: { canonicalPath: '/foreign/settings.json', dev: 1, ino: 2, mtimeMs: 1,
      sha256: adoptedRecord.adoptedSettings.sha256, size: 2 },
  } satisfies QortalInstallCandidate;
  const adopted: QortalInstallObservation = { candidate: adoptedCandidate, kind: 'adopted', record: adoptedRecord };
  const adoptedTargetState = { ...FILE_TARGET, canonicalPath: adoptedRecord.jarPath };
  const adoptedAuthority: QortalRuntimeAuthority = {
    ...AUTHORITY,
    canonicalCwd: adoptedRecord.installPath,
    canonicalJarPath: adoptedRecord.jarPath,
    owner: 'external',
  };
  let prepared = false;
  let spawned: { command: string; args: readonly string[]; cwd: string } | null = null;
  const adoptedManager = manager({ inspectInstall: async () => adopted,
    prepareCommand: (command, args) => { prepared = true; return {
      command: '/bin/bash', args: ['-c', 'exec "$@"', 'home-adopted', command, ...args],
    }; },
    readTargetState: async () => adoptedTargetState,
    spawnProcess: async (_target, command, args, options) => {
      spawned = { command, args, cwd: options.cwd };
      return { pid: adoptedAuthority.pid, startIdentity: adoptedAuthority.startIdentity, unref: () => {} };
    },
    stageCandidate: async () => { mutated = true; throw new Error('must not stage'); },
    stopWithApiKey: async () => { mutated = true; },
    waitForReadiness: async () => ({ authority: adoptedAuthority, state: 'running' }),
  });
  const status = await adoptedManager.getStatus();
  assert.deepEqual(status.capabilities,
    { canInitialInstall: false, canStart: true, canStop: false, canUpdate: false });
  assert.equal(status.updateOwnership.ownership, 'home-github');
  for (const result of [await adoptedManager.install('release'), await adoptedManager.update('release')]) {
    assert.equal(result.kind, 'blocked');
    if (result.kind === 'blocked') assert.equal(result.code, 'adopted-unsupported');
  }
  assert.equal((await adoptedManager.start()).kind, 'started');
  assert.equal(prepared, true);
  assert.deepEqual(spawned, { command: '/bin/bash',
    args: ['-c', 'exec "$@"', 'home-adopted', '/usr/bin/java', '-jar', adoptedRecord.jarPath, 'settings.json'],
    cwd: adoptedRecord.installPath });

  let launchBoundaryReads = 0;
  let launchBoundarySpawned = false;
  const changedAdoptedTargetState = { ...adoptedTargetState, sha256: `sha256:${'c'.repeat(64)}` };
  const launchBoundary = await manager({
    inspectInstall: async () => adopted,
    readTargetState: async () => {
      launchBoundaryReads += 1;
      return launchBoundaryReads === 3 ? changedAdoptedTargetState : adoptedTargetState;
    },
    spawnProcess: async () => { launchBoundarySpawned = true;
      return { pid: adoptedAuthority.pid, startIdentity: adoptedAuthority.startIdentity, unref: () => {} }; },
  }).start();
  assert.equal(launchBoundary.kind, 'blocked');
  if (launchBoundary.kind === 'blocked') assert.equal(launchBoundary.code, 'target-changed');
  assert.equal(launchBoundarySpawned, false,
    'a target mutation after the final stopped proof must prevent adopted launch');

  let runtimeBarrierReads = 0;
  let runtimeBarrierSpawned = false;
  const competingRuntime = await manager({
    inspectInstall: async () => adopted,
    inspectRuntime: async () => {
      runtimeBarrierReads += 1;
      return runtimeBarrierReads === 3
        ? { authority: adoptedAuthority, state: 'running' }
        : STOPPED;
    },
    readTargetState: async () => adoptedTargetState,
    spawnProcess: async () => { runtimeBarrierSpawned = true;
      return { pid: adoptedAuthority.pid, startIdentity: adoptedAuthority.startIdentity, unref: () => {} }; },
  }).start();
  assert.equal(competingRuntime.kind, 'blocked');
  if (competingRuntime.kind === 'blocked') assert.equal(competingRuntime.code, 'process-active');
  assert.equal(runtimeBarrierSpawned, false,
    'a competing runtime at the spawn-adjacent absence proof must prevent adopted launch');

  let confirmationReads = 0;
  let confirmationSpawned = false;
  const postLaunchMutation = await manager({
    inspectInstall: async () => adopted,
    readTargetState: async () => {
      confirmationReads += 1;
      return confirmationReads === 4 ? changedAdoptedTargetState : adoptedTargetState;
    },
    spawnProcess: async () => { confirmationSpawned = true;
      return { pid: adoptedAuthority.pid, startIdentity: adoptedAuthority.startIdentity, unref: () => {} }; },
    waitForReadiness: async () => ({ authority: adoptedAuthority, state: 'running' }),
  }).start();
  assert.equal(confirmationSpawned, true);
  assert.equal(postLaunchMutation.kind, 'start-unconfirmed');

  const stop = await adoptedManager.stop();
  assert.equal(stop.kind, 'blocked');
  if (stop.kind === 'blocked') assert.equal(stop.code, 'process-ownership-unproven');
  assert.equal(mutated, false);

  let lockedTarget = '';
  let keyTarget: QortalRuntimeTarget | null = null;
  let stopTarget: QortalRuntimeTarget | null = null;
  const runningAdoptedManager = manager({
    inspectInstall: async () => adopted,
    inspectRuntime: async () => ({ authority: adoptedAuthority, state: 'running' }),
    readApiKey: async (target) => { keyTarget = target; return 'private-test-key'; },
    readTargetState: async () => adoptedTargetState,
    stopWithApiKey: async (input) => { stopTarget = input.target; },
    waitForStopped: async () => STOPPED,
    withOperationLock: async (request, operation) => {
      lockedTarget = request.targetPath;
      return await operation({ canonicalTarget: request.targetPath, key: 'key',
        lockPath: path.join(LOCK_ROOT, 'key.lock'), ownerToken: 'a'.repeat(64) });
    },
  });
  const runningStatus = await runningAdoptedManager.getStatus();
  assert.deepEqual(runningStatus.capabilities,
    { canInitialInstall: false, canStart: false, canStop: true, canUpdate: false });
  assert.equal((await runningAdoptedManager.stop()).kind, 'stopped');
  const expectedAdoptedTarget: QortalRuntimeTarget = {
    installPath: adoptedRecord.installPath,
    jarPath: adoptedRecord.jarPath,
    owner: 'external',
  };
  assert.equal(lockedTarget, adoptedRecord.jarPath);
  assert.deepEqual(keyTarget, expectedAdoptedTarget);
  assert.deepEqual(stopTarget, expectedAdoptedTarget);

  let persistenceCalled = false;
  const persistenceManager = manager({
    inspectInstall: async () => ({ kind: 'missing' }),
    persistAdoptedSelection: async (candidate, detectedBy, paths, options) => {
      persistenceCalled = candidate === adoptedCandidate && detectedBy === 'user-selected' && paths === PATHS &&
        typeof options?.operations?.readSecureRecord === 'function';
      return { kind: 'unchanged', record: adoptedRecord };
    },
  }, false, { readAdoptedRecord: async () => Buffer.from('{}') });
  const persistence = await persistenceManager.persistAdoptedSelection(adoptedCandidate, 'user-selected');
  assert.equal(persistence.kind, 'unchanged');
  assert.equal(persistenceCalled, true);

  let dormantSelectionCalled = false;
  const managedSelection = await manager({
    persistAdoptedSelection: async () => { dormantSelectionCalled = true; return { kind: 'persisted', record: adoptedRecord }; },
  }).persistAdoptedSelection(adoptedCandidate, 'user-selected');
  assert.equal(managedSelection.kind, 'blocked');
  assert.equal(dormantSelectionCalled, false);
}

assert.equal(manager().descriptor.launch.kind, 'direct-jar');
assert.equal(manager().networkId, 'qortal');
console.log('Guarded Qortal Core manager checks passed.');
