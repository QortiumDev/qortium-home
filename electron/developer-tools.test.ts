import assert from 'node:assert/strict';
import {
  pickDeveloperToolsTabView,
  resolveDeveloperToolsTarget,
  toggleWebContentsDevTools,
} from './developer-tools.js';

const hidden = { destroyed: false, tabId: 'tab-hidden', visible: false };
const shown = { destroyed: false, tabId: 'tab-shown', visible: true };
const gone = { destroyed: true, tabId: 'tab-gone', visible: true };

// --- which view "this tab" means ------------------------------------------------

assert.equal(pickDeveloperToolsTabView([]), null, 'a window without app views has no tab view');
assert.equal(pickDeveloperToolsTabView([hidden]), null, 'a hidden app view is not the active tab');
assert.equal(pickDeveloperToolsTabView([hidden, shown]), shown, 'the visible view is the active tab');
assert.equal(
  pickDeveloperToolsTabView([gone, shown]),
  shown,
  'a destroyed view is skipped even while it still reports visible',
);
assert.equal(pickDeveloperToolsTabView([gone]), null, 'only a destroyed view means no tab view');

// --- target resolution ----------------------------------------------------------

assert.deepEqual(
  resolveDeveloperToolsTarget('tab', [hidden, shown]),
  { kind: 'app-view', view: shown },
  '"this tab" opens the app view the window shows',
);
assert.deepEqual(
  resolveDeveloperToolsTarget('tab', [hidden]),
  { kind: 'shell' },
  '"this tab" falls back to the shell when the active tab is a shell page (dashboard, settings, viewer)',
);
assert.deepEqual(
  resolveDeveloperToolsTarget('tab', []),
  { kind: 'shell' },
  '"this tab" falls back to the shell in a window with no app views at all',
);
assert.deepEqual(
  resolveDeveloperToolsTarget('home', [hidden, shown]),
  { kind: 'shell' },
  '"Home" always means the shell renderer, even while an app is showing',
);

// --- toggling -------------------------------------------------------------------

function fakeWebContents(initial: { destroyed?: boolean; open?: boolean }) {
  const calls: string[] = [];
  let open = initial.open ?? false;
  return {
    calls,
    closeDevTools() {
      calls.push('close');
      open = false;
    },
    isDestroyed: () => initial.destroyed ?? false,
    isDevToolsOpened: () => open,
    openDevTools(options: { mode: string }) {
      calls.push(`open:${options.mode}`);
      open = true;
    },
  };
}

{
  const contents = fakeWebContents({});
  assert.equal(toggleWebContentsDevTools(contents as never), true, 'closed tools open');
  assert.equal(toggleWebContentsDevTools(contents as never), false, 'open tools close');
  assert.deepEqual(contents.calls, ['open:detach', 'close'], 'tools open detached, then close');
}

{
  const contents = fakeWebContents({ destroyed: true });
  assert.equal(toggleWebContentsDevTools(contents as never), false, 'a destroyed webContents is left alone');
  assert.deepEqual(contents.calls, [], 'nothing is called on a destroyed webContents');
}

console.log('developer-tools tests passed');
