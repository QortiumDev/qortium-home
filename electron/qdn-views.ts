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
import { resetZoom, zoomIn, zoomOut } from './zoom.js';

const ALLOWED_RENDER_SERVICES = new Set(['APP', 'WEBSITE']);
const TAB_ID_PATTERN = /^[a-z0-9._:-]{1,80}$/i;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THEME_VALUES = new Set(['dark', 'light']);
const LANGUAGE_VALUES = new Set(['ar', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'he', 'hi', 'hu', 'it', 'ja', 'ko', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'zh-CN', 'zh-TW']);
const TEXT_SIZE_VALUES = new Set(['extra-large', 'extra-small', 'huge', 'large', 'medium', 'small']);
const ACCENT_VALUES = new Set(['blue', 'cyan', 'green', 'orange', 'pink', 'purple', 'red', 'teal', 'yellow']);
const UI_VALUES = new Set(['classic', 'modern']);
// Exact Qortal node origins the cross-chain bridge can return for direct resource URLs. QDN apps
// render from the node's own origin, so the rendered Content-Security-Policy must allow connecting
// to these for read-only cross-chain reads (e.g. an emulator streaming a ROM from Qortal). Android
// strips the CSP entirely; on desktop we relax it narrowly to just these origins.
const QORTAL_RENDER_ALLOWED_ORIGINS = [
  'http://127.0.0.1:12391',
  'https://ext-node.qortal.link',
  'https://api.qortal.org',
];
const QORTAL_RELAXED_CSP_DIRECTIVES = ['connect-src', 'img-src', 'media-src'];

// Relaxes a rendered QDN app's CSP so it can reach the Qortal node origin(s) for cross-chain reads,
// leaving the rest of the policy intact. Adds the allowed origins to connect-src/img-src/media-src,
// creating those directives from default-src when absent (otherwise they inherit default-src 'self').
function relaxQdnAppCspForQortal(csp: string): string {
  if (!QORTAL_RENDER_ALLOWED_ORIGINS.length || !csp.trim()) {
    return csp;
  }

  const directives = csp.split(';').map((directive) => directive.trim()).filter(Boolean);
  const present = new Set(directives.map((directive) => directive.split(/\s+/)[0].toLowerCase()));
  const defaultSrc = directives.find((directive) => directive.split(/\s+/)[0].toLowerCase() === 'default-src');
  const defaultValues = defaultSrc ? defaultSrc.split(/\s+/).slice(1) : ["'self'"];

  const updated = directives.map((directive) => {
    const parts = directive.split(/\s+/);
    if (QORTAL_RELAXED_CSP_DIRECTIVES.includes(parts[0].toLowerCase())) {
      const values = new Set(parts.slice(1));
      QORTAL_RENDER_ALLOWED_ORIGINS.forEach((origin) => values.add(origin));
      return `${parts[0]} ${[...values].join(' ')}`;
    }
    return directive;
  });

  for (const directiveName of QORTAL_RELAXED_CSP_DIRECTIVES) {
    if (!present.has(directiveName)) {
      const values = new Set(defaultValues);
      QORTAL_RENDER_ALLOWED_ORIGINS.forEach((origin) => values.add(origin));
      updated.push(`${directiveName} ${[...values].join(' ')}`);
    }
  }

  return updated.join('; ');
}

export type QdnDisplaySettings = {
  language: 'ar' | 'de' | 'el' | 'en' | 'es' | 'et' | 'fi' | 'fr' | 'he' | 'hi' | 'hu' | 'it' | 'ja' | 'ko' | 'nb' | 'nl' | 'pl' | 'pt' | 'ro' | 'ru' | 'sv' | 'zh-CN' | 'zh-TW';
  textSize: 'extra-large' | 'extra-small' | 'huge' | 'large' | 'medium' | 'small';
  accent: 'blue' | 'cyan' | 'green' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'yellow';
  theme: 'dark' | 'light';
  ui: 'classic' | 'modern';
};

