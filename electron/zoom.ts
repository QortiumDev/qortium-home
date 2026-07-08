import { BrowserWindow, type WebContents } from 'electron';

export const ZOOM_LEVEL_STEP = 0.5;
export const MIN_ZOOM_LEVEL = -3;
export const MAX_ZOOM_LEVEL = 3;

const ZOOM_LEVEL_BASE = 1.2;
const MIN_ZOOM_PERCENT = 50;
const MAX_ZOOM_PERCENT = 200;

type ZoomSync = (window: BrowserWindow) => void;

let syncQdnViewsForWindowZoom: ZoomSync | undefined;

export function initZoom({ sync }: { sync: ZoomSync }) {
  syncQdnViewsForWindowZoom = sync;
}

function clampZoomLevel(level: number) {
  return Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, level));
}

function sanitizeZoomPercent(percent: number) {
  if (!Number.isFinite(percent)) {
    throw new Error('Zoom percent must be a finite number.');
  }

  return Math.max(MIN_ZOOM_PERCENT, Math.min(MAX_ZOOM_PERCENT, Math.round(percent)));
}

export function zoomLevelToPercent(level: number) {
  return Math.round(100 * Math.pow(ZOOM_LEVEL_BASE, clampZoomLevel(level)));
}

export function zoomPercentToLevel(percent: number) {
  return Math.log(sanitizeZoomPercent(percent) / 100) / Math.log(ZOOM_LEVEL_BASE);
}

function getWindowForWebContents(webContents: WebContents) {
  const window = BrowserWindow.fromWebContents(webContents);

  if (!window || window.isDestroyed()) {
    return null;
  }

  return window;
}

// Applies zoom in whole-percent space: the displayed percent is the source of
// truth and the stored zoom level is always derived from it, so keyboard, menu,
// wheel, and renderer-set paths all land on the same percent ladder. Comparing
// percents (not float levels) makes re-applying the current percent a complete
// no-op, which is what keeps the renderer's own zoom:set echoes from cascading.
// `notify` controls the zoom:changed broadcast: main-originated changes
// (keyboard/menu/app-view wheel) notify the renderer; renderer-originated
// zoom:set calls must NOT be echoed back or the two sides can feed each other.
function applyZoomPercent(webContents: WebContents, percent: number, notify: boolean) {
  const window = getWindowForWebContents(webContents);
  const nextLevel = clampZoomLevel(zoomPercentToLevel(percent));
  const nextPercent = zoomLevelToPercent(nextLevel);

  if (!window || webContents.isDestroyed()) {
    return nextPercent;
  }

  if (zoomLevelToPercent(webContents.getZoomLevel()) === nextPercent) {
    return nextPercent;
  }

  webContents.setZoomLevel(nextLevel);
  syncQdnViewsForWindowZoom?.(window);

  if (notify) {
    window.webContents.send('zoom:changed', nextPercent);
  }

  return nextPercent;
}

export function getZoomPercent(webContents: WebContents) {
  return zoomLevelToPercent(webContents.getZoomLevel());
}

export function setZoomPercent(webContents: WebContents, percent: number, notify = true) {
  return applyZoomPercent(webContents, percent, notify);
}

function stepZoom(webContents: WebContents, direction: 1 | -1) {
  const level = zoomPercentToLevel(getZoomPercent(webContents)) + direction * ZOOM_LEVEL_STEP;

  return applyZoomPercent(webContents, zoomLevelToPercent(level), true);
}

export function zoomIn(webContents: WebContents) {
  return stepZoom(webContents, 1);
}

export function zoomOut(webContents: WebContents) {
  return stepZoom(webContents, -1);
}

export function resetZoom(webContents: WebContents) {
  return applyZoomPercent(webContents, 100, true);
}
