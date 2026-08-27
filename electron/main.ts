import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  protocol,
  session,
  screen,
  type MenuItemConstructorOptions,
  type Rectangle,
  type WebContents,
} from 'electron';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { autoUnlockHomeV2SelectedAccount, registerAccountIpcHandlers } from './accounts.js';
import { registerAppUpdateIpcHandlers } from './app-updates.js';
import {
  disableLegacyCoreManagerRendererEvents,
  isManagedCoreUsingI2p,
  registerCoreManagerIpcHandlers,
  registerProductionCoreManagerEntries,
} from './core-manager.js';
import {
  disableLegacyI2pdRendererEvents,
  registerI2pdManagerIpcHandlers,
  startIfManaged as startI2pdIfManaged,
  stopRetainedChildForAppQuit as stopI2pdForAppQuit,
  stopIfManaged as stopI2pdIfManaged,
} from './i2pd-manager.js';
import { prewarmRunningCoreApiKeyCache } from './local-api-key.js';
import {
  migrateHomeV2LegacyCustomNodeKey, registerNodeSettingsIpcHandlers } from './node-settings.js';
import { registerHomeV2NodeBridgeIpcHandlers } from './home-v2-node-bridge.js';
import { registerHomeV2NodeAdminIpcHandlers } from './home-v2-node-admin-bridge.js';
import { assertAuthorizedHomeV2Sender, authorizeHomeV2Sender } from './home-v2-authorized-senders.js';
import { assertHomeV2ShellClipboardText } from './home-v2-shell-clipboard.js';
import { sanitizeHomeV2WindowAddress } from './home-v2-window-startup.js';
import { readHomeV2ShellState } from './home-v2-shell-store.js';
import { homeWindowFocus } from './home-window-focus.js';
import {
  homeV2TabCount,
  planHomeClose,
  resolveHomeCloseDialog,
} from './home-close-behavior.js';
import {
  applyHomeWindowBehaviorPatch,
  DEFAULT_HOME_WINDOW_BEHAVIOR,
  parseHomeWindowBehavior,
  parseHomeWindowBehaviorPatch,
  serializeHomeWindowBehavior,
  type HomeWindowBehavior,
} from './home-window-behavior.js';
import {
  initialWindowState,
  mergeWindowState,
  parseWindowStates,
  type WindowStateRole,
  type WindowStatesRecord,
} from './home-window-state.js';
import {
  forgetHomeV2WindowPendingPrompts,
  registerHomeV2AppBridgeIpcHandlers,
} from './home-v2-app-bridge.js';
import { registerHomeV2CoreManagerBridgeIpcHandlers } from './home-v2-core-manager-bridge.js';
import { registerHomeV2AppUpdateBridgeIpcHandlers } from './home-v2-app-update-bridge.js';
import { registerHomeV2ReleaseNotesBridgeIpcHandlers } from './home-v2-release-notes-bridge.js';
import { registerHomeV2QdnSettingsBridgeIpcHandlers } from './home-v2-qdn-settings-bridge.js';
import { registerHomeV2NotificationPolicyBridgeIpcHandlers } from './home-v2-notification-policy-bridge.js';
import { registerHomeV2CollectionsBridgeIpcHandlers } from './home-v2-collections-bridge.js';
import { registerHomeV2DesktopResourceStreamProtocol } from './home-v2-desktop-resource-stream.js';
import { HOME_V2_RESOURCE_STREAM_SCHEME } from './home-v2-resource-stream-capability.js';
import { HOME_V2_CORE_DOCS_SCHEME } from './home-v2-core-docs-contract.js';
import { registerHomeV2CoreDocsProtocol } from './home-v2-core-docs-protocol.js';
import { registerHomeV2CoreDocsBridgeIpcHandlers } from './home-v2-core-docs-bridge.js';
import { registerHomeV2RetainedViewerBridgeIpcHandlers } from './home-v2-retained-viewer-bridge.js';
import { registerNotificationStoreIpcHandlers } from './notification-store.js';
import { startNotificationWatcher } from './notification-watcher.js';
import {
  cleanupQdnPreviewStagingDirs,
  registerQdnIpcHandlers,
  sweepOrphanedQdnPreviewStagingDirs,
} from './qdn.js';
import { registerQdnViewIpcHandlers, syncQdnViewsForWindowZoom } from './qdn-views.js';
import { registerQdnManagerPermissionStoreIpcHandlers } from './qdn-manager-permission-store.js';
import { shouldLoadRendererFromDist } from './renderer-entry.js';
import { destroyTray, getTray, installTray } from './tray.js';
import { installNodeTlsForDefaultSessions } from './node-tls.js';
import { registerSystemIpcHandlers } from './system.js';
import { getZoomPercent, initZoom, resetZoom, setZoomPercent, zoomIn, zoomOut } from './zoom.js';
import { ensureHomeV2ProfileBackup, restoreHomeV2ProfileIfRequested } from './home-v2-profile-recovery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WINDOW_WIDTH = 1100;
const DEFAULT_WINDOW_HEIGHT = 720;
const MIN_WINDOW_WIDTH = 720;
const MIN_WINDOW_HEIGHT = 480;
const WINDOW_STATE_FILE = 'window-state.json';
const WINDOW_BEHAVIOR_FILE = 'window-behavior.json';
const WINDOW_STATE_SAVE_DELAY_MS = 250;
const WINDOW_ICON_FILE = 'icon.png';
const NEW_WINDOW_OFFSET_PX = 32;
const HOME_V2_SHELL_PARTITION = 'persist:home-v2-shell';
const USER_DATA_DIR_NAME = 'qortium-home';
const USER_DATA_DIR_OVERRIDE = process.env.QORTIUM_HOME_USER_DATA_DIR?.trim();
const IS_HOME_V2 = process.env.QORTIUM_HOME_V2 === '1';

