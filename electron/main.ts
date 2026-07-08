import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  type MenuItemConstructorOptions,
  type Rectangle,
  type WebContents,
} from 'electron';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAccountIpcHandlers } from './accounts.js';
import { registerAppUpdateIpcHandlers } from './app-updates.js';
import {
  isManagedCoreRuntimeRunning,
  isManagedCoreUsingI2p,
  registerCoreManagerIpcHandlers,
} from './core-manager.js';
import {
  registerI2pdManagerIpcHandlers,
  startIfManaged as startI2pdIfManaged,
  stopIfManaged as stopI2pdIfManaged,
} from './i2pd-manager.js';
import { registerNodeSettingsIpcHandlers } from './node-settings.js';
import {
  cleanupQdnPreviewStagingDirs,
  registerQdnIpcHandlers,
  sweepOrphanedQdnPreviewStagingDirs,
} from './qdn.js';
import { registerQdnViewIpcHandlers, syncQdnViewsForWindowZoom } from './qdn-views.js';
import { installNodeTlsForDefaultSessions } from './node-tls.js';
import { registerSystemIpcHandlers } from './system.js';
import { getZoomPercent, initZoom, resetZoom, setZoomPercent, zoomIn, zoomOut } from './zoom.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WINDOW_WIDTH = 1100;
const DEFAULT_WINDOW_HEIGHT = 720;
const MIN_WINDOW_WIDTH = 720;
const MIN_WINDOW_HEIGHT = 480;
const WINDOW_STATE_FILE = 'window-state.json';
const WINDOW_STATE_SAVE_DELAY_MS = 250;
const WINDOW_ICON_FILE = 'icon.png';
const NEW_WINDOW_OFFSET_PX = 32;
const USER_DATA_DIR_NAME = 'qortium-home';
const USER_DATA_DIR_OVERRIDE = process.env.QORTIUM_HOME_USER_DATA_DIR?.trim();

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

