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
assert.equal(registry.require('alpha').readStatus(), 'alpha-ready');
assert.throws(() => registry.require('beta'), /No Core manager is registered for beta/);
assert.throws(
  () => new NetworkManagerEntryRegistry<'alpha' | 'beta', TestEntry>([alpha, alpha]),
  /already registered for alpha/,
);

console.log('Core manager entry registry checks passed.');
