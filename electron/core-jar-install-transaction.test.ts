import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CoreJarInstallCleanupError,
  CoreJarInstallRecoveryError,
  runCoreJarInstallTransaction,
  type CoreJarInstallTransactionContext,
} from './core-jar-install-transaction.js';

function createPaths(label: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), `qortium-home-${label}-`));

  return {
    backup: path.join(root, '.qortium-home-qortal-backup.jar'),
    candidate: path.join(root, '.qortium-home-qortal-candidate.jar'),
    root,
    target: path.join(root, 'qortal.jar'),
  };
}

function write(targetPath: string, value: string) {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, value, 'utf8');
}

function read(targetPath: string) {
  return readFileSync(targetPath, 'utf8');
}

async function withPaths(
  label: string,
  callback: (paths: ReturnType<typeof createPaths>) => Promise<void>,
) {
  const paths = createPaths(label);

  try {
    await callback(paths);
  } finally {
    rmSync(paths.root, { force: true, recursive: true });
  }
}

function callbacks(overrides: {
  afterRollback?: (context: CoreJarInstallTransactionContext) => Promise<void>;
  afterSwap?: (context: CoreJarInstallTransactionContext) => Promise<void>;
} = {}) {
  return {
    afterRollback: overrides.afterRollback ?? (async () => {}),
    afterSwap: overrides.afterSwap ?? (async () => {}),
  };
}

function snapshotFiles(root: string, relativePaths: readonly string[]) {
  return Object.fromEntries(
    relativePaths.map((relativePath) => {
      const targetPath = path.join(root, relativePath);
      const stats = statSync(targetPath);

      return [relativePath, {
        contents: readFileSync(targetPath).toString('hex'),
        ino: stats.ino,
        mode: stats.mode,
        mtimeMs: stats.mtimeMs,
        size: stats.size,
      }];
    }),
  );
}

await withPaths('jar-initial-success', async (paths) => {
  write(paths.candidate, 'candidate');
  const callbackOrder: string[] = [];
  const renameCalls: Array<[string, string]> = [];

  const result = await runCoreJarInstallTransaction({
    ...callbacks({
      afterSwap: async (context) => {
        callbackOrder.push('afterSwap');
        assert.deepEqual(context, { kind: 'initial-install', targetJarPath: paths.target });
        assert.equal(read(paths.target), 'candidate');
        assert.equal(existsSync(paths.candidate), false);
        assert.equal(existsSync(paths.backup), false);
      },
    }),
    backupJarPath: paths.backup,
    candidateJarPath: paths.candidate,
    operations: {
      rename: async (sourcePath, destinationPath) => {
        renameCalls.push([sourcePath, destinationPath]);
        await rename(sourcePath, destinationPath);
      },
    },
    targetJarPath: paths.target,
  });

  assert.deepEqual(result, { kind: 'initial-install', targetJarPath: paths.target });
  assert.deepEqual(callbackOrder, ['afterSwap']);
  assert.deepEqual(renameCalls, [[paths.candidate, paths.target]]);
  assert.equal(read(paths.target), 'candidate');
  assert.equal(existsSync(paths.candidate), false);
  assert.equal(existsSync(paths.backup), false);
});

await withPaths('jar-initial-rollback', async (paths) => {
  write(paths.candidate, 'candidate');
  const metadataPath = path.join(paths.root, 'current.json');
  const installError = new Error('metadata commit failed');
  const callbackOrder: string[] = [];

  await assert.rejects(
    runCoreJarInstallTransaction({
      ...callbacks({
        afterSwap: async () => {
          callbackOrder.push('afterSwap');
          assert.equal(read(paths.target), 'candidate');
          write(metadataPath, 'candidate metadata');
          throw installError;
        },
        afterRollback: async (context) => {
          callbackOrder.push('afterRollback');
          assert.equal(context.kind, 'initial-install');
          assert.equal(existsSync(paths.target), false);
          assert.equal(read(paths.candidate), 'candidate');
          assert.equal(existsSync(paths.backup), false);
          assert.equal(read(metadataPath), 'candidate metadata');
          unlinkSync(metadataPath);
        },
      }),
      backupJarPath: paths.backup,
      candidateJarPath: paths.candidate,
      targetJarPath: paths.target,
    }),
    (error) => error === installError,
  );

  assert.deepEqual(callbackOrder, ['afterSwap', 'afterRollback']);
  assert.equal(existsSync(paths.target), false);
  assert.equal(existsSync(paths.candidate), false);
  assert.equal(existsSync(paths.backup), false);
  assert.equal(existsSync(metadataPath), false);
});

