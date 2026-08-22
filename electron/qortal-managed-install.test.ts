import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import {
  CoreJarInstallRecoveryError,
  runCoreJarInstallTransaction,
} from './core-jar-install-transaction.js';
import {
  parseQortalManagedInstallRecord,
  prepareQortalManagedInstall,
  QortalManagedInstallAtomicWriteError,
  QortalManagedInstallRollbackError,
  resolveQortalManagedInstallPaths,
  type QortalManagedInstallOperations,
  type QortalManagedInstallPaths,
} from './qortal-managed-install.js';
import type { QortalJarRelease } from './qortal-release-policy.js';

const identity = {
  buildTimestamp: '20260708200403',
  buildVersion: '6.1.9-108bf191d4',
  commit: '108bf191d42d710ec617f535af30cfd82fc03c87',
  semver: '6.1.9',
};
function createTestJar(jarIdentity: typeof identity) {
  return Buffer.from(zipSync({
    'build.properties': strToU8(
      `build.version=${jarIdentity.buildVersion}\nbuild.timestamp=${jarIdentity.buildTimestamp}\n`,
    ),
    'git.properties': strToU8(`git.commit.id.full=${jarIdentity.commit}\n`),
  }));
}

function releaseFor(tagName: string, jarBytes: Buffer, commit: string): QortalJarRelease {
  return {
    asset: {
      digest: `sha256:${createHash('sha256').update(jarBytes).digest('hex')}`,
      downloadUrl: `https://github.com/Qortal/qortal/releases/download/${tagName}/qortal.jar`,
      name: 'qortal.jar',
      size: jarBytes.length,
    },
    commit,
    tagName,
  };
}

const jarBytes = createTestJar(identity);
const release = releaseFor('v6.1.9', jarBytes, identity.commit);
const fixedNow = new Date('2026-08-21T12:34:56.000Z');

function createRoot(label: string) {
  return mkdtempSync(path.join(os.tmpdir(), `qortium-home-qortal-managed-${label}-`));
}

function pathsFor(root: string) {
  return resolveQortalManagedInstallPaths({
    appDataPath: path.join(root, 'app-data'),
    userDataPath: path.join(root, 'user-data'),
  });
}

function write(targetPath: string, contents: string | Buffer, mode = 0o600) {
  mkdirSync(path.dirname(targetPath), { mode: 0o700, recursive: true });
  writeFileSync(targetPath, contents, { mode });
}

function mode(targetPath: string) {
  return lstatSync(targetPath).mode & 0o777;
}

function referenceBase58(bytes: Uint8Array) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;

  for (const byte of bytes) value = (value << 8n) | BigInt(byte);

  let encoded = '';
  while (value > 0n) {
    encoded = `${alphabet[Number(value % 58n)]}${encoded}`;
    value /= 58n;
  }

  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return `${'1'.repeat(zeroes)}${encoded}`;
}

function deterministicOperations(
  overrides: Partial<QortalManagedInstallOperations> = {},
): Partial<QortalManagedInstallOperations> {
  let token = 0;

  return {
    now: () => fixedNow,
    randomBytes: (size) => {
      if (size === 16) return Uint8Array.from({ length: 16 }, (_, index) => index);
      token += 1;
      return Buffer.alloc(size, token);
    },
    ...overrides,
  };
}

async function createRealHandle(targetPath: string, fileMode: number) {
  const handle = await open(targetPath, 'wx', fileMode);

  return {
    close: () => handle.close(),
    stat: () => handle.stat(),
    sync: () => handle.sync(),
    write: async (contents: string | Uint8Array) => {
      await handle.writeFile(contents);
    },
  };
}

async function runInitial(
  paths: QortalManagedInstallPaths,
  operations: Partial<QortalManagedInstallOperations> = deterministicOperations(),
) {
  write(paths.candidateJarPath, jarBytes);
  const callbacks = await prepareQortalManagedInstall(
    { identity, kind: 'initial-install', paths, release },
    { operations },
  );
  await runCoreJarInstallTransaction({
    ...callbacks,
    backupJarPath: paths.backupJarPath,
    candidateJarPath: paths.candidateJarPath,
    targetJarPath: paths.jarPath,
  });
  return callbacks;
}

