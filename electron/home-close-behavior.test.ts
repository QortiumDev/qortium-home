import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HOME_CLOSE_DIALOG_CANCEL_BUTTON,
  HOME_CLOSE_DIALOG_CLOSE_BUTTON,
  HOME_CLOSE_DIALOG_HIDE_BUTTON,
  homeCloseDialog,
  homeV2TabCount,
  planHomeClose,
  resolveHomeCloseDialog,
  type HomeCloseContext,
} from './home-close-behavior.js';

const base: HomeCloseContext = {
  closeToTray: false,
  confirmed: false,
  quitting: false,
  role: 'primary',
  tabCount: 1,
  trayAvailable: true,
  warnOnMultipleTabs: true,
};

const context = (overrides: Partial<HomeCloseContext>): HomeCloseContext => ({
  ...base,
  ...overrides,
});

// --- the rule that must never break -----------------------------------------

// A quit outranks everything. If close-to-tray could survive a quit, Quit
// would hide the window instead of exiting and the app would be unquittable
// from its own menu.
for (const closeToTray of [false, true]) {
  for (const warnOnMultipleTabs of [false, true]) {
    assert.equal(
      planHomeClose(context({ closeToTray, quitting: true, tabCount: 9, warnOnMultipleTabs })).kind,
      'close',
      'a quit in progress always closes',
    );
  }
}

// --- exhaustive combinations ------------------------------------------------

// Stated again here in different words than the implementation, so a change to
// the ordering in planHomeClose has to be a deliberate change to both.
function expectedKind(input: HomeCloseContext): 'close' | 'hide' | 'prompt' {
  if (input.quitting) return 'close';
  if (input.confirmed) return 'close';
  if (input.role === 'secondary') return 'close';
  if (input.closeToTray && input.trayAvailable) return 'hide';
  if (input.warnOnMultipleTabs && input.tabCount > 1) return 'prompt';
  return 'close';
}

let combinations = 0;
for (const quitting of [false, true]) {
  for (const confirmed of [false, true]) {
    for (const role of ['primary', 'secondary'] as const) {
      for (const closeToTray of [false, true]) {
        for (const warnOnMultipleTabs of [false, true]) {
          for (const trayAvailable of [false, true]) {
            for (const tabCount of [0, 1, 2, 7]) {
              const input = context({
                closeToTray,
                confirmed,
                quitting,
                role,
                tabCount,
                trayAvailable,
                warnOnMultipleTabs,
              });
              combinations += 1;
              assert.equal(
                planHomeClose(input).kind,
                expectedKind(input),
                `unexpected plan for ${JSON.stringify(input)}`,
              );
            }
          }
        }
      }
    }
  }
}
assert.equal(combinations, 2 * 2 * 2 * 2 * 2 * 2 * 4);

// --- the individually load-bearing cases ------------------------------------

assert.equal(
  planHomeClose(context({ closeToTray: true })).kind,
  'hide',
  'close-to-tray hides even with a single tab',
);

// Hiding a window with no tray to restore it from would strand it. The setting
// falls back to the warning instead.
assert.equal(
  planHomeClose(context({ closeToTray: true, tabCount: 3, trayAvailable: false })).kind,
  'prompt',
  'without a tray, close-to-tray falls through to the warning',
);
assert.equal(
  planHomeClose(context({ closeToTray: true, tabCount: 1, trayAvailable: false })).kind,
  'close',
  'without a tray and with nothing to warn about, the window just closes',
);

// Re-entrancy: the close issued by the dialog's own "Close window" answer runs
// through this handler again. Without the confirmed flag it would prompt for
// ever and the window could never be closed.
assert.equal(
  planHomeClose(context({ confirmed: true, tabCount: 5 })).kind,
  'close',
  'a confirmed close never re-prompts',
);
assert.equal(
  planHomeClose(context({ closeToTray: true, confirmed: true })).kind,
  'close',
  'a confirmed close is not turned back into a hide either',
);

// Detached and secondary windows own a session-only tab strip; the app-level
// behaviour belongs to the main window.
assert.equal(
  planHomeClose(context({ closeToTray: true, role: 'secondary', tabCount: 4 })).kind,
  'close',
  'a secondary window closes normally',
);

assert.equal(
  planHomeClose(context({ tabCount: 1 })).kind,
  'close',
  'one tab is nothing to warn about',
);
assert.equal(planHomeClose(context({ tabCount: 2 })).kind, 'prompt');
assert.equal(
  planHomeClose(context({ tabCount: 6, warnOnMultipleTabs: false })).kind,
  'close',
  'the warning can be turned off',
);

// --- the dialog -------------------------------------------------------------

const withTray = homeCloseDialog(3, true);
assert.deepEqual(withTray.buttons, [
  HOME_CLOSE_DIALOG_CLOSE_BUTTON,
  HOME_CLOSE_DIALOG_HIDE_BUTTON,
  HOME_CLOSE_DIALOG_CANCEL_BUTTON,
]);
assert.deepEqual(withTray.actions, ['close', 'hide', 'cancel']);
assert.equal(withTray.cancelId, 2);
assert.equal(withTray.defaultId, withTray.cancelId, 'the default answer must keep the tabs');
assert.equal(withTray.message, 'Close 3 tabs?');
assert.equal(withTray.buttons.length, withTray.actions.length);

const withoutTray = homeCloseDialog(2, false);
assert.deepEqual(withoutTray.buttons, [
  HOME_CLOSE_DIALOG_CLOSE_BUTTON,
  HOME_CLOSE_DIALOG_CANCEL_BUTTON,
]);
assert.deepEqual(withoutTray.actions, ['close', 'cancel']);
assert.equal(withoutTray.cancelId, 1);
assert.equal(withoutTray.defaultId, 1);
assert.ok(
  !withoutTray.detail.includes('tray'),
  'with no tray, the dialog must not offer one',
);
assert.equal(homeCloseDialog(1, true).message, 'Close 1 tab?');