await withPaths('jar-update-success-preserves-runtime', async (paths) => {
  write(paths.target, 'previous');
  write(paths.candidate, 'candidate');
  const preservedFiles = [
    'settings.json',
    'apikey.txt',
    path.join('db', 'blockchain.dat'),
    path.join('data', 'arbitrary.dat'),
    path.join('lists', 'peers.json'),
    path.join('logs', 'qortal.log'),
  ] as const;

  for (const [index, relativePath] of preservedFiles.entries()) {
    write(path.join(paths.root, relativePath), `preserved-${index}`);
  }

  const before = snapshotFiles(paths.root, preservedFiles);
  const renameCalls: Array<[string, string]> = [];

  const result = await runCoreJarInstallTransaction({
    ...callbacks({
      afterSwap: async (context) => {
        assert.equal(context.kind, 'update');
        assert.equal(read(paths.target), 'candidate');
        assert.equal(read(paths.backup), 'previous');
        assert.equal(existsSync(paths.candidate), false);
        assert.deepEqual(snapshotFiles(paths.root, preservedFiles), before);
      },
    }),
    backupJarPath: paths.backup,
    candidateJarPath: paths.candidate,
    operations: {
      rename: async (sourcePath, destinationPath) => {
        renameCalls.push([sourcePath, destinationPath]);
        await rename(sourcePath, destinationPath);
      },
    },
    targetJarPath: paths.target,
  });

  assert.deepEqual(result, { kind: 'update', targetJarPath: paths.target });
  assert.deepEqual(renameCalls, [
    [paths.target, paths.backup],
    [paths.candidate, paths.target],
  ]);
  assert.equal(read(paths.target), 'candidate');
  assert.equal(existsSync(paths.candidate), false);
  assert.equal(existsSync(paths.backup), false);
  assert.deepEqual(snapshotFiles(paths.root, preservedFiles), before);
});

await withPaths('jar-update-rollback-preserves-runtime', async (paths) => {
  write(paths.target, 'previous');
  write(paths.candidate, 'candidate');
  const metadataPath = path.join(paths.root, 'current.json');
  const preservedFiles = [
    'settings.json',
    path.join('db', 'blockchain.dat'),
    path.join('data', 'arbitrary.dat'),
    path.join('lists', 'peers.json'),
    path.join('logs', 'qortal.log'),
  ] as const;

  write(metadataPath, 'previous metadata');
  for (const [index, relativePath] of preservedFiles.entries()) {
    write(path.join(paths.root, relativePath), `preserved-${index}`);
  }

  const before = snapshotFiles(paths.root, preservedFiles);
  const installError = new Error('candidate activation failed');
  const callbackOrder: string[] = [];
  const renameCalls: Array<[string, string]> = [];

  await assert.rejects(
    runCoreJarInstallTransaction({
      ...callbacks({
        afterSwap: async () => {
          callbackOrder.push('afterSwap');
          assert.equal(read(paths.target), 'candidate');
          assert.equal(read(paths.backup), 'previous');
          writeFileSync(metadataPath, 'candidate metadata', 'utf8');
          throw installError;
        },
        afterRollback: async (context) => {
          callbackOrder.push('afterRollback');
          assert.equal(context.kind, 'update');
          assert.equal(read(paths.target), 'previous');
          assert.equal(existsSync(paths.backup), false);
          assert.equal(read(paths.candidate), 'candidate');
          assert.equal(read(metadataPath), 'candidate metadata');
          writeFileSync(metadataPath, 'previous metadata', 'utf8');
        },
      }),
      backupJarPath: paths.backup,
      candidateJarPath: paths.candidate,
      operations: {
        rename: async (sourcePath, destinationPath) => {
          renameCalls.push([sourcePath, destinationPath]);
          await rename(sourcePath, destinationPath);
        },
      },
      targetJarPath: paths.target,
    }),
    (error) => error === installError,
  );

  assert.deepEqual(callbackOrder, ['afterSwap', 'afterRollback']);
  assert.deepEqual(renameCalls, [
    [paths.target, paths.backup],
    [paths.candidate, paths.target],
    [paths.target, paths.candidate],
    [paths.backup, paths.target],
  ]);
  assert.equal(read(paths.target), 'previous');
  assert.equal(read(metadataPath), 'previous metadata');
  assert.equal(existsSync(paths.candidate), false);
  assert.equal(existsSync(paths.backup), false);
  assert.deepEqual(snapshotFiles(paths.root, preservedFiles), before);
});

