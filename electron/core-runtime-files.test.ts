import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  mirrorRuntimeRewardNodeIdentityToPreview,
  preserveLegacyRewardNodeIdentity,
} from './core-runtime-files.js';

const IDENTITY_LENGTH = 32;

function createPaths(label: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), `qortium-home-${label}-`));
  const preview = path.join(root, 'install', 'preview');
  const runtime = path.join(root, 'runtime');

  return {
    legacyIdentity: path.join(preview, 'reward-node', 'identity.key'),
    preview,
    root,
    runtime,
    runtimeIdentity: path.join(runtime, 'reward-node', 'identity.key'),
  };
}

function writeIdentity(filePath: string, value: number) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const identity = Buffer.alloc(IDENTITY_LENGTH, value);
  writeFileSync(filePath, identity, { mode: 0o600 });

  if (process.platform !== 'win32') {
    chmodSync(filePath, 0o600);
  }

  return identity;
}

function assertNoTemporaryIdentityFiles(runtimePath: string) {
  const rewardNodePath = path.join(runtimePath, 'reward-node');

  if (!existsSync(rewardNodePath)) {
    return;
  }

  assert.equal(
    readdirSync(rewardNodePath).some((name) => name.startsWith('.identity.key.tmp-')),
    false,
  );
}

async function withPaths(
  label: string,
  callback: (paths: ReturnType<typeof createPaths>) => Promise<void>,
) {
  const paths = createPaths(label);

  try {
    await callback(paths);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
}

await withPaths('reward-identity-missing', async (paths) => {
  await preserveLegacyRewardNodeIdentity(paths.preview, paths.runtime);

  assert.equal(existsSync(paths.runtimeIdentity), false);
  assertNoTemporaryIdentityFiles(paths.runtime);
});

await withPaths('reward-identity-copy', async (paths) => {
  const identity = writeIdentity(paths.legacyIdentity, 0x31);

  await preserveLegacyRewardNodeIdentity(paths.preview, paths.runtime);

  assert.deepEqual(readFileSync(paths.runtimeIdentity), identity);
  assert.deepEqual(readFileSync(paths.legacyIdentity), identity);
  assert.equal(lstatSync(paths.runtimeIdentity).isFile(), true);
  assert.equal(lstatSync(paths.runtimeIdentity).isSymbolicLink(), false);

  if (process.platform !== 'win32') {
    assert.equal(lstatSync(paths.runtimeIdentity).mode & 0o777, 0o600);
    assert.equal(lstatSync(path.dirname(paths.runtimeIdentity)).mode & 0o777, 0o700);
  }

  assertNoTemporaryIdentityFiles(paths.runtime);
});

await withPaths('reward-identity-target-wins', async (paths) => {
  const legacyIdentity = writeIdentity(paths.legacyIdentity, 0x41);
  const runtimeIdentity = writeIdentity(paths.runtimeIdentity, 0x42);
  assert.equal(legacyIdentity.equals(runtimeIdentity), false);

  await preserveLegacyRewardNodeIdentity(paths.preview, paths.runtime);

  assert.deepEqual(readFileSync(paths.runtimeIdentity), runtimeIdentity);
  assert.deepEqual(readFileSync(paths.legacyIdentity), legacyIdentity);
  assertNoTemporaryIdentityFiles(paths.runtime);
});

await withPaths('reward-identity-target-skips-bad-legacy', async (paths) => {
  const runtimeIdentity = writeIdentity(paths.runtimeIdentity, 0x52);
  mkdirSync(path.dirname(paths.legacyIdentity), { recursive: true });
  writeFileSync(paths.legacyIdentity, Buffer.alloc(IDENTITY_LENGTH - 1), { mode: 0o600 });

  await preserveLegacyRewardNodeIdentity(paths.preview, paths.runtime);

  assert.deepEqual(readFileSync(paths.runtimeIdentity), runtimeIdentity);
});

await withPaths('reward-identity-invalid-source', async (paths) => {
  mkdirSync(path.dirname(paths.legacyIdentity), { recursive: true });
  writeFileSync(paths.legacyIdentity, Buffer.alloc(IDENTITY_LENGTH - 1), { mode: 0o600 });

  await assert.rejects(
    preserveLegacyRewardNodeIdentity(paths.preview, paths.runtime),
    /exactly 32 bytes/,
  );

  assert.equal(existsSync(paths.runtimeIdentity), false);
  assert.equal(existsSync(paths.legacyIdentity), true);
  assertNoTemporaryIdentityFiles(paths.runtime);
});

await withPaths('reward-identity-directory-source', async (paths) => {
  mkdirSync(paths.legacyIdentity, { recursive: true });

  await assert.rejects(
    preserveLegacyRewardNodeIdentity(paths.preview, paths.runtime),
    /regular file/,
  );

  assert.equal(existsSync(paths.runtimeIdentity), false);
});

if (process.platform !== 'win32') {
  await withPaths('reward-identity-unsafe-source-permissions', async (paths) => {
    writeIdentity(paths.legacyIdentity, 0x60);
    chmodSync(paths.legacyIdentity, 0o640);

    await assert.rejects(
      preserveLegacyRewardNodeIdentity(paths.preview, paths.runtime),
      /owner-only permissions/,
    );

    assert.equal(existsSync(paths.runtimeIdentity), false);
    assert.equal(lstatSync(paths.legacyIdentity).mode & 0o777, 0o640);
  });
}

await withPaths('reward-identity-symlink-source', async (paths) => {
  const identityTarget = path.join(paths.root, 'identity-target.key');
  writeIdentity(identityTarget, 0x61);
  mkdirSync(path.dirname(paths.legacyIdentity), { recursive: true });

  try {
    symlinkSync(identityTarget, paths.legacyIdentity, 'file');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      return;
    }

    throw error;
  }

  await assert.rejects(
    preserveLegacyRewardNodeIdentity(paths.preview, paths.runtime),
    /symbolic link/,
  );

  assert.equal(existsSync(paths.runtimeIdentity), false);
  assert.deepEqual(readFileSync(identityTarget), Buffer.alloc(IDENTITY_LENGTH, 0x61));
});