protocol.registerSchemesAsPrivileged(
  [HOME_V2_RESOURCE_STREAM_SCHEME, HOME_V2_CORE_DOCS_SCHEME].map((scheme) => ({
    scheme,
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
  })),
);

initZoom({ sync: syncQdnViewsForWindowZoom });

function migrateUserDataPath(sourcePath: string, targetPath: string) {
  const source = path.resolve(sourcePath);
  const target = path.resolve(targetPath);

  if (source === target || !existsSync(source) || existsSync(target)) {
    return;
  }

  mkdirSync(path.dirname(target), { recursive: true });

  try {
    renameSync(source, target);
  } catch (renameError) {
    try {
      cpSync(source, target, { recursive: true });
    } catch (copyError) {
      console.warn('Unable to migrate Qortium Home user data directory.', renameError, copyError);
    }
  }
}

if (USER_DATA_DIR_OVERRIDE) {
  app.setPath('userData', path.resolve(USER_DATA_DIR_OVERRIDE));
} else {
  const legacyUserDataPath = app.getPath('userData');
  const homeUserDataPath = path.join(app.getPath('appData'), USER_DATA_DIR_NAME);

  migrateUserDataPath(legacyUserDataPath, homeUserDataPath);
  app.setPath('userData', homeUserDataPath);
}

if (IS_HOME_V2) {
  try {
    restoreHomeV2ProfileIfRequested();
  } catch (error) {
    console.error('Unable to restore the requested Home profile backup.', error);
  }
}

type WindowState = {
  height: number;
  isMaximized: boolean;
  width: number;
  x?: number;
  y?: number;
};

type WindowRouteSnapshot = {
  displayUrl: string;
  kind: string;
  [key: string]: unknown;
};

type WindowRouteHistorySnapshot = {
  entries: WindowRouteSnapshot[];
  index: number;
};

type WindowTabSnapshot = {
  accountId: string | null;
  history: WindowRouteHistorySnapshot;
};

type WindowStartupPayload = {
  tab: WindowTabSnapshot;
};

// Home 2's detach payload is deliberately just an address: the receiving
// window opens it through the ordinary address route, so nothing about a tab's
// internal shape has to survive a trip through the main process.
type HomeV2WindowStartup = {
  address: string;
};

type CreateWindowOptions = {
  placement?: 'primary' | 'secondary';
  startupPayload?: WindowStartupPayload;
  homeV2Startup?: HomeV2WindowStartup;
};

type MenuCommand =
  | 'close-tab'
  | 'focus-address-bar'
  | 'go-back'
  | 'go-forward'
  | 'new-tab'
  | 'reload-tab'
  | 'reopen-closed-tab';

const windowStartupPayloads = new Map<number, WindowStartupPayload>();
const homeV2WindowStartups = new Map<number, HomeV2WindowStartup>();

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeRouteSnapshot(value: unknown): WindowRouteSnapshot | null {
  if (!isRecord(value) || typeof value.displayUrl !== 'string' || typeof value.kind !== 'string') {
    return null;
  }

  return {
    ...value,
    displayUrl: value.displayUrl,
    kind: value.kind,
  };
}

function sanitizeRouteHistorySnapshot(value: unknown): WindowRouteHistorySnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    return null;
  }

  const entries = value.entries
    .map((entry) => sanitizeRouteSnapshot(entry))
    .filter((entry): entry is WindowRouteSnapshot => !!entry);

  if (entries.length === 0) {
    return null;
  }

  const index = isFiniteNumber(value.index)
    ? Math.max(0, Math.min(entries.length - 1, Math.round(value.index)))
    : entries.length - 1;

  return {
    entries,
    index,
  };
}

function sanitizeTabSnapshot(value: unknown): WindowTabSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const history = sanitizeRouteHistorySnapshot(value.history);

  if (!history) {
    return null;
  }

  return {
    accountId: typeof value.accountId === 'string' ? value.accountId : null,
    history,
  };
}

function sanitizeWindowStartupPayload(value: unknown): WindowStartupPayload {
  if (!isRecord(value)) {
    throw new Error('New window request must include a tab snapshot.');
  }

  const tab = sanitizeTabSnapshot(value.tab);

  if (!tab) {
    throw new Error('New window request must include a valid tab snapshot.');
  }

  return { tab };
}

function getWindowStatePath() {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILE);
}

function rectanglesOverlap(first: Rectangle, second: Rectangle) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

function isVisibleOnAnyDisplay(bounds: Rectangle) {
  return screen.getAllDisplays().some((display) => rectanglesOverlap(bounds, display.workArea));
}

const WINDOW_STATE_LIMITS = {
  defaultHeight: DEFAULT_WINDOW_HEIGHT,
  defaultWidth: DEFAULT_WINDOW_WIDTH,
  minHeight: MIN_WINDOW_HEIGHT,
  minWidth: MIN_WINDOW_WIDTH,
};

function readWindowStates(): WindowStatesRecord {
  try {
    const parsed: unknown = JSON.parse(readFileSync(getWindowStatePath(), 'utf8'));

    return parseWindowStates(parsed, WINDOW_STATE_LIMITS, isVisibleOnAnyDisplay);
  } catch {
    return {};
  }
}

function writeWindowStates(states: WindowStatesRecord) {
  const statePath = getWindowStatePath();

  try {
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(states, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.warn('Unable to save window state.', error);
  }
}

// --- window behaviour settings ----------------------------------------------
// Close-to-tray and the multi-tab close warning. Their own file rather than a
// third key in window-state.json, because parseWindowStates reads a record
// with no primary/secondary key as one legacy geometry blob.
//
// Synchronous, and memoised, because the close event that reads them cannot
// wait: an async read would return after the window has already gone. Home
// holds the single-instance lock, so this process is the only writer.

let windowBehavior: HomeWindowBehavior | undefined;

function getWindowBehaviorPath() {
  return path.join(app.getPath('userData'), WINDOW_BEHAVIOR_FILE);
}

function readWindowBehavior(): HomeWindowBehavior {
  if (!windowBehavior) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(getWindowBehaviorPath(), 'utf8'));

      windowBehavior = parseHomeWindowBehavior(parsed);
    } catch {
      windowBehavior = DEFAULT_HOME_WINDOW_BEHAVIOR;
    }
  }

  return windowBehavior;
}

