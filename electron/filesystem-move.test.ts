import assert from 'node:assert/strict';
import { movePath, WINDOWS_BUSY_MOVE_RETRY_DELAYS_MS } from './filesystem-move.js';

function errno(code: string) {
  return Object.assign(new Error(`filesystem error: ${code}`), { code });
}

function operationsWithRename(rename: (sourcePath: string, destinationPath: string) => Promise<void>) {
  return {
    copy: async () => {},
    makeParent: async () => {},
    remove: async () => {},
    rename,
    wait: async () => {},
  };
}

{
  let attempts = 0;
  const waits: number[] = [];

  await movePath('install', '_install-backup', {
    platform: 'win32',
    retryWindowsBusy: true,
    operations: {
      ...operationsWithRename(async () => {
        attempts += 1;

        if (attempts <= 2) {
          throw errno('EPERM');
        }
      }),
      wait: async (delayMs) => {
        waits.push(delayMs);
      },
    },
  });

  assert.equal(attempts, 3);
  assert.deepEqual(waits, WINDOWS_BUSY_MOVE_RETRY_DELAYS_MS.slice(0, 2));
}

{
  let attempts = 0;
  const waits: number[] = [];

  await movePath('install', '_install-backup', {
    platform: 'win32',
    retryWindowsBusy: true,
    operations: {
      ...operationsWithRename(async () => {
        attempts += 1;

        if (attempts === 1) {
          throw errno('EACCES');
        }
      }),
      wait: async (delayMs) => {
        waits.push(delayMs);
      },
    },
  });

  assert.equal(attempts, 2);
  assert.deepEqual(waits, WINDOWS_BUSY_MOVE_RETRY_DELAYS_MS.slice(0, 1));
}

{
  let attempts = 0;
  const waits: number[] = [];
  const busyError = errno('EBUSY');

  await assert.rejects(
    movePath('install', '_install-backup', {
      platform: 'win32',
      retryWindowsBusy: true,
      operations: {
        ...operationsWithRename(async () => {
          attempts += 1;
          throw busyError;
        }),
        wait: async (delayMs) => {
          waits.push(delayMs);
        },
      },
    }),
    (error) => error === busyError,
  );

  assert.equal(attempts, WINDOWS_BUSY_MOVE_RETRY_DELAYS_MS.length + 1);
  assert.deepEqual(waits, WINDOWS_BUSY_MOVE_RETRY_DELAYS_MS);
}

{
  let attempts = 0;
  const permissionError = errno('EACCES');

  await assert.rejects(
    movePath('install', '_install-backup', {
      platform: 'linux',
      retryWindowsBusy: true,
      operations: operationsWithRename(async () => {
        attempts += 1;
        throw permissionError;
      }),
    }),
    (error) => error === permissionError,
  );

  assert.equal(attempts, 1);
}

{
  let attempts = 0;
  const missingPathError = errno('ENOENT');

  await assert.rejects(
    movePath('install', '_install-backup', {
      platform: 'win32',
      retryWindowsBusy: true,
      operations: operationsWithRename(async () => {
        attempts += 1;
        throw missingPathError;
      }),
    }),
    (error) => error === missingPathError,
  );

  assert.equal(attempts, 1);
}

{
  let attempts = 0;
  const permissionError = errno('EPERM');

  await assert.rejects(
    movePath('install', '_install-backup', {
      platform: 'win32',
      operations: operationsWithRename(async () => {
        attempts += 1;
        throw permissionError;
      }),
    }),
    (error) => error === permissionError,
  );

  assert.equal(attempts, 1);
}

{
  const calls: string[] = [];

  await movePath('source', 'destination', {
    platform: 'win32',
    operations: {
      copy: async () => {
        calls.push('copy');
      },
      makeParent: async () => {
        calls.push('makeParent');
      },
      remove: async () => {
        calls.push('remove');
      },
      rename: async () => {
        calls.push('rename');
        throw errno('EXDEV');
      },
      wait: async () => {
        calls.push('wait');
      },
    },
  });

  assert.deepEqual(calls, ['makeParent', 'rename', 'copy', 'remove']);
}

console.log('filesystem move tests passed');
