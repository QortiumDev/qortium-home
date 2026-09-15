import assert from 'node:assert/strict'

import { chromeOpenOptions, isMiddleButton } from './chrome-open-options'

const click = (overrides: Partial<{ button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>) => ({
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...overrides,
})

assert.equal(chromeOpenOptions(click({})).newTab, false, 'a plain left click opens in place')
assert.equal(chromeOpenOptions(click({ ctrlKey: true })).newTab, true, 'Ctrl+click asks for a new tab')
assert.equal(chromeOpenOptions(click({ metaKey: true })).newTab, true, 'Cmd+click asks for a new tab')
assert.equal(chromeOpenOptions(click({ button: 1 })).newTab, true, 'middle click asks for a new tab')
assert.equal(
  chromeOpenOptions(click({ shiftKey: true })).newTab,
  false,
  'Shift is not a new-tab modifier (it means a new window in browsers, which Home chrome does not offer)',
)
assert.equal(chromeOpenOptions(click({ button: 2 })).newTab, false, 'the secondary button is the context menu, not an open')
assert.equal(chromeOpenOptions(click({ button: 2, ctrlKey: true })).newTab, false)
assert.equal(isMiddleButton({ button: 1 }), true)
assert.equal(isMiddleButton({ button: 0 }), false)
assert.equal(isMiddleButton({ button: 2 }), false)

console.log('Home v2 chrome open options tests passed.')
