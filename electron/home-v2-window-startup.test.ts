import assert from 'node:assert/strict';
import {
  HOME_V2_WINDOW_ADDRESS_MAX_LENGTH,
  mergeHomeV2ShellGlobalState,
  sanitizeHomeV2TabTransfer,
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

// The boundary itself, exactly. Main's bound MUST equal the renderer's
// validateCustomNewTabAddress bound (2,000): main accepting what the receiving
// renderer will refuse loses the tab, because the sending window closes it as
// soon as main says yes.
assert.equal(HOME_V2_WINDOW_ADDRESS_MAX_LENGTH, 2_000, "main's bound is the renderer's bound");
const atBound = `home://${'a'.repeat(HOME_V2_WINDOW_ADDRESS_MAX_LENGTH - 'home://'.length)}`;
assert.equal(atBound.length, 2_000);
assert.equal(sanitizeHomeV2WindowAddress(atBound), atBound, 'exactly 2,000 characters is accepted');
assert.throws(
  () => sanitizeHomeV2WindowAddress(`${atBound}a`),
  /bounded string/,
  '2,001 characters is refused',
);
// The same boundary inside an envelope, on both the address and a history entry.
assert.equal(
  sanitizeHomeV2TabTransfer({ revision: 2, address: atBound, accountId: 'home-v2:guest' }).address,
  atBound,
);
assert.throws(
  () =>
    sanitizeHomeV2TabTransfer({
      revision: 2,
      address: `${atBound}a`,
      accountId: 'home-v2:guest',
    }),
  /bounded string/,
);
assert.throws(
  () =>
    sanitizeHomeV2TabTransfer({
      revision: 2,
      address: 'home://settings',
      accountId: 'home-v2:guest',
      history: { entries: [{ address: `${atBound}a` }], index: 0 },
    }),
  /bounded string/,
);

// Scheme matching is case-insensitive, matching how the address route parses.
assert.equal(
  sanitizeHomeV2WindowAddress('QDN://APP/Chat/Chat'),
  'QDN://APP/Chat/Chat',
);

// --- tab transfer envelope --------------------------------------------------

// The historical payload was a bare address, and a window pair that still
// speaks it must keep working rather than fail.
assert.deepEqual(sanitizeHomeV2TabTransfer('  home://settings  '), {
  revision: 1,
  address: 'home://settings',
});
assert.deepEqual(sanitizeHomeV2TabTransfer({ revision: 1, address: 'home://settings' }), {
  revision: 1,
  address: 'home://settings',
});
// A revision-1 payload carries no account and no history, whatever it claims.
assert.deepEqual(
  sanitizeHomeV2TabTransfer({
    revision: 1,
    address: 'home://settings',
    accountId: 'wallet:A',
    history: { entries: [{ address: 'home://settings' }], index: 0 },
  }),
  { revision: 1, address: 'home://settings' },
);

const transfer = sanitizeHomeV2TabTransfer({
  revision: 2,
  address: 'qdn://APP/Chat/published/room',
  accountId: 'wallet:A',
  title: 'Chat',
  history: {
    entries: [
      { address: '  qdn://APP/Chat/published  ', title: 'Chat' },
      { address: 'qdn://APP/Chat/published/room' },
    ],
    index: 1,
  },
  // Anything Home does not name is dropped rather than forwarded.
  previewUrl: 'http://127.0.0.1:1/render/hash/preview',
  native: { entries: [1, 2, 3] },
});
assert.deepEqual(transfer, {
  revision: 2,
  address: 'qdn://APP/Chat/published/room',
  accountId: 'wallet:A',
  title: 'Chat',
  history: {
    entries: [
      { address: 'qdn://APP/Chat/published', title: 'Chat' },
      { address: 'qdn://APP/Chat/published/room' },
    ],
    index: 1,
  },
});
assert.equal('previewUrl' in transfer, false, 'a preview capability never travels');
assert.equal('native' in transfer, false, 'a native history session never travels');
assert.equal(Object.getPrototypeOf(transfer), Object.prototype);

// Optional fields stay optional, and an empty title is simply absent.
assert.deepEqual(
  sanitizeHomeV2TabTransfer({ revision: 2, address: 'home://dashboard', accountId: 'home-v2:guest' }),
  { revision: 2, address: 'home://dashboard', accountId: 'home-v2:guest' },
);
assert.deepEqual(
  sanitizeHomeV2TabTransfer({
    revision: 2, address: 'home://dashboard', accountId: 'home-v2:guest', title: '   ',
  }),
  { revision: 2, address: 'home://dashboard', accountId: 'home-v2:guest' },
);
// Display-only, so an over-long title is trimmed to fit rather than refused.
assert.equal(
  (sanitizeHomeV2TabTransfer({
    revision: 2, address: 'home://dashboard', accountId: 'home-v2:guest', title: 'x'.repeat(900),
  }) as { title: string }).title.length,
  512,
);

// The account id is bounded and forwarded verbatim; the receiving window is
// what checks it against its own catalogue.
for (const rejected of [
  { revision: 2, address: 'home://settings' },
  { revision: 2, address: 'home://settings', accountId: '' },
  { revision: 2, address: 'home://settings', accountId: '   ' },
  { revision: 2, address: 'home://settings', accountId: 42 },
  { revision: 2, address: 'home://settings', accountId: null },
  { revision: 2, address: 'home://settings', accountId: 'a'.repeat(401) },
]) {
  assert.throws(
    () => sanitizeHomeV2TabTransfer(rejected),
    /account/,
    `${JSON.stringify(rejected)} is refused`,
  );
}

for (const rejected of [
  null,
  undefined,
  42,
  ['home://settings'],
  {},
  { address: 'home://settings' },
  { revision: 3, address: 'home://settings', accountId: 'home-v2:guest' },
  { revision: '2', address: 'home://settings', accountId: 'home-v2:guest' },
  { revision: 2, address: 'https://example.com', accountId: 'home-v2:guest' },
  { revision: 2, address: 42, accountId: 'home-v2:guest' },
]) {
  assert.throws(
    () => sanitizeHomeV2TabTransfer(rejected),
    /tab transfer|window address|revision/,
    `${JSON.stringify(rejected)} is refused`,
  );
}

const guest = { revision: 2, address: 'home://settings', accountId: 'home-v2:guest' };
for (const badHistory of [
  'history',
  42,
  [],
  { index: 0 },
  { entries: {}, index: 0 },
  { entries: [{ address: 'home://settings' }] },
  { entries: [{ address: 'home://settings' }], index: 1 },
  { entries: [{ address: 'home://settings' }], index: -1 },
  { entries: [{ address: 'home://settings' }], index: 0.5 },
  { entries: [{ address: 'home://settings' }], index: '0' },
  { entries: [], index: 0 },
  { entries: [{ address: 'https://example.com' }], index: 0 },
  { entries: ['home://settings'], index: 0 },
  { entries: [{ address: 'home://settings', title: 42 }], index: 0 },
  { entries: Array.from({ length: 51 }, () => ({ address: 'home://settings' })), index: 0 },
]) {
  assert.throws(
    () => sanitizeHomeV2TabTransfer({ ...guest, history: badHistory }),
    /history|window address|title/,
    `${JSON.stringify(badHistory)} is refused`,
  );
}
// An absent history is not a malformed one.
assert.deepEqual(sanitizeHomeV2TabTransfer({ ...guest, history: undefined }), guest);
assert.deepEqual(sanitizeHomeV2TabTransfer({ ...guest, history: null }), guest);

// The result is a fresh object: nothing the renderer sent is retained by
// reference, so a later mutation there cannot reach the new window.
const sent = {
  revision: 2,
  address: 'home://settings',
  accountId: 'home-v2:guest',
  history: { entries: [{ address: 'home://settings' }, { address: 'home://dashboard' }], index: 0 },
};
const copied = sanitizeHomeV2TabTransfer(sent) as {
  history: { entries: { address: string }[] };
};
assert.notEqual(copied.history, sent.history);
assert.notEqual(copied.history.entries, sent.history.entries);
assert.notEqual(copied.history.entries[0], sent.history.entries[0]);

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
