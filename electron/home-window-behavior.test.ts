import assert from 'node:assert/strict';
import {
  applyHomeWindowBehaviorPatch,
  DEFAULT_HOME_WINDOW_BEHAVIOR,
  HOME_WINDOW_BEHAVIOR_SCHEMA,
  parseHomeWindowBehavior,
  parseHomeWindowBehaviorPatch,
  serializeHomeWindowBehavior,
} from './home-window-behavior.js';

// --- defaults ----------------------------------------------------------------

assert.deepEqual(DEFAULT_HOME_WINDOW_BEHAVIOR, {
  closeToTray: false,
  warnOnCloseWithMultipleTabs: true,
});

// --- reading the stored file -------------------------------------------------

assert.deepEqual(
  parseHomeWindowBehavior({
    closeToTray: true,
    schema: HOME_WINDOW_BEHAVIOR_SCHEMA,
    version: 1,
    warnOnCloseWithMultipleTabs: false,
  }),
  { closeToTray: true, warnOnCloseWithMultipleTabs: false },
  'a well-formed record round-trips',
);

// Junk must never stop Home from opening: every unusable value falls back to
// its own default, field by field.
for (const junk of [
  null,
  undefined,
  0,
  '',
  'closeToTray',
  [],
  [{ closeToTray: true }],
  true,
]) {
  assert.deepEqual(
    parseHomeWindowBehavior(junk),
    DEFAULT_HOME_WINDOW_BEHAVIOR,
    'unusable stored behaviour falls back to the defaults',
  );
}

assert.deepEqual(
  parseHomeWindowBehavior({ closeToTray: 'yes', warnOnCloseWithMultipleTabs: false }),
  { closeToTray: false, warnOnCloseWithMultipleTabs: false },
  'one malformed field does not discard the other',
);

assert.deepEqual(
  parseHomeWindowBehavior({ warnOnCloseWithMultipleTabs: false }),
  { closeToTray: false, warnOnCloseWithMultipleTabs: false },
  'a missing field takes its default',
);

assert.deepEqual(
  parseHomeWindowBehavior({ closeToTray: true, somethingElse: 1 }),
  { closeToTray: true, warnOnCloseWithMultipleTabs: true },
  'an unknown stored key is ignored rather than fatal',
);

// A geometry record must never be mistaken for behaviour, and vice versa: they
// are separate files precisely so neither parse can see the other's shape.
assert.deepEqual(
  parseHomeWindowBehavior({ height: 900, isMaximized: false, width: 1400 }),
  DEFAULT_HOME_WINDOW_BEHAVIOR,
);

// --- writing -----------------------------------------------------------------

const written = serializeHomeWindowBehavior({
  closeToTray: true,
  warnOnCloseWithMultipleTabs: false,
});
assert.deepEqual(written, {
  closeToTray: true,
  schema: HOME_WINDOW_BEHAVIOR_SCHEMA,
  version: 1,
  warnOnCloseWithMultipleTabs: false,
});
assert.deepEqual(
  parseHomeWindowBehavior(JSON.parse(JSON.stringify(written))),
  { closeToTray: true, warnOnCloseWithMultipleTabs: false },
  'what is written reads back unchanged',
);

// --- renderer-supplied changes ----------------------------------------------

assert.deepEqual(parseHomeWindowBehaviorPatch({ closeToTray: true }), { closeToTray: true });
assert.deepEqual(
  parseHomeWindowBehaviorPatch({ closeToTray: false, warnOnCloseWithMultipleTabs: true }),
  { closeToTray: false, warnOnCloseWithMultipleTabs: true },
);

// Strict, unlike the disk parse: this is untrusted renderer input.
for (const bad of [
  null,
  undefined,
  'closeToTray',
  42,
  [],
  {},
  { closeToTray: 'true' },
  { closeToTray: 1 },
  { closeToTray: true, unexpected: true },
  { unexpected: true },
  { closeToTray: true, warnOnCloseWithMultipleTabs: true, extra: true },
]) {
  assert.throws(
    () => parseHomeWindowBehaviorPatch(bad),
    /window behaviour/,
    `a window behaviour change of ${JSON.stringify(bad)} must be refused`,
  );
}

// --- applying ---------------------------------------------------------------

assert.deepEqual(
  applyHomeWindowBehaviorPatch(DEFAULT_HOME_WINDOW_BEHAVIOR, { closeToTray: true }),
  { closeToTray: true, warnOnCloseWithMultipleTabs: true },
  'a one-field change leaves the other setting alone',
);
assert.deepEqual(
  applyHomeWindowBehaviorPatch(
    { closeToTray: true, warnOnCloseWithMultipleTabs: false },
    { warnOnCloseWithMultipleTabs: true },
  ),
  { closeToTray: true, warnOnCloseWithMultipleTabs: true },
);
assert.deepEqual(
  applyHomeWindowBehaviorPatch({ closeToTray: true, warnOnCloseWithMultipleTabs: false }, {}),
  { closeToTray: true, warnOnCloseWithMultipleTabs: false },
  'an empty patch changes nothing',
);
assert.deepEqual(
  applyHomeWindowBehaviorPatch(DEFAULT_HOME_WINDOW_BEHAVIOR, { closeToTray: false }),
  DEFAULT_HOME_WINDOW_BEHAVIOR,
  'turning a setting off is a real change, not a missing one',
);

console.log('Home window behaviour tests passed.');