const DEFAULT_QDN_DISPLAY_SETTINGS: QdnDisplaySettings = {
  language: 'en',
  textSize: 'medium',
  accent: 'green',
  theme: 'light',
  ui: 'classic',
};

type QdnViewEntry = {
  accountId: string | null;
  accountUnlocked: boolean;
  currentUrl: string | null;
  // The renderUrl React last asked us to load. Unlike `currentUrl`, this is not
  // mutated by in-app navigation, so it tells us whether a `qdn-views:show`
  // carries a genuinely new destination (reload) or is a pure suspend→show of
  // the same page (no reload, preserving the live in-app location).
  requestedUrl: string | null;
  // What the loaded page last received; `undefined` means nothing delivered
  // yet, so state messages are only sent when these fall out of sync.
  deliveredAccountStateKey: string | undefined;
  deliveredDisplaySettings: QdnDisplaySettings | undefined;
  displaySettings: QdnDisplaySettings;
  hostCssBounds: Rectangle | null;
  nodeOrigin: string;
  pendingStateDelivery: Promise<void>;
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
  isUnlocked: boolean;
  tabId: string;
};

type SanitizedWheelCommand = {
  direction: 'in' | 'out';
  textSize: boolean;
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
  const accent = typeof value.accent === 'string' && ACCENT_VALUES.has(value.accent)
    ? value.accent as QdnDisplaySettings['accent']
    : DEFAULT_QDN_DISPLAY_SETTINGS.accent;
  const ui = typeof value.ui === 'string' && UI_VALUES.has(value.ui)
    ? value.ui as QdnDisplaySettings['ui']
    : DEFAULT_QDN_DISPLAY_SETTINGS.ui;

  return {
    language,
    textSize,
    accent,
    theme,
    ui,
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

  if (pathSegments[1] !== 'render' || typeof pathSegments[3] !== 'string' || pathSegments[3].length === 0) {
    return false;
  }

  // Hash render URLs come from local publish previews, which the Core node
  // only serves for pre-authorized hashes with a matching secret.
  if (pathSegments[2] === 'hash') {
    return true;
  }

  return ALLOWED_RENDER_SERVICES.has(getRenderService(url));
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
    isUnlocked: value.isUnlocked === true,
    tabId: sanitizeTabId(value.tabId),
  };
}

function sanitizeTabRequest(value: unknown) {
  if (!isRecord(value)) {
    throw new Error('QDN view tab request is required.');
  }

  return sanitizeTabId(value.tabId);
}

function sanitizeWheelCommand(value: unknown): SanitizedWheelCommand | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.direction !== 'in' && value.direction !== 'out') {
    return null;
  }

  return {
    direction: value.direction,
    textSize: value.textSize === true,
  };
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