const prompted = planHomeClose(context({ tabCount: 4 }));
assert.equal(prompted.kind, 'prompt');
if (prompted.kind === 'prompt') {
  assert.equal(prompted.dialog.message, 'Close 4 tabs?');
}

// --- what "Remember my choice" records --------------------------------------

// The checkbox only ever turns the answer the user gave into its own setting.
assert.deepEqual(resolveHomeCloseDialog(withTray, { response: 0 }), {
  action: 'close',
  settings: null,
});
assert.deepEqual(resolveHomeCloseDialog(withTray, { response: 0, checkboxChecked: false }), {
  action: 'close',
  settings: null,
});
assert.deepEqual(resolveHomeCloseDialog(withTray, { response: 0, checkboxChecked: true }), {
  action: 'close',
  settings: { warnOnCloseWithMultipleTabs: false },
});
assert.deepEqual(resolveHomeCloseDialog(withTray, { response: 1 }), {
  action: 'hide',
  settings: null,
});
assert.deepEqual(resolveHomeCloseDialog(withTray, { response: 1, checkboxChecked: true }), {
  action: 'hide',
  settings: { closeToTray: true },
});

// Cancelling expresses no preference. Recording one from a dialog the user
// backed out of would be the worst possible surprise.
assert.deepEqual(resolveHomeCloseDialog(withTray, { response: 2, checkboxChecked: true }), {
  action: 'cancel',
  settings: null,
});

// The button indices differ without a tray, so an answer must be read against
// the dialog that produced it rather than against fixed positions.
assert.deepEqual(resolveHomeCloseDialog(withoutTray, { response: 1, checkboxChecked: true }), {
  action: 'cancel',
  settings: null,
});
assert.deepEqual(resolveHomeCloseDialog(withoutTray, { response: 0, checkboxChecked: true }), {
  action: 'close',
  settings: { warnOnCloseWithMultipleTabs: false },
});

// An unknown answer must never close anything.
for (const response of [-1, 3, 99, Number.NaN, 1.5]) {
  assert.deepEqual(
    resolveHomeCloseDialog(withTray, { response, checkboxChecked: true }),
    { action: 'cancel', settings: null },
    `an out-of-range answer (${response}) must cancel`,
  );
}

// --- the tab count main reads at close time ---------------------------------

assert.equal(homeV2TabCount({ product: { entries: [{}, {}, {}] } }), 3);
assert.equal(homeV2TabCount({ product: { entries: [] } }), 0);
for (const junk of [
  null,
  undefined,
  0,
  'product',
  [],
  [{ product: { entries: [{}, {}] } }],
  {},
  { product: null },
  { product: [] },
  { product: { entries: null } },
  { product: { entries: 3 } },
  { product: { entries: {} } },
  { entries: [{}, {}] },
]) {
  assert.equal(
    homeV2TabCount(junk),
    0,
    `unreadable shell state must count as no tabs, not as a reason to warn (${JSON.stringify(junk)})`,
  );
}

// No tabs and one tab both mean no warning, so an unreadable state degrades to
// closing normally rather than to a dialog about nothing.
assert.equal(planHomeClose(context({ tabCount: homeV2TabCount(null) })).kind, 'close');

// --- how main.ts must wire this ---------------------------------------------

const mainSource = readFileSync('electron/main.ts', 'utf8');
assert.match(
  mainSource,
  /planHomeClose\(/,
  'the close handler must decide through the tested module, not inline',
);
assert.match(mainSource, /resolveHomeCloseDialog\(/);
assert.match(
  mainSource,
  /app\.on\('before-quit', \(event\) => \{\s*\n\s*(?:\/\/[^\n]*\n\s*)*quitRequested = true;/,
  'before-quit must set the quitting flag first, or close-to-tray blocks the quit',
);
assert.match(
  mainSource,
  /if \(gotSingleInstanceLock\) prepareI2pdForAppQuit\(\);/,
  'quitting Home must revoke a not-yet-launched i2pd start',
);
assert.doesNotMatch(
  mainSource,
  /stopRetainedChildForAppQuit|stopI2pdForAppQuit/,
  'quitting Home must not stop an established managed i2pd router',
);
const i2pdManagerSource = readFileSync('electron/i2pd-manager.ts', 'utf8');
assert.match(
  i2pdManagerSource,
  /export function prepareForAppQuit\(\): void \{\s*appShutdownRequested = true;\s*\}/,
  'the quit gate must synchronously revoke new i2pd launches without signalling the child',
);
assert.doesNotMatch(
  mainSource,
  /if \(await isManagedCoreUsingI2p\(\)\) \{\s*await startI2pdIfManaged\(\);\s*\} else \{\s*await stopI2pdIfManaged\(\);/,
  'reopening Home must not stop a standalone managed i2pd router when Core is stopped',
);
assert.match(
  mainSource,
  /quitting: quitRequested/,
  'the close plan must be told about a quit in progress',
);

// The tray's Quit goes through app.quit(), which is what raises before-quit and
// therefore the quitting flag. A tray that closed windows directly would be
// swallowed by close-to-tray.
const traySource = readFileSync('electron/tray.ts', 'utf8');
assert.match(
  traySource,
  /commandId === TRAY_COMMAND_QUIT[\s\S]{0,120}app\.quit\(\)/,
  'the tray Quit command must quit the app, not close its windows',
);

console.log('Home close behaviour tests passed.');