function writeWindowBehavior(next: HomeWindowBehavior): HomeWindowBehavior {
  const behaviorPath = getWindowBehaviorPath();

  // The memo is updated even when the write fails, so the setting the user
  // just chose is honoured for this session rather than silently ignored.
  windowBehavior = next;

  try {
    mkdirSync(path.dirname(behaviorPath), { recursive: true });
    writeFileSync(
      behaviorPath,
      `${JSON.stringify(serializeHomeWindowBehavior(next), null, 2)}\n`,
      'utf8',
    );
  } catch (error) {
    console.warn('Unable to save window behaviour settings.', error);
  }

  return next;
}

function changeWindowBehavior(patch: Partial<HomeWindowBehavior>): HomeWindowBehavior {
  return writeWindowBehavior(applyHomeWindowBehaviorPatch(readWindowBehavior(), patch));
}

function getCurrentWindowState(window: BrowserWindow): WindowState {
  const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds();

  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(bounds.width, MIN_WINDOW_WIDTH),
    height: Math.max(bounds.height, MIN_WINDOW_HEIGHT),
    isMaximized: window.isMaximized(),
  };
}

// Read-merge-write, so saving one window's geometry leaves the other role's
// alone. Both happen in the main process, so the pair cannot interleave.
function persistWindowState(window: BrowserWindow, role: WindowStateRole) {
  if (!window.isDestroyed()) {
    writeWindowStates(
      mergeWindowState(readWindowStates(), role, getCurrentWindowState(window)),
    );
  }
}

function watchWindowState(window: BrowserWindow, role: WindowStateRole) {
  let saveWindowStateTimeout: NodeJS.Timeout | undefined;

  function scheduleWindowStateSave() {
    if (saveWindowStateTimeout) {
      clearTimeout(saveWindowStateTimeout);
    }

    saveWindowStateTimeout = setTimeout(() => {
      persistWindowState(window, role);
      saveWindowStateTimeout = undefined;
    }, WINDOW_STATE_SAVE_DELAY_MS);
  }

  window.on('move', scheduleWindowStateSave);
  window.on('resize', scheduleWindowStateSave);
  window.on('maximize', () => persistWindowState(window, role));
  window.on('unmaximize', () => persistWindowState(window, role));
  window.on('close', () => {
    if (saveWindowStateTimeout) {
      clearTimeout(saveWindowStateTimeout);
      saveWindowStateTimeout = undefined;
    }

    persistWindowState(window, role);
  });
}

function getWindowIconPath() {
  if (process.platform === 'darwin') {
    return undefined;
  }

  return app.isPackaged
    ? path.join(process.resourcesPath, WINDOW_ICON_FILE)
    : path.join(__dirname, '..', 'build', WINDOW_ICON_FILE);
}

function getSecondaryWindowState(savedState: WindowState | undefined): WindowState | undefined {
  const focusedWindow = BrowserWindow.getFocusedWindow();

  if (!focusedWindow || focusedWindow.isDestroyed()) {
    return savedState
      ? {
          ...savedState,
          isMaximized: false,
        }
      : undefined;
  }

  const focusedBounds = focusedWindow.isMaximized()
    ? focusedWindow.getNormalBounds()
    : focusedWindow.getBounds();
  const width = savedState?.width ?? Math.max(focusedBounds.width, MIN_WINDOW_WIDTH);
  const height = savedState?.height ?? Math.max(focusedBounds.height, MIN_WINDOW_HEIGHT);
  const candidateBounds = {
    x: focusedBounds.x + NEW_WINDOW_OFFSET_PX,
    y: focusedBounds.y + NEW_WINDOW_OFFSET_PX,
    width,
    height,
  };

  if (!isVisibleOnAnyDisplay(candidateBounds)) {
    return savedState
      ? {
          ...savedState,
          isMaximized: false,
        }
      : undefined;
  }

  return {
    ...candidateBounds,
    isMaximized: false,
  };
}

/**
 * Which geometry a window owns. Read and write must agree on this, or a
 * secondary window saves over the primary's remembered size.
 */
function getWindowStateRole(options: CreateWindowOptions): WindowStateRole {
  return options.startupPayload ||
    options.homeV2Startup ||
    options.placement === 'secondary'
    ? 'secondary'
    : 'primary';
}

function getInitialWindowState(
  options: CreateWindowOptions,
  role: WindowStateRole,
): WindowState | undefined {
  const savedState = initialWindowState(readWindowStates(), role);

  if (role === 'secondary') {
    return getSecondaryWindowState(savedState);
  }

  return savedState;
}

// --- closing the main window ------------------------------------------------
// Home 2 only. What a close does is decided by home-close-behavior.ts; this
// half owns the BrowserWindow calls and the per-window flags that keep the
// confirmed close from re-entering the handler it came from.

/** A quit is under way, so nothing here may keep the app alive. */
let quitRequested = false;
/** Windows this hid rather than closed, and can therefore bring back. */
const hiddenToTrayWindowIds = new Set<number>();
/** Windows whose close the user has already confirmed in the dialog. */
const confirmedCloseWindowIds = new Set<number>();
/** Windows currently showing the close dialog. */
const promptingWindowIds = new Set<number>();

function hideWindowToTray(window: BrowserWindow) {
  hiddenToTrayWindowIds.add(window.id);
  window.hide();
}

