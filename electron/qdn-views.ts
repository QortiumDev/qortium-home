import {
  BrowserWindow,
  WebContentsView,
  ipcMain,
  type IpcMainInvokeEvent,
  type Rectangle,
  type WebContents,
} from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_RENDER_SERVICES = new Set(['APP', 'WEBSITE']);
const TAB_ID_PATTERN = /^[a-z0-9._:-]{1,80}$/i;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type QdnViewEntry = {
  accountId: string | null;
  currentUrl: string | null;
  nodeOrigin: string;
  tabId: string;
  view: WebContentsView;
  window: BrowserWindow;
};

type SanitizedShowRequest = {
  accountId: string | null;
  bounds: Rectangle;
  nodeOrigin: string;
  renderUrl: string;
  tabId: string;
};

type SanitizedBoundsRequest = {
  bounds: Rectangle;
  tabId: string;
};

const qdnViewsByWindow = new Map<number, Map<string, QdnViewEntry>>();
const watchedWindowIds = new Set<number>();

export type QdnViewContext = {
  accountId: string | null;
  currentUrl: string | null;
  nodeOrigin: string;
  tabId: string;
  windowId: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getRequiredString(value: unknown, label: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
}

function sanitizeTabId(value: unknown) {
  const tabId = getRequiredString(value, 'Tab id');

  if (!TAB_ID_PATTERN.test(tabId)) {
    throw new Error('Tab id is invalid.');
  }

  return tabId;
}

function sanitizeOptionalAccountId(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error('Account id must be a string.');
  }

  const accountId = value.trim();

  if (!accountId) {
    return null;
  }

  if (accountId.length > 240) {
    throw new Error('Account id is too long.');
  }

  return accountId;
}

function getRequiredNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return value;
}

function sanitizeBounds(value: unknown): Rectangle {
  if (!isRecord(value)) {
    throw new Error('View bounds are required.');
  }

  return {
    x: Math.round(getRequiredNumber(value.x, 'View x')),
    y: Math.round(getRequiredNumber(value.y, 'View y')),
    width: Math.max(1, Math.round(getRequiredNumber(value.width, 'View width'))),
    height: Math.max(1, Math.round(getRequiredNumber(value.height, 'View height'))),
  };
}

