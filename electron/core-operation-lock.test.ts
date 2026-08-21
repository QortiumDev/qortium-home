import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { open as openFile } from 'node:fs/promises';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CoreOperationLockContentionError,
  CoreOperationLockCreationError,
  CoreOperationLockIntegrityError,
  CoreOperationLockReleaseError,
  CoreOperationLockStaleError,
  probeCoreOperationLockPid,
  resolveCoreOperationLockIdentity,
  withCoreOperationLock,
  type CoreOperationLockPidState,
  type CoreOperationLockRequest,
} from './core-operation-lock.js';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function fixture(label: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), `qortium-home-operation-lock-${label}-`));
  const lockRoot = path.join(root, 'locks');
  const targetDirectory = path.join(root, 'target');
  mkdirSync(lockRoot, { mode: 0o700 });
  mkdirSync(targetDirectory, { mode: 0o700 });
  const targetPath = path.join(targetDirectory, 'qortal.jar');
  writeFileSync(targetPath, 'jar', { mode: 0o600 });
  const request: CoreOperationLockRequest = {
    lockRoot,
    networkId: 'qortal',
    op: 'github-update',
    targetPath,
  };
  return { lockRoot, request, root, targetDirectory, targetPath };
}

async function usingFixture(
  label: string,
  run: (value: ReturnType<typeof fixture>) => Promise<void>,
) {
  const value = fixture(label);
  try {
    await run(value);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}

function validPayload(
  request: CoreOperationLockRequest,
  canonicalTarget: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    network: request.networkId,
    op: request.op,
    pid: 999_999,
    start: '2000-01-01T00:00:00.000Z',
    target: canonicalTarget,
    token: 'a'.repeat(64),
    version: 1,
    ...overrides,
  };
}

function writeLock(lockPath: string, payload: unknown) {
  writeFileSync(lockPath, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(lockPath, 0o600);
}

async function waitForLine(stream: NodeJS.ReadableStream, expected: string) {
  return new Promise<void>((resolve, reject) => {
    let buffered = '';
    const onData = (chunk: Buffer | string) => {
      buffered += chunk.toString();
      if (buffered.includes(`${expected}\n`)) {
        cleanup();
        resolve();
      }
    };
    const onEnd = () => {
      cleanup();
      reject(new Error(`Child process ended before emitting ${expected}.`));
    };
    const cleanup = () => {
      stream.off('data', onData);
      stream.off('end', onEnd);
    };
    stream.on('data', onData);
    stream.on('end', onEnd);
  });
}

assert.equal(probeCoreOperationLockPid(1, () => {}), 'alive');
assert.equal(
  probeCoreOperationLockPid(1, () => {
    throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
  }),
  'alive',
);
assert.equal(
  probeCoreOperationLockPid(1, () => {
    throw Object.assign(new Error('gone'), { code: 'ESRCH' });
  }),
  'dead',
);
assert.equal(
  probeCoreOperationLockPid(1, () => {
    throw Object.assign(new Error('uncertain'), { code: 'EIO' });
  }),
  'unknown',
);

await usingFixture('payload-mode', async ({ request }) => {
  let observedLockPath = '';
  const result = await withCoreOperationLock(
    request,
    async (context) => {
      observedLockPath = context.lockPath;
      const payload = JSON.parse(readFileSync(context.lockPath, 'utf8'));
      assert.deepEqual(Object.keys(payload).sort(), [
        'network', 'op', 'pid', 'start', 'target', 'token', 'version',
      ]);
      assert.equal(payload.version, 1);
      assert.equal(payload.network, 'qortal');
      assert.equal(payload.op, request.op);
      assert.equal(payload.pid, 42_424);
      assert.equal(payload.target, context.canonicalTarget);
      assert.match(payload.token, /^[0-9a-f]{64}$/);
      assert.equal(Number.isFinite(Date.parse(payload.start)), true);
      assert.equal(lstatSync(context.lockPath).isFile(), true);
      if (process.platform !== 'win32') {
        assert.equal(lstatSync(context.lockPath).mode & 0o777, 0o600);
      }
      return 'complete';
    },
    {
      operations: {
        getPid: () => 42_424,
        now: () => new Date('2026-08-21T20:15:00.000Z'),
        randomBytes: () => Buffer.alloc(32, 0x12),
      },
    },
  );
  assert.equal(result, 'complete');
  assert.equal(existsSync(observedLockPath), false);
});

await usingFixture('contention', async ({ request }) => {
  const gate = deferred<void>();
  const entered = deferred<void>();
  const first = withCoreOperationLock(request, async () => {
    entered.resolve();
    await gate.promise;
  });
  await entered.promise;
  await assert.rejects(
    withCoreOperationLock(request, async () => {}),
    (error) => error instanceof CoreOperationLockContentionError && error.owner.pid === process.pid,
  );
  gate.resolve();
  await first;
});

await usingFixture('cross-process-contention', async ({ request }) => {
  const moduleUrl = new URL('./core-operation-lock.js', import.meta.url).href;
  const childSource = `
    const { withCoreOperationLock } = await import(process.argv[1]);
    const request = JSON.parse(process.argv[2]);
    await withCoreOperationLock(request, async () => {
      process.stdout.write('LOCKED\\n');
      await new Promise((resolve) => process.stdin.once('data', resolve));
    });
  `;
  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', childSource, moduleUrl, JSON.stringify(request)],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    await waitForLine(child.stdout, 'LOCKED');
    await assert.rejects(
      withCoreOperationLock(request, async () => {}),
      (error) =>
        error instanceof CoreOperationLockContentionError && error.owner.pid === child.pid,
    );
  } finally {
    child.stdin.end('release\n');
  }

  const exitCode = await new Promise<number | null>((resolve) => child.once('exit', resolve));
  assert.equal(exitCode, 0, stderr);
});