/**
 * Brings back a window that close-to-tray hid.
 *
 * A hidden window is still a window, so `window-all-closed` never fires for it
 * and a second launch would otherwise open a duplicate beside the one the user
 * already has. The tray's "Open Qortium Home" already restores hidden windows;
 * this is the same answer for the other two routes back in — launching Home
 * again, and the macOS dock.
 */
function showHiddenHomeWindow(): boolean {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || !hiddenToTrayWindowIds.has(window.id) || window.isVisible()) {
      continue;
    }

    if (window.isMinimized()) window.restore();
    window.show();
    // Same focus-stealing dance as the tray: a show that the user did not
    // click on is demoted to a taskbar flash on X11 and Wayland without it.
    window.moveTop();
    window.focus();
    app.focus({ steal: true });
    return true;
  }

  return false;
}

function installHomeCloseBehavior(window: BrowserWindow, role: WindowStateRole) {
  window.on('show', () => hiddenToTrayWindowIds.delete(window.id));
  window.on('closed', () => {
    hiddenToTrayWindowIds.delete(window.id);
    confirmedCloseWindowIds.delete(window.id);
    promptingWindowIds.delete(window.id);
  });

  window.on('close', (event) => {
    // A dialog is already up for this window. A second close request — another
    // click on the title bar X — must wait for the answer to the first rather
    // than stack a second dialog on top of it.
    if (promptingWindowIds.has(window.id)) {
      event.preventDefault();
      return;
    }

    const behavior = readWindowBehavior();
    const plan = planHomeClose({
      closeToTray: behavior.closeToTray,
      confirmed: confirmedCloseWindowIds.has(window.id),
      quitting: quitRequested,
      role,
      // The last state the renderer saved. A close cannot wait for an answer
      // over IPC, and the renderer saves on every tab change, so this is
      // current except in the moment between opening a tab and that save
      // landing — where it can undercount by one and skip a warning.
      tabCount: homeV2TabCount(readHomeV2ShellState()),
      trayAvailable: getTray() !== null,
      warnOnMultipleTabs: behavior.warnOnCloseWithMultipleTabs,
    });

    if (plan.kind === 'close') {
      return;
    }

    event.preventDefault();

    if (plan.kind === 'hide') {
      hideWindowToTray(window);
      return;
    }

    const promptDialog = plan.dialog;
    promptingWindowIds.add(window.id);
    void dialog
      .showMessageBox(window, {
        buttons: [...promptDialog.buttons],
        cancelId: promptDialog.cancelId,
        checkboxChecked: false,
        checkboxLabel: promptDialog.checkboxLabel,
        defaultId: promptDialog.defaultId,
        detail: promptDialog.detail,
        message: promptDialog.message,
        // Windows renders multiple buttons as command links otherwise, which
        // reads as a wizard rather than as a question about this window.
        noLink: true,
        title: promptDialog.title,
        type: promptDialog.type,
      })
      .then((answer) => {
        promptingWindowIds.delete(window.id);

        const outcome = resolveHomeCloseDialog(promptDialog, answer);

        if (outcome.settings) {
          changeWindowBehavior(outcome.settings);
        }

        if (window.isDestroyed()) {
          return;
        }

        if (outcome.action === 'hide') {
          hideWindowToTray(window);
          return;
        }

        if (outcome.action === 'close') {
          // Marked confirmed first: this close re-enters the handler above,
          // and without the flag it would ask the same question again.
          confirmedCloseWindowIds.add(window.id);
          window.close();
        }
      })
      .catch((error) => {
        promptingWindowIds.delete(window.id);
        // The window stays open. A question that could not be asked must not
        // be answered on the user's behalf.
        console.warn('Home could not ask about closing this window.', error);
      });
  });
}

function zoomFocusedWindow(action: (webContents: WebContents) => void) {
  const window = BrowserWindow.getFocusedWindow();

  if (window) {
    action(window.webContents);
  }
}

// --- Startup timing instrumentation ------------------------------------------
// Logs coarse cold-start milestones to stdout (visible when launched from a
// terminal) so slow-startup reports can be measured instead of guessed. Only the
// first window is instrumented; the renderer reports its own first paint over IPC.
// STARTUP_T0_MS is captured at main-module load — close enough to process start
// for relative milestones.
const STARTUP_T0_MS = Date.now();
let startupTimingCaptured = false;
let startupPaintReported = false;
let homeV2SessionConfigured = false;

// Absolute epoch anchor for t0 (main-module load). Lets an external launcher diff
// its own wall-clock launch time against t0 to measure the pre-t0 boot — process
// spawn + AppImage FUSE mount + Electron binary/V8 init — which the relative
// milestones below (all measured from t0) cannot see.
console.log(`[startup] main module loaded (epoch ${STARTUP_T0_MS}ms, ${new Date(STARTUP_T0_MS).toISOString()})`);

function logStartupMilestone(label: string, extra = '') {
  console.log(`[startup] ${label}: +${Date.now() - STARTUP_T0_MS}ms${extra}`);
}

function instrumentStartupTiming(window: BrowserWindow) {
  if (startupTimingCaptured) {
    return;
  }
  startupTimingCaptured = true;
  logStartupMilestone('first window created');
  window.webContents.once('did-finish-load', () => logStartupMilestone('renderer did-finish-load'));
  window.once('ready-to-show', () => logStartupMilestone('window ready-to-show'));
}

ipcMain.handle('system:reportStartupPaint', (_event, navToPaintMs: unknown) => {
  if (startupPaintReported) {
    return;
  }
  startupPaintReported = true;
  const paint = typeof navToPaintMs === 'number' ? Math.round(navToPaintMs) : 0;
  logStartupMilestone('renderer first paint', ` (renderer nav→paint ${paint}ms)`);
});