function getHttpUrl(value: unknown, label: string) {
  const rawUrl = getRequiredString(value, label);
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label} is invalid.`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }

  return url;
}

function getNodeOrigin(value: unknown) {
  return getHttpUrl(value, 'Node API URL').origin;
}

function getRenderService(url: URL) {
  const [, , service] = url.pathname.split('/');

  try {
    return decodeURIComponent(service ?? '');
  } catch {
    return '';
  }
}

function isAllowedRenderUrlForOrigin(rawUrl: string, nodeOrigin: string) {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.origin !== nodeOrigin) {
    return false;
  }

  const pathSegments = url.pathname.split('/');

  return (
    pathSegments[1] === 'render' &&
    ALLOWED_RENDER_SERVICES.has(getRenderService(url)) &&
    typeof pathSegments[3] === 'string' &&
    pathSegments[3].length > 0
  );
}

function sanitizeRenderUrl(value: unknown, nodeOrigin: string) {
  const url = getHttpUrl(value, 'QDN render URL');

  if (!isAllowedRenderUrlForOrigin(url.toString(), nodeOrigin)) {
    throw new Error('QDN render URL is outside the allowed APP/WEBSITE render scope.');
  }

  return url.toString();
}

function sanitizeShowRequest(value: unknown): SanitizedShowRequest {
  if (!isRecord(value)) {
    throw new Error('QDN view request is required.');
  }

  const nodeOrigin = getNodeOrigin(value.nodeApiUrl);

  return {
    accountId: sanitizeOptionalAccountId(value.accountId),
    bounds: sanitizeBounds(value.bounds),
    nodeOrigin,
    renderUrl: sanitizeRenderUrl(value.renderUrl, nodeOrigin),
    tabId: sanitizeTabId(value.tabId),
  };
}

function sanitizeBoundsRequest(value: unknown): SanitizedBoundsRequest {
  if (!isRecord(value)) {
    throw new Error('QDN view bounds request is required.');
  }

  return {
    bounds: sanitizeBounds(value.bounds),
    tabId: sanitizeTabId(value.tabId),
  };
}

function sanitizeTabRequest(value: unknown) {
  if (!isRecord(value)) {
    throw new Error('QDN view tab request is required.');
  }

  return sanitizeTabId(value.tabId);
}

function getSenderWindow(event: IpcMainInvokeEvent) {
  const window = BrowserWindow.fromWebContents(event.sender);

  if (!window || window.isDestroyed()) {
    throw new Error('QDN view request does not belong to an active window.');
  }

  return window;
}

function getWindowViews(windowId: number) {
  let windowViews = qdnViewsByWindow.get(windowId);

  if (!windowViews) {
    windowViews = new Map();
    qdnViewsByWindow.set(windowId, windowViews);
  }

  return windowViews;
}

function watchWindow(window: BrowserWindow) {
  const windowId = window.webContents.id;

  if (watchedWindowIds.has(windowId)) {
    return;
  }

  watchedWindowIds.add(windowId);
  window.once('closed', () => {
    watchedWindowIds.delete(windowId);
    destroyWindowViews(windowId);
  });
}

function getPartition(window: BrowserWindow, tabId: string) {
  return `qortium-home-tab-${window.webContents.id}-${tabId}`;
}

export function getQdnViewContextForWebContents(webContents: WebContents): QdnViewContext | null {
  for (const [windowId, windowViews] of qdnViewsByWindow) {
    for (const entry of windowViews.values()) {
      if (entry.view.webContents.id === webContents.id) {
        return {
          accountId: entry.accountId,
          currentUrl: entry.currentUrl,
          nodeOrigin: entry.nodeOrigin,
          tabId: entry.tabId,
          windowId,
        };
      }
    }
  }

  return null;
}

function applyViewGuards(entry: QdnViewEntry) {
  entry.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  entry.view.webContents.on('will-navigate', (event, url) => {
    const navigationUrl = event.url || url;

    if (!isAllowedRenderUrlForOrigin(navigationUrl, entry.nodeOrigin)) {
      event.preventDefault();
    }
  });
  entry.view.webContents.on('will-frame-navigate', (event) => {
    if (!isAllowedRenderUrlForOrigin(event.url, entry.nodeOrigin)) {
      event.preventDefault();
    }
  });
  entry.view.webContents.on('will-redirect', (event, url) => {
    const redirectUrl = event.url || url;

    if (!isAllowedRenderUrlForOrigin(redirectUrl, entry.nodeOrigin)) {
      event.preventDefault();
    }
  });

  const isolatedSession = entry.view.webContents.session;

  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function createViewEntry(
  window: BrowserWindow,
  tabId: string,
  nodeOrigin: string,
  accountId: string | null,
): QdnViewEntry {
  const entry: QdnViewEntry = {
    accountId,
    currentUrl: null,
    nodeOrigin,
    tabId,
    view: new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: getPartition(window, tabId),
        preload: path.join(__dirname, 'qdn-app-preload.cjs'),
        sandbox: true,
      },
    }),
    window,
  };

  applyViewGuards(entry);

  return entry;
}

function destroyEntry(entry: QdnViewEntry) {
  if (!entry.window.isDestroyed()) {
    entry.window.contentView.removeChildView(entry.view);
  }

  if (!entry.view.webContents.isDestroyed()) {
    entry.view.webContents.close({ waitForBeforeUnload: false });
  }
}

function destroyWindowViews(windowId: number) {
  const windowViews = qdnViewsByWindow.get(windowId);

  if (!windowViews) {
    return;
  }

  for (const entry of windowViews.values()) {
    destroyEntry(entry);
  }

  qdnViewsByWindow.delete(windowId);
}

function destroyTabView(windowId: number, tabId: string) {
  const windowViews = qdnViewsByWindow.get(windowId);
  const entry = windowViews?.get(tabId);

  if (!entry) {
    return;
  }

  destroyEntry(entry);
  windowViews?.delete(tabId);

  if (windowViews?.size === 0) {
    qdnViewsByWindow.delete(windowId);
  }
}

function getOrCreateEntry(window: BrowserWindow, request: SanitizedShowRequest) {
  const windowId = window.webContents.id;
  const windowViews = getWindowViews(windowId);
  const existingEntry = windowViews.get(request.tabId);

  if (existingEntry && existingEntry.nodeOrigin === request.nodeOrigin) {
    existingEntry.accountId = request.accountId;
    return existingEntry;
  }

  if (existingEntry) {
    destroyEntry(existingEntry);
  }

  const entry = createViewEntry(window, request.tabId, request.nodeOrigin, request.accountId);

  windowViews.set(request.tabId, entry);
  watchWindow(window);

  return entry;
}

export function registerQdnViewIpcHandlers() {
  ipcMain.handle('qdn-views:show', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const request = sanitizeShowRequest(rawRequest);
    const entry = getOrCreateEntry(window, request);

    entry.view.setBounds(request.bounds);
    window.contentView.addChildView(entry.view);
    entry.view.setVisible(true);

    if (entry.currentUrl !== request.renderUrl) {
      entry.currentUrl = request.renderUrl;
      void entry.view.webContents.loadURL(request.renderUrl).catch((error) => {
        console.warn('Unable to load isolated QDN view.', error);
      });
    }
  });

  ipcMain.handle('qdn-views:setBounds', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const request = sanitizeBoundsRequest(rawRequest);
    const entry = qdnViewsByWindow.get(window.webContents.id)?.get(request.tabId);

    entry?.view.setBounds(request.bounds);
  });

  ipcMain.handle('qdn-views:hide', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const tabId = sanitizeTabRequest(rawRequest);
    const entry = qdnViewsByWindow.get(window.webContents.id)?.get(tabId);

    entry?.view.setVisible(false);
  });

  ipcMain.handle('qdn-views:destroy', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const tabId = sanitizeTabRequest(rawRequest);

    destroyTabView(window.webContents.id, tabId);
  });
}
