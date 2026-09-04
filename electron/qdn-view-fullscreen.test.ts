// The rules a hosted QDN app view follows while it is in HTML fullscreen.
//
// The bug these cover: the host renderer re-sends the app's tab-slot bounds on
// every window resize and ResizeObserver tick (src/v2/shell/AppTabStage.tsx),
// and taking the window OS-fullscreen for an app IS a resize - so without a
// fullscreen flag the very act of going fullscreen snapped the app straight
// back into its tab slot inside a now-chromeless window.
import assert from 'node:assert/strict'
import {
  IDLE_QDN_VIEW_FULLSCREEN_STATE,
  QDN_VIEW_FULLSCREEN_CUE_DURATION_MS,
  QDN_VIEW_FULLSCREEN_CUE_HEIGHT,
  enterQdnViewFullscreen,
  isQdnViewPermissionAllowed,
  leaveQdnViewFullscreen,
  releaseQdnViewFullscreenCue,
  resolveQdnViewBounds,
  resolveQdnViewFullscreenTeardown,
  scaleQdnViewBoundsForHostZoom,
} from './qdn-view-fullscreen.js'

// ---------------------------------------------------------------------------
// Permissions: fullscreen is the ONLY thing a hosted app may have.
// ---------------------------------------------------------------------------

assert.equal(isQdnViewPermissionAllowed('fullscreen'), true)

// Every permission Electron can hand either handler, minus 'fullscreen'. If a
// future Electron adds one, it is denied by default and this list only has to
// grow to keep saying so out loud.
const DENIED_PERMISSIONS = [
  'clipboard-read',
  'clipboard-sanitized-write',
  'deprecated-sync-clipboard-read',
  'display-capture',
  'fileSystem',
  'geolocation',
  'hid',
  'idle-detection',
  'keyboardLock',
  'media',
  'mediaKeySystem',
  'midi',
  'midiSysex',
  'notifications',
  'openExternal',
  'pointerLock',
  'serial',
  'speaker-selection',
  'storage-access',
  'top-level-storage-access',
  'unknown',
  'usb',
  'window-management',
]

for (const permission of DENIED_PERMISSIONS) {
  assert.equal(
    isQdnViewPermissionAllowed(permission),
    false,
    `${permission} must stay denied for untrusted app content`,
  )
}

// Near-misses must not slip through a loose comparison.
for (const permission of ['Fullscreen', 'fullscreen ', 'fullscreen-capture', '']) {
  assert.equal(isQdnViewPermissionAllowed(permission), false)
}

// ---------------------------------------------------------------------------
// Layout while not fullscreen: unchanged behaviour, host bounds scaled by zoom.
// ---------------------------------------------------------------------------

const WINDOW = { height: 800, width: 1280 }
const SLOT = { x: 240, y: 96, width: 1000, height: 640 }

assert.deepEqual(
  resolveQdnViewBounds({
    fullscreen: IDLE_QDN_VIEW_FULLSCREEN_STATE,
    hostCssBounds: SLOT,
    windowContentSize: WINDOW,
    zoomFactor: 1,
  }),
  SLOT,
)

assert.deepEqual(
  resolveQdnViewBounds({
    fullscreen: IDLE_QDN_VIEW_FULLSCREEN_STATE,
    hostCssBounds: SLOT,
    windowContentSize: WINDOW,
    zoomFactor: 1.25,
  }),
  scaleQdnViewBoundsForHostZoom(SLOT, 1.25),
)

// Nothing to apply before the host has sent any bounds.
assert.equal(
  resolveQdnViewBounds({
    fullscreen: IDLE_QDN_VIEW_FULLSCREEN_STATE,
    hostCssBounds: null,
    windowContentSize: WINDOW,
    zoomFactor: 1,
  }),
  null,
)

// ---------------------------------------------------------------------------
// Entering fullscreen: full window, minus the cue strip for the first seconds.
// ---------------------------------------------------------------------------

let state = enterQdnViewFullscreen(false)
assert.equal(state.active, true)
assert.equal(state.cueReserved, true)
assert.equal(state.windowWasFullScreen, false)

const withCue = resolveQdnViewBounds({
  fullscreen: state,
  hostCssBounds: SLOT,
  windowContentSize: { height: 1080, width: 1920 },
  zoomFactor: 1,
})
assert.deepEqual(withCue, {
  x: 0,
  y: QDN_VIEW_FULLSCREEN_CUE_HEIGHT,
  width: 1920,
  height: 1080 - QDN_VIEW_FULLSCREEN_CUE_HEIGHT,
})

// The strip is a host CSS measurement, so a zoomed host needs a taller strip
// or the banner it holds would be clipped.
assert.deepEqual(
  resolveQdnViewBounds({
    fullscreen: state,
    hostCssBounds: SLOT,
    windowContentSize: { height: 1080, width: 1920 },
    zoomFactor: 1.5,
  }),
  {
    x: 0,
    y: Math.round(QDN_VIEW_FULLSCREEN_CUE_HEIGHT * 1.5),
    width: 1920,
    height: 1080 - Math.round(QDN_VIEW_FULLSCREEN_CUE_HEIGHT * 1.5),
  },
)