function createWindow(options: CreateWindowOptions = {}) {
  const loadRendererFromDist = shouldLoadRendererFromDist();
  const developmentUrl = (
    process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173'
  ).replace(/\/+$/, '');
  const homeV2RendererUrl = IS_HOME_V2
    ? loadRendererFromDist
      ? pathToFileURL(path.join(__dirname, '../dist/v2-live.html')).href
      : `${developmentUrl}/v2-live.html`
    : null;
  const windowStateRole = getWindowStateRole(options);
  const windowState = getInitialWindowState(options, windowStateRole);
  const window = new BrowserWindow({
    width: windowState?.width ?? DEFAULT_WINDOW_WIDTH,
    height: windowState?.height ?? DEFAULT_WINDOW_HEIGHT,
    x: windowState?.x,
    y: windowState?.y,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    autoHideMenuBar: IS_HOME_V2,
    title: 'Qortium Home',
    icon: getWindowIconPath(),
    backgroundColor: '#121515',
    webPreferences: {
      preload: path.join(
        __dirname,
        IS_HOME_V2 ? 'home-v2-live-preload.cjs' : 'preload.cjs',
      ),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: IS_HOME_V2,
      webviewTag: false,
      ...(IS_HOME_V2 ? { partition: HOME_V2_SHELL_PARTITION } : {}),
    },
  });

  if (IS_HOME_V2) {
    registerHomeV2DesktopResourceStreamProtocol(session.fromPartition(HOME_V2_SHELL_PARTITION));
    registerHomeV2CoreDocsProtocol(session.fromPartition(HOME_V2_SHELL_PARTITION));
    authorizeHomeV2Sender(window.webContents, homeV2RendererUrl!);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.webContents.on('will-navigate', (event, targetUrl) => {
      if (targetUrl !== homeV2RendererUrl) event.preventDefault();
    });
    window.webContents.on('will-redirect', (event) => event.preventDefault());

    if (!homeV2SessionConfigured) {
      homeV2SessionConfigured = true;
      const homeV2Session = window.webContents.session;
      homeV2Session.setPermissionCheckHandler(() => false);
      homeV2Session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      homeV2Session.setDevicePermissionHandler(() => false);
      homeV2Session.on('will-download', (event) => event.preventDefault());
      homeV2Session.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
        (_details, callback) => callback({ cancel: true }),
      );
    }
  }

  if (options.startupPayload) {
    // Capture the id now: by the time 'closed' fires the webContents is already
    // destroyed, so reading window.webContents there throws "Object has been
    // destroyed" and surfaces as an uncaught main-process exception.
    const webContentsId = window.webContents.id;
    windowStartupPayloads.set(webContentsId, options.startupPayload);
    window.once('closed', () => {
      windowStartupPayloads.delete(webContentsId);
    });
  }

  if (options.homeV2Startup) {
    // Same capture-the-id rule as above.
    const webContentsId = window.webContents.id;
    homeV2WindowStartups.set(webContentsId, options.homeV2Startup);
    window.once('closed', () => {
      homeV2WindowStartups.delete(webContentsId);
    });
  }

  watchWindowState(window, windowStateRole);

  if (IS_HOME_V2) {
    // Close-to-tray and the multi-tab warning are Home 2 settings, and only
    // Home 2 installs the tray a hidden window would be restored from.
    installHomeCloseBehavior(window, windowStateRole);
  }

  // The tray raises the window the user actually used last, rather than
  // whichever comes first in creation order.
  window.on('focus', () => homeWindowFocus.note(window.id));
  window.on('closed', () => homeWindowFocus.forget(window.id));
  // Deny and forget this window's outstanding app permission prompts.
  //
  // Nothing could approve them once the chrome that renders them is gone, but
  // without this they sat in the pending map until their own 60s timeout, still
  // occupying slots in the per-app and global caps — so closing and reopening
  // windows was a way to keep those ceilings occupied on behalf of windows that
  // no longer exist.
  //
  // 'closed', not 'close': a 'close' can be prevented or diverted to the tray,
  // and the window may well survive it. The id is captured HERE rather than
  // read inside the listener, because by the time 'closed' fires the
  // webContents is destroyed and reading it throws — the same rule the startup
  // payload cleanups above follow.
  const pendingPromptWebContentsId = window.webContents.id;
  window.on('closed', () => forgetHomeV2WindowPendingPrompts(pendingPromptWebContentsId));
  instrumentStartupTiming(window);

  window.on('app-command', (_event, command) => {
    if (command !== 'browser-backward' && command !== 'browser-forward') {
      return;
    }

    // When the Home renderer itself has focus it already handles the mouse
    // back/forward buttons, so forwarding here would step history twice.
    // Forward only when focus is elsewhere (e.g. an embedded QDN view, which
    // swallows the mouse events before the renderer can see them).
    if (window.webContents.isFocused()) {
      return;
    }

    const menuCommand: MenuCommand = command === 'browser-backward' ? 'go-back' : 'go-forward';
    window.webContents.send('menu:command', menuCommand);
  });

  // Native content zoom. We handle this here (rather than relying on the menu
  // accelerators alone) so that Ctrl/Cmd + '=' works WITHOUT requiring Shift,
  // which the accelerator-only approach cannot express. preventDefault() stops
  // the matching menu accelerator from firing too, so zoom never double-steps.
  // Shift is deliberately excluded: Ctrl/Cmd+Shift +/-/0 is reserved for the
  // renderer's text-size shortcut, so we must let those keydowns reach the DOM.
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') {
      return;
    }

    const primaryModifier = process.platform === 'darwin' ? input.meta : input.control;

    if (!primaryModifier || input.alt || input.shift) {
      return;
    }

    const key = input.key;

    if (key === '=' || key === '+' || input.code === 'NumpadAdd') {
      zoomIn(window.webContents);
      event.preventDefault();
      return;
    }

    if (key === '-' || input.code === 'NumpadSubtract') {
      zoomOut(window.webContents);
      event.preventDefault();
      return;
    }

    if (key === '0' || input.code === 'Numpad0') {
      resetZoom(window.webContents);
      event.preventDefault();
    }
  });

  if (windowState?.isMaximized) {
    window.maximize();
  }

  if (loadRendererFromDist) {
    void window.loadFile(
      path.join(
        __dirname,
        IS_HOME_V2 ? '../dist/v2-live.html' : '../dist/index.html',
      ),
    );
  } else {
    void window.loadURL(homeV2RendererUrl ?? developmentUrl);
  }
}