{
  const paths = resolveQortalManagedInstallPaths({
    appDataPath: '/home/alice/.config',
    runtimeOverride: '/tmp/must-not-split',
    userDataPath: '/home/alice/.config/Qortium Home',
  });
  assert.equal(paths.basePath, '/home/alice/.config/qortal-core');
  assert.equal(paths.installPath, '/home/alice/.config/qortal-core/install');
  assert.equal(paths.runtimePath, paths.installPath);
  assert.equal(paths.jarPath, path.join(paths.installPath, 'qortal.jar'));
  assert.equal(paths.settingsPath, path.join(paths.installPath, 'settings.json'));
  assert.equal(paths.apiKeyPath, path.join(paths.installPath, 'apikey.txt'));
  assert.equal(paths.currentMetadataPath, path.join(paths.basePath, 'current.json'));
  assert.equal(path.dirname(paths.candidateJarPath), paths.installPath);
  assert.equal(path.dirname(paths.backupJarPath), paths.installPath);
}

{
  const root = createRoot('initial-success');
  const paths = pathsFor(root);
  const events: string[] = [];

  try {
    const operations = deterministicOperations({
      openExclusive: async (targetPath, fileMode) => {
        events.push(`open:${path.basename(targetPath)}`);
        return createRealHandle(targetPath, fileMode);
      },
      rename: async (sourcePath, destinationPath) => {
        events.push(`rename:${path.basename(destinationPath)}`);
        await rename(sourcePath, destinationPath);
      },
    });
    const callbacks = await runInitial(paths, operations);
    const entropy = Uint8Array.from({ length: 16 }, (_, index) => index);
    const apiKey = readFileSync(paths.apiKeyPath, 'utf8');
    const metadataText = readFileSync(paths.currentMetadataPath, 'utf8');
    const metadata: unknown = JSON.parse(metadataText);

    assert.deepEqual(readFileSync(paths.jarPath), jarBytes);
    assert.equal(
      readFileSync(paths.settingsPath, 'utf8'),
      '{"autoUpdateEnabled":false}\n',
    );
    assert.deepEqual(JSON.parse(readFileSync(paths.settingsPath, 'utf8')), {
      autoUpdateEnabled: false,
    });
    assert.equal(apiKey, referenceBase58(entropy));
    assert.equal(apiKey.includes('\n'), false);
    assert.deepEqual(parseQortalManagedInstallRecord(metadata, paths), callbacks.record);
    assert.equal(callbacks.record.release.commit, identity.commit);
    const missingCommit = JSON.parse(metadataText) as { release: Record<string, unknown> };
    delete missingCommit.release.commit;
    assert.equal(parseQortalManagedInstallRecord(missingCommit, paths), null);
    const mismatchedCommit = JSON.parse(metadataText) as { release: Record<string, unknown> };
    mismatchedCommit.release.commit = 'b'.repeat(40);
    assert.equal(parseQortalManagedInstallRecord(mismatchedCommit, paths), null);
    assert.equal(metadataText.includes(apiKey), false);
    assert.equal(metadataText.includes('apiKey'), false);
    assert.equal(events.at(-1), 'rename:current.json', 'current.json must commit last');
    if (process.platform !== 'win32') {
      assert.equal(mode(paths.settingsPath), 0o600);
      assert.equal(mode(paths.apiKeyPath), 0o600);
      assert.equal(mode(paths.currentMetadataPath), 0o600);
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

for (const conflict of ['jarPath', 'settingsPath', 'apiKeyPath', 'currentMetadataPath'] as const) {
  const root = createRoot(`initial-conflict-${conflict}`);
  const paths = pathsFor(root);

  try {
    mkdirSync(paths.installPath, { mode: 0o700, recursive: true });
    write(paths[conflict], 'unexpected');
    await assert.rejects(
      prepareQortalManagedInstall(
        { identity, kind: 'initial-install', paths, release },
        { operations: deterministicOperations() },
      ),
      /requires an empty target/,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

{
  const root = createRoot('activated-jar-mismatch');
  const paths = pathsFor(root);

  try {
    write(paths.candidateJarPath, Buffer.alloc(jarBytes.length, 0x5a));
    const callbacks = await prepareQortalManagedInstall(
      { identity, kind: 'initial-install', paths, release },
      { operations: deterministicOperations() },
    );
    await assert.rejects(
      runCoreJarInstallTransaction({
        ...callbacks,
        backupJarPath: paths.backupJarPath,
        candidateJarPath: paths.candidateJarPath,
        targetJarPath: paths.jarPath,
      }),
      /does not match its verified release identity/i,
    );
    for (const targetPath of [
      paths.jarPath,
      paths.settingsPath,
      paths.apiKeyPath,
      paths.currentMetadataPath,
      paths.candidateJarPath,
    ]) {
      assert.equal(existsSync(targetPath), false);
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

if (process.platform !== 'win32') {
  const root = createRoot('insecure-directory');
  const paths = pathsFor(root);

  try {
    write(paths.candidateJarPath, jarBytes);
    chmodSync(paths.basePath, 0o777);
    await assert.rejects(
      prepareQortalManagedInstall(
        { identity, kind: 'initial-install', paths, release },
        { operations: deterministicOperations() },
      ),
      /directory is not private/i,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

{
  const root = createRoot('initial-metadata-failure');
  const paths = pathsFor(root);
  const metadataFailure = new Error('metadata rename failed');

  try {
    write(paths.candidateJarPath, jarBytes);
    const callbacks = await prepareQortalManagedInstall(
      { identity, kind: 'initial-install', paths, release },
      {
        operations: deterministicOperations({
          rename: async (sourcePath, destinationPath) => {
            if (destinationPath === paths.currentMetadataPath) throw metadataFailure;
            await rename(sourcePath, destinationPath);
          },
        }),
      },
    );

    await assert.rejects(
      runCoreJarInstallTransaction({
        ...callbacks,
        backupJarPath: paths.backupJarPath,
        candidateJarPath: paths.candidateJarPath,
        targetJarPath: paths.jarPath,
      }),
      (error) => error === metadataFailure,
    );
    for (const targetPath of [
      paths.jarPath,
      paths.settingsPath,
      paths.apiKeyPath,
      paths.currentMetadataPath,
      paths.candidateJarPath,
      paths.backupJarPath,
    ]) {
      assert.equal(existsSync(targetPath), false, `${targetPath} should be rolled back`);
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

{
  const root = createRoot('initial-effectful-metadata-rename-failure');
  const paths = pathsFor(root);
  const effectfulFailure = new Error('metadata rename committed but reported failure');

  try {
    write(paths.candidateJarPath, jarBytes);
    const callbacks = await prepareQortalManagedInstall(
      { identity, kind: 'initial-install', paths, release },
      {
        operations: deterministicOperations({
          rename: async (sourcePath, destinationPath) => {
            await rename(sourcePath, destinationPath);
            if (destinationPath === paths.currentMetadataPath) throw effectfulFailure;
          },
        }),
      },
    );
    await assert.rejects(
      runCoreJarInstallTransaction({
        ...callbacks,
        backupJarPath: paths.backupJarPath,
        candidateJarPath: paths.candidateJarPath,
        targetJarPath: paths.jarPath,
      }),
      (error) => error === effectfulFailure,
    );
    for (const targetPath of [
      paths.jarPath,
      paths.settingsPath,
      paths.apiKeyPath,
      paths.currentMetadataPath,
      paths.candidateJarPath,
    ]) {
      assert.equal(existsSync(targetPath), false);
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

{
  const root = createRoot('initial-atomic-cleanup-evidence');
  const paths = pathsFor(root);
  const metadataFailure = new Error('metadata rename failed');
  const temporaryCleanupFailure = new Error('metadata temp cleanup denied');

  try {
    write(paths.candidateJarPath, jarBytes);
    const callbacks = await prepareQortalManagedInstall(
      { identity, kind: 'initial-install', paths, release },
      {
        operations: deterministicOperations({
          rename: async (sourcePath, destinationPath) => {
            if (destinationPath === paths.currentMetadataPath) throw metadataFailure;
            await rename(sourcePath, destinationPath);
          },
          unlink: async (targetPath) => {
            if (targetPath.includes('current.json.qortium-home-')) {
              throw temporaryCleanupFailure;
            }
            await unlink(targetPath);
          },
        }),
      },
    );

    await assert.rejects(
      runCoreJarInstallTransaction({
        ...callbacks,
        backupJarPath: paths.backupJarPath,
        candidateJarPath: paths.candidateJarPath,
        targetJarPath: paths.jarPath,
      }),
      (error) => {
        assert(error instanceof QortalManagedInstallAtomicWriteError);
        assert.deepEqual(error.errors, [metadataFailure, temporaryCleanupFailure]);
        assert.equal(error.destinationPath, paths.currentMetadataPath);
        assert.equal(existsSync(error.temporaryPath), true);
        return true;
      },
    );
    assert.equal(existsSync(paths.jarPath), false);
    assert.equal(existsSync(paths.settingsPath), false);
    assert.equal(existsSync(paths.apiKeyPath), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

{
  const root = createRoot('initial-rollback-evidence');
  const paths = pathsFor(root);
  const activationFailure = new Error('post-metadata activation failed');
  const apiCleanupFailure = new Error('apikey cleanup denied');
  const cleanupOrder: string[] = [];

  try {
    write(paths.candidateJarPath, jarBytes);
    const callbacks = await prepareQortalManagedInstall(
      { identity, kind: 'initial-install', paths, release },
      {
        operations: deterministicOperations({
          unlink: async (targetPath) => {
            cleanupOrder.push(targetPath);
            if (targetPath === paths.apiKeyPath) throw apiCleanupFailure;
            await unlink(targetPath);
          },
        }),
      },
    );

    await assert.rejects(
      runCoreJarInstallTransaction({
        afterRollback: callbacks.afterRollback,
        afterSwap: async (context) => {
          await callbacks.afterSwap(context);
          throw activationFailure;
        },
        backupJarPath: paths.backupJarPath,
        candidateJarPath: paths.candidateJarPath,
        targetJarPath: paths.jarPath,
      }),
      (error) => {
        assert(error instanceof CoreJarInstallRecoveryError);
        assert.equal(error.errors[0], activationFailure);
        assert(error.errors[1] instanceof QortalManagedInstallRollbackError);
        assert.deepEqual(error.errors[1].errors, [apiCleanupFailure]);
        assert.deepEqual(error.errors[1].evidencePaths, [paths.apiKeyPath]);
        return true;
      },
    );
    assert.equal(existsSync(paths.candidateJarPath), true, 'candidate evidence must remain');
    assert.equal(existsSync(paths.apiKeyPath), true, 'failed-cleanup evidence must remain');
    assert.equal(existsSync(paths.settingsPath), false, 'other rollback cleanup must continue');
    assert.equal(existsSync(paths.currentMetadataPath), false);
    assert.deepEqual(cleanupOrder, [
      paths.currentMetadataPath,
      paths.apiKeyPath,
      paths.settingsPath,
    ]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

{
  const root = createRoot('update-success-and-rollback');
  const paths = pathsFor(root);

  try {
    await runInitial(paths);
    write(
      paths.settingsPath,
      '{"autoUpdateEnabled":true,"preserved":"existing-settings"}\n',
      0o640,
    );
    const preservedPaths = [
      paths.settingsPath,
      paths.apiKeyPath,
      path.join(paths.installPath, 'db', 'blockchain.dat'),
      path.join(paths.installPath, 'data', 'arbitrary.dat'),
      path.join(paths.installPath, 'lists', 'peers.json'),
      path.join(paths.installPath, 'wallets', 'wallet.dat'),
      path.join(paths.installPath, 'logs', 'qortal.log'),
    ];
    for (const [index, targetPath] of preservedPaths.entries()) {
      if (!existsSync(targetPath)) write(targetPath, `preserved-${index}`, 0o640);
    }
    const before = preservedPaths.map((targetPath) => {
      const stats = statSync(targetPath);
      return {
        bytes: readFileSync(targetPath),
        ino: stats.ino,
        mode: stats.mode,
        mtimeMs: stats.mtimeMs,
        path: targetPath,
      };
    });
    const firstMetadata = readFileSync(paths.currentMetadataPath);
    const updatedIdentity = {
      ...identity,
      buildVersion: '6.2.0-abcdef1234',
      commit: `abcdef1234${'0'.repeat(30)}`,
      semver: '6.2.0',
    };
    const updatedJarBytes = createTestJar(updatedIdentity);
    const updatedRelease = releaseFor('v6.2.0', updatedJarBytes, updatedIdentity.commit);

    write(paths.candidateJarPath, updatedJarBytes);
    const updateCallbacks = await prepareQortalManagedInstall(
      { identity: updatedIdentity, kind: 'update', paths, release: updatedRelease },
      { operations: deterministicOperations() },
    );
    await runCoreJarInstallTransaction({
      ...updateCallbacks,
      backupJarPath: paths.backupJarPath,
      candidateJarPath: paths.candidateJarPath,
      targetJarPath: paths.jarPath,
    });
    assert.deepEqual(readFileSync(paths.jarPath), updatedJarBytes);
    assert.deepEqual(
      parseQortalManagedInstallRecord(JSON.parse(readFileSync(paths.currentMetadataPath, 'utf8')), paths),
      updateCallbacks.record,
    );
    for (const expected of before) {
      const current = statSync(expected.path);
      assert.deepEqual(readFileSync(expected.path), expected.bytes);
      assert.equal(current.ino, expected.ino, `${expected.path} inode changed during JAR update`);
      assert.equal(current.mode, expected.mode, `${expected.path} mode changed during JAR update`);
      assert.equal(current.mtimeMs, expected.mtimeMs, `${expected.path} mtime changed during JAR update`);
    }

    const successfulMetadata = readFileSync(paths.currentMetadataPath);
    write(paths.candidateJarPath, jarBytes);
    const rollbackCallbacks = await prepareQortalManagedInstall(
      { identity, kind: 'update', paths, release },
      { operations: deterministicOperations() },
    );
    const activationFailure = new Error('updated Core failed readiness');
    await assert.rejects(
      runCoreJarInstallTransaction({
        afterRollback: rollbackCallbacks.afterRollback,
        afterSwap: async (context) => {
          await rollbackCallbacks.afterSwap(context);
          throw activationFailure;
        },
        backupJarPath: paths.backupJarPath,
        candidateJarPath: paths.candidateJarPath,
        targetJarPath: paths.jarPath,
      }),
      (error) => error === activationFailure,
    );
    assert.deepEqual(readFileSync(paths.jarPath), updatedJarBytes);
    assert.deepEqual(readFileSync(paths.currentMetadataPath), successfulMetadata);
    assert.notDeepEqual(successfulMetadata, firstMetadata);
    for (const expected of before) {
      const current = statSync(expected.path);
      assert.deepEqual(readFileSync(expected.path), expected.bytes);
      assert.equal(current.ino, expected.ino);
      assert.equal(current.mode, expected.mode);
      assert.equal(current.mtimeMs, expected.mtimeMs);
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

console.log('Qortal managed initial/update install setup and rollback checks passed.');