function getPartition(nodeOrigin: string, resourceUrl: string | null): string {
  const safeOrigin = nodeOrigin.replace(/[^a-z0-9:.-]/gi, '_').slice(0, 40);
  if (resourceUrl) {
    // resourceUrl is a stable QDN URL (e.g. "qdn://APP/walletium/default")
    // that identifies the app regardless of which tab or window opened it.
    const safeResource = resourceUrl.replace(/[^a-z0-9:/._-]/gi, '_').slice(0, 60);
    return `persist:qortium-home-${safeOrigin}-${safeResource}`;
  }
  return `persist:qortium-home-${safeOrigin}`;
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

function getQdnViewEntryForWebContents(webContents: WebContents): QdnViewEntry | null {
  for (const windowViews of qdnViewsByWindow.values()) {
    for (const entry of windowViews.values()) {
      if (entry.view.webContents.id === webContents.id) {
        return entry;
      }
    }
  }

  return null;
}

function sendTextSizeCommand(entry: QdnViewEntry, command: 'text-size-decrease' | 'text-size-increase' | 'text-size-reset') {
  if (!entry.window.isDestroyed()) {
    entry.window.webContents.send('menu:command', command);
  }
}

function applyViewGuards(entry: QdnViewEntry) {
  const updateCurrentUrl = (url: string) => {
    if (isAllowedRenderUrlForOrigin(url, entry.nodeOrigin)) {
      entry.currentUrl = url;
    }
  };

  entry.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  entry.view.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || entry.window.isDestroyed()) {
      return;
    }

    const primaryModifier = process.platform === 'darwin' ? input.meta : input.control;

    if (!primaryModifier || input.alt) {
      return;
    }

    const key = input.key;

    if (input.shift) {
      if (key === '+' || key === '=') {
        sendTextSizeCommand(entry, 'text-size-increase');
        event.preventDefault();
        return;
      }

      if (key === '-' || key === '_') {
        sendTextSizeCommand(entry, 'text-size-decrease');
        event.preventDefault();
        return;
      }

      if (key === '0' || key === ')') {
        sendTextSizeCommand(entry, 'text-size-reset');
        event.preventDefault();
      }

      return;
    }

    if (key === '=' || key === '+' || input.code === 'NumpadAdd') {
      zoomIn(entry.window.webContents);
      event.preventDefault();
      return;
    }

    if (key === '-' || input.code === 'NumpadSubtract') {
      zoomOut(entry.window.webContents);
      event.preventDefault();
      return;
    }

    if (key === '0' || input.code === 'Numpad0') {
      resetZoom(entry.window.webContents);
      event.preventDefault();
    }
  });
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

  // Relax the rendered app's Content-Security-Policy so it can read cross-chain (Qortal) resources.
  // Narrow by design: only the configured Qortal node origins are added to connect-src/img-src/
  // media-src; the rest of the node-supplied policy is preserved. Responses from the Qortal node
  // itself carry no CSP, so they are left untouched.
  isolatedSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders;
    if (!responseHeaders) {
      callback({});
      return;
    }

    for (const headerName of Object.keys(responseHeaders)) {
      if (headerName.toLowerCase() === 'content-security-policy') {
        const values = responseHeaders[headerName];
        responseHeaders[headerName] = (Array.isArray(values) ? values : [values]).map((value) =>
          relaxQdnAppCspForQortal(value),
        );
      }
    }

    callback({ responseHeaders });
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
    {
      action: 'ACCENT_CHANGED',
      requestedHandler: 'UI',
      accent: displaySettings.accent,
    },
    {
      action: 'UI_STYLE_CHANGED',
      requestedHandler: 'UI',
      uiStyle: displaySettings.ui,
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

function areDisplaySettingsEqual(
  first: QdnDisplaySettings | undefined,
  second: QdnDisplaySettings,
) {
  return (
    !!first &&
    first.accent === second.accent &&
    first.language === second.language &&
    first.textSize === second.textSize &&
    first.theme === second.theme &&
    first.ui === second.ui
  );
}

// Unlocking the selected account must notify the page too, so the delivery
// key covers both the account id and its lock state.
function getAccountStateKey(entry: QdnViewEntry) {
  return `${entry.accountUnlocked ? 'unlocked' : 'locked'}:${entry.accountId ?? ''}`;
}

async function sendPendingQdnViewStateMessages(entry: QdnViewEntry) {
  const sendDisplaySettings = !areDisplaySettingsEqual(
    entry.deliveredDisplaySettings,
    entry.displaySettings,
  );
  const sendAccountChanged = entry.deliveredAccountStateKey !== getAccountStateKey(entry);
  const messages = [
    ...(sendDisplaySettings ? getQdnDisplaySettingMessages(entry.displaySettings) : []),
    ...(sendAccountChanged ? [getQdnSelectedAccountChangedMessage()] : []),
  ];

  if (!messages.length) {
    return;
  }

  await sendQdnMessages(entry, messages);

  if (sendDisplaySettings) {
    entry.deliveredDisplaySettings = entry.displaySettings;
  }

  if (sendAccountChanged) {
    entry.deliveredAccountStateKey = getAccountStateKey(entry);
  }
}

// Deliveries are serialized per view so concurrent show/update calls cannot
// both see the same pending state and send duplicate messages into the page.
function queueQdnViewStateDelivery(entry: QdnViewEntry) {
  entry.pendingStateDelivery = entry.pendingStateDelivery
    .then(() => sendPendingQdnViewStateMessages(entry))
    .catch((error) => {
      console.warn('Unable to update isolated QDN view state.', error);
    });
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
    accountUnlocked: false,
    currentUrl: null,
    requestedUrl: null,
    deliveredAccountStateKey: undefined,
    deliveredDisplaySettings: undefined,
    displaySettings,
    hostCssBounds: null,
    nodeOrigin,
    pendingStateDelivery: Promise.resolve(),
    resourceUrl,
    tabId,
    view: new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: getPartition(nodeOrigin, resourceUrl),
        preload: path.join(__dirname, 'qdn-app-preload.cjs'),
        sandbox: true,
      },
    }),
    window,
  };

  applyViewGuards(entry);

  return entry;
}

