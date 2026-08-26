import {
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  type IpcMainInvokeEvent,
  type Rectangle,
  type WebContents,
} from 'electron';
import { registerHomeV2DesktopResourceStreamProtocol } from './home-v2-desktop-resource-stream.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installCertificateVerifyProc } from './node-tls.js';
import { isHomeV2CoreBridgeClientRequest } from './home-v2-core-bridge-client.js';
import { getQdnArchiveRenderRoot, getRealPathIfAvailable, isManagedQdnArchiveRenderUrl } from './qdn-archive-render.js';
import {
  isQdnRenderUrlSameAppResource as isQdnRenderUrlSameAppResourcePure,
  type QdnArchiveIdentityResolver,
  type QdnResourceLaunchRef,
} from './qdn-resource-identity.js';
import { isQdnBrowserArchiveService } from './qdn-browser-archive-services.js';
import {
  QDN_MANAGER_EVENT_KINDS,
  QDN_MANAGER_EVENT_NAMES,
  getQdnManagerRevisionEventDetail,
  validateQdnManagerRevisions,
  type QdnManagerEventKind,
  type QdnManagerRevisions,
} from './qdn-manager-events.js';
import { sanitizeQdnManagerAppKey } from './qdn-manager-permissions.js';
import { canReuseQdnViewEntry, getQdnViewPartition } from './qdn-view-security-context.js';
import { isWidgetTabId } from './widget-registry.js';
import { resetZoom, zoomIn, zoomOut } from './zoom.js';
import {
  getHomeV2ContextMenuPopupPoint,
  type HomeV2ContextMenuAnchor,
} from './home-v2-context-menu.js';

const TAB_ID_PATTERN = /^[a-z0-9._:-]{1,80}$/i;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THEME_VALUES = new Set(['dark', 'light']);
const LANGUAGE_VALUES = new Set(['ar', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'he', 'hi', 'hu', 'it', 'ja', 'ko', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'zh-CN', 'zh-TW']);
const TEXT_SIZE_VALUES = new Set(['extra-large', 'extra-small', 'huge', 'large', 'medium', 'small']);
const ACCENT_VALUES = new Set(['blue', 'clay', 'cyan', 'green', 'orange', 'pink', 'purple', 'red', 'teal', 'yellow']);
const UI_VALUES = new Set(['classic', 'modern', 'fun']);
// Exact Qortal node origins the cross-chain bridge can return for direct resource URLs. QDN apps
// render from the node's own origin, so the rendered Content-Security-Policy must allow connecting
// to these for read-only cross-chain reads (e.g. an emulator streaming a ROM from Qortal). Android
// strips the CSP entirely; on desktop we relax it narrowly to just these origins.
const QORTAL_RENDER_ALLOWED_ORIGINS = [
  'http://127.0.0.1:12391',
  'https://127.0.0.1:12391',
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
  accent: 'blue' | 'clay' | 'cyan' | 'green' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'yellow';
  theme: 'dark' | 'light';
  ui: 'classic' | 'modern' | 'fun';
};

export type QdnHomeSettingsChangedDetail = QdnDisplaySettings & {
  appNotifications: boolean;
  appZoom: number;
  lang: QdnDisplaySettings['language'];
  uiStyle: QdnDisplaySettings['ui'];
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
  bridgeStates: QdnBridgeStateDetail[];
  currentUrl: string | null;
  // The renderUrl React last asked us to load. Unlike `currentUrl`, this is not
  // mutated by in-app navigation, so it tells us whether a `qdn-views:show`
  // carries a genuinely new destination (reload) or is a pure suspend→show of
  // the same page (no reload, preserving the live in-app location).
  requestedUrl: string | null;
  // What the loaded page last received; `undefined` means nothing delivered
  // yet, so state messages are only sent when these fall out of sync.
  deliveredAccountStateKey: string | undefined;
  deliveredBridgeStateRevisions: Record<string, string> | undefined;
  deliveredDisplaySettings: QdnDisplaySettings | undefined;
  deliveredManagerRevisions: QdnManagerRevisions | undefined;
  displaySettings: QdnDisplaySettings;
  hostCssBounds: Rectangle | null;
  isPageReady: boolean;
  nodeOrigin: string;
  pendingAppTargetMessage: unknown | undefined;
  pendingHomeSettingsEvent: QdnHomeSettingsChangedDetail | undefined;
  pendingStateDelivery: Promise<void>;
  managerRevisions: QdnManagerRevisions | undefined;
  resourceUrl: string | null;
  tabId: string;
  view: WebContentsView;
  window: BrowserWindow;
};

type SanitizedShowRequest = {
  accountId: string | null;
  bounds: Rectangle;
  bridgeStates: QdnBridgeStateDetail[];
  displaySettings: QdnDisplaySettings;
  managerRevisions: QdnManagerRevisions | undefined;
  nodeOrigin: string;
  renderUrl: string;
  resourceUrl: string | null;
  tabId: string;
};

export type QdnBridgeStateDetail = {
  network: 'qortal' | 'qortium';
  protocol: 'qdnRequest' | 'qortalRequest';
  revision: string;
};