await usingFixture('canonical-alias', async ({ lockRoot, root, targetDirectory, targetPath }) => {
  const alias = path.join(root, 'target-alias');
  try {
    symlinkSync(targetDirectory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) return;
    throw error;
  }
  const direct = await resolveCoreOperationLockIdentity({
    lockRoot,
    networkId: 'qortal',
    op: 'update',
    targetPath,
  });
  const throughAlias = await resolveCoreOperationLockIdentity({
    lockRoot,
    networkId: 'qortal',
    op: 'update',
    targetPath: path.join(alias, 'qortal.jar'),
  });
  assert.deepEqual(throughAlias, direct);

  const missingDirect = await resolveCoreOperationLockIdentity({
    lockRoot,
    networkId: 'qortal',
    op: 'install',
    targetPath: path.join(targetDirectory, 'missing.jar'),
  });
  const missingAlias = await resolveCoreOperationLockIdentity({
    lockRoot,
    networkId: 'qortal',
    op: 'install',
    targetPath: path.join(alias, 'missing.jar'),
  });
  assert.deepEqual(missingAlias, missingDirect);

  const otherNetwork = await resolveCoreOperationLockIdentity({
    lockRoot,
    networkId: 'qortium',
    op: 'update',
    targetPath,
  });
  assert.notEqual(otherNetwork.key, direct.key);
  assert.notEqual(otherNetwork.lockPath, direct.lockPath);
});

await usingFixture('lock-root-symlink', async ({ lockRoot, request, root }) => {
  const alias = path.join(root, 'lock-alias');
  try {
    symlinkSync(lockRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) return;
    throw error;
  }
  await assert.rejects(
    withCoreOperationLock({ ...request, lockRoot: alias }, async () => {}),
    /lock root.*symlink/i,
  );
});

if (process.platform !== 'win32') {
  await usingFixture('lock-root-mode', async ({ lockRoot, request }) => {
    chmodSync(lockRoot, 0o777);
    await assert.rejects(
      withCoreOperationLock(request, async () => {}),
      /lock root must not be writable by group or other users/i,
    );
  });

  await usingFixture('lock-root-owner', async ({ request }) => {
    const currentUid = process.getuid?.();
    if (currentUid === undefined) return;
    await assert.rejects(
      withCoreOperationLock(request, async () => {}, {
        operations: { getUid: () => currentUid + 1 },
      }),
      /lock root is not owned by the current user/i,
    );
  });

  await usingFixture('existing-lock-mode', async ({ request }) => {
    const identity = await resolveCoreOperationLockIdentity(request);
    writeLock(identity.lockPath, validPayload(request, identity.canonicalTarget));
    chmodSync(identity.lockPath, 0o644);
    await assert.rejects(
      withCoreOperationLock(request, async () => {}),
      /lock permissions are not exactly 0600/i,
    );
    assert.equal(existsSync(identity.lockPath), true);
  });
}

