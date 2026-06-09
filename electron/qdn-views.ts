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
import { isManagedQdnArchiveRenderUrl } from './qdn-archive-render.js';

const ALLOWED_RENDER_SERVICES = new Set(['APP', 'WEBSITE']);
const TAB_ID_PATTERN = /^[a-z0-9._:-]{1,80}$/i;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THEME_VALUES = new Set(['dark', 'light']);
const LANGUAGE_VALUES = new Set(['ar', 'de', 'en', 'es', 'et', 'fi', 'fr', 'he', 'hu', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'zh-CN', 'zh-TW']);
const TEXT_SIZE_VALUES = new Set(['extra-large', 'extra-small', 'huge', 'large', 'medium', 'small']);

export type QdnDisplaySettings = {
  language: 'ar' | 'de' | 'en' | 'es' | 'et' | 'fi' | 'fr' | 'he' | 'hu' | 'it' | 'ja' | 'ko' | 'nl' | 'pl' | 'pt' | 'ro' | 'ru' | 'sv' | 'zh-CN' | 'zh-TW';
  textSize: 'extra-large' | 'extra-small' | 'huge' | 'large' | 'medium' | 'small';
  theme: 'dark' | 'light';
};

const DEFAULT_QDN_DISPLAY_SETTINGS: QdnDisplaySettings = {
  language: 'en',
  textSize: 'medium',
  theme: 'light',
};

type QdnViewEntry = {
  accountId: string | null;
  currentUrl: string | null;
  displaySettings: QdnDisplaySettings;
  nodeOrigin: string;
  resourceUrl: string | null;
  tabId: string;
  view: WebContentsView;
  window: BrowserWindow;
};

type SanitizedShowRequest = {
  accountId: string | null;
  bounds: Rectangle;
  displaySettings: QdnDisplaySettings;
  nodeOrigin: string;
  renderUrl: string;
  resourceUrl: string | null;
  tabId: string;
};

type SanitizedBoundsRequest = {
  bounds: Rectangle;
  tabId: string;
};

type SanitizedDisplaySettingsRequest = {
  displaySettings: QdnDisplaySettings;
  tabId: string;
};

type SanitizedAccountStateRequest = {
  accountId: string | null;
  tabId: string;
};

const qdnViewsByWindow = new Map<number, Map<string, QdnViewEntry>>();
const watchedWindowIds = new Set<number>();

export type QdnViewContext = {
  accountId: string | null;
  currentUrl: string | null;
  displaySettings: QdnDisplaySettings;
  nodeOrigin: string;
  resourceUrl: string | null;
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

function sanitizeOptionalResourceUrl(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error('Resource URL must be a string.');
  }

  const resourceUrl = value.trim();

  if (!resourceUrl) {
    return null;
  }

  if (resourceUrl.length > 2_000) {
    throw new Error('Resource URL is too long.');
  }

  return resourceUrl;
}

function sanitizeDisplaySettings(value: unknown): QdnDisplaySettings {
  if (!isRecord(value)) {
    return DEFAULT_QDN_DISPLAY_SETTINGS;
  }

  const theme = typeof value.theme === 'string' && THEME_VALUES.has(value.theme)
    ? value.theme as QdnDisplaySettings['theme']
    : DEFAULT_QDN_DISPLAY_SETTINGS.theme;
  const language = typeof value.language === 'string' && LANGUAGE_VALUES.has(value.language)
    ? value.language as QdnDisplaySettings['language']
    : DEFAULT_QDN_DISPLAY_SETTINGS.language;
  const textSize = typeof value.textSize === 'string' && TEXT_SIZE_VALUES.has(value.textSize)
    ? value.textSize as QdnDisplaySettings['textSize']
    : DEFAULT_QDN_DISPLAY_SETTINGS.textSize;

  return {
    language,
    textSize,
    theme,
  };
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
  if (isManagedQdnArchiveRenderUrl(rawUrl)) {
    return true;
  }

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
  if (typeof value === 'string' && isManagedQdnArchiveRenderUrl(value)) {
    return new URL(value).toString();
  }

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
    displaySettings: sanitizeDisplaySettings(value.displaySettings),
    nodeOrigin,
    renderUrl: sanitizeRenderUrl(value.renderUrl, nodeOrigin),
    resourceUrl: sanitizeOptionalResourceUrl(value.resourceUrl),
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

function sanitizeDisplaySettingsRequest(value: unknown): SanitizedDisplaySettingsRequest {
  if (!isRecord(value)) {
    throw new Error('QDN view display settings request is required.');
  }

  return {
    displaySettings: sanitizeDisplaySettings(value.displaySettings),
    tabId: sanitizeTabId(value.tabId),
  };
}

function sanitizeAccountStateRequest(value: unknown): SanitizedAccountStateRequest {
  if (!isRecord(value)) {
    throw new Error('QDN view account state request is required.');
  }

  return {
    accountId: sanitizeOptionalAccountId(value.accountId),
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
          displaySettings: entry.displaySettings,
          nodeOrigin: entry.nodeOrigin,
          resourceUrl: entry.resourceUrl,
          tabId: entry.tabId,
          windowId,
        };
      }
    }
  }

  return null;
}