type SanitizedBoundsRequest = {
  bounds: Rectangle;
  tabId: string;
};

type SanitizedNavigationRequest = {
  index: number;
  tabId: string;
};

type SanitizedDisplaySettingsRequest = {
  displaySettings: QdnDisplaySettings;
  tabId: string;
};

type SanitizedBridgeStatesRequest = {
  bridgeStates: QdnBridgeStateDetail[];
  tabId: string;
};

type SanitizedManagerRevisionsRequest = {
  managerRevisions: QdnManagerRevisions;
  tabId: string;
};

type SanitizedAudioMutedRequest = {
  muted: boolean;
  tabId: string;
};

type SanitizedHomeSettingsBroadcastRequest = {
  detail: QdnHomeSettingsChangedDetail;
};

type SanitizedAccountStateRequest = {
  accountId: string | null;
  isUnlocked: boolean;
  tabId: string;
};

type QdnAppTargetMessage = {
  action: 'OPEN_APP_TARGET';
  requestedHandler: 'UI';
  query: {
    address?: string;
    group?: string;
  };
};

type SanitizedPostMessageRequest = {
  message: QdnAppTargetMessage;
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
  bridgeStates: QdnBridgeStateDetail[];
  currentUrl: string | null;
  displaySettings: QdnDisplaySettings;
  managerRevisions: QdnManagerRevisions | undefined;
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

export const QDN_APP_TITLE_MAX_LENGTH = 160;

// App-controlled text that lands in host UI (tab labels, notifications): strip
// control and direction-override characters, collapse runs of whitespace, and
// cap the length.
export function sanitizeAppTitle(value: unknown, maxLength = QDN_APP_TITLE_MAX_LENGTH): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const title = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!title) {
    return null;
  }

  return title.length > maxLength ? `${title.slice(0, maxLength - 1)}…` : title;
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

  return isQdnBrowserArchiveService(getRenderService(url));
}

// Fix A (finding 1) same-app-resource navigation binding: the pure identity
// parsing/comparison logic lives in qdn-resource-identity.ts (no
// node/electron-only imports, so it is plain-Node testable). The only piece
// that needs Electron here is resolving a managed-archive `file://` URL's
// cache-directory identity, which touches `app.getPath` via
// getQdnArchiveRenderRoot() — that stays local to this file and is injected
// into the pure module as a QdnArchiveIdentityResolver.

// The managed-archive cache directory a `file://` render URL resolves inside
// (qdn-archive-render.ts prepareQdnArchiveRender): unique per published
// resource *and* content version, so directory equality means "same rendered
// resource". isManagedQdnArchiveRenderUrl has already verified the URL
// resolves inside the archive root before this is called.
//
// Fix 4 (Sol re-review #5): identity is computed from the REAL (symlink-
// resolved) path, via the SAME getRealPathIfAvailable helper
// qdn-archive-render.ts's own containment checks use — not the lexical URL
// path — so an extracted archive that plants a symlink pointing at a
// sibling cache directory is identified by where it REALLY resolves, not by
// which cache directory it lexically appears to live under. See that
// helper's doc comment for the full rationale.
function getArchiveCacheDirIdentity(rawUrl: string): string | null {
  try {
    const filePath = fileURLToPath(new URL(rawUrl));
    const realFilePath = getRealPathIfAvailable(filePath);
    const realRoot = getRealPathIfAvailable(path.resolve(getQdnArchiveRenderRoot()));
    const relative = path.relative(realRoot, realFilePath);

    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return null;
    }

    return relative.split(path.sep)[0] || null;
  } catch {
    return null;
  }
}

const qdnArchiveIdentityResolver: QdnArchiveIdentityResolver = {
  isArchiveUrl: isManagedQdnArchiveRenderUrl,
  getArchiveIdentity: getArchiveCacheDirIdentity,
};

// Whether `candidateUrl` still points at the SAME app resource `ref` was
// launched for. Exported for electron/home-v2-app-bridge.ts's defense-in-
// depth live-resource recheck.
export function isQdnRenderUrlSameAppResource(candidateUrl: string, ref: QdnResourceLaunchRef): boolean {
  return isQdnRenderUrlSameAppResourcePure(candidateUrl, ref, qdnArchiveIdentityResolver);
}

// Combined gate used everywhere a loaded view's in-view navigation is
// checked: the existing origin/service allowlist, plus Fix A's same-app-
// resource binding.
function isAllowedInViewNavigation(candidateUrl: string, entry: QdnViewEntry): boolean {
  return (
    isAllowedRenderUrlForOrigin(candidateUrl, entry.nodeOrigin) &&
    isQdnRenderUrlSameAppResource(candidateUrl, {
      nodeOrigin: entry.nodeOrigin,
      requestedUrl: entry.requestedUrl,
      resourceUrl: entry.resourceUrl,
    })
  );
}