await usingFixture('incomplete-publication', async ({ request }) => {
  const identity = await resolveCoreOperationLockIdentity(request);
  writeFileSync(identity.lockPath, '', { mode: 0o600 });
  let entered = false;
  await assert.rejects(
    withCoreOperationLock(request, async () => { entered = true; }),
    /payload exceeds its allowed size/i,
  );
  assert.equal(entered, false);
  assert.equal(existsSync(identity.lockPath), true);
});

for (const [label, state] of [
  ['live', 'alive'],
  ['unknown', 'unknown'],
] as const) {
  await usingFixture(`owner-${label}`, async ({ request }) => {
    const identity = await resolveCoreOperationLockIdentity(request);
    writeLock(identity.lockPath, validPayload(request, identity.canonicalTarget));
    await assert.rejects(
      withCoreOperationLock(request, async () => {}, {
        operations: { probePid: async () => state },
      }),
      state === 'alive' ? CoreOperationLockContentionError : CoreOperationLockIntegrityError,
    );
    assert.equal(existsSync(identity.lockPath), true);
  });
}

await usingFixture('dead-owner-retained', async ({ request }) => {
  const identity = await resolveCoreOperationLockIdentity(request);
  writeLock(identity.lockPath, validPayload(request, identity.canonicalTarget));
  let entered = false;
  await assert.rejects(
    withCoreOperationLock(request, async () => { entered = true; }, {
      operations: { probePid: async () => 'dead' },
    }),
    (error) =>
      error instanceof CoreOperationLockStaleError && error.retained === true,
  );
  assert.equal(entered, false);
  assert.equal(existsSync(identity.lockPath), true);
});

for (const label of ['malformed', 'oversized', 'wrong-target'] as const) {
  await usingFixture(label, async ({ request }) => {
    const identity = await resolveCoreOperationLockIdentity(request);
    if (label === 'malformed') {
      writeFileSync(identity.lockPath, '{broken', { mode: 0o600 });
    } else if (label === 'oversized') {
      writeFileSync(identity.lockPath, 'x'.repeat(4_097), { mode: 0o600 });
    } else {
      writeLock(
        identity.lockPath,
        validPayload(request, identity.canonicalTarget, { target: path.join(path.dirname(identity.canonicalTarget), 'other.jar') }),
      );
    }
    await assert.rejects(
      withCoreOperationLock(request, async () => {}, {
        operations: { probePid: async () => 'dead' },
      }),
      CoreOperationLockIntegrityError,
    );
    assert.equal(existsSync(identity.lockPath), true);
  });
}

await usingFixture('lock-symlink', async ({ request, root }) => {
  const identity = await resolveCoreOperationLockIdentity(request);
  const source = path.join(root, 'outside-lock');
  writeFileSync(source, 'outside', { mode: 0o600 });
  try {
    symlinkSync(source, identity.lockPath, 'file');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) return;
    throw error;
  }
  await assert.rejects(
    withCoreOperationLock(request, async () => {}, {
      operations: { probePid: async () => 'dead' },
    }),
    /regular file, not a symlink/i,
  );
  assert.equal(readFileSync(source, 'utf8'), 'outside');
  assert.equal(lstatSync(identity.lockPath).isSymbolicLink(), true);
});

await usingFixture('target-symlink', async ({ lockRoot, request, root, targetPath }) => {
  const aliasTarget = path.join(root, 'qortal-link.jar');
  try {
    symlinkSync(targetPath, aliasTarget, 'file');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) return;
    throw error;
  }
  await assert.rejects(
    resolveCoreOperationLockIdentity({ ...request, lockRoot, targetPath: aliasTarget }),
    /target must be a regular file/i,
  );
});

await usingFixture('dead-token-race', async ({ request }) => {
  const identity = await resolveCoreOperationLockIdentity(request);
  writeLock(identity.lockPath, validPayload(request, identity.canonicalTarget));
  let probes = 0;
  await assert.rejects(
    withCoreOperationLock(request, async () => {}, {
      operations: {
        probePid: async (): Promise<CoreOperationLockPidState> => {
          probes += 1;
          if (probes === 1) {
            unlinkSync(identity.lockPath);
            writeLock(
              identity.lockPath,
              validPayload(request, identity.canonicalTarget, {
                pid: process.pid,
                token: 'b'.repeat(64),
              }),
            );
            return 'dead';
          }
          return 'alive';
        },
      },
    }),
    (error) =>
      error instanceof CoreOperationLockContentionError ||
      error instanceof CoreOperationLockIntegrityError ||
      error instanceof CoreOperationLockStaleError,
  );
  const retained = JSON.parse(readFileSync(identity.lockPath, 'utf8'));
  assert.equal(retained.token, 'b'.repeat(64));
});

