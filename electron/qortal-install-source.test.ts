import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

  const record = createQortalAdoptedInstallRecord(first.candidate, 'user-selected', new Date('2026-08-21T22:00:00.000Z'));
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
