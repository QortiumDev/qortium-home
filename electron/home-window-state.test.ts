import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initialWindowState,
  mergeWindowState,
  parseWindowStates,
  type WindowStatesRecord,
} from './home-window-state.js';

const limits = {
  defaultHeight: 720,
  defaultWidth: 1100,
  minHeight: 480,
  minWidth: 720,
};
const alwaysVisible = () => true;
const neverVisible = () => false;

// --- the bug this exists to prevent -----------------------------------------

// Every window used to write one flat record, so resizing and closing a second
// window redefined the size the main window opened at.
const stored: WindowStatesRecord = {
  primary: { height: 900, isMaximized: false, width: 1400, x: 10, y: 20 },
};
const afterSecondary = mergeWindowState(stored, 'secondary', {
  height: 500,
  isMaximized: false,
  width: 800,
  x: 300,
  y: 300,
});
assert.deepEqual(
  afterSecondary.primary,
  stored.primary,
  'a secondary window saving its bounds must not touch the primary geometry',
);
assert.equal(afterSecondary.secondary?.width, 800);

const afterPrimary = mergeWindowState(afterSecondary, 'primary', {
  height: 1000,
  isMaximized: true,
  width: 1600,
});
assert.equal(afterPrimary.secondary?.width, 800, 'and the reverse holds too');
assert.equal(afterPrimary.primary?.width, 1600);
assert.equal(afterPrimary.primary?.isMaximized, true);

// --- upgrading an existing profile ------------------------------------------

// The flat shape written by earlier versions is the primary window's geometry.
// Reading it as "unknown" would silently reset everyone's window size.
const legacy = parseWindowStates(
  { height: 900, isMaximized: false, width: 1400, x: 10, y: 20 },
  limits,
  alwaysVisible,
);
assert.deepEqual(legacy, {
  primary: { height: 900, isMaximized: false, width: 1400, x: 10, y: 20 },
});

const roles = parseWindowStates(
  {
    primary: { height: 900, isMaximized: false, width: 1400 },
    secondary: { height: 600, isMaximized: false, width: 900 },
  },
  limits,
  alwaysVisible,
);
assert.equal(roles.primary?.width, 1400);
assert.equal(roles.secondary?.width, 900);

// A record holding only one role must not invent the other.
const onlySecondary = parseWindowStates(
  { secondary: { height: 600, isMaximized: false, width: 900 } },
  limits,
  alwaysVisible,
);
assert.equal(onlySecondary.primary, undefined);
assert.equal(onlySecondary.secondary?.width, 900);

for (const junk of [null, undefined, 'state', 42, [1, 2]]) {
  assert.deepEqual(parseWindowStates(junk, limits, alwaysVisible), {});
}

// --- clamping and off-screen safety -----------------------------------------

const tiny = parseWindowStates(
  { height: 10, isMaximized: false, width: 10 },
  limits,
  alwaysVisible,
);
assert.equal(tiny.primary?.width, limits.minWidth, 'width is clamped to the minimum');
assert.equal(tiny.primary?.height, limits.minHeight);

const missingSize = parseWindowStates({ isMaximized: false }, limits, alwaysVisible);
assert.equal(missingSize.primary?.width, limits.defaultWidth);
assert.equal(missingSize.primary?.height, limits.defaultHeight);

// Unplugging a monitor must not strand a window off-screen: the size is kept,
// the position is dropped.
const offScreen = parseWindowStates(
  { height: 900, isMaximized: false, width: 1400, x: 9000, y: 9000 },
  limits,
  neverVisible,
);
assert.equal(offScreen.primary?.width, 1400);
assert.equal(offScreen.primary?.x, undefined);
assert.equal(offScreen.primary?.y, undefined);

// A half-written position is not a position.
const halfPosition = parseWindowStates(
  { height: 900, isMaximized: false, width: 1400, x: 10 },
  limits,
  alwaysVisible,
);
assert.equal(halfPosition.primary?.x, undefined);

// --- which geometry a new window opens with ---------------------------------

assert.equal(
  initialWindowState({ primary: { height: 900, isMaximized: false, width: 1400 } }, 'secondary')
    ?.width,
  1400,
  'the first secondary window borrows the primary size rather than the default',
);
assert.equal(
  initialWindowState(
    {
      primary: { height: 900, isMaximized: false, width: 1400 },
      secondary: { height: 600, isMaximized: false, width: 900 },
    },
    'secondary',
  )?.width,
  900,
  'once a secondary size is remembered it wins',
);
assert.equal(
  initialWindowState({ secondary: { height: 600, isMaximized: false, width: 900 } }, 'primary'),
  undefined,
  'the primary never inherits a secondary size',
);

// The original bug was an asymmetry: the read side already branched on role
// while the write side did not. Pin both to the same helper.
const mainSource = readFileSync('electron/main.ts', 'utf8');
assert.match(mainSource, /getWindowStateRole\(options\)/);
assert.match(
  mainSource,
  /watchWindowState\(window, windowStateRole\)/,
  'every window must save under its own role, or a second window clobbers the first',
);
assert.doesNotMatch(
  mainSource,
  /watchWindowState\(window\)/,
  'a role-less save is what caused the clobbering',
);

console.log('Home window state tests passed.');