await withPaths('jar-target-backup-failure', async (paths) => {
  write(paths.target, 'previous');
  write(paths.candidate, 'candidate');
  const moveError = new Error('target remained busy');
  let callbackCount = 0;

  await assert.rejects(
    runCoreJarInstallTransaction({
      afterRollback: async () => { callbackCount += 1; },
      afterSwap: async () => { callbackCount += 1; },
      backupJarPath: paths.backup,
      candidateJarPath: paths.candidate,
      operations: {
        rename: async () => { throw moveError; },
      },
      platform: 'linux',
      targetJarPath: paths.target,
    }),
    (error) => error === moveError,
  );

  assert.equal(callbackCount, 0);
  assert.equal(read(paths.target), 'previous');
  assert.equal(existsSync(paths.candidate), false);
  assert.equal(existsSync(paths.backup), false);
});

await withPaths('jar-candidate-move-failure-recovers', async (paths) => {
  write(paths.target, 'previous');
  write(paths.candidate, 'candidate');
  const moveError = Object.assign(new Error('atomic candidate rename failed'), { code: 'EXDEV' });
  const renameCalls: Array<[string, string]> = [];
  let callbackCount = 0;

  await assert.rejects(
    runCoreJarInstallTransaction({
      afterRollback: async () => { callbackCount += 1; },
      afterSwap: async () => { callbackCount += 1; },
      backupJarPath: paths.backup,
      candidateJarPath: paths.candidate,
      operations: {
        rename: async (sourcePath, destinationPath) => {
          renameCalls.push([sourcePath, destinationPath]);
          if (sourcePath === paths.candidate) throw moveError;
          await rename(sourcePath, destinationPath);
        },
      },
      targetJarPath: paths.target,
    }),
    (error) => error === moveError,
  );

  assert.equal(callbackCount, 0);
  assert.deepEqual(renameCalls, [
    [paths.target, paths.backup],
    [paths.candidate, paths.target],
    [paths.backup, paths.target],
  ]);
  assert.equal(read(paths.target), 'previous');
  assert.equal(existsSync(paths.candidate), false);
  assert.equal(existsSync(paths.backup), false);
});

await withPaths('jar-restore-failure-preserves-recovery-files', async (paths) => {
  write(paths.target, 'previous');
  write(paths.candidate, 'candidate');
  const moveError = new Error('candidate rename failed');
  const restoreError = new Error('backup rename failed');
  let callbackCount = 0;

  await assert.rejects(
    runCoreJarInstallTransaction({
      afterRollback: async () => { callbackCount += 1; },
      afterSwap: async () => { callbackCount += 1; },
      backupJarPath: paths.backup,
      candidateJarPath: paths.candidate,
      operations: {
        rename: async (sourcePath, destinationPath) => {
          if (sourcePath === paths.candidate) throw moveError;
          if (sourcePath === paths.backup) throw restoreError;
          await rename(sourcePath, destinationPath);
        },
      },
      targetJarPath: paths.target,
    }),
    (error) => {
      assert(error instanceof CoreJarInstallRecoveryError);
      assert.deepEqual(error.errors, [moveError, restoreError]);
      assert.equal(error.backupJarPath, paths.backup);
      return true;
    },
  );

  assert.equal(callbackCount, 0);
  assert.equal(existsSync(paths.target), false);
  assert.equal(read(paths.backup), 'previous');
  assert.equal(read(paths.candidate), 'candidate');
});

await withPaths('jar-metadata-rollback-failure-is-combined', async (paths) => {
  write(paths.target, 'previous');
  write(paths.candidate, 'candidate');
  const installError = new Error('metadata commit failed');
  const metadataRestoreError = new Error('metadata restore failed');

  await assert.rejects(
    runCoreJarInstallTransaction({
      afterRollback: async () => { throw metadataRestoreError; },
      afterSwap: async () => { throw installError; },
      backupJarPath: paths.backup,
      candidateJarPath: paths.candidate,
      targetJarPath: paths.target,
    }),
    (error) => {
      assert(error instanceof CoreJarInstallRecoveryError);
      assert.deepEqual(error.errors, [installError, metadataRestoreError]);
      return true;
    },
  );

  assert.equal(read(paths.target), 'previous');
  assert.equal(read(paths.candidate), 'candidate');
  assert.equal(existsSync(paths.backup), false);
});

