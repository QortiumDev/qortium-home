// Layout and permission decisions for a hosted QDN app view that has entered
// HTML fullscreen.
//
// This module is deliberately free of Electron objects so the rules can be
// unit tested in plain Node; qdn-views.ts is the thin adapter that owns the
// real WebContentsView, the window and the cue timer.
//
// Background, measured on Electron 39.8.10 (the version this repo pins) with a
// WebContentsView child of a BrowserWindow:
//
//   * `enter-html-full-screen` on the child view puts the OWNER WINDOW into OS
//     fullscreen. Electron does that unless the view was created with
//     `disableHtmlFullscreenWindowResize: true` - see the note in qdn-views.ts
//     for why we keep the resize.
//   * `window.getContentBounds()` read inside the `enter-html-full-screen`
//     handler still reports the PRE-fullscreen size; the real size only lands
//     with the window `resize` that follows. So the fullscreen bounds must be
//     recomputed on every relayout while the flag is set, never computed once
//     at enter time.
//   * The host renderer keeps pushing the app's tab-slot bounds the whole time
//     (window resize + ResizeObserver in src/v2/shell/AppTabStage.tsx). Those
//     have to be RECORDED (so leaving fullscreen restores the right slot) but
//     not APPLIED, or the app snaps back into its tab slot inside a fullscreen
//     window.

export type QdnViewRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// Height in host CSS pixels of the strip left uncovered at the top of the
// window right after an app goes fullscreen, so Home can draw its own
// "this app is fullscreen" cue there. A WebContentsView is a native view that
// paints OVER the host DOM, so a cue drawn in the shell is only visible while
// the view is not covering that area - hence the strip rather than a plain
// overlay.
export const QDN_VIEW_FULLSCREEN_CUE_HEIGHT = 36;

// How long the strip is reserved. Long enough to read, short enough not to
// spoil the fullscreen the user asked for.
export const QDN_VIEW_FULLSCREEN_CUE_DURATION_MS = 3200;

// Hosted Q-App code is untrusted, so the isolated session denies every
// permission except this one. `fullscreen` is safe to allow because it grants
// no data and no device: it only lets the page ask its own view to fill the
// window, which Home then decides how to lay out (below), and Chromium's own
// Escape handling always lets the user back out. Everything with a
// side-channel - camera, microphone, clipboard, geolocation, HID, serial,
// USB, notifications, pointer lock, window management - stays denied.
export function isQdnViewPermissionAllowed(permission: string): boolean {
  return permission === 'fullscreen';
}

export type QdnViewFullscreenState = {
  // The app's own content is in HTML fullscreen right now.
  readonly active: boolean;
  // The cue strip at the top of the window is still reserved.
  readonly cueReserved: boolean;
  // The window was ALREADY in OS fullscreen when the app went fullscreen (the
  // user had put it there). Teardown must not take that away from them.
  readonly windowWasFullScreen: boolean;
};

export const IDLE_QDN_VIEW_FULLSCREEN_STATE: QdnViewFullscreenState = Object.freeze({
  active: false,
  cueReserved: false,
  windowWasFullScreen: false,
});

export function enterQdnViewFullscreen(windowWasFullScreen: boolean): QdnViewFullscreenState {
  return { active: true, cueReserved: true, windowWasFullScreen };
}

export function leaveQdnViewFullscreen(): QdnViewFullscreenState {
  return IDLE_QDN_VIEW_FULLSCREEN_STATE;
}

// The cue timer elapsed: give the strip back to the app. A late timer for a
// view that already left fullscreen must not resurrect any state.
export function releaseQdnViewFullscreenCue(
  state: QdnViewFullscreenState,
): QdnViewFullscreenState {
  if (!state.active || !state.cueReserved) {
    return state;
  }

  return { ...state, cueReserved: false };
}

// Tearing the view down while it is fullscreen. There is no page left to send
// an Escape to, so the OS fullscreen the app caused has to be dropped
// directly - otherwise Home is left chromeless and full screen with nothing in
// it. `restoreWindow` is false when the user's own fullscreen is what the
// window is in.
export function resolveQdnViewFullscreenTeardown(state: QdnViewFullscreenState): {
  readonly restoreWindow: boolean;
  readonly state: QdnViewFullscreenState;
} {
  return {
    restoreWindow: state.active && !state.windowWasFullScreen,
    state: IDLE_QDN_VIEW_FULLSCREEN_STATE,
  };
}

export function scaleQdnViewBoundsForHostZoom(
  bounds: QdnViewRectangle,
  zoomFactor: number,
): QdnViewRectangle {
  return {
    x: Math.round(bounds.x * zoomFactor),
    y: Math.round(bounds.y * zoomFactor),
    width: Math.max(1, Math.round(bounds.width * zoomFactor)),
    height: Math.max(1, Math.round(bounds.height * zoomFactor)),
  };
}

export type QdnViewBoundsInput = {
  readonly fullscreen: QdnViewFullscreenState;
  // The last bounds the host renderer asked for, in host CSS pixels. This is
  // recorded even while fullscreen, which is what makes the restore correct.
  readonly hostCssBounds: QdnViewRectangle | null;
  readonly windowContentSize: { readonly width: number; readonly height: number };
  readonly zoomFactor: number;
};

// The single place that decides where an app view sits. `null` means "nothing
// to apply yet" - the host has not sent bounds and the app is not fullscreen.
export function resolveQdnViewBounds(input: QdnViewBoundsInput): QdnViewRectangle | null {
  if (input.fullscreen.active) {
    const width = Math.max(1, Math.round(input.windowContentSize.width));
    const height = Math.max(1, Math.round(input.windowContentSize.height));
    const requestedStrip = input.fullscreen.cueReserved
      ? Math.round(QDN_VIEW_FULLSCREEN_CUE_HEIGHT * input.zoomFactor)
      : 0;
    // A window too short to hold both the strip and a usable view gets the
    // view; the cue is a courtesy, not a reason to render nothing.
    const strip = height - requestedStrip >= 1 ? requestedStrip : 0;

    return { x: 0, y: strip, width, height: height - strip };
  }

  if (!input.hostCssBounds) {
    return null;
  }

  return scaleQdnViewBoundsForHostZoom(input.hostCssBounds, input.zoomFactor);
}