function getHostZoomFactor(window: BrowserWindow) {
  try {
    return window.webContents.getZoomFactor();
  } catch {
    return 1;
  }
}

function getHostZoomLevel(window: BrowserWindow) {
  try {
    return window.webContents.getZoomLevel();
  } catch {
    return 0;
  }
}

function scaleBoundsForHostZoom(bounds: Rectangle, zoomFactor: number): Rectangle {
  return {
    x: Math.round(bounds.x * zoomFactor),
    y: Math.round(bounds.y * zoomFactor),
    width: Math.max(1, Math.round(bounds.width * zoomFactor)),
    height: Math.max(1, Math.round(bounds.height * zoomFactor)),
  };
}

function applyHostViewBounds(entry: QdnViewEntry, bounds: Rectangle) {
  entry.hostCssBounds = bounds;
  entry.view.setBounds(scaleBoundsForHostZoom(bounds, getHostZoomFactor(entry.window)));
}

function applyHostZoomToEntry(entry: QdnViewEntry) {
  if (entry.window.isDestroyed() || entry.view.webContents.isDestroyed()) {
    return;
  }

  const zoomLevel = getHostZoomLevel(entry.window);

  if (entry.view.webContents.getZoomLevel() !== zoomLevel) {
    entry.view.webContents.setZoomLevel(zoomLevel);
  }

  if (entry.hostCssBounds) {
    entry.view.setBounds(scaleBoundsForHostZoom(entry.hostCssBounds, getHostZoomFactor(entry.window)));
  }
}

