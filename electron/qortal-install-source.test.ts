import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { lstat as lstatAsync } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CoreJarIdentity } from './core-jar-identity.js';
import { readCoreJarTargetState } from './core-jar-target-state.js';
import { inspectQortalInstallSource } from './qortal-core-manager.js';
import {
  createQortalAdoptedInstallRecord,
  discoverQortalInstallCandidates,
  inspectQortalInstallCandidate,
  inspectRecordedQortalAdoptedInstall,
  parseQortalAdoptedInstallRecord,
  persistSelectedQortalAdoptedInstall,
  readQortalAdoptedInstallRecord,
  resolveQortalAdoptedInstallRecordPath,
} from './qortal-install-source.js';
import { resolveQortalManagedInstallPaths } from './qortal-managed-install.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'qortium-qortal-install-source-'));
const appDataPath = path.join(root, 'app-data');
const userDataPath = path.join(root, 'user-data');
const paths = resolveQortalManagedInstallPaths({ appDataPath, userDataPath });
const identity: CoreJarIdentity = {
  buildTimestamp: '20260821000000',
  buildVersion: '6.1.9-a1b2c3d4',
  commit: 'a1b2c3d4',
  semver: '6.1.9',
};
const operations = {
  readJarState: async (targetPath: string) => await readCoreJarTargetState(targetPath, {
    operations: { readIdentity: async () => identity },
  }),
};

function install(name: string) {
  const installPath = path.join(root, name);
  mkdirSync(installPath, { recursive: true });
  writeFileSync(path.join(installPath, 'qortal.jar'), `jar:${name}`);
  writeFileSync(path.join(installPath, 'settings.json'), '{}\n');
  return installPath;
}