function sanitizeRenderUrl(value: unknown, nodeOrigin: string) {
  if (typeof value === 'string' && isManagedQdnArchiveRenderUrl(value)) {
    return new URL(value).toString();
  }

  const url = getHttpUrl(value, 'QDN render URL');

  if (!isAllowedRenderUrlForOrigin(url.toString(), nodeOrigin)) {
    throw new Error('QDN render URL is outside the allowed browser archive render scope.');
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
    bridgeStates: sanitizeBridgeStates(value.bridgeStates),
    displaySettings: sanitizeDisplaySettings(value.displaySettings),
    managerRevisions: value.managerRevisions === undefined
      ? undefined
      : validateQdnManagerRevisions(value.managerRevisions),
    nodeOrigin,
    renderUrl: sanitizeRenderUrl(value.renderUrl, nodeOrigin),
    resourceUrl: sanitizeOptionalResourceUrl(value.resourceUrl),
    tabId: sanitizeTabId(value.tabId),
  };
}

function sanitizeBridgeStates(value: unknown): QdnBridgeStateDetail[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 2) {
    throw new Error('QDN bridge states are invalid.');
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!isRecord(entry)) throw new Error('QDN bridge state is invalid.');
    const protocol = entry.protocol;
    if (protocol !== 'qdnRequest' && protocol !== 'qortalRequest') {
      throw new Error('QDN bridge state is invalid.');
    }
    const network = entry.network;
    const revision = typeof entry.revision === 'string' ? entry.revision.trim() : '';
    const expectedNetwork = protocol === 'qdnRequest' ? 'qortium' : 'qortal';
    if (
      network !== expectedNetwork ||
      !revision ||
      revision.length > 128 ||
      seen.has(protocol)
    ) {
      throw new Error('QDN bridge state is invalid.');
    }
    seen.add(protocol);
    return { network: expectedNetwork, protocol, revision };
  });
}

function sanitizeManagerRevisionsRequest(value: unknown): SanitizedManagerRevisionsRequest {
  if (!isRecord(value)) {
    throw new Error('QDN view manager revisions request is required.');
  }

  return {
    managerRevisions: validateQdnManagerRevisions(value.managerRevisions),
    tabId: sanitizeTabId(value.tabId),
  };
}