function sendMenuCommand(command: MenuCommand) {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:command', command);
}

const DEFAULT_MENU_LABELS = {
  back: 'Back',
  closeTab: 'Close Tab',
  closeWindow: 'Close Window',
  copy: 'Copy',
  cut: 'Cut',
  edit: 'Edit',
  file: 'File',
  focusAddressBar: 'Focus Address Bar',
  forward: 'Forward',
  minimize: 'Minimize',
  newTab: 'New Tab',
  newWindow: 'New Window',
  paste: 'Paste',
  quit: 'Quit',
  redo: 'Redo',
  reloadTab: 'Reload Tab',
  reopenClosedTab: 'Reopen Closed Tab',
  resetZoom: 'Reset Zoom',
  selectAll: 'Select All',
  toggleFullScreen: 'Toggle Full Screen',
  undo: 'Undo',
  view: 'View',
  window: 'Window',
  zoom: 'Zoom',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
};

type MenuLabels = typeof DEFAULT_MENU_LABELS;

const MENU_LABEL_MAX_LENGTH = 80;

let menuLabels: MenuLabels = { ...DEFAULT_MENU_LABELS };

function sanitizeMenuLabels(value: unknown): Partial<MenuLabels> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const labels: Partial<MenuLabels> = {};

  for (const key of Object.keys(DEFAULT_MENU_LABELS) as (keyof MenuLabels)[]) {
    const label = (value as Record<string, unknown>)[key];

    if (typeof label === 'string' && label.trim() && label.length <= MENU_LABEL_MAX_LENGTH) {
      labels[key] = label.trim();
    }
  }

  return labels;
}

function buildApplicationMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: menuLabels.file,
      submenu: [
        {
          label: menuLabels.newWindow,
          accelerator: 'CommandOrControl+N',
          click: () => createWindow({ placement: 'secondary' }),
        },
        {
          label: menuLabels.newTab,
          accelerator: 'CommandOrControl+T',
          click: () => sendMenuCommand('new-tab'),
        },
        {
          label: menuLabels.reopenClosedTab,
          accelerator: 'CommandOrControl+Shift+T',
          click: () => sendMenuCommand('reopen-closed-tab'),
        },
        { type: 'separator' },
        {
          label: menuLabels.closeTab,
          accelerator: 'CommandOrControl+W',
          click: () => sendMenuCommand('close-tab'),
        },
        {
          label: menuLabels.closeWindow,
          accelerator: 'CommandOrControl+Shift+W',
          click: () => BrowserWindow.getFocusedWindow()?.close(),
        },
        { type: 'separator' },
        { role: 'quit', label: menuLabels.quit },
      ],
    },
    {
      label: menuLabels.edit,
      submenu: [
        { role: 'undo', label: menuLabels.undo },
        { role: 'redo', label: menuLabels.redo },
        { type: 'separator' },
        { role: 'cut', label: menuLabels.cut },
        { role: 'copy', label: menuLabels.copy },
        { role: 'paste', label: menuLabels.paste },
        { role: 'selectAll', label: menuLabels.selectAll },
      ],
    },
    {
      label: menuLabels.view,
      submenu: [
        {
          label: menuLabels.back,
          accelerator: 'Alt+Left',
          click: () => sendMenuCommand('go-back'),
        },
        {
          label: menuLabels.forward,
          accelerator: 'Alt+Right',
          click: () => sendMenuCommand('go-forward'),
        },
        {
          label: menuLabels.reloadTab,
          accelerator: 'CommandOrControl+R',
          click: () => sendMenuCommand('reload-tab'),
        },
        {
          label: menuLabels.focusAddressBar,
          accelerator: 'CommandOrControl+L',
          click: () => sendMenuCommand('focus-address-bar'),
        },
        { type: 'separator' },
        {
          label: menuLabels.zoomIn,
          accelerator: 'CommandOrControl+Plus',
          click: () => zoomFocusedWindow(zoomIn),
        },
        {
          label: menuLabels.zoomOut,
          accelerator: 'CommandOrControl+-',
          click: () => zoomFocusedWindow(zoomOut),
        },
        {
          label: menuLabels.resetZoom,
          accelerator: 'CommandOrControl+0',
          click: () => zoomFocusedWindow(resetZoom),
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: menuLabels.toggleFullScreen },
      ],
    },
    {
      label: menuLabels.window,
      submenu: [
        { role: 'minimize', label: menuLabels.minimize },
        ...(process.platform === 'darwin'
          ? ([
              { role: 'zoom', label: menuLabels.zoom },
              { type: 'separator' },
              { role: 'front' },
            ] satisfies MenuItemConstructorOptions[])
          : []),
      ],
    },
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerMenuIpcHandlers() {
  ipcMain.handle('menu:setLabels', (_event, request: unknown) => {
    const labels = sanitizeMenuLabels(
      request && typeof request === 'object' ? (request as { labels?: unknown }).labels : null,
    );

    menuLabels = { ...menuLabels, ...labels };
    buildApplicationMenu();
  });
}