try {
  assert.equal(resolveQortalAdoptedInstallRecordPath(paths), path.join(paths.basePath, 'adopted.json'));

  const firstPath = install('foreign-one');
  const first = await inspectQortalInstallCandidate({
    hubHint: true,
    installPath: firstPath,
    origin: 'qortal-hub',
    runningProcessMatch: true,
  }, paths, { operations });
  assert.equal(first.kind, 'candidate');
  if (first.kind !== 'candidate') throw new Error('Expected a valid Qortal candidate.');
  assert.equal(first.candidate.canonicalInstallPath, firstPath);
  assert.equal(first.candidate.jarState.sha256.startsWith('sha256:'), true);
  assert.equal(first.candidate.settingsState.canonicalPath, path.join(firstPath, 'settings.json'));

  const secondPath = install('foreign-two');
  const discovery = await discoverQortalInstallCandidates([
    { installPath: secondPath, origin: 'user-selected' },
    { hubHint: true, installPath: firstPath, origin: 'qortal-hub' },
    { installPath: firstPath, origin: 'running-process', runningProcessMatch: true },
    { installPath: path.join(root, 'missing'), origin: 'default-location' },
  ], paths, { operations });
  assert.equal(discovery.kind, 'observed');
  assert.equal(discovery.candidates.length, 2);
  const merged = discovery.candidates.find((candidate) => candidate.canonicalInstallPath === firstPath);
  assert.deepEqual(merged?.origins, ['qortal-hub', 'running-process']);
  assert.equal(merged?.hubHint, true);
  assert.equal(merged?.runningProcessMatch, true);

  if (process.platform !== 'win32') {
    const alias = path.join(root, 'foreign-one-alias');
    symlinkSync(firstPath, alias, 'dir');
    const deduped = await discoverQortalInstallCandidates([
      { installPath: firstPath, origin: 'user-selected' },
      { installPath: alias, origin: 'qortal-hub' },
    ], paths, { operations });
    assert.equal(deduped.candidates.length, 1);
    assert.deepEqual(deduped.candidates[0]?.origins, ['qortal-hub', 'user-selected']);

    const linkedSettingsPath = install('linked-settings');
    rmSync(path.join(linkedSettingsPath, 'settings.json'));
    symlinkSync(path.join(firstPath, 'settings.json'), path.join(linkedSettingsPath, 'settings.json'));
    assert.equal((await inspectQortalInstallCandidate({
      installPath: linkedSettingsPath,
      origin: 'user-selected',
    }, paths, { operations })).kind, 'unknown');

    const linkedJarPath = install('linked-jar');
    rmSync(path.join(linkedJarPath, 'qortal.jar'));
    symlinkSync(path.join(firstPath, 'qortal.jar'), path.join(linkedJarPath, 'qortal.jar'));
    assert.equal((await inspectQortalInstallCandidate({
      installPath: linkedJarPath,
      origin: 'user-selected',
    }, paths, { operations })).kind, 'unknown');
  }

  let installStatsReads = 0;
  assert.equal((await inspectQortalInstallCandidate({
    installPath: secondPath,
    origin: 'user-selected',
  }, paths, { operations: {
    ...operations,
    lstat: async (targetPath) => {
      const stats = await lstatAsync(targetPath);
      if (targetPath !== secondPath) return stats;
      installStatsReads += 1;
      return installStatsReads === 1 ? stats : {
        dev: stats.dev, ino: stats.ino + 1, isDirectory: () => stats.isDirectory(),
        isFile: () => stats.isFile(), isSymbolicLink: () => stats.isSymbolicLink(),
        mode: stats.mode, mtimeMs: stats.mtimeMs, size: stats.size, uid: stats.uid,
      };
    },
  } })).kind, 'unknown');

  mkdirSync(paths.installPath, { recursive: true });
  writeFileSync(paths.jarPath, 'managed jar');
  writeFileSync(paths.settingsPath, '{}\n');
  const ordered = await discoverQortalInstallCandidates([
    { installPath: firstPath, origin: 'user-selected' },
    { installPath: paths.installPath, origin: 'default-location' },
  ], paths, { operations });
  assert.equal(ordered.candidates[0]?.origins.includes('home-managed'), true);
  assert.throws(
    () => createQortalAdoptedInstallRecord(ordered.candidates[0]!, 'user-selected'),
    /Home-managed.*cannot be recorded as adopted/i,
  );

  assert.throws(
    () => createQortalAdoptedInstallRecord(first.candidate, 'user-selected'),
    /detection source.*not observed/i,
  );
  const record = createQortalAdoptedInstallRecord(first.candidate, 'qortal-hub', new Date('2026-08-21T22:00:00.000Z'));
  assert.equal(parseQortalAdoptedInstallRecord(record)?.installPath, firstPath);
  assert.equal(parseQortalAdoptedInstallRecord({ ...record, extra: true }), null);
  assert.equal(parseQortalAdoptedInstallRecord({ ...record, jarPath: path.join(firstPath, 'other.jar') }), null);
  assert.equal(parseQortalAdoptedInstallRecord({ ...record,
    adoptedJar: { ...record.adoptedJar, canonicalPath: 7 } }), null);
  assert.equal(parseQortalAdoptedInstallRecord({ ...record,
    adoptedSettings: { ...record.adoptedSettings, canonicalPath: null } }), null);
  assert.equal(parseQortalAdoptedInstallRecord({ ...record,
    adoptedAt: '2026-08-21 22:00:00Z' }), null);
  assert.equal(parseQortalAdoptedInstallRecord({ ...record,
    installPath: `${firstPath}/./` }), null);
  assert.equal(parseQortalAdoptedInstallRecord({ ...record,
    installPath: `${firstPath}\0suffix` }), null);
  assert.equal((await inspectRecordedQortalAdoptedInstall(record, paths, { operations })).kind, 'candidate');
  const settingsStats = await lstatAsync(path.join(firstPath, 'settings.json'));
  const sameSizeReplacement = Buffer.from('[]\n');
  assert.equal(sameSizeReplacement.length, record.adoptedSettings.size);
  assert.equal((await inspectRecordedQortalAdoptedInstall(record, paths, { operations: {
    ...operations,
    openSettings: async () => ({
      close: async () => {},
      read: async (buffer: Buffer, offset: number, length: number, position: number) => {
        const bytesRead = Math.min(length, Math.max(0, sameSizeReplacement.length - position));
        sameSizeReplacement.copy(buffer, offset, position, position + bytesRead);
        return { bytesRead };
      },
      stat: async () => settingsStats,
    }),
  } })).kind, 'unknown',
  'settings content changes must be rejected even when size and filesystem metadata are unchanged');

  const persistencePaths = resolveQortalManagedInstallPaths({
    appDataPath: path.join(root, 'persist-app-data'),
    userDataPath: path.join(root, 'persist-user-data'),
  });
  const adoptedDirectoryBefore = readdirSync(firstPath).sort().map((name) => [
    name,
    readFileSync(path.join(firstPath, name)).toString('hex'),
  ]);
  const persistenceOperations = {
    ...operations,
    ...(process.platform === 'win32' ? {
      readSecureRecord: async (targetPath: string) => readFileSync(targetPath),
    } : {}),
    now: () => new Date('2026-08-21T23:00:00.000Z'),
  };
  if (process.platform !== 'win32') {
  const digestSelectionPaths = resolveQortalManagedInstallPaths({
    appDataPath: path.join(root, 'digest-selection-app-data'),
    userDataPath: path.join(root, 'digest-selection-user-data'),
  });
  const digestChangedSelection = await persistSelectedQortalAdoptedInstall(
    first.candidate,
    'qortal-hub',
    digestSelectionPaths,
    { operations: {
      ...persistenceOperations,
      openSettings: async () => ({
        close: async () => {},
        read: async (buffer: Buffer, offset: number, length: number, position: number) => {
          const bytesRead = Math.min(length, Math.max(0, sameSizeReplacement.length - position));
          sameSizeReplacement.copy(buffer, offset, position, position + bytesRead);
          return { bytesRead };
        },
        stat: async () => settingsStats,
      }),
    } },
  );
  assert.equal(digestChangedSelection.kind, 'blocked');
  assert.equal(existsSync(digestSelectionPaths.basePath), false,
    'persistence must not rebind changed settings bytes to the selected filesystem metadata');

  const persisted = await persistSelectedQortalAdoptedInstall(
    first.candidate,
    'qortal-hub',
    persistencePaths,
    { operations: persistenceOperations },
  );
  assert.equal(persisted.kind, 'persisted');
  const persistedPath = resolveQortalAdoptedInstallRecordPath(persistencePaths);
  const persistedBytes = readFileSync(persistedPath);
  assert.equal(statSync(persistedPath).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(firstPath).sort().map((name) => [
    name,
    readFileSync(path.join(firstPath, name)).toString('hex'),
  ]), adoptedDirectoryBefore, 'persistence must not write into the adopted install directory');

  const unchanged = await persistSelectedQortalAdoptedInstall(
    first.candidate,
    'qortal-hub',
    persistencePaths,
    { operations: { ...persistenceOperations, now: () => new Date('2026-08-22T01:00:00.000Z') } },
  );
  assert.equal(unchanged.kind, 'unchanged');
  assert.deepEqual(readFileSync(persistedPath), persistedBytes, 'idempotence must not rewrite the selected record');

  const second = await inspectQortalInstallCandidate({
    installPath: secondPath,
    origin: 'user-selected',
  }, persistencePaths, { operations });
  assert.equal(second.kind, 'candidate');
  if (second.kind !== 'candidate') throw new Error('Expected a second valid Qortal candidate.');
  const different = await persistSelectedQortalAdoptedInstall(
    second.candidate,
    'user-selected',
    persistencePaths,
    { operations: persistenceOperations },
  );
  assert.equal(different.kind, 'blocked');
  assert.deepEqual(readFileSync(persistedPath), persistedBytes, 'a different selection must never overwrite the record');

  const malformedPaths = resolveQortalManagedInstallPaths({
    appDataPath: path.join(root, 'malformed-app-data'),
    userDataPath: path.join(root, 'malformed-user-data'),
  });
  mkdirSync(malformedPaths.basePath, { mode: 0o700, recursive: true });
  const malformedPath = resolveQortalAdoptedInstallRecordPath(malformedPaths);
  writeFileSync(malformedPath, '{broken', { mode: 0o600 });
  chmodSync(malformedPath, 0o600);
  const malformed = await persistSelectedQortalAdoptedInstall(
    first.candidate,
    'qortal-hub',
    malformedPaths,
    { operations: persistenceOperations },
  );
  assert.equal(malformed.kind, 'blocked');
  assert.equal(readFileSync(malformedPath, 'utf8'), '{broken');
  chmodSync(malformedPath, 0o644);
  const insecure = await persistSelectedQortalAdoptedInstall(
    first.candidate,
    'qortal-hub',
    malformedPaths,
    { operations: persistenceOperations },
  );
  assert.equal(insecure.kind, 'blocked');
  assert.equal(readFileSync(malformedPath, 'utf8'), '{broken');

  const stalePaths = resolveQortalManagedInstallPaths({
    appDataPath: path.join(root, 'stale-app-data'),
    userDataPath: path.join(root, 'stale-user-data'),
  });
  const stalePath = install('stale-selected');
  const stale = await inspectQortalInstallCandidate({
    installPath: stalePath,
    origin: 'user-selected',
  }, stalePaths, { operations });
  assert.equal(stale.kind, 'candidate');
  if (stale.kind !== 'candidate') throw new Error('Expected a stale-test Qortal candidate.');
  writeFileSync(path.join(stalePath, 'qortal.jar'), 'changed after selection');
  const staleResult = await persistSelectedQortalAdoptedInstall(
    stale.candidate,
    'user-selected',
    stalePaths,
    { operations: persistenceOperations },
  );
  assert.equal(staleResult.kind, 'blocked');
  assert.equal(existsSync(stalePaths.basePath), false, 'stale selection must be rejected before appData mutation');

  const boundaryPaths = resolveQortalManagedInstallPaths({
    appDataPath: path.join(root, 'boundary-app-data'),
    userDataPath: path.join(root, 'boundary-user-data'),
  });
  const boundaryPath = install('boundary-selected');
  const boundary = await inspectQortalInstallCandidate({
    installPath: boundaryPath,
    origin: 'user-selected',
  }, boundaryPaths, { operations });
  assert.equal(boundary.kind, 'candidate');
  if (boundary.kind !== 'candidate') throw new Error('Expected a boundary-test Qortal candidate.');
  let boundaryJarReads = 0;
  const boundaryResult = await persistSelectedQortalAdoptedInstall(
    boundary.candidate,
    'user-selected',
    boundaryPaths,
    { operations: {
      ...persistenceOperations,
      readJarState: async (targetPath) => {
        boundaryJarReads += 1;
        if (boundaryJarReads === 2) writeFileSync(targetPath, 'changed at commit boundary');
        return await operations.readJarState(targetPath);
      },
    } },
  );
  assert.equal(boundaryResult.kind, 'blocked');
  assert.equal(existsSync(resolveQortalAdoptedInstallRecordPath(boundaryPaths)), false,
    'a selection changing at the final barrier must not be committed');

  const rollbackPaths = resolveQortalManagedInstallPaths({
    appDataPath: path.join(root, 'post-link-rollback-app-data'),
    userDataPath: path.join(root, 'post-link-rollback-user-data'),
  });
  const rollback = await persistSelectedQortalAdoptedInstall(
    first.candidate,
    'qortal-hub',
    rollbackPaths,
    { operations: {
      ...persistenceOperations,
      syncDirectory: async () => { throw new Error('directory sync failed'); },
    } },
  );
  assert.equal(rollback.kind, 'unknown');
  assert.equal(existsSync(resolveQortalAdoptedInstallRecordPath(rollbackPaths)), false,
    'a failed post-link verification must roll back only the still-owned destination');
  assert.deepEqual(readdirSync(rollbackPaths.basePath), [],
    'a failed post-link verification must clean its still-owned temporary name');

  const durableRollbackPaths = resolveQortalManagedInstallPaths({
    appDataPath: path.join(root, 'durable-rollback-app-data'),
    userDataPath: path.join(root, 'durable-rollback-user-data'),
  });
  let durableRollbackJarReads = 0;
  let durableRollbackSyncs = 0;
  const durableRollback = await persistSelectedQortalAdoptedInstall(
    first.candidate,
    'qortal-hub',
    durableRollbackPaths,
    { operations: {
      ...persistenceOperations,
      readJarState: async (targetPath) => {
        durableRollbackJarReads += 1;
        return durableRollbackJarReads === 3
          ? { ...first.candidate.jarState, sha256: `sha256:${'e'.repeat(64)}` }
          : await operations.readJarState(targetPath);
      },
      syncDirectory: async () => { durableRollbackSyncs += 1; },
    } },
  );
  assert.equal(durableRollback.kind, 'unknown');
  assert.equal(durableRollbackSyncs, 2,
    'a post-link rollback must sync both publication and removal from the record directory');
  assert.equal(existsSync(resolveQortalAdoptedInstallRecordPath(durableRollbackPaths)), false);

  const concurrentPaths = resolveQortalManagedInstallPaths({
    appDataPath: path.join(root, 'concurrent-app-data'),
    userDataPath: path.join(root, 'concurrent-user-data'),
  });
  const concurrent = await Promise.all([
    persistSelectedQortalAdoptedInstall(first.candidate, 'qortal-hub', concurrentPaths, {
      operations: persistenceOperations,
    }),
    persistSelectedQortalAdoptedInstall(second.candidate, 'user-selected', concurrentPaths, {
      operations: persistenceOperations,
    }),
  ]);
  assert.equal(concurrent.filter((result) => result.kind === 'persisted').length, 1);
  assert.equal(concurrent.filter((result) => result.kind === 'blocked').length, 1);
  assert.equal((await readQortalAdoptedInstallRecord(
    resolveQortalAdoptedInstallRecordPath(concurrentPaths),
    { operations: persistenceOperations },
  )).kind, 'record');

  const collisionPaths = resolveQortalManagedInstallPaths({
    appDataPath: path.join(root, 'collision-app-data'),
    userDataPath: path.join(root, 'collision-user-data'),
  });
  mkdirSync(collisionPaths.basePath, { mode: 0o700, recursive: true });
  const collisionTemporaryPath = path.join(collisionPaths.basePath, `.adopted-${'01'.repeat(12)}.tmp`);
  writeFileSync(collisionTemporaryPath, 'retained collision', { mode: 0o600 });
  const collision = await persistSelectedQortalAdoptedInstall(
    first.candidate,
    'qortal-hub',
    collisionPaths,
    { operations: { ...persistenceOperations, randomBytes: () => Buffer.alloc(12, 1) } },
  );
  assert.equal(collision.kind, 'unknown');
  assert.equal(readFileSync(collisionTemporaryPath, 'utf8'), 'retained collision');
  assert.equal(existsSync(resolveQortalAdoptedInstallRecordPath(collisionPaths)), false);

  const aliasPaths = resolveQortalManagedInstallPaths({
    appDataPath: path.join(root, 'alias-app-data'),
    userDataPath: path.join(root, 'alias-user-data'),
  });
  const aliasTarget = path.join(root, 'aliased-app-data-target', 'qortal-core');
  mkdirSync(aliasTarget, { mode: 0o700, recursive: true });
  mkdirSync(path.dirname(aliasPaths.basePath), { recursive: true });
  symlinkSync(aliasTarget, aliasPaths.basePath, 'dir');
  const aliased = await persistSelectedQortalAdoptedInstall(
    first.candidate,
    'qortal-hub',
    aliasPaths,
    { operations: persistenceOperations },
  );
  assert.equal(aliased.kind, 'unknown');
  assert.equal(existsSync(path.join(aliasTarget, 'adopted.json')), false);

  const publicPaths = resolveQortalManagedInstallPaths({
    appDataPath: path.join(root, 'public-app-data'),
    userDataPath: path.join(root, 'public-user-data'),
  });
  mkdirSync(publicPaths.basePath, { mode: 0o755, recursive: true });
  chmodSync(publicPaths.basePath, 0o755);
  const publicDirectory = await persistSelectedQortalAdoptedInstall(
    first.candidate,
    'qortal-hub',
    publicPaths,
    { operations: persistenceOperations },
  );
  assert.equal(publicDirectory.kind, 'unknown');
  assert.equal(existsSync(resolveQortalAdoptedInstallRecordPath(publicPaths)), false,
    'a group/world-accessible appData directory must not receive the selected record');
  }

  let unsupportedWindowsMutations = 0;
  const unsupportedWindows = await persistSelectedQortalAdoptedInstall(
    first.candidate,
    'qortal-hub',
    resolveQortalManagedInstallPaths({
      appDataPath: path.join(root, 'unsupported-windows-app-data'),
      userDataPath: path.join(root, 'unsupported-windows-user-data'),
    }),
    { platform: 'win32', operations: {
      ...operations,
      mkdir: async () => { unsupportedWindowsMutations += 1; },
      openPrivate: async () => { unsupportedWindowsMutations += 1; throw new Error('must not open'); },
    } },
  );
  assert.equal(unsupportedWindows.kind, 'blocked');
  assert.equal(unsupportedWindowsMutations, 0);

  let supportedWindowsMutations = 0;
  const windowsBlocked = await persistSelectedQortalAdoptedInstall(
    first.candidate,
    'qortal-hub',
    resolveQortalManagedInstallPaths({
      appDataPath: path.join(root, 'windows-app-data'),
      userDataPath: path.join(root, 'windows-user-data'),
    }),
    { platform: 'win32', operations: {
      ...operations,
      mkdir: async () => { supportedWindowsMutations += 1; },
      openPrivate: async () => { supportedWindowsMutations += 1; throw new Error('must not open'); },
      readSecureRecord: async () => Buffer.from('{}'),
    } },
  );
  assert.equal(windowsBlocked.kind, 'blocked');
  assert.equal(supportedWindowsMutations, 0,
    'Windows selected-record persistence must remain disabled without a native secure writer');

  mkdirSync(paths.basePath, { recursive: true });
  const recordPath = resolveQortalAdoptedInstallRecordPath(paths);
  writeFileSync(recordPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(recordPath, 0o600);
  const recordReadOperations = process.platform === 'win32'
    ? { readSecureRecord: async (targetPath: string) => readFileSync(targetPath) }
    : {};
  assert.equal((await readQortalAdoptedInstallRecord(path.join(paths.basePath, 'absent.json'),
    { platform: 'win32' })).kind, 'missing');
  assert.equal((await readQortalAdoptedInstallRecord(recordPath, { platform: 'win32' })).kind, 'unknown');
  assert.equal((await readQortalAdoptedInstallRecord(recordPath, { platform: 'win32', operations: {
    readSecureRecord: async () => Buffer.from(`${JSON.stringify(record)}\n`),
  } })).kind, 'record');
  const read = await readQortalAdoptedInstallRecord(recordPath, { operations: recordReadOperations });
  assert.equal(read.kind, 'record');
  if (read.kind === 'record') assert.equal(read.record.adoptedJar.sha256, record.adoptedJar.sha256);
  rmSync(paths.installPath, { force: true, recursive: true });
  const integrated = await inspectQortalInstallSource(paths, recordPath, { operations: {
    ...operations,
    ...recordReadOperations,
  } });
  assert.equal(integrated.kind, 'adopted');
  if (integrated.kind === 'adopted') assert.equal(integrated.record.installPath, firstPath);
  writeFileSync(path.join(firstPath, 'qortal.jar'), 'changed jar');
  assert.equal((await inspectRecordedQortalAdoptedInstall(record, paths, { operations })).kind, 'unknown');
  writeFileSync(path.join(firstPath, 'qortal.jar'), 'jar:foreign-one');
  writeFileSync(path.join(firstPath, 'settings.json'), '{"changed":true}\n');
  assert.equal((await inspectRecordedQortalAdoptedInstall(record, paths, { operations })).kind, 'unknown');
  writeFileSync(recordPath, '{broken', { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(recordPath, 0o600);
  assert.equal((await readQortalAdoptedInstallRecord(recordPath, { operations: recordReadOperations })).kind, 'unknown');
  rmSync(recordPath);
  assert.equal((await readQortalAdoptedInstallRecord(recordPath, { operations: recordReadOperations })).kind, 'missing');
  writeFileSync(recordPath, Buffer.from([0xff]), { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(recordPath, 0o600);
  assert.equal((await readQortalAdoptedInstallRecord(recordPath, { operations: recordReadOperations })).kind, 'unknown');
  writeFileSync(recordPath, Buffer.alloc(32 * 1024 + 1), { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(recordPath, 0o600);
  assert.equal((await readQortalAdoptedInstallRecord(recordPath, { operations: recordReadOperations })).kind, 'unknown');
  if (process.platform !== 'win32') {
    chmodSync(recordPath, 0o644);
    assert.equal((await readQortalAdoptedInstallRecord(recordPath)).kind, 'unknown');
    rmSync(recordPath);
    const recordTarget = path.join(paths.basePath, 'record-target.json');
    writeFileSync(recordTarget, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    symlinkSync(recordTarget, recordPath, 'file');
    assert.equal((await readQortalAdoptedInstallRecord(recordPath)).kind, 'unknown');
  }
} finally {
  rmSync(root, { force: true, recursive: true });
}

console.log('Qortal install-source discovery and adopted-record checks passed.');