function sanitizeAudioMutedRequest(value: unknown): SanitizedAudioMutedRequest {
  if (!isRecord(value)) {
    throw new Error('QDN view audio muted request is required.');
  }

  return {
    muted: value.muted === true,
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

function sanitizeNavigationRequest(value: unknown): SanitizedNavigationRequest {
  if (!isRecord(value)) {
    throw new Error('QDN view navigation request is required.');
  }

  if (!Number.isInteger(value.index) || (value.index as number) < 0 || (value.index as number) > 10_000) {
    throw new Error('QDN view navigation index is invalid.');
  }

  return {
    index: value.index as number,
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

function sanitizeBridgeStatesRequest(value: unknown): SanitizedBridgeStatesRequest {
  if (!isRecord(value)) {
    throw new Error('QDN view bridge states request is required.');
  }

  return {
    bridgeStates: sanitizeBridgeStates(value.bridgeStates),
    tabId: sanitizeTabId(value.tabId),
  };
}

function sanitizeHomeSettingsBroadcastRequest(value: unknown): SanitizedHomeSettingsBroadcastRequest {
  if (!isRecord(value) || !isRecord(value.detail)) {
    throw new Error('QDN Home settings broadcast is required.');
  }
  const detail = value.detail;
  if (typeof detail.appZoom !== 'number' || !Number.isFinite(detail.appZoom) || typeof detail.appNotifications !== 'boolean') {
    throw new Error('QDN Home settings broadcast is invalid.');
  }
  const displaySettings = sanitizeDisplaySettings(detail);
  if (detail.lang !== displaySettings.language || detail.uiStyle !== displaySettings.ui) {
    throw new Error('QDN Home settings broadcast is inconsistent.');
  }
  return {
    detail: {
      ...displaySettings,
      appNotifications: detail.appNotifications,
      appZoom: detail.appZoom,
      lang: displaySettings.language,
      uiStyle: displaySettings.ui,
    },
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

function sanitizeAppTargetValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function sanitizePostMessageRequest(value: unknown): SanitizedPostMessageRequest {
  if (!isRecord(value) || !isRecord(value.message) || !isRecord(value.message.query)) {
    throw new Error('QDN view message request is required.');
  }

  if (value.message.action !== 'OPEN_APP_TARGET' || value.message.requestedHandler !== 'UI') {
    throw new Error('QDN view message is not supported.');
  }

  const address = sanitizeAppTargetValue(value.message.query.address);
  const group = sanitizeAppTargetValue(value.message.query.group);

  if (!address && !group) {
    throw new Error('QDN app target is required.');
  }

  return {
    message: {
      action: 'OPEN_APP_TARGET',
      requestedHandler: 'UI',
      query: {
        ...(address ? { address } : {}),
        ...(group ? { group } : {}),
      },
    },
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

/**
 * Notified when a QDN app view commits a main-frame navigation, i.e. when the
 * document that may have outstanding requests is replaced.
 *
 * A registration hook rather than a direct call, because
 * electron/home-v2-app-bridge.ts already imports THIS module: importing it back
 * would make the pair a true ESM cycle and leave qdn-views un-loadable on its
 * own, which its tests rely on. The dependency direction stays one-way; the
 * bridge registers itself when it installs its IPC handlers.
 */
type QdnViewNavigationListener = (navigation: {
  readonly hostWebContentsId: number;
  readonly tabId: string;
}) => void;

const qdnViewNavigationListeners = new Set<QdnViewNavigationListener>();

export function onQdnViewNavigated(listener: QdnViewNavigationListener) {
  qdnViewNavigationListeners.add(listener);
  return () => {
    qdnViewNavigationListeners.delete(listener);
  };
}

function notifyQdnViewNavigated(entry: QdnViewEntry) {
  // The host window's webContents id — the same key qdnViewsByWindow and the
  // bridge's pending-prompt map use. Guarded because a navigation can land as
  // the window is going away, and reading webContents on a destroyed window
  // throws.
  if (entry.window.isDestroyed()) {
    return;
  }
  const navigation = {
    hostWebContentsId: entry.window.webContents.id,
    tabId: entry.tabId,
  };
  for (const listener of qdnViewNavigationListeners) {
    try {
      listener(navigation);
    } catch (error) {
      console.warn('[qdn-views] A view navigation listener failed:', error);
    }
  }
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

// Moved to qdn-view-security-context.ts so the reuse decision below and the
// partition a view is actually created with can never be computed from two
// different definitions.
const getPartition = getQdnViewPartition;

// An app view counts as focused only when it is the visible view of a focused
// window — that is when the user is already looking at the app, so app
// notifications for it would be pure noise.
export function isQdnViewFocused(windowId: number, tabId: string) {
  const entry = qdnViewsByWindow.get(windowId)?.get(tabId);

  return !!entry && !entry.window.isDestroyed() && entry.window.isFocused() && entry.view.getVisible();
}

// Permission prompts need trusted Home chrome. A hidden background tab may
// continue polling, but it must not summon that chrome and switch the user's
// active app merely because its prior grant is absent or was revoked.
export function isQdnViewVisible(windowId: number, tabId: string) {
  const entry = qdnViewsByWindow.get(windowId)?.get(tabId);

  return !!entry && !entry.window.isDestroyed() && entry.view.getVisible();
}

function getCanonicalQdnAppKey(resourceUrl: string | null) {
  if (!resourceUrl) return null;
  try {
    return sanitizeQdnManagerAppKey(resourceUrl);
  } catch {
    return null;
  }
}

export function isQdnAppResourceFocused(resourceUrl: string) {
  const appKey = getCanonicalQdnAppKey(resourceUrl);
  if (!appKey) return false;
  for (const windowViews of qdnViewsByWindow.values()) {
    for (const entry of windowViews.values()) {
      if (
        getCanonicalQdnAppKey(entry.resourceUrl) === appKey &&
        !entry.window.isDestroyed() &&
        entry.window.isFocused() &&
        entry.view.getVisible()
      ) {
        return true;
      }
    }
  }

  return false;
}

// Fix 3 (Sol re-review #3): the TRUSTED live URL, sourced directly from
// Chromium rather than from `entry.currentUrl` (a field this module updates
// itself via navigation event listeners, so a missed/misordered event could
// theoretically leave it stale). webContents.getURL() reflects the last
// COMMITTED navigation regardless of our own bookkeeping, so a permission-
// time recheck against it fails closed on the page that is actually loaded,
// not on a best-case snapshot. Falls back to the (now always up to date, per
// updateCurrentUrl above) bookkeeping field only once the webContents itself
// is gone and can no longer be asked.
function getTrustedCurrentUrl(entry: QdnViewEntry): string | null {
  if (entry.view.webContents.isDestroyed()) {
    return entry.currentUrl;
  }

  const liveUrl = entry.view.webContents.getURL();

  // A freshly created (not-yet-navigated) webContents can report '' or
  // 'about:blank' rather than throwing/returning undefined — both mean "no
  // real committed URL yet", same as the null this returned before any
  // navigation had happened.
  return liveUrl && liveUrl !== 'about:blank' ? liveUrl : null;
}

export function getQdnViewContextForWebContents(webContents: WebContents): QdnViewContext | null {
  for (const [windowId, windowViews] of qdnViewsByWindow) {
    for (const entry of windowViews.values()) {
      if (entry.view.webContents.id === webContents.id) {
        return {
          accountId: entry.accountId,
          bridgeStates: entry.bridgeStates,
          currentUrl: getTrustedCurrentUrl(entry),
          displaySettings: entry.displaySettings,
          managerRevisions: entry.managerRevisions,
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

export function getQdnViewContextMenuPopupHost(
  webContents: WebContents,
  anchor: HomeV2ContextMenuAnchor | null,
): { readonly window: BrowserWindow; readonly x: number; readonly y: number } | null {
  for (const windowViews of qdnViewsByWindow.values()) {
    for (const entry of windowViews.values()) {
      if (entry.view.webContents.id !== webContents.id) continue
      if (
        !entry.hostCssBounds ||
        entry.window.isDestroyed() ||
        !entry.window.isFocused() ||
        entry.view.webContents.isDestroyed() ||
        !entry.view.getVisible()
      ) {
        return null
      }
      const point = getHomeV2ContextMenuPopupPoint(
        entry.hostCssBounds,
        getHostZoomFactor(entry.window),
        anchor,
      )
      return Object.freeze({ window: entry.window, ...point })
    }
  }
  return null
}

// The "Open as widget" toolbar action is issued by the Home shell rather than
// by the app, so the request names a tab instead of arriving on the app view's
// own webContents. The host window is verified by the caller, so a shell can
// only ever address a tab in its own window.
// hostWebContentsId, not a BrowserWindow id: qdnViewsByWindow is keyed by the
// host window's webContents id, and so is the windowId this returns. The two
// sequences only coincide for the very first window, so mixing them up works in
// testing and fails for every window opened afterwards.
export function getQdnViewContextForTab(
  hostWebContentsId: number,
  tabId: string,
): QdnViewContext | null {
  const entry = qdnViewsByWindow.get(hostWebContentsId)?.get(tabId);

  if (!entry) {
    return null;
  }

  return {
    accountId: entry.accountId,
    bridgeStates: entry.bridgeStates,
    currentUrl: getTrustedCurrentUrl(entry),
    displaySettings: entry.displaySettings,
    managerRevisions: entry.managerRevisions,
    nodeOrigin: entry.nodeOrigin,
    resourceUrl: entry.resourceUrl,
    tabId: entry.tabId,
    windowId: hostWebContentsId,
  };
}

export function syncWidgetQdnViewState(value: unknown) {
  if (!isRecord(value)) throw new Error('Widget runtime state is required.');
  const displaySettings = sanitizeDisplaySettings(value.displaySettings);
  const bridgeStates = sanitizeBridgeStates(value.bridgeStates);
  const managerRevisions = value.managerRevisions === undefined
    ? undefined
    : validateQdnManagerRevisions(value.managerRevisions);
  const deliveries: Promise<void>[] = [];
  for (const windowViews of qdnViewsByWindow.values()) {
    for (const entry of windowViews.values()) {
      if (!entry.tabId.startsWith('widget:')) continue;
      entry.displaySettings = displaySettings;
      entry.bridgeStates = bridgeStates;
      if (managerRevisions) entry.managerRevisions = managerRevisions;
      deliveries.push(queueQdnViewStateDelivery(entry));
    }
  }
  return Promise.all(deliveries).then(() => undefined);
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
  const sendNavigationSnapshot = () => {
    if (entry.window.isDestroyed() || !entry.resourceUrl) {
      return;
    }

    const navigationHistory = entry.view.webContents.navigationHistory;
    const activeIndex = navigationHistory.getActiveIndex();
    const entries = navigationHistory
      .getAllEntries()
      .map((navigationEntry, index) => ({ index, url: navigationEntry.url }))
      .filter((navigationEntry) => isAllowedInViewNavigation(navigationEntry.url, entry))
      .slice(-200);

    if (!entries.some((navigationEntry) => navigationEntry.index === activeIndex)) {
      return;
    }

    entry.window.webContents.send('qdn-views:app-navigation-changed', {
      activeIndex,
      entries,
      resourceUrl: entry.resourceUrl,
      tabId: entry.tabId,
    });
  };

  const updateCurrentUrl = (url: string) => {
    // Fix 3 (Sol re-review #3): record every committed main-frame URL
    // unconditionally. Discarding a disallowed one here used to leave
    // `entry.currentUrl` stale (pointing at the last ALLOWED url) even
    // though the page had actually navigated somewhere disallowed — a
    // permission-time consumer reading `entry.currentUrl` (via
    // getQdnViewContextForWebContents) would then wrongly see "still on the
    // allowed resource". getQdnViewContextForWebContents no longer trusts
    // this field for that purpose (it reads the live webContents.getURL()
    // instead — see below), but this field is also used as a plain
    // bookkeeping fallback there, so it must reflect reality, not a
    // best-case snapshot.
    entry.currentUrl = url;

    if (!isAllowedInViewNavigation(url, entry)) {
      return;
    }

    // A pushState can intentionally add the same URL twice. Always send the
    // engine snapshot so its stable indexes, rather than URL equality, decide
    // whether Home gained a history entry.
    if (!entry.window.isDestroyed() && entry.resourceUrl) {
      sendNavigationSnapshot();
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

    if (!isAllowedInViewNavigation(navigationUrl, entry)) {
      event.preventDefault();
    }
  });
  entry.view.webContents.on('will-frame-navigate', (event) => {
    if (!isAllowedInViewNavigation(event.url, entry)) {
      event.preventDefault();
    }
  });
  entry.view.webContents.on('will-redirect', (event, url) => {
    const redirectUrl = event.url || url;

    if (!isAllowedInViewNavigation(redirectUrl, entry)) {
      event.preventDefault();
    }
  });
  entry.view.webContents.on('did-navigate', (_event, url) => {
    updateCurrentUrl(url);
    // A committed main-frame navigation replaces the DOCUMENT. Anything still
    // pending on behalf of the outgoing one can no longer be answered by it.
    // Deliberately NOT also hooked to 'did-navigate-in-page' below: that is the
    // same document doing client-side routing, and cancelling a prompt on a
    // hash change or history.pushState would break single-page apps for no
    // safety gain — the app-resource identity, which is what the grant checks
    // are keyed on, has not changed there.
    notifyQdnViewNavigated(entry);
  });
  entry.view.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) {
      updateCurrentUrl(url);
    }
  });
  // The app's document.title drives the host tab label, like a regular browser.
  // `explicitSet` is false when Chromium falls back to the URL as the title, which
  // must clear the label back to the route-derived default rather than leak a URL.
  entry.view.webContents.on('page-title-updated', (_event, title, explicitSet) => {
    if (entry.window.isDestroyed()) {
      return;
    }

    entry.window.webContents.send('qdn-views:app-title-changed', {
      tabId: entry.tabId,
      title: explicitSet ? sanitizeAppTitle(title) : null,
    });
  });
  // Chromium reports a view as audible whenever it is producing sound, independently of
  // whether it is muted, so the tab strip is sent both and never infers one from the
  // other. Muting raises no event of its own, which is why the mute IPC handler echoes
  // the new state back rather than leaving the strip waiting on this listener.
  entry.view.webContents.on('audio-state-changed', (event) => {
    if (entry.window.isDestroyed()) {
      return;
    }

    entry.window.webContents.send('qdn-views:app-audio-state-changed', {
      audible: event.audible,
      muted: entry.view.webContents.isAudioMuted(),
      tabId: entry.tabId,
    });
  });

  const isolatedSession = entry.view.webContents.session;

  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  if (process.env.QORTIUM_HOME_V2 === '1') {
    isolatedSession.webRequest.onBeforeRequest((details, callback) => {
      callback({
        cancel: isHomeV2CoreBridgeClientRequest(details.url, entry.nodeOrigin),
      });
    });
  }

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

async function sendQdnHomeSettingsChangedEvent(entry: QdnViewEntry, detail: QdnHomeSettingsChangedDetail) {
  if (entry.view.webContents.isDestroyed()) return;
  await entry.view.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent('qortiumHomeSettingsChanged', { detail: ${JSON.stringify(detail)} }));`,
    true,
  );
}

async function sendQdnBridgeStateChangedEvent(
  entry: QdnViewEntry,
  detail: QdnBridgeStateDetail,
) {
  if (entry.view.webContents.isDestroyed()) return;
  await entry.view.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent('qortiumBridgeStateChanged', { detail: ${JSON.stringify(detail)} }));`,
    true,
  );
}

function bridgeStateRevisionMap(states: readonly QdnBridgeStateDetail[]) {
  return Object.fromEntries(states.map((state) => [state.protocol, state.revision]));
}

async function sendQdnManagerRevisionChangedEvent(
  entry: QdnViewEntry,
  kind: QdnManagerEventKind,
  revision: number,
) {
  if (entry.view.webContents.isDestroyed()) return;
  const eventName = QDN_MANAGER_EVENT_NAMES[kind];
  const detail = getQdnManagerRevisionEventDetail(revision);

  await entry.view.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent(${JSON.stringify(eventName)}, { detail: ${JSON.stringify(detail)} }));`,
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
  const changedBridgeStates = entry.isPageReady && entry.deliveredBridgeStateRevisions
    ? entry.bridgeStates.filter(
        (state) => entry.deliveredBridgeStateRevisions?.[state.protocol] !== state.revision,
      )
    : [];
  const appTargetMessage = entry.pendingAppTargetMessage;
  const homeSettingsEvent = entry.pendingHomeSettingsEvent;
  const sendHomeSettingsEvent = entry.isPageReady && !!homeSettingsEvent;
  const managerRevisions = entry.managerRevisions;
  const managerRevisionEvents = entry.isPageReady && managerRevisions
    ? QDN_MANAGER_EVENT_KINDS.filter(
        (kind) => entry.deliveredManagerRevisions?.[kind] !== managerRevisions[kind],
      ).map((kind) => ({ kind, revision: managerRevisions[kind] }))
    : [];
  const sendAppTarget = entry.isPageReady && typeof appTargetMessage !== 'undefined';
  const messages = [
    ...(sendDisplaySettings ? getQdnDisplaySettingMessages(entry.displaySettings) : []),
    ...(sendAccountChanged ? [getQdnSelectedAccountChangedMessage()] : []),
    ...(sendAppTarget ? [appTargetMessage] : []),
  ];

  if (
    !messages.length &&
    !sendHomeSettingsEvent &&
    managerRevisionEvents.length === 0 &&
    changedBridgeStates.length === 0
  ) {
    return;
  }

  if (messages.length) {
    await sendQdnMessages(entry, messages);
  }

  if (sendDisplaySettings) {
    entry.deliveredDisplaySettings = entry.displaySettings;
  }

  if (sendAccountChanged) {
    entry.deliveredAccountStateKey = getAccountStateKey(entry);
  }

  if (sendAppTarget && entry.pendingAppTargetMessage === appTargetMessage) {
    entry.pendingAppTargetMessage = undefined;
  }

  if (sendHomeSettingsEvent && homeSettingsEvent && entry.pendingHomeSettingsEvent === homeSettingsEvent) {
    await sendQdnHomeSettingsChangedEvent(entry, homeSettingsEvent);
    entry.pendingHomeSettingsEvent = undefined;
  }

  for (const detail of changedBridgeStates) {
    await sendQdnBridgeStateChangedEvent(entry, detail);
  }
  if (changedBridgeStates.length > 0) {
    entry.deliveredBridgeStateRevisions = bridgeStateRevisionMap(entry.bridgeStates);
  }

  for (const { kind, revision } of managerRevisionEvents) {
    await sendQdnManagerRevisionChangedEvent(entry, kind, revision);
  }

  if (managerRevisionEvents.length > 0 && managerRevisions) {
    entry.deliveredManagerRevisions = managerRevisions;
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

  return entry.pendingStateDelivery;
}

function createViewEntry(
  window: BrowserWindow,
  tabId: string,
  nodeOrigin: string,
  accountId: string | null,
  resourceUrl: string | null,
  displaySettings: QdnDisplaySettings,
  bridgeStates: QdnBridgeStateDetail[],
): QdnViewEntry {
  const partition = getPartition(nodeOrigin, resourceUrl);
  const viewSession = session.fromPartition(partition);
  installCertificateVerifyProc(viewSession);
  if (process.env.QORTIUM_HOME_V2 === '1') {
    registerHomeV2DesktopResourceStreamProtocol(viewSession);
  }

  const entry: QdnViewEntry = {
    accountId,
    accountUnlocked: false,
    bridgeStates,
    currentUrl: null,
    requestedUrl: null,
    deliveredAccountStateKey: undefined,
    deliveredBridgeStateRevisions: undefined,
    deliveredDisplaySettings: undefined,
    deliveredManagerRevisions: undefined,
    displaySettings,
    hostCssBounds: null,
    isPageReady: false,
    managerRevisions: undefined,
    nodeOrigin,
    pendingAppTargetMessage: undefined,
    pendingHomeSettingsEvent: undefined,
    pendingStateDelivery: Promise.resolve(),
    resourceUrl,
    tabId,
    view: new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition,
        preload: path.join(
          __dirname,
          process.env.QORTIUM_HOME_V2 === '1'
            ? 'home-v2-qdn-app-preload.cjs'
            : 'qdn-app-preload.cjs',
        ),
        sandbox: true,
      },
    }),
    window,
  };

  applyViewGuards(entry);

  // A widget's WebContentsView composites above a transparent, shaped host
  // window - but WebContentsView has its own opaque-white default background
  // independent of the host window's, so without this every pixel outside
  // what the app actually paints (including its own declared shape's cutout
  // corners) renders solid white instead of showing the desktop through it.
  // Ordinary desktop app tabs are unaffected: they always sit inside opaque
  // Home chrome, so this is scoped to widget tabIds only.
  if (isWidgetTabId(tabId)) {
    entry.view.setBackgroundColor('#00000000');
  }

  // Electron zoom levels are stored per-origin: a level applied to the freshly
  // created (blank) webContents does not survive the first loadURL, and a
  // navigation to a different node origin falls back to that origin's default.
  // Re-apply the host window's zoom after every completed load so a persisted
  // App Zoom takes effect without needing a manual zoom shortcut first.
  entry.view.webContents.on('did-finish-load', () => applyHostZoomToEntry(entry));

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

  // Reuse is a SECURITY decision, not an optimization: the view keeps the
  // partition it was created with, so reusing it for a different app would
  // hand that app the previous one's cookies, localStorage and IndexedDB.
  // canReuseQdnViewEntry fails closed — anything it cannot prove to be the
  // same app principal in the same partition falls through and is rebuilt
  // below, along exactly the path a freshly opened tab takes.
  if (existingEntry && canReuseQdnViewEntry(existingEntry, request)) {
    // accountId is pinned at creation: a QDN app tab stays bound to its launch
    // account for its lifetime, so a re-show must never rebind it.
    existingEntry.displaySettings = request.displaySettings;
    existingEntry.bridgeStates = request.bridgeStates;
    existingEntry.managerRevisions = request.managerRevisions;
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
    request.bridgeStates,
  );

  entry.managerRevisions = request.managerRevisions;

  windowViews.set(request.tabId, entry);

  // A brand new view starts silent and unmuted, and stays silent until something plays.
  // Without this the tab strip would keep showing whatever the destroyed view last
  // reported. Mute deliberately survives navigation within a reused view, matching how
  // a browser keeps a tab muted as you move around inside it.
  if (!window.isDestroyed()) {
    window.webContents.send('qdn-views:app-audio-state-changed', {
      audible: false,
      muted: false,
      tabId: request.tabId,
    });
  }

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
      entry.isPageReady = false;
      void entry.view.webContents
        .loadURL(request.renderUrl)
        .then(() => {
          // The freshly loaded page has received nothing yet.
          entry.isPageReady = true;
          entry.deliveredAccountStateKey = undefined;
          entry.deliveredBridgeStateRevisions = bridgeStateRevisionMap(entry.bridgeStates);
          entry.deliveredDisplaySettings = undefined;
          entry.deliveredManagerRevisions = undefined;
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

  ipcMain.handle('qdn-views:navigate', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const request = sanitizeNavigationRequest(rawRequest);
    const entry = qdnViewsByWindow.get(window.webContents.id)?.get(request.tabId);

    if (!entry || entry.view.webContents.isDestroyed()) {
      return false;
    }

    const navigationHistory = entry.view.webContents.navigationHistory;
    const target = navigationHistory.getEntryAtIndex(request.index);

    if (!target || !isAllowedInViewNavigation(target.url, entry)) {
      return false;
    }

    navigationHistory.goToIndex(request.index);
    return true;
  });

  ipcMain.handle('qdn-views:reload', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const tabId = sanitizeTabRequest(rawRequest);
    const entry = qdnViewsByWindow.get(window.webContents.id)?.get(tabId);
    if (!entry || entry.view.webContents.isDestroyed()) return false;
    entry.view.webContents.reload();
    return true;
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
    // The hide may complete after the user has switched to another desktop
    // window. In that case focusing Home here would raise it over the user's
    // current work. Only transfer focus from the hidden app view to Home while
    // Home itself still owns the OS focus.
    if (!window.isDestroyed() && window.isFocused()) {
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

  // Route/capability revisions are state delivery, not view identity. Updating
  // them independently prevents the renderer's 15-second node poll from
  // tearing down and re-showing the native view merely to deliver an event.
  ipcMain.handle('qdn-views:updateBridgeStates', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const request = sanitizeBridgeStatesRequest(rawRequest);
    const entry = qdnViewsByWindow.get(window.webContents.id)?.get(request.tabId);

    if (!entry) return;
    entry.bridgeStates = request.bridgeStates;
    queueQdnViewStateDelivery(entry);
  });

  ipcMain.handle('qdn-views:setAudioMuted', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const request = sanitizeAudioMutedRequest(rawRequest);
    const entry = qdnViewsByWindow.get(window.webContents.id)?.get(request.tabId);

    if (!entry || entry.view.webContents.isDestroyed()) {
      return;
    }

    entry.view.webContents.setAudioMuted(request.muted);

    // Chromium raises no audio-state event for a mute change, so the tab strip is told
    // directly instead of being left to guess.
    if (!entry.window.isDestroyed()) {
      entry.window.webContents.send('qdn-views:app-audio-state-changed', {
        audible: entry.view.webContents.isCurrentlyAudible(),
        muted: request.muted,
        tabId: entry.tabId,
      });
    }
  });

  ipcMain.handle('qdn-views:updateManagerRevisions', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const request = sanitizeManagerRevisionsRequest(rawRequest);
    const entry = qdnViewsByWindow.get(window.webContents.id)?.get(request.tabId);

    if (!entry) {
      return;
    }

    entry.managerRevisions = request.managerRevisions;
    queueQdnViewStateDelivery(entry);
  });

  // Desktop delivery. The full detail — appNotifications and appZoom included —
  // is safe to inject here: each app view is an origin-isolated WebContentsView
  // and this injects the CustomEvent into that specific view, so there is no
  // shared-origin frame a hard-navigated document could read it from. Android
  // is the opposite (one render-proxy origin per node) and there the producer
  // deliberately withholds those two fields; do NOT "unify" the two shapes by
  // copying either behaviour to the other. See src/v2/shell/AppTabStage.tsx.
  ipcMain.handle('qdn-views:broadcastHomeSettingsChanged', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const request = sanitizeHomeSettingsBroadcastRequest(rawRequest);
    const windowViews = qdnViewsByWindow.get(window.webContents.id);
    if (!windowViews) {
      return;
    }
    const deliveries: Promise<void>[] = [];
    for (const entry of windowViews.values()) {
      entry.displaySettings = {
        accent: request.detail.accent,
        language: request.detail.language,
        textSize: request.detail.textSize,
        theme: request.detail.theme,
        ui: request.detail.ui,
      };
      // The EVENT is withheld from widgets, while the display state above is
      // not. Its detail carries appNotifications and appZoom on top of the
      // display subset, and widgets are deliberately excluded from
      // GET_HOME_SETTINGS (isWidgetPublicReadAction, home-v2-app-runtime.ts) —
      // broadcasting the same fields would hand a chromeless widget by the back
      // door exactly what the read gate refuses it at the front. A widget still
      // re-themes, because that is what entry.displaySettings above is for.
      if (!entry.tabId.startsWith('widget:')) {
        entry.pendingHomeSettingsEvent = request.detail;
      }
      deliveries.push(queueQdnViewStateDelivery(entry));
    }
    return Promise.all(deliveries).then(() => undefined);
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
    return queueQdnViewStateDelivery(entry);
  });

  ipcMain.handle('qdn-views:postMessage', async (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const request = sanitizePostMessageRequest(rawRequest);
    const entry = qdnViewsByWindow.get(window.webContents.id)?.get(request.tabId);

    if (!entry) {
      return;
    }

    entry.pendingAppTargetMessage = request.message;
    await queueQdnViewStateDelivery(entry);
  });

  ipcMain.handle('qdn-views:destroy', (event, rawRequest: unknown) => {
    const window = getSenderWindow(event);
    const tabId = sanitizeTabRequest(rawRequest);

    destroyTabView(window.webContents.id, tabId);
  });
}