await withPaths('jar-filesystem-rollback-failure-skips-metadata', async (paths) => {
  write(paths.target, 'previous');
  write(paths.candidate, 'candidate');
  const installError = new Error('candidate activation failed');
  const restoreError = new Error('old JAR remained locked');
  let rollbackCallbackRan = false;

  await assert.rejects(
    runCoreJarInstallTransaction({
      afterRollback: async () => { rollbackCallbackRan = true; },
      afterSwap: async () => { throw installError; },
      backupJarPath: paths.backup,
      candidateJarPath: paths.candidate,
      operations: {
        rename: async (sourcePath, destinationPath) => {
          if (sourcePath === paths.backup) throw restoreError;
          await rename(sourcePath, destinationPath);
        },
      },
      targetJarPath: paths.target,
    }),
    (error) => {
      assert(error instanceof CoreJarInstallRecoveryError);
      assert.deepEqual(error.errors, [installError, restoreError]);
      return true;
    },
  );

  assert.equal(rollbackCallbackRan, false);
  assert.equal(existsSync(paths.target), false);
  assert.equal(read(paths.backup), 'previous');
  assert.equal(read(paths.candidate), 'candidate');
});

await withPaths('jar-preexisting-backup-fails-closed', async (paths) => {
  write(paths.target, 'previous');
  write(paths.candidate, 'candidate');
  write(paths.backup, 'recovery');
  let callbackCount = 0;

  await assert.rejects(
    runCoreJarInstallTransaction({
      afterRollback: async () => { callbackCount += 1; },
      afterSwap: async () => { callbackCount += 1; },
      backupJarPath: paths.backup,
      candidateJarPath: paths.candidate,
      targetJarPath: paths.target,
    }),
    /backup JAR path must not already exist/i,
  );

  assert.equal(callbackCount, 0);
  assert.equal(read(paths.target), 'previous');
  assert.equal(read(paths.candidate), 'candidate');
  assert.equal(read(paths.backup), 'recovery');
});

await withPaths('jar-path-validation', async (paths) => {
  write(paths.candidate, 'candidate');
  const elsewhere = path.join(paths.root, 'elsewhere');
  mkdirSync(elsewhere);

  await assert.rejects(
    runCoreJarInstallTransaction({
      ...callbacks(),
      backupJarPath: paths.backup,
      candidateJarPath: path.join(elsewhere, 'candidate.jar'),
      targetJarPath: paths.target,
    }),
    /must be direct siblings/i,
  );
  await assert.rejects(
    runCoreJarInstallTransaction({
      ...callbacks(),
      backupJarPath: paths.backup,
      candidateJarPath: paths.target,
      targetJarPath: paths.target,
    }),
    /must be distinct/i,
  );
  await assert.rejects(
    runCoreJarInstallTransaction({
      ...callbacks(),
      backupJarPath: paths.backup,
      candidateJarPath: path.join(paths.root, 'QORTAL.JAR'),
      platform: 'win32',
      targetJarPath: path.join(paths.root, 'qortal.jar'),
    }),
    /must be distinct/i,
  );

  rmSync(paths.candidate);
  mkdirSync(paths.candidate);
  await assert.rejects(
    runCoreJarInstallTransaction({
      ...callbacks(),
      backupJarPath: paths.backup,
      candidateJarPath: paths.candidate,
      targetJarPath: paths.target,
    }),
    /candidate JAR must exist as a regular file/i,
  );
  assert.equal(lstatSync(paths.candidate).isDirectory(), true);
});

await withPaths('jar-symlink-rejected', async (paths) => {
  const source = path.join(paths.root, 'source.jar');
  write(source, 'candidate');

  try {
    symlinkSync(source, paths.candidate, 'file');
  } catch (error) {
    const code = error instanceof Error && 'code' in error
      ? (error as NodeJS.ErrnoException).code
      : undefined;
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) return;
    throw error;
  }

  await assert.rejects(
    runCoreJarInstallTransaction({
      ...callbacks(),
      backupJarPath: paths.backup,
      candidateJarPath: paths.candidate,
      targetJarPath: paths.target,
    }),
    /candidate JAR must exist as a regular file/i,
  );
  assert.equal(lstatSync(paths.candidate).isSymbolicLink(), true);
  assert.equal(read(source), 'candidate');
});

await withPaths('jar-target-directory-rejected', async (paths) => {
  write(paths.candidate, 'candidate');
  mkdirSync(paths.target);

  await assert.rejects(
    runCoreJarInstallTransaction({
      ...callbacks(),
      backupJarPath: paths.backup,
      candidateJarPath: paths.candidate,
      targetJarPath: paths.target,
    }),
    /target JAR must be absent or a regular file/i,
  );
  assert.equal(lstatSync(paths.target).isDirectory(), true);
  assert.equal(read(paths.candidate), 'candidate');
});

