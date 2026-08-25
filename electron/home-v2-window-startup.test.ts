import assert from 'node:assert/strict';
import {
  mergeHomeV2ShellGlobalState,
  sanitizeHomeV2WindowAddress,
} from './home-v2-window-startup.js';

// --- address validation -----------------------------------------------------

for (const address of [
  'home://settings',
  'qdn://APP/Chat/Chat',
  'qortal://APP/Q-Mail/Q-Mail/inbox?filter=all#top',
  'core://',
  'qortal-core://api-documentation',
]) {
  assert.equal(sanitizeHomeV2WindowAddress(address), address, `${address} is openable`);
}

assert.equal(
  sanitizeHomeV2WindowAddress('  home://dashboard  '),
  'home://dashboard',
  'surrounding whitespace is trimmed rather than rejected',
);

// This address becomes the first thing a brand new window opens, so anything
// that is not one of Home's own schemes must not get that far.
for (const rejected of [
  '',
  '   ',
  'https://example.com',
  'file:///etc/passwd',
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'qortalish://APP/Foo/Foo',
  'HOME:/dashboard',
  null,
  undefined,
  42,
  { address: 'home://settings' },
  ['home://settings'],
]) {
  assert.throws(
    () => sanitizeHomeV2WindowAddress(rejected),
    /window address/,
    `${JSON.stringify(rejected)} is refused`,
  );
}

assert.throws(
  () => sanitizeHomeV2WindowAddress(`home://${'a'.repeat(4096)}`),
  /bounded string/,
  'an unbounded address is refused',
);

// Scheme matching is case-insensitive, matching how the address route parses.
assert.equal(
  sanitizeHomeV2WindowAddress('QDN://APP/Chat/Chat'),
  'QDN://APP/Chat/Chat',
);

// --- detached-window save merge --------------------------------------------

const stored = {
  appearance: { theme: 'dark' },
  product: { activeTabId: 'tab-1', entries: [{ id: 'tab-1' }] },
  selectedAccountId: 'wallet:Q1',
};

// The whole point: a detached window's session-only strip must not overwrite
// the tabs of the window it was dragged out of.
const merged = mergeHomeV2ShellGlobalState(stored, {
  appearance: { theme: 'light' },
  product: { activeTabId: 'detached-tab', entries: [{ id: 'detached-tab' }] },
  selectedAccountId: 'wallet:Q2',
}) as Record<string, unknown>;

assert.deepEqual(merged.product, stored.product, 'the stored tab strip survives');
assert.deepEqual(
  merged.appearance,
  { theme: 'light' },
  'settings from the detached window are still persisted',
);
assert.equal(merged.selectedAccountId, 'wallet:Q2');

// A first run has nothing stored, so there is no strip to preserve — and the
// detached window must not seed one either.
const fresh = mergeHomeV2ShellGlobalState(null, {
  appearance: { theme: 'dark' },
  product: { activeTabId: 'detached-tab', entries: [] },
}) as Record<string, unknown>;
assert.equal('product' in fresh, false, 'no strip is written when none is stored');

// Junk on disk must not become a way to smuggle a product value through.
for (const junk of [undefined, 'not an object', 42, ['product']]) {
  const result = mergeHomeV2ShellGlobalState(junk, {
    appearance: { theme: 'dark' },
    product: { activeTabId: 'x', entries: [] },
  }) as Record<string, unknown>;
  assert.equal('product' in result, false, `${JSON.stringify(junk)} yields no product`);
}

for (const invalid of [null, undefined, 'state', 7, [1, 2]]) {
  assert.throws(
    () => mergeHomeV2ShellGlobalState(stored, invalid),
    /must be an object/,
    `${JSON.stringify(invalid)} is refused`,
  );
}

console.log('Home v2 window startup tests passed.');
