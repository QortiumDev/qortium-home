import assert from 'node:assert/strict';
import {
  isCoreInstallActive,
  isCoreInstallActiveForNetwork,
  withCoreInstallLock,
  withCoreInstallLockForNetwork,
} from './core-install-lock.js';
import { userMessage } from './user-message.js';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

const githubGate = deferred<void>();
const qortiumGithub = withCoreInstallLockForNetwork('qortium', 'github', async () => {
  await githubGate.promise;
  return 'qortium github complete';
});

assert.equal(isCoreInstallActiveForNetwork('qortium'), true);
assert.equal(isCoreInstallActiveForNetwork('qortal'), false);
assert.equal(isCoreInstallActive(), true);
await assert.rejects(
  withCoreInstallLockForNetwork('qortium', 'on-chain', async () => {}),
  new Error(userMessage('core.error.installLockedGithub')),
);

const qortalGate = deferred<void>();
const qortalOnChain = withCoreInstallLockForNetwork('qortal', 'on-chain', async () => {
  await qortalGate.promise;
  return 'qortal on-chain complete';
});

assert.equal(isCoreInstallActiveForNetwork('qortium'), true);
assert.equal(isCoreInstallActiveForNetwork('qortal'), true);
await assert.rejects(
  withCoreInstallLockForNetwork('qortal', 'github', async () => {}),
  new Error(userMessage('core.error.installLockedOnChain')),
);

githubGate.resolve();
assert.equal(await qortiumGithub, 'qortium github complete');
assert.equal(isCoreInstallActiveForNetwork('qortium'), false);
assert.equal(isCoreInstallActiveForNetwork('qortal'), true);

qortalGate.resolve();
assert.equal(await qortalOnChain, 'qortal on-chain complete');
assert.equal(isCoreInstallActiveForNetwork('qortal'), false);
assert.equal(
  await withCoreInstallLockForNetwork('qortal', 'github', async () => 'released after resolve'),
  'released after resolve',
);

const operationError = new Error('install failed');
const rejectionGate = deferred<void>();
const rejectedInstall = withCoreInstallLockForNetwork('qortal', 'helpers', async () => {
  await rejectionGate.promise;
});
assert.equal(isCoreInstallActiveForNetwork('qortal'), true);
rejectionGate.reject(operationError);
await assert.rejects(
  rejectedInstall,
  (error) => error === operationError,
);
assert.equal(isCoreInstallActiveForNetwork('qortal'), false);
assert.equal(
  await withCoreInstallLockForNetwork('qortal', 'github', async () => 'released after rejection'),
  'released after rejection',
);

const legacyGate = deferred<void>();
const legacyQortiumInstall = withCoreInstallLock('helpers', async () => {
  await legacyGate.promise;
  return 'legacy complete';
});

assert.equal(isCoreInstallActive(), true);
assert.equal(isCoreInstallActiveForNetwork('qortium'), true);
assert.equal(isCoreInstallActiveForNetwork('qortal'), false);
await assert.rejects(
  withCoreInstallLockForNetwork('qortium', 'github', async () => {}),
  new Error(userMessage('core.error.installLockedHelpers')),
);

legacyGate.resolve();
assert.equal(await legacyQortiumInstall, 'legacy complete');
assert.equal(isCoreInstallActive(), false);

console.log('Core install lock network isolation checks passed.');