// A window too short for both gets the app; the cue is a courtesy.
assert.deepEqual(
  resolveQdnViewBounds({
    fullscreen: state,
    hostCssBounds: SLOT,
    windowContentSize: { height: 20, width: 300 },
    zoomFactor: 1,
  }),
  { x: 0, y: 0, width: 300, height: 20 },
)

// ---------------------------------------------------------------------------
// THE REGRESSION: a host relayout while fullscreen records the new slot but
// does not move the view off the full window.
// ---------------------------------------------------------------------------

const RESIZED_SLOT = { x: 0, y: 96, width: 1920, height: 984 }
const afterHostRelayout = resolveQdnViewBounds({
  fullscreen: state,
  // What the host renderer sends once the window is OS-fullscreen: the app's
  // tab slot inside a bigger window, NOT the whole window.
  hostCssBounds: RESIZED_SLOT,
  windowContentSize: { height: 1080, width: 1920 },
  zoomFactor: 1,
})
assert.deepEqual(afterHostRelayout, withCue, 'a host relayout must not shrink a fullscreen view')

// Same with the zoom relayout path, which re-applies bounds after setting the
// zoom level.
assert.deepEqual(
  resolveQdnViewBounds({
    fullscreen: state,
    hostCssBounds: RESIZED_SLOT,
    windowContentSize: { height: 1080, width: 1920 },
    zoomFactor: 2,
  }),
  {
    x: 0,
    y: Math.round(QDN_VIEW_FULLSCREEN_CUE_HEIGHT * 2),
    width: 1920,
    height: 1080 - Math.round(QDN_VIEW_FULLSCREEN_CUE_HEIGHT * 2),
  },
)

// ---------------------------------------------------------------------------
// The cue timer elapsing hands the strip back, and nothing else changes.
// ---------------------------------------------------------------------------

assert.ok(QDN_VIEW_FULLSCREEN_CUE_DURATION_MS > 1000)
state = releaseQdnViewFullscreenCue(state)
assert.equal(state.active, true)
assert.equal(state.cueReserved, false)
assert.deepEqual(
  resolveQdnViewBounds({
    fullscreen: state,
    hostCssBounds: RESIZED_SLOT,
    windowContentSize: { height: 1080, width: 1920 },
    zoomFactor: 1,
  }),
  { x: 0, y: 0, width: 1920, height: 1080 },
)

// A late timer for a view that already left must not resurrect anything.
assert.deepEqual(
  releaseQdnViewFullscreenCue(IDLE_QDN_VIEW_FULLSCREEN_STATE),
  IDLE_QDN_VIEW_FULLSCREEN_STATE,
)

// ---------------------------------------------------------------------------
// Leaving restores the LAST slot the host asked for, not the one from before
// the fullscreen session.
// ---------------------------------------------------------------------------

state = leaveQdnViewFullscreen()
assert.deepEqual(state, IDLE_QDN_VIEW_FULLSCREEN_STATE)
assert.deepEqual(
  resolveQdnViewBounds({
    fullscreen: state,
    hostCssBounds: RESIZED_SLOT,
    windowContentSize: { height: 800, width: 1280 },
    zoomFactor: 1,
  }),
  RESIZED_SLOT,
)

// ---------------------------------------------------------------------------
// Teardown: destroying the view drops the OS fullscreen the app caused, but
// never the one the user had put the window in themselves.
// ---------------------------------------------------------------------------

const appCausedTeardown = resolveQdnViewFullscreenTeardown(enterQdnViewFullscreen(false))
assert.equal(appCausedTeardown.restoreWindow, true)
assert.deepEqual(appCausedTeardown.state, IDLE_QDN_VIEW_FULLSCREEN_STATE)

const userFullscreenTeardown = resolveQdnViewFullscreenTeardown(enterQdnViewFullscreen(true))
assert.equal(
  userFullscreenTeardown.restoreWindow,
  false,
  'the user\'s own window fullscreen is not ours to undo',
)
assert.deepEqual(userFullscreenTeardown.state, IDLE_QDN_VIEW_FULLSCREEN_STATE)

// Destroying a view that was never fullscreen touches nothing.
const idleTeardown = resolveQdnViewFullscreenTeardown(IDLE_QDN_VIEW_FULLSCREEN_STATE)
assert.equal(idleTeardown.restoreWindow, false)
assert.deepEqual(idleTeardown.state, IDLE_QDN_VIEW_FULLSCREEN_STATE)

// After teardown the view lays out from host bounds again - no stale flag can
// keep a rebuilt view pinned to the whole window.
assert.deepEqual(
  resolveQdnViewBounds({
    fullscreen: idleTeardown.state,
    hostCssBounds: SLOT,
    windowContentSize: WINDOW,
    zoomFactor: 1,
  }),
  SLOT,
)

console.log('qdn-view-fullscreen tests passed.')