function applyViewGuards(entry: QdnViewEntry) {
  const updateCurrentUrl = (url: string) => {
    if (isAllowedRenderUrlForOrigin(url, entry.nodeOrigin)) {
      entry.currentUrl = url;
    }
  };

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
  entry.view.webContents.on('did-navigate', (_event, url) => {
    updateCurrentUrl(url);
  });
  entry.view.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) {
      updateCurrentUrl(url);
    }
  });

  const isolatedSession = entry.view.webContents.session;

  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function getQdnDisplaySettingMessages(displaySettings: QdnDisplaySettings) {
  return [
    {
      action: 'THEME_CHANGED',
      requestedHandler: 'UI',
      theme: displaySettings.theme,
    },
    {
      action: 'LANGUAGE_CHANGED',
      language: displaySettings.language,
      requestedHandler: 'UI',
    },
    {
      action: 'TEXT_SIZE_CHANGED',
      requestedHandler: 'UI',
      textSize: displaySettings.textSize,
    },
  ];
}

function getQdnSelectedAccountChangedMessage() {
  return {
    action: 'SELECTED_ACCOUNT_CHANGED',
    requestedHandler: 'ACCOUNT',
    type: 'qortium:selected-account-changed',
  };
}

async function sendQdnMessages(entry: QdnViewEntry, messages: unknown[]) {
  if (entry.view.webContents.isDestroyed()) {
    return;
  }

  const serializedMessages = JSON.stringify(messages);

  await entry.view.webContents.executeJavaScript(
    `for (const message of ${serializedMessages}) window.dispatchEvent(new MessageEvent('message', { data: message, origin: window.location.origin, source: window }));`,
    true,
  );
}

async function sendDisplaySettingsMessages(entry: QdnViewEntry) {
  await sendQdnMessages(entry, getQdnDisplaySettingMessages(entry.displaySettings));
}

async function sendSelectedAccountChangedMessage(entry: QdnViewEntry) {
  await sendQdnMessages(entry, [getQdnSelectedAccountChangedMessage()]);
}

async function sendQdnViewStateMessages(entry: QdnViewEntry) {
  await sendQdnMessages(entry, [
    ...getQdnDisplaySettingMessages(entry.displaySettings),
    getQdnSelectedAccountChangedMessage(),
  ]);
}

function createViewEntry(
  window: BrowserWindow,
  tabId: string,
  nodeOrigin: string,
  accountId: string | null,
  resourceUrl: string | null,
  displaySettings: QdnDisplaySettings,
): QdnViewEntry {
  const entry: QdnViewEntry = {
    accountId,
    currentUrl: null,
    displaySettings,
    nodeOrigin,
    resourceUrl,
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
    existingEntry.displaySettings = request.displaySettings;
    existingEntry.resourceUrl = request.resourceUrl;
    return existingEntry;
  }

  if (existingEntry) {
    destroyEntry(existingEntry);
  }

  const entry = createViewEntry(
    window,
    request.tabId,
    request.nodeOrigin,
    request.accountId,
    request.resourceUrl,
    request.displaySettings,
  );

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
      void entry.view.webContents
        .loadURL(request.renderUrl)
        .then(() => sendQdnViewStateMessages(entry))
        .catch((error) => {
          console.warn('Unable to load isolated QDN view.', error);
        });
    } else {
      void sendQdnViewStateMessages(entry).catch((error) => {
        console.warn('Unable to update isolated QDN view state.', error);
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

  ipcMain.handle('qdn-views:updateDisplaySettings', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const request = sanitizeDisplaySettingsRequest(rawRequest);
    const entry = qdnViewsByWindow.get(window.webContents.id)?.get(request.tabId);

    if (!entry) {
      return;
    }

    entry.displaySettings = request.displaySettings;
    void sendDisplaySettingsMessages(entry).catch((error) => {
      console.warn('Unable to update isolated QDN view display settings.', error);
    });
  });

  ipcMain.handle('qdn-views:updateAccountState', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const request = sanitizeAccountStateRequest(rawRequest);
    const entry = qdnViewsByWindow.get(window.webContents.id)?.get(request.tabId);

    if (!entry) {
      return;
    }

    entry.accountId = request.accountId;
    void sendSelectedAccountChangedMessage(entry).catch((error) => {
      console.warn('Unable to update isolated QDN view account state.', error);
    });
  });

  ipcMain.handle('qdn-views:destroy', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const tabId = sanitizeTabRequest(rawRequest);

    destroyTabView(window.webContents.id, tabId);
  });
}