await usingFixture('release-race-success', async ({ request }) => {
  let replacementPath = '';
  await assert.rejects(
    withCoreOperationLock(request, async (context) => {
      replacementPath = context.lockPath;
      unlinkSync(context.lockPath);
      writeLock(
        context.lockPath,
        validPayload(request, context.canonicalTarget, {
          pid: process.pid,
          token: 'c'.repeat(64),
        }),
      );
      return 'committed';
    }),
    (error) =>
      error instanceof CoreOperationLockReleaseError && error.operationCompleted === true,
  );
  assert.equal(JSON.parse(readFileSync(replacementPath, 'utf8')).token, 'c'.repeat(64));
});

await usingFixture('operation-and-release-fail', async ({ request }) => {
  const operationError = new Error('operation failed');
  await assert.rejects(
    withCoreOperationLock(request, async (context) => {
      unlinkSync(context.lockPath);
      writeLock(
        context.lockPath,
        validPayload(request, context.canonicalTarget, {
          pid: process.pid,
          token: 'd'.repeat(64),
        }),
      );
      throw operationError;
    }),
    (error) => {
      assert(error instanceof AggregateError);
      assert.equal(error.errors[0], operationError);
      assert(error.errors[1] instanceof CoreOperationLockIntegrityError);
      return true;
    },
  );
});

await usingFixture('undefined-operation-failure', async ({ request }) => {
  await assert.rejects(
    withCoreOperationLock(request, async () => {
      throw undefined;
    }),
    (error) => error === undefined,
  );
});

await usingFixture('unlink-release-failure', async ({ request }) => {
  const unlinkError = Object.assign(new Error('cannot unlink'), { code: 'EACCES' });
  await assert.rejects(
    withCoreOperationLock(request, async () => 'committed', {
      operations: {
        unlink: async () => { throw unlinkError; },
      },
    }),
    (error) =>
      error instanceof CoreOperationLockReleaseError &&
      error.operationCompleted === true &&
      error.cause === unlinkError,
  );
});

await usingFixture('undefined-release-failure', async ({ request }) => {
  await assert.rejects(
    withCoreOperationLock(request, async () => 'committed', {
      operations: {
        unlink: async () => { throw undefined; },
      },
    }),
    (error) =>
      error instanceof CoreOperationLockReleaseError &&
      error.operationCompleted === true &&
      error.cause === undefined,
  );
});

await usingFixture('invalid-operation-name', async ({ request }) => {
  await assert.rejects(
    withCoreOperationLock({ ...request, op: 'bad\nname' }, async () => {}),
    /operation name/i,
  );
});

await usingFixture('creation-cleanup-evidence', async ({ request }) => {
  const closeError = new Error('close failed');
  const cleanupError = new Error('cleanup failed');
  let createdLockPath = '';

  await assert.rejects(
    withCoreOperationLock(request, async () => {}, {
      operations: {
        open: async (targetPath, flags, fileMode) => {
          createdLockPath = targetPath;
          const handle = await openFile(targetPath, flags, fileMode);
          return {
            close: async () => {
              await handle.close();
              throw closeError;
            },
            read: (buffer, offset, length, position) =>
              handle.read(buffer, offset, length, position),
            stat: () => handle.stat(),
            sync: () => handle.sync(),
            writeFile: (contents, options) => handle.writeFile(contents, options),
          };
        },
        unlink: async () => { throw cleanupError; },
      },
    }),
    (error) => {
      assert(error instanceof CoreOperationLockCreationError);
      assert.deepEqual(error.errors, [closeError, cleanupError]);
      assert.equal(error.lockPath, createdLockPath);
      assert.equal(error.evidenceRetained, true);
      return true;
    },
  );
  assert.equal(existsSync(createdLockPath), true);
});

console.log('Core cooperative cross-process operation lock checks passed.');
