import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planTrayOpenHome, type TrayHomeWindowSnapshot } from './tray-open-home.js';

function windowSnapshot(
  id: number,
  overrides: Partial<Omit<TrayHomeWindowSnapshot, 'id'>> = {},
): TrayHomeWindowSnapshot {
  return {
    id,
    isFocused: false,
    isMinimized: false,
    isVisible: true,
    ...overrides,
  };
}

// Home running with only widgets on screen: the tray is the only route back in,
// and the first window owns the primary geometry.
assert.deepEqual(planTrayOpenHome([], null), {
  kind: 'open-new',
  placement: 'primary',
});

// The bug this module exists for: a window already in front and taking input
// made "Open Qortium Home" a no-op, because raising it changed nothing.
assert.deepEqual(
  planTrayOpenHome([windowSnapshot(1, { isFocused: true })], 1),
  { kind: 'open-new', placement: 'secondary' },
  'an already-focused window means the user wants another one',
);

// A second window must not stack on the primary's remembered geometry, nor
// save over it — that is what secondary placement is for.
assert.deepEqual(
  planTrayOpenHome([windowSnapshot(4, { isFocused: true })], null),
  { kind: 'open-new', placement: 'secondary' },
  'placement is secondary whenever windows already exist, focus history or not',
);

// Minimized is the classic "get Home back" case.
assert.deepEqual(
  planTrayOpenHome([windowSnapshot(2, { isMinimized: true, isVisible: false })], 2),
  { kind: 'raise', windowId: 2 },
);

// A minimized window that still reports itself visible and focused (window
// managers disagree about this) is a raise, not a new window.
assert.deepEqual(
  planTrayOpenHome(
    [windowSnapshot(2, { isFocused: true, isMinimized: true })],
    2,
  ),
  { kind: 'raise', windowId: 2 },
);

// Visible but behind another application: raising is exactly what was asked
// for, and is the case Linux focus-stealing prevention used to swallow.
assert.deepEqual(
  planTrayOpenHome([windowSnapshot(3, { isFocused: false })], 3),
  { kind: 'raise', windowId: 3 },
);

// Hidden without being minimized.
assert.deepEqual(
  planTrayOpenHome([windowSnapshot(5, { isVisible: false })], 5),
  { kind: 'raise', windowId: 5 },
);

// Creation order is arbitrary with several windows open, so the most recently
// focused one decides — both which window is raised, and whether the whole
// menu item means raise or open.
const many = [
  windowSnapshot(10),
  windowSnapshot(11, { isFocused: true }),
  windowSnapshot(12),
];
assert.deepEqual(
  planTrayOpenHome(many, 12),
  { kind: 'raise', windowId: 12 },
  'the most recent window is the one raised, not the first found',
);
assert.deepEqual(
  planTrayOpenHome(many, 11),
  { kind: 'open-new', placement: 'secondary' },
  'the most recent window decides raise-vs-open, even when others are unfocused',
);

// Never focused, and a stale id that names a window that has since closed, both
// fall back to first-found rather than to nothing at all.
assert.deepEqual(planTrayOpenHome(many, null), { kind: 'raise', windowId: 10 });
assert.deepEqual(planTrayOpenHome(many, 99), { kind: 'raise', windowId: 10 });

// The plan is only worth anything if the tray executes it, and every step of
// the raise is one line that a refactor can quietly drop.
const traySource = readFileSync('electron/tray.ts', 'utf8');
assert.match(
  traySource,
  /planTrayOpenHome\(/,
  'the tray must decide raise-vs-open through the tested plan',
);
assert.match(
  traySource,
  /\.moveTop\(\)/,
  'a raise needs moveTop(); focus() alone leaves the window behind on Linux',
);
assert.match(
  traySource,
  /app\.focus\(\{\s*steal:\s*true\s*\}\)/,
  'focus-stealing prevention demotes a tray focus() to a taskbar flash without it',
);
assert.match(
  traySource,
  /placement:/,
  'the tray must tell main which placement a newly opened window gets',
);

// main.ts has to honour that placement, or every tray-opened window stacks on
// the primary's saved geometry.
const mainSource = readFileSync('electron/main.ts', 'utf8');
assert.match(
  mainSource,
  /installTray\(\{\s*openHome:\s*\(\{\s*placement\s*\}\)\s*=>\s*createWindow\(\{\s*placement\s*\}\)/,
  'installTray must thread the tray placement into createWindow',
);

console.log('Tray open-home tests passed.');