await withPaths('reward-identity-symlink-source-directory', async (paths) => {
  const identityDirectory = path.join(paths.root, 'legacy-reward-node-target');
  writeIdentity(path.join(identityDirectory, 'identity.key'), 0x62);
  mkdirSync(path.dirname(path.dirname(paths.legacyIdentity)), { recursive: true });

  try {
    symlinkSync(identityDirectory, path.dirname(paths.legacyIdentity), 'dir');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      return;
    }

    throw error;
  }

  await assert.rejects(
    preserveLegacyRewardNodeIdentity(paths.preview, paths.runtime),
    /parent must be a directory and cannot be a symbolic link/,
  );

  assert.equal(existsSync(paths.runtimeIdentity), false);
});

await withPaths('reward-identity-invalid-target', async (paths) => {
  writeIdentity(paths.legacyIdentity, 0x71);
  mkdirSync(path.dirname(paths.runtimeIdentity), { recursive: true });
  writeFileSync(paths.runtimeIdentity, Buffer.alloc(IDENTITY_LENGTH - 1), { mode: 0o600 });

  await assert.rejects(
    preserveLegacyRewardNodeIdentity(paths.preview, paths.runtime),
    /exactly 32 bytes/,
  );

  assert.equal(readFileSync(paths.runtimeIdentity).length, IDENTITY_LENGTH - 1);
  assert.deepEqual(readFileSync(paths.legacyIdentity), Buffer.alloc(IDENTITY_LENGTH, 0x71));
});