function registerHomeV2ZoomIpcHandlers() {
  // Narrow Home 2 surface: the shell renderer can only step its own window's
  // zoom (Ctrl+wheel over shell-owned surfaces); no absolute set is exposed.
  // Absolute set backs the Appearance "app zoom" setting. Native zoom is used
  // rather than CSS `zoom` because `100vh` is not zoom-aware: inside a
  // CSS-zoomed shell the viewport math overflowed the window (measured: 841px
  // of content in a 720px window at 120%), cutting off the chrome and the
  // bottom of the open app.
  ipcMain.handle('home-v2-zoom:set', (event, percent: unknown) => {
    assertAuthorizedHomeV2Sender(event);

    if (typeof percent !== 'number' || !Number.isFinite(percent)) {
      throw new Error('Zoom percent must be a finite number.');
    }

    // No zoom:changed echo to the requester: it already knows the value it
    // asked for, and echoing renderer-originated sets can oscillate.
    return setZoomPercent(event.sender, percent, false);
  });

  ipcMain.handle('home-v2-zoom:step', (event, direction: unknown) => {
    assertAuthorizedHomeV2Sender(event);

    if (direction === 'in') {
      zoomIn(event.sender);
    } else if (direction === 'out') {
      zoomOut(event.sender);
    } else {
      throw new Error('Unknown zoom step direction.');
    }
  });
}

function registerHomeV2ShellClipboardIpcHandlers() {
  // Narrow Home 2 surface: write a short string to the system clipboard, and
  // nothing else - no read, no formats, no images. The shell renderer cannot
  // use navigator.clipboard at all because its session denies every permission
  // request, so its copy actions arrive here instead. App views already copy
  // through main the same way (home-v2-app-bridge.ts).
  ipcMain.handle('home-v2-shell:copy-text', (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event);
    clipboard.writeText(assertHomeV2ShellClipboardText(value));
  });
}

function registerZoomIpcHandlers() {
  ipcMain.handle('zoom:get', (event) => getZoomPercent(event.sender));

  ipcMain.handle('zoom:set', (event, percent: unknown) => {
    if (typeof percent !== 'number') {
      throw new Error('Zoom percent must be a number.');
    }

    // No zoom:changed echo back to the requester: it learns the applied
    // percent from this return value. Echoing renderer-originated sets can
    // oscillate against the renderer's appZoom effect.
    return setZoomPercent(event.sender, percent, false);
  });
}

/**
 * Home 2's window channels. The legacy `windows:*` handlers stay v1-only:
 * their payload is a route-history snapshot, and Home 2 needs nothing but an
 * address. Kept separate so neither shell can be handed the other's shape.
 */
function registerHomeV2WindowIpcHandlers() {
  ipcMain.handle('home-v2-windows:getStartup', (event) => {
    assertAuthorizedHomeV2Sender(event);

    const payload = homeV2WindowStartups.get(event.sender.id) ?? null;

    // One-shot: a reload must not reopen the detached tab a second time.
    homeV2WindowStartups.delete(event.sender.id);

    return payload;
  });

  ipcMain.handle('home-v2-windows:openTab', (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event);

    createWindow({
      homeV2Startup: { address: sanitizeHomeV2WindowAddress(value) },
      placement: 'secondary',
    });
  });

  // The two app-level window settings. They are main's to own — the renderer
  // is not on screen at the moment a close has to be decided — so Settings
  // reads and writes them here rather than keeping its own copy.
  ipcMain.handle('home-v2-windows:getBehavior', (event) => {
    assertAuthorizedHomeV2Sender(event);

    return readWindowBehavior();
  });

  // Returns the settings as they now stand, so the caller never has to guess
  // what its own change produced. Not broadcast: a second window reads the
  // stored value when its Settings page next opens.
  ipcMain.handle('home-v2-windows:setBehavior', (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event);

    return changeWindowBehavior(parseHomeWindowBehaviorPatch(value));
  });
}

