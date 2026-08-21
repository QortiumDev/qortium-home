import assert from 'node:assert/strict';
import { CoreManagerStateRegistry } from './core-manager-state.js';

type TestStatus = { available: string | null };
type TestConfirmation = { expiresAt: string; networkMarker: string; targetVersion: string; token: string };

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

const registry = new CoreManagerStateRegistry<'alpha' | 'beta', TestStatus, TestConfirmation>(() => ({
  available: null,
}));
const alpha = registry.forNetwork('alpha');
const beta = registry.forNetwork('beta');

assert.notEqual(alpha, beta);
assert.notEqual(alpha.updateEngineStatus, beta.updateEngineStatus);
alpha.updateEngineStatus.available = 'alpha-release';
assert.equal(beta.updateEngineStatus.available, null);

let alphaLayoutRuns = 0;
await Promise.all([
  registry.ensureLayout('alpha', async () => {
    alphaLayoutRuns += 1;
  }),
  registry.ensureLayout('alpha', async () => {
    alphaLayoutRuns += 1;
  }),
]);
assert.equal(alphaLayoutRuns, 1);
let betaLayoutRuns = 0;
await registry.ensureLayout('beta', async () => {
  betaLayoutRuns += 1;
});
assert.equal(betaLayoutRuns, 1);

const failedLayout = new Error('layout failed');
const retryRegistry = new CoreManagerStateRegistry<'alpha', TestStatus, TestConfirmation>(() => ({
  available: null,
}));
await assert.rejects(
  retryRegistry.ensureLayout('alpha', async () => {
    throw failedLayout;
  }),
  (error) => error === failedLayout,
);
await retryRegistry.ensureLayout('alpha', async () => {});

const javaGate = deferred<void>();
assert.equal(
  registry.scheduleManagedJavaRefresh('alpha', async () => {
    await javaGate.promise;
  }),
  true,
);
assert.equal(registry.scheduleManagedJavaRefresh('alpha', async () => {}), false);
assert.equal(registry.scheduleManagedJavaRefresh('beta', async () => {}), true);
javaGate.resolve();
await javaGate.promise;
await new Promise<void>((resolve) => setImmediate(resolve));
assert.equal(registry.forNetwork('alpha').managedJavaRefreshInFlight, false);

const failedRefresh = deferred<void>();
assert.equal(
  registry.scheduleManagedJavaRefresh('alpha', async () => {
    await failedRefresh.promise;
  }),
  true,
);
failedRefresh.reject(new Error('refresh failed'));
await failedRefresh.promise.catch(() => {});
await new Promise<void>((resolve) => setImmediate(resolve));
assert.equal(registry.forNetwork('alpha').managedJavaRefreshInFlight, false);

const updateGate = deferred<void>();
let alphaUpdateRuns = 0;
const alphaUpdate = registry.runUpdateEngine('alpha', async () => {
  alphaUpdateRuns += 1;
  await updateGate.promise;
});
assert.equal(registry.runUpdateEngine('alpha', async () => { alphaUpdateRuns += 1; }), alphaUpdate);
let betaUpdateRuns = 0;
await registry.runUpdateEngine('beta', async () => {
  betaUpdateRuns += 1;
});
assert.equal(betaUpdateRuns, 1);

const rerun = registry.runUpdateEngineAfterPolicyChange('alpha', async () => {
  alphaUpdateRuns += 1;
});
assert.equal(
  registry.runUpdateEngineAfterPolicyChange('alpha', async () => {
    alphaUpdateRuns += 10;
  }),
  rerun,
);
updateGate.resolve();
await rerun;
assert.equal(alphaUpdateRuns, 2);
assert.equal(registry.forNetwork('alpha').updateEnginePromise, null);
assert.equal(registry.forNetwork('alpha').updateEngineRerunPromise, null);

let intervalCreations = 0;
const createInterval = () => {
  intervalCreations += 1;
  return { unref() {} } as NodeJS.Timeout;
};
assert.equal(registry.ensureUpdateInterval('alpha', createInterval), true);
assert.equal(registry.ensureUpdateInterval('alpha', createInterval), false);
assert.equal(registry.ensureUpdateInterval('beta', createInterval), true);
assert.equal(intervalCreations, 2);

const future = new Date(Date.now() + 60_000).toISOString();
registry.storeDowngradeConfirmation('alpha', {
  expiresAt: future,
  networkMarker: 'alpha',
  targetVersion: 'v1.2.3',
  token: 'shared-token',
});
assert.equal(registry.consumeDowngradeConfirmation('beta', 'shared-token', 'v1.2.3'), false);
assert.equal(registry.consumeDowngradeConfirmation('alpha', 'shared-token', 'v1.2.3'), true);
assert.equal(registry.consumeDowngradeConfirmation('alpha', 'shared-token', 'v1.2.3'), false);

registry.storeDowngradeConfirmation('beta', {
  expiresAt: future,
  networkMarker: 'beta',
  targetVersion: 'v1.2.3',
  token: 'wrong-target',
});
assert.equal(registry.consumeDowngradeConfirmation('beta', 'wrong-target', 'v9.9.9'), false);
assert.equal(registry.consumeDowngradeConfirmation('beta', 'wrong-target', 'v1.2.3'), false);

registry.storeDowngradeConfirmation('beta', {
  expiresAt: new Date(Date.now() - 1).toISOString(),
  networkMarker: 'beta',
  targetVersion: 'v1.2.3',
  token: 'expired',
});
assert.equal(registry.consumeDowngradeConfirmation('beta', 'expired', 'v1.2.3'), false);

console.log('Core manager state network isolation checks passed.');
