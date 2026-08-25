import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHomeWindowFocusTracker } from './home-window-focus.js';

const tracker = createHomeWindowFocusTracker();

// Nothing focused yet: the caller must be told so, not handed a guess.
assert.equal(tracker.mostRecent([1, 2, 3]), null);

tracker.note(1);
tracker.note(2);
assert.equal(tracker.mostRecent([1, 2]), 2, 'the newest focus wins');

// Re-focusing an older window moves it to the front rather than duplicating it.
tracker.note(1);
assert.equal(tracker.mostRecent([1, 2]), 1);
tracker.note(1);
assert.equal(tracker.mostRecent([1, 2]), 1);
tracker.forget(1);
assert.equal(tracker.mostRecent([1, 2]), 2, 'one forget is enough after repeats');

// A closed window must never be raised, even though it was focused most
// recently — this is the case the tray hits after you close the window you
// were using.
tracker.note(3);
tracker.forget(3);
assert.equal(tracker.mostRecent([2, 3]), 2);

// Candidates filter the answer: a window that is focused but not offered (a
// widget window, say) is not returned.
tracker.note(9);
assert.equal(tracker.mostRecent([2]), 2);
assert.equal(tracker.mostRecent([]), null);
assert.equal(tracker.mostRecent([4, 5]), null, 'unknown ids fall back to null');

// Trackers are independent, so one test cannot leak into another.
const other = createHomeWindowFocusTracker();
assert.equal(other.mostRecent([2, 9]), null);

// Forgetting something never seen is harmless.
other.forget(42);
other.note(7);
assert.equal(other.mostRecent([7]), 7);

// The tracker is only useful if the tray and window creation actually use it;
// both are one line each and easy to lose in a refactor.
const traySource = readFileSync('electron/tray.ts', 'utf8');
assert.match(
  traySource,
  /homeWindowFocus\.mostRecent\(/,
  'the tray must pick the most recently focused Home window, not the first found',
);

const mainSource = readFileSync('electron/main.ts', 'utf8');
assert.match(
  mainSource,
  /homeWindowFocus\.note\(/,
  'window creation must record focus, or the tracker is always empty',
);
assert.match(
  mainSource,
  /homeWindowFocus\.forget\(/,
  'a closed window must be forgotten, or the tray tries to raise it',
);

console.log('Home window focus tests passed.');