function registerWindowIpcHandlers() {
  ipcMain.handle('windows:getStartupPayload', (event) => {
    return windowStartupPayloads.get(event.sender.id) ?? null;
  });

  ipcMain.handle('windows:openTabInNewWindow', (_event, request: unknown) => {
    const startupPayload = sanitizeWindowStartupPayload(request);

    createWindow({ startupPayload });
  });

  ipcMain.handle('windows:openDashboardWindow', () => {
    createWindow({ placement: 'secondary' });
  });

  ipcMain.handle('windows:closeCurrentWindow', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}

// Reconcile Home's current-process i2pd supervision with Core on launch. When
// Core is running with I2P enabled, start the strict managed generation only if
// no SAM router is already present. Otherwise stop only the child retained by
// this Home process. A router surviving another Home process is treated as
// external and is never adopted or signalled. Best-effort: I2P is a fallback.
async function reconcileI2pdWithCore(): Promise<void> {
  try {
    if (await isManagedCoreUsingI2p()) {
      await startI2pdIfManaged();
    } else {
      await stopI2pdIfManaged();
    }
  } catch {
    // Never block startup on the I2P fallback.
  }
}

// Home keeps all its state in one fixed userData directory and manages shared
// singletons (the i2pd router, Core). A second launch must not spin up a rival
// process tree fighting over that state — take a single-instance lock and, if
// another instance already holds it, surface that instance's window and exit.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  // Launching Home again while it sits in the tray means "give me Home back",
  // not "give me a second one" — so restore the hidden window first.
  if (showHiddenHomeWindow()) {
    return;
  }

  // Keep a single process / userData owner, but let a relaunch open another
  // window (offset from the focused one) within this instance.
  createWindow({ placement: 'secondary' });
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) {
    return;
  }

  logStartupMilestone('main process ready');
  installNodeTlsForDefaultSessions();
  registerProductionCoreManagerEntries();

  if (IS_HOME_V2) {
    disableLegacyCoreManagerRendererEvents();
    disableLegacyI2pdRendererEvents();
    registerAccountIpcHandlers();
    registerHomeV2NodeBridgeIpcHandlers();
    registerHomeV2NodeAdminIpcHandlers();
    // Move any legacy plaintext custom-node API key into protected storage
    // before anything can read or send it from the settings file.
    try {
      migrateHomeV2LegacyCustomNodeKey();
    } catch (error) {
      console.warn('[home-v2] Unable to migrate a legacy custom-node API key:', error);
    }
    registerHomeV2CoreManagerBridgeIpcHandlers();
    registerHomeV2AppUpdateBridgeIpcHandlers();
    registerHomeV2ReleaseNotesBridgeIpcHandlers();
    registerHomeV2QdnSettingsBridgeIpcHandlers();
    registerHomeV2CollectionsBridgeIpcHandlers();
    registerHomeV2CoreDocsBridgeIpcHandlers();
    registerHomeV2RetainedViewerBridgeIpcHandlers();
    // Initialize the authoritative notification gate before registering the
    // app bridge or creating any trusted shell window.
    await registerHomeV2NotificationPolicyBridgeIpcHandlers();
    registerHomeV2AppBridgeIpcHandlers();
    registerQdnViewIpcHandlers();
    registerHomeV2ZoomIpcHandlers();
    registerHomeV2ShellClipboardIpcHandlers();
    registerHomeV2WindowIpcHandlers();
    // The application menu is what carries the browser keyboard accelerators
    // (new/close/reopen tab, back/forward, reload, focus address bar). Home 2
    // windows keep the menu BAR hidden (autoHideMenuBar) so only the
    // accelerators — and Alt to peek at the menu — are user-visible.
    buildApplicationMenu();
    // Widgets outlive main Home windows, so Home can end up running with
    // nothing on screen. The tray is what makes that state visible, and it is
    // the only route to closing a widget whose app never painted.
    installTray({ openHome: ({ placement }) => createWindow({ placement }) });
    try {
      ensureHomeV2ProfileBackup();
      autoUnlockHomeV2SelectedAccount();
    } catch (error) {
      console.error('Home 2.0 profile backup or account auto-unlock was unavailable.', error);
    }
    createWindow();
    // Home 2 uses the same host-owned Qortium Core/i2pd lifecycle as the legacy
    // shell. Reconcile once after the production managers are registered; the
    // Home 2 bridge remains invoke-only and does not re-enable legacy events.
    void reconcileI2pdWithCore();
    app.on('activate', () => {
      // A window hidden to the tray still counts as open, so the length test
      // below would leave the dock icon doing nothing at all.
      if (showHiddenHomeWindow()) return;
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    return;
  }
  prewarmRunningCoreApiKeyCache();
  registerAccountIpcHandlers();
  registerAppUpdateIpcHandlers();
  registerCoreManagerIpcHandlers();
  registerI2pdManagerIpcHandlers();
  registerNodeSettingsIpcHandlers();
  registerNotificationStoreIpcHandlers();
  registerQdnManagerPermissionStoreIpcHandlers();
  registerQdnIpcHandlers();
  registerQdnViewIpcHandlers();
  registerMenuIpcHandlers();
  registerSystemIpcHandlers();
  registerWindowIpcHandlers();
  registerZoomIpcHandlers();
  buildApplicationMenu();
  createWindow();
  startNotificationWatcher();

  // Bring the managed i2pd router in line with Core's current state (e.g. adopt a
  // router that survived a previous Home session, or clean up an orphan).
  void reconcileI2pdWithCore();

  // Collect preview staging dirs a crashed/killed session left in the OS temp
  // dir. Safe here: the single-instance lock is held, so they cannot be in use.
  void sweepOrphanedQdnPreviewStagingDirs();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  cleanupQdnPreviewStagingDirs();
  // A tray left behind outlives its process on Windows and leaves a dead icon
  // in the notification area until the user hovers over it.
  destroyTray();
});

app.on('window-all-closed', () => {
  // A widget is a real BrowserWindow, so this does not fire while one is open.
  // That is deliberate: widgets outlive main Home windows, which is what keeps
  // a floating player running after you close Home. It also means Home can sit
  // running with no main window, a state it never had before, and the tray
  // installed at startup is what makes that state visible and exitable.
  //
  // Close-to-tray reaches the same state by a different route and relies on
  // the same fact: a hidden window has not been closed, so this does not fire
  // for it and Home keeps running with nothing on screen.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Never intentionally lose the ChildProcess authority needed to stop Home's
// router safely. A normal quit therefore stops only the live child retained by
// this process, even when Core remains running; the next Home launch can start
// the strict managed generation again. A router left by a crash is treated as
// external rather than adopted from mutable PID evidence.
let i2pdShutdownComplete = false;
app.on('before-quit', (event) => {
  // First, before anything can cancel the quit: from here on a window close is
  // a real close. Without this, close-to-tray would hide the window Quit just
  // asked to close and the app could never exit from its own tray menu.
  quitRequested = true;

  // A redundant second instance (no lock) never started the shared i2pd/Core, so
  // it must quit immediately without touching them. Same once shutdown has run.
  if (!gotSingleInstanceLock || i2pdShutdownComplete) {
    return;
  }

  event.preventDefault();
  void (async () => {
    try {
      // The manager has its own bounded SIGTERM wait. Await it in full so the
      // app never discards the only safe ChildProcess authority at a shorter
      // outer timeout.
      await stopI2pdForAppQuit();
    } catch {
      // Keep Home alive with its ChildProcess authority intact. A later quit
      // retries the bounded stop; force termination remains the user's explicit
      // escape hatch if the child cannot be stopped.
      //
      // The quit is off, so the flag has to come off with it: Home is running
      // again, and its windows should behave the way the settings say.
      quitRequested = false;
      console.error('Home could not confirm that its managed i2pd child stopped; quit was cancelled.');
      return;
    }
    i2pdShutdownComplete = true;
    app.quit();
  })();
});