export function syncQdnViewsForWindowZoom(window: BrowserWindow) {
  const entries = qdnViewsByWindow.get(window.webContents.id);

  if (!entries) {
    return;
  }

  for (const entry of entries.values()) {
    applyHostZoomToEntry(entry);
  }
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
    // accountId is pinned at creation: a QDN app tab stays bound to its launch
    // account for its lifetime, so a re-show must never rebind it.
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
  ipcMain.on('qdn-views:wheel-command', (event, rawRequest: unknown) => {
    const request = sanitizeWheelCommand(rawRequest);
    const entry = getQdnViewEntryForWebContents(event.sender);

    if (!request || !entry || entry.window.isDestroyed()) {
      return;
    }

    if (request.textSize) {
      sendTextSizeCommand(
        entry,
        request.direction === 'in' ? 'text-size-increase' : 'text-size-decrease',
      );
      return;
    }

    if (request.direction === 'in') {
      zoomIn(entry.window.webContents);
    } else {
      zoomOut(entry.window.webContents);
    }
  });

  ipcMain.handle('qdn-views:show', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const request = sanitizeShowRequest(rawRequest);
    const entry = getOrCreateEntry(window, request);

    applyHostZoomToEntry(entry);
    applyHostViewBounds(entry, request.bounds);
    window.contentView.addChildView(entry.view);
    entry.view.setVisible(true);

    // Reload only when React actually asked for a different page. A pure
    // suspend→show with the same requested URL must NOT reload, otherwise an
    // inactive tab loses its in-app navigation when you switch away and back:
    // `entry.currentUrl` has drifted to the live in-app location, so comparing
    // against it would force a reload to the original render URL.
    if (entry.requestedUrl !== request.renderUrl) {
      entry.requestedUrl = request.renderUrl;
      entry.currentUrl = request.renderUrl;
      void entry.view.webContents
        .loadURL(request.renderUrl)
        .then(() => {
          // The freshly loaded page has received nothing yet.
          entry.deliveredAccountStateKey = undefined;
          entry.deliveredDisplaySettings = undefined;
          queueQdnViewStateDelivery(entry);
        })
        .catch((error) => {
          console.warn('Unable to load isolated QDN view.', error);
        });
    } else {
      queueQdnViewStateDelivery(entry);
    }
  });

  ipcMain.handle('qdn-views:setBounds', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const request = sanitizeBoundsRequest(rawRequest);
    const entry = qdnViewsByWindow.get(window.webContents.id)?.get(request.tabId);

    if (entry) {
      applyHostViewBounds(entry, request.bounds);
    }
  });

  ipcMain.handle('qdn-views:capture', async (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const tabId = sanitizeTabRequest(rawRequest);
    const entry = qdnViewsByWindow.get(window.webContents.id)?.get(tabId);

    // Capturing a hidden view yields an empty image, so only capture live views.
    if (!entry || !entry.view.getVisible() || entry.view.webContents.isDestroyed()) {
      return null;
    }

    try {
      const snapshot = await entry.view.webContents.capturePage();

      if (snapshot.isEmpty()) {
        return null;
      }

      // JPEG instead of PNG: encoding, transferring, and decoding a full-view
      // PNG data URL takes long enough to make overlay opening feel laggy.
      return `data:image/jpeg;base64,${snapshot.toJPEG(90).toString('base64')}`;
    } catch (error) {
      console.warn('Unable to capture isolated QDN view snapshot.', error);
      return null;
    }
  });

  ipcMain.handle('qdn-views:hide', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const tabId = sanitizeTabRequest(rawRequest);
    const entry = qdnViewsByWindow.get(window.webContents.id)?.get(tabId);

    entry?.view.setVisible(false);

    // The isolated view is an out-of-process WebContentsView that holds OS keyboard
    // focus while it is on screen. Hiding it (e.g. when a permission dialog opens)
    // does not move focus back to the host, so keystrokes would keep going to the
    // now-hidden app view — leaving a permission/unlock dialog unable to autofocus
    // its field or receive Enter/Escape. Return focus to the host web contents.
    if (!window.isDestroyed()) {
      window.webContents.focus();
    }
  });

  ipcMain.handle('qdn-views:updateDisplaySettings', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const request = sanitizeDisplaySettingsRequest(rawRequest);
    const entry = qdnViewsByWindow.get(window.webContents.id)?.get(request.tabId);

    if (!entry) {
      return;
    }

    entry.displaySettings = request.displaySettings;
    queueQdnViewStateDelivery(entry);
  });

  ipcMain.handle('qdn-views:updateAccountState', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const request = sanitizeAccountStateRequest(rawRequest);
    const entry = qdnViewsByWindow.get(window.webContents.id)?.get(request.tabId);

    if (!entry) {
      return;
    }

    // The bound account is pinned at view creation and never changes for the
    // tab's lifetime. Only track unlock transitions of that same account; ignore
    // any spurious account swap so a global account change can't leak into an
    // already-open app view.
    if (request.accountId !== entry.accountId) {
      return;
    }

    entry.accountUnlocked = request.isUnlocked;
    queueQdnViewStateDelivery(entry);
  });

  ipcMain.handle('qdn-views:destroy', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const tabId = sanitizeTabRequest(rawRequest);

    destroyTabView(window.webContents.id, tabId);
  });
}