await withPaths('reward-identity-symlink-target', async (paths) => {
  writeIdentity(paths.legacyIdentity, 0x72);
  const identityTarget = path.join(paths.root, 'runtime-identity-target.key');
  const targetIdentity = writeIdentity(identityTarget, 0x73);
  mkdirSync(path.dirname(paths.runtimeIdentity), { recursive: true });

  try {
    symlinkSync(identityTarget, paths.runtimeIdentity, 'file');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      return;
    }

    throw error;
  }

  await assert.rejects(
    preserveLegacyRewardNodeIdentity(paths.preview, paths.runtime),
    /symbolic link/,
  );

  assert.deepEqual(readFileSync(identityTarget), targetIdentity);
  assert.equal(lstatSync(paths.runtimeIdentity).isSymbolicLink(), true);
});

await withPaths('reward-identity-directory-target', async (paths) => {
  writeIdentity(paths.legacyIdentity, 0x74);
  mkdirSync(paths.runtimeIdentity, { recursive: true });

  await assert.rejects(
    preserveLegacyRewardNodeIdentity(paths.preview, paths.runtime),
    /regular file/,
  );

  assert.equal(lstatSync(paths.runtimeIdentity).isDirectory(), true);
});

await withPaths('reward-identity-symlink-target-directory', async (paths) => {
  writeIdentity(paths.legacyIdentity, 0x75);
  const identityDirectory = path.join(paths.root, 'runtime-reward-node-target');
  mkdirSync(identityDirectory, { recursive: true });
  mkdirSync(path.dirname(path.dirname(paths.runtimeIdentity)), { recursive: true });

  try {
    symlinkSync(identityDirectory, path.dirname(paths.runtimeIdentity), 'dir');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      return;
    }

    throw error;
  }

  await assert.rejects(
    preserveLegacyRewardNodeIdentity(paths.preview, paths.runtime),
    /parent must be a directory and cannot be a symbolic link/,
  );

  assert.equal(existsSync(path.join(identityDirectory, 'identity.key')), false);
});

await withPaths('reward-identity-concurrent-copy', async (paths) => {
  const identity = writeIdentity(paths.legacyIdentity, 0x7f);

  await Promise.all(
    Array.from({ length: 12 }, () => preserveLegacyRewardNodeIdentity(paths.preview, paths.runtime)),
  );

  assert.deepEqual(readFileSync(paths.runtimeIdentity), identity);
  assert.deepEqual(readFileSync(paths.legacyIdentity), identity);
  assertNoTemporaryIdentityFiles(paths.runtime);
});

await withPaths('reward-identity-mirror-for-downgrade', async (paths) => {
  const runtimeIdentity = writeIdentity(paths.runtimeIdentity, 0x81);

  await mirrorRuntimeRewardNodeIdentityToPreview(paths.runtime, paths.preview);

  assert.deepEqual(readFileSync(paths.runtimeIdentity), runtimeIdentity);
  assert.deepEqual(readFileSync(paths.legacyIdentity), runtimeIdentity);
  assertNoTemporaryIdentityFiles(paths.preview);
});

await withPaths('reward-identity-mirror-missing-runtime', async (paths) => {
  await mirrorRuntimeRewardNodeIdentityToPreview(paths.runtime, paths.preview);

  assert.equal(existsSync(paths.legacyIdentity), false);
});

await withPaths('reward-identity-mirror-conflict', async (paths) => {
  const runtimeIdentity = writeIdentity(paths.runtimeIdentity, 0x82);
  const legacyIdentity = writeIdentity(paths.legacyIdentity, 0x83);
  assert.equal(runtimeIdentity.equals(legacyIdentity), false);

  await assert.rejects(
    mirrorRuntimeRewardNodeIdentityToPreview(paths.runtime, paths.preview),
    /conflicts with the runtime identity/,
  );

  assert.deepEqual(readFileSync(paths.runtimeIdentity), runtimeIdentity);
  assert.deepEqual(readFileSync(paths.legacyIdentity), legacyIdentity);
});

console.log('Core runtime file tests passed.');
