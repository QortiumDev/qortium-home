import assert from 'node:assert/strict';
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  coreJarTargetStatesMatch,
  readCoreJarTargetState,
} from './core-jar-target-state.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'qortium-core-jar-state-'));

try {
  const installPath = path.join(root, 'install');
  const jarPath = path.join(installPath, 'qortal.jar');
  mkdirSync(installPath);

  const missing = await readCoreJarTargetState(jarPath);
  assert.equal(missing.kind, 'missing');
  assert.equal(missing.canonicalPath, jarPath);
  assert.equal(coreJarTargetStatesMatch(missing, await readCoreJarTargetState(jarPath)), true);

  let missingLstatCalls = 0;
  await assert.rejects(
    readCoreJarTargetState(path.join(installPath, 'appeared.jar'), {
      operations: {
        lstat: async (targetPath) => {
          missingLstatCalls += 1;
          if (missingLstatCalls === 1) {
            throw Object.assign(new Error('missing'), { code: 'ENOENT' });
          }
          if (targetPath === installPath) return lstatSync(installPath);
          return {
            dev: 1,
            ino: 2,
            isDirectory: () => false,
            isFile: () => true,
            mtimeMs: 1,
            size: 1,
          };
        },
        realpath: async () => installPath,
      },
    }),
    /appeared while.*missing state/i,
  );

  writeFileSync(jarPath, 'candidate jar');
  const identity = {
    buildTimestamp: '2026-08-21T00:00:00Z',
    buildVersion: '6.1.9-a1b2c3d4',
    commit: 'a1b2c3d4',
    semver: '6.1.9',
  };
  const fileState = await readCoreJarTargetState(jarPath, {
    operations: { readIdentity: async () => identity },
  });
  assert.equal(fileState.kind, 'file');
  assert.equal(fileState.canonicalPath, jarPath);
  assert.match(fileState.sha256, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(fileState.identity, identity);
  assert.equal(
    coreJarTargetStatesMatch(
      fileState,
      await readCoreJarTargetState(jarPath, {
        operations: { readIdentity: async () => identity },
      }),
    ),
    true,
  );

  writeFileSync(jarPath, 'changed candidate jar');
  assert.equal(
    coreJarTargetStatesMatch(
      fileState,
      await readCoreJarTargetState(jarPath, {
        operations: { readIdentity: async () => identity },
      }),
    ),
    false,
  );

  if (process.platform !== 'win32') {
    const aliasRoot = path.join(root, 'alias');
    symlinkSync(root, aliasRoot, 'dir');
    const aliasState = await readCoreJarTargetState(path.join(aliasRoot, 'install', 'qortal.jar'), {
      operations: { readIdentity: async () => identity },
    });
    assert.equal(aliasState.kind, 'file');
    assert.equal(aliasState.canonicalPath, jarPath);
  }

  const targetLink = path.join(installPath, 'linked.jar');
  try {
    symlinkSync(jarPath, targetLink, 'file');
    await assert.rejects(readCoreJarTargetState(targetLink), /not a symlink or directory/i);
  } catch (error) {
    const code = error instanceof Error && 'code' in error
      ? (error as NodeJS.ErrnoException).code
      : undefined;
    if (process.platform !== 'win32' || (code !== 'EPERM' && code !== 'EACCES')) throw error;
  }

  const directoryTarget = path.join(root, 'directory-target');
  mkdirSync(directoryTarget);
  await assert.rejects(readCoreJarTargetState(directoryTarget), /not a symlink or directory/i);

  const changingStats = {
    dev: 1,
    ino: 2,
    isDirectory: () => false,
    isFile: () => true,
    mtimeMs: 10,
    size: 20,
  };
  let lstatCalls = 0;
  await assert.rejects(
    readCoreJarTargetState(jarPath, {
      operations: {
        hashFile: async () => `sha256:${'a'.repeat(64)}`,
        lstat: async () => {
          lstatCalls += 1;
          return lstatCalls === 3 ? { ...changingStats, mtimeMs: 11 } : changingStats;
        },
        readIdentity: async () => identity,
        realpath: async () => jarPath,
      },
    }),
    /changed while it was being fingerprinted/i,
  );

  await assert.rejects(
    readCoreJarTargetState(jarPath, {
      operations: {
        hashFile: async () => 'not-a-digest',
        lstat: async () => changingStats,
        readIdentity: async () => identity,
        realpath: async () => jarPath,
      },
    }),
    /invalid SHA-256 digest/i,
  );

  assert.equal(
    coreJarTargetStatesMatch(
      { canonicalPath: '/A/qortal.jar', kind: 'missing', parentDev: 1, parentIno: 2 },
      { canonicalPath: '/a/QORTAL.JAR', kind: 'missing', parentDev: 1, parentIno: 2 },
      'win32',
    ),
    true,
  );
} finally {
  rmSync(root, { force: true, recursive: true });
}

console.log('Core JAR target fingerprint and revalidation checks passed.');
