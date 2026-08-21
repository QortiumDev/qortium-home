import assert from 'node:assert/strict';
import { NetworkManagerEntryRegistry } from './core-manager-entry-registry.js';

type TestEntry = {
  networkId: 'alpha' | 'beta';
  readStatus(): string;
};

const alpha: TestEntry = {
  networkId: 'alpha',
  readStatus: () => 'alpha-ready',
};
const registry = new NetworkManagerEntryRegistry<'alpha' | 'beta', TestEntry>([alpha]);

assert.equal(registry.get('alpha'), alpha);
assert.equal(registry.get('beta'), null);
assert.deepEqual(registry.listNetworkIds(), ['alpha']);
const beta: TestEntry = { networkId: 'beta', readStatus: () => 'beta-ready' };
assert.equal(registry.register(beta), beta);
assert.equal(registry.get('beta'), beta);
assert.deepEqual(registry.listNetworkIds(), ['alpha', 'beta']);
assert.equal(registry.require('alpha').readStatus(), 'alpha-ready');
assert.equal(registry.require('beta').readStatus(), 'beta-ready');
assert.throws(() => registry.register(beta), /already registered for beta/);
assert.throws(
  () => new NetworkManagerEntryRegistry<'alpha' | 'beta', TestEntry>([alpha, alpha]),
  /already registered for alpha/,
);

console.log('Core manager entry registry checks passed.');