type CreateWindowOptions = {
  placement?: 'primary' | 'secondary';
  startupPayload?: WindowStartupPayload;
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

function readWindowState(): WindowState | undefined {
  try {
    const parsedState: unknown = JSON.parse(readFileSync(getWindowStatePath(), 'utf8'));

    if (!parsedState || typeof parsedState !== 'object') {
      return undefined;
    }

    const state = parsedState as Partial<WindowState>;
    const width = isFiniteNumber(state.width)
      ? Math.max(Math.round(state.width), MIN_WINDOW_WIDTH)
      : DEFAULT_WINDOW_WIDTH;
    const height = isFiniteNumber(state.height)
      ? Math.max(Math.round(state.height), MIN_WINDOW_HEIGHT)
      : DEFAULT_WINDOW_HEIGHT;
    const nextState: WindowState = {
      width,
      height,
      isMaximized: state.isMaximized === true,
    };

    if (isFiniteNumber(state.x) && isFiniteNumber(state.y)) {
      const candidateBounds = {
        x: Math.round(state.x),
        y: Math.round(state.y),
        width,
        height,
      };

      if (isVisibleOnAnyDisplay(candidateBounds)) {
        nextState.x = candidateBounds.x;
        nextState.y = candidateBounds.y;
      }
    }

    return nextState;
  } catch {
    return undefined;
  }
}

function writeWindowState(state: WindowState) {
  const statePath = getWindowStatePath();

  try {
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.warn('Unable to save window state.', error);
  }
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

function persistWindowState(window: BrowserWindow) {
  if (!window.isDestroyed()) {
    writeWindowState(getCurrentWindowState(window));
  }
}

function watchWindowState(window: BrowserWindow) {
  let saveWindowStateTimeout: NodeJS.Timeout | undefined;

  function scheduleWindowStateSave() {
    if (saveWindowStateTimeout) {
      clearTimeout(saveWindowStateTimeout);
    }

    saveWindowStateTimeout = setTimeout(() => {
      persistWindowState(window);
      saveWindowStateTimeout = undefined;
    }, WINDOW_STATE_SAVE_DELAY_MS);
  }

  window.on('move', scheduleWindowStateSave);
  window.on('resize', scheduleWindowStateSave);
  window.on('maximize', () => persistWindowState(window));
  window.on('unmaximize', () => persistWindowState(window));
  window.on('close', () => {
    if (saveWindowStateTimeout) {
      clearTimeout(saveWindowStateTimeout);
      saveWindowStateTimeout = undefined;
    }

    persistWindowState(window);
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

function getInitialWindowState(options: CreateWindowOptions): WindowState | undefined {
  const savedState = readWindowState();

  if (options.startupPayload || options.placement === 'secondary') {
    return getSecondaryWindowState(savedState);
  }

  return savedState;
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
  const windowState = getInitialWindowState(options);
  const window = new BrowserWindow({
    width: windowState?.width ?? DEFAULT_WINDOW_WIDTH,
    height: windowState?.height ?? DEFAULT_WINDOW_HEIGHT,
    x: windowState?.x,
    y: windowState?.y,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: 'Qortium Home',
    icon: getWindowIconPath(),
    backgroundColor: '#121515',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

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

  watchWindowState(window);
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

  if (app.isPackaged) {
    void window.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173');
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

// Reconcile the managed i2pd router with Core on launch, enforcing the invariant
// "i2pd runs iff Core is running and I2P is enabled". This self-heals a router
// left over from a previous session: if Core is up and using I2P we (re)start /
// re-adopt it; otherwise we stop an orphan that outlived a Core shutdown that
// happened while Home was closed. Best-effort — I2P is only a fallback transport.
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
  // Keep a single process / userData owner, but let a relaunch open another
  // window (offset from the focused one) within this instance.
  createWindow({ placement: 'secondary' });
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) {
    return;
  }

  logStartupMilestone('main process ready');
  installNodeTlsForDefaultSessions();
  registerAccountIpcHandlers();
  registerAppUpdateIpcHandlers();
  registerCoreManagerIpcHandlers();
  registerI2pdManagerIpcHandlers();
  registerNodeSettingsIpcHandlers();
  registerQdnIpcHandlers();
  registerQdnViewIpcHandlers();
  registerMenuIpcHandlers();
  registerSystemIpcHandlers();
  registerWindowIpcHandlers();
  registerZoomIpcHandlers();
  buildApplicationMenu();
  createWindow();

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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// The managed i2pd router tracks Core's lifetime, not Home's window. Core is
// designed to keep running after Home closes, so on quit we stop i2pd ONLY when
// Core is also stopped — otherwise we'd strand a still-running Core without its
// I2P fallback transport. When we leave i2pd running, the detached router holds
// the SAM port for Core and the next Home launch reconciles it (see app.whenReady
// below). Defer the quit until this check runs.
const QUIT_I2PD_SHUTDOWN_TIMEOUT_MS = 4000;
let i2pdShutdownComplete = false;
app.on('before-quit', (event) => {
  // A redundant second instance (no lock) never started the shared i2pd/Core, so
  // it must quit immediately without touching them. Same once shutdown has run.
  if (!gotSingleInstanceLock || i2pdShutdownComplete) {
    return;
  }

  event.preventDefault();
  void (async () => {
    try {
      // Bound the shutdown so a hung i2pd/Core check can never block the quit and
      // leave the user force-killing the app — which is what orphans the helper
      // processes and the AppImage FUSE mount in the first place.
      await Promise.race([
        (async () => {
          if (!(await isManagedCoreRuntimeRunning())) {
            await stopI2pdIfManaged();
          }
        })(),
        new Promise<void>((resolve) => {
          setTimeout(resolve, QUIT_I2PD_SHUTDOWN_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // Quit regardless of any i2pd shutdown error.
    } finally {
      i2pdShutdownComplete = true;
      app.quit();
    }
  })();
});
