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

function applyZoomLevel(webContents: WebContents, level: number) {
  const window = getWindowForWebContents(webContents);
  const nextLevel = clampZoomLevel(level);
  const nextPercent = zoomLevelToPercent(nextLevel);

  if (!window || webContents.isDestroyed()) {
    return nextPercent;
  }

  if (webContents.getZoomLevel() === nextLevel) {
    return nextPercent;
  }

  webContents.setZoomLevel(nextLevel);
  syncQdnViewsForWindowZoom?.(window);
  window.webContents.send('zoom:changed', nextPercent);

  return nextPercent;
}

export function getZoomPercent(webContents: WebContents) {
  return zoomLevelToPercent(webContents.getZoomLevel());
}

export function setZoomPercent(webContents: WebContents, percent: number) {
  return applyZoomLevel(webContents, zoomPercentToLevel(percent));
}

export function zoomIn(webContents: WebContents) {
  return applyZoomLevel(webContents, webContents.getZoomLevel() + ZOOM_LEVEL_STEP);
}

export function zoomOut(webContents: WebContents) {
  return applyZoomLevel(webContents, webContents.getZoomLevel() - ZOOM_LEVEL_STEP);
}

export function resetZoom(webContents: WebContents) {
  return applyZoomLevel(webContents, 0);
}