await withPaths('jar-post-commit-cleanup-failure', async (paths) => {
  write(paths.target, 'previous');
  write(paths.candidate, 'candidate');
  const cleanupError = new Error('backup remained locked');

  await assert.rejects(
    runCoreJarInstallTransaction({
      ...callbacks(),
      backupJarPath: paths.backup,
      candidateJarPath: paths.candidate,
      operations: {
        unlink: async (targetPath) => {
          if (targetPath === paths.backup) throw cleanupError;
          unlinkSync(targetPath);
        },
      },
      platform: 'linux',
      targetJarPath: paths.target,
    }),
    (error) => {
      assert(error instanceof CoreJarInstallCleanupError);
      assert.equal(error.cause, cleanupError);
      assert.equal(error.committed, true);
      return true;
    },
  );

  assert.equal(read(paths.target), 'candidate');
  assert.equal(read(paths.backup), 'previous');
  assert.equal(existsSync(paths.candidate), false);
});

// A rename-only primitive has no cross-device copy seam. EXDEV is propagated,
// and the staged candidate is removed only after the original state is safe.
await withPaths('jar-initial-exdev-no-copy', async (paths) => {
  write(paths.candidate, 'candidate');
  const crossDeviceError = Object.assign(new Error('cross-device move'), { code: 'EXDEV' });
  const renameCalls: Array<[string, string]> = [];

  await assert.rejects(
    runCoreJarInstallTransaction({
      ...callbacks(),
      backupJarPath: paths.backup,
      candidateJarPath: paths.candidate,
      operations: {
        rename: async (sourcePath, destinationPath) => {
          renameCalls.push([sourcePath, destinationPath]);
          throw crossDeviceError;
        },
      },
      targetJarPath: paths.target,
    }),
    (error) => error === crossDeviceError,
  );

  assert.deepEqual(renameCalls, [[paths.candidate, paths.target]]);
  assert.equal(existsSync(paths.target), false);
  assert.equal(existsSync(paths.candidate), false);
  assert.equal(existsSync(paths.backup), false);
});

await withPaths('jar-windows-busy-retry', async (paths) => {
  write(paths.candidate, 'candidate');
  const waits: number[] = [];
  let renameAttempts = 0;

  const result = await runCoreJarInstallTransaction({
    ...callbacks(),
    backupJarPath: paths.backup,
    candidateJarPath: paths.candidate,
    operations: {
      rename: async (sourcePath, destinationPath) => {
        renameAttempts += 1;
        if (renameAttempts < 3) {
          throw Object.assign(new Error('JAR is busy'), { code: 'EBUSY' });
        }
        await rename(sourcePath, destinationPath);
      },
      wait: async (delayMs) => {
        waits.push(delayMs);
      },
    },
    platform: 'win32',
    retryDelaysMs: [1, 2],
    targetJarPath: paths.target,
  });

  assert.equal(result.kind, 'initial-install');
  assert.equal(renameAttempts, 3);
  assert.deepEqual(waits, [1, 2]);
  assert.equal(read(paths.target), 'candidate');
});

await withPaths('jar-windows-busy-retry-exhausted', async (paths) => {
  write(paths.candidate, 'candidate');
  const busyError = Object.assign(new Error('JAR remained locked'), { code: 'EPERM' });
  const waits: number[] = [];
  let renameAttempts = 0;

  await assert.rejects(
    runCoreJarInstallTransaction({
      ...callbacks(),
      backupJarPath: paths.backup,
      candidateJarPath: paths.candidate,
      operations: {
        rename: async () => {
          renameAttempts += 1;
          throw busyError;
        },
        wait: async (delayMs) => {
          waits.push(delayMs);
        },
      },
      platform: 'win32',
      retryDelaysMs: [1, 2],
      targetJarPath: paths.target,
    }),
    (error) => error === busyError,
  );

  assert.equal(renameAttempts, 3);
  assert.deepEqual(waits, [1, 2]);
  assert.equal(existsSync(paths.target), false);
  assert.equal(existsSync(paths.candidate), false);
});

await withPaths('jar-windows-retry-wait-failure', async (paths) => {
  write(paths.candidate, 'candidate');
  const waitError = new Error('retry timer failed');
  let renameAttempts = 0;

  await assert.rejects(
    runCoreJarInstallTransaction({
      ...callbacks(),
      backupJarPath: paths.backup,
      candidateJarPath: paths.candidate,
      operations: {
        rename: async () => {
          renameAttempts += 1;
          throw Object.assign(new Error('JAR is busy'), { code: 'EACCES' });
        },
        wait: async () => {
          throw waitError;
        },
      },
      platform: 'win32',
      retryDelaysMs: [1],
      targetJarPath: paths.target,
    }),
    (error) => error === waitError,
  );

  assert.equal(renameAttempts, 1);
  assert.equal(existsSync(paths.candidate), false);
});

console.log('core JAR-only atomic install transaction checks passed');
