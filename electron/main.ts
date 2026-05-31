import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  type MenuItemConstructorOptions,
  type Rectangle,
} from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAccountIpcHandlers } from './accounts.js';
import { registerAppUpdateIpcHandlers } from './app-updates.js';
import { registerCoreManagerIpcHandlers } from './core-manager.js';
import { registerNodeSettingsIpcHandlers } from './node-settings.js';
import { registerQdnIpcHandlers } from './qdn.js';
import { registerQdnViewIpcHandlers } from './qdn-views.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WINDOW_WIDTH = 1100;
const DEFAULT_WINDOW_HEIGHT = 720;
const MIN_WINDOW_WIDTH = 720;
const MIN_WINDOW_HEIGHT = 480;
const WINDOW_STATE_FILE = 'window-state.json';
const WINDOW_STATE_SAVE_DELAY_MS = 250;
const WINDOW_ICON_FILE = 'icon.png';
const NEW_WINDOW_OFFSET_PX = 32;

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
    windowStartupPayloads.set(window.webContents.id, options.startupPayload);
    window.once('closed', () => {
      windowStartupPayloads.delete(window.webContents.id);
    });
  }

  watchWindowState(window);

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

function buildApplicationMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CommandOrControl+N',
          click: () => createWindow({ placement: 'secondary' }),
        },
        {
          label: 'New Tab',
          accelerator: 'CommandOrControl+T',
          click: () => sendMenuCommand('new-tab'),
        },
        {
          label: 'Reopen Closed Tab',
          accelerator: 'CommandOrControl+Shift+T',
          click: () => sendMenuCommand('reopen-closed-tab'),
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CommandOrControl+W',
          click: () => sendMenuCommand('close-tab'),
        },
        {
          label: 'Close Window',
          accelerator: 'CommandOrControl+Shift+W',
          click: () => BrowserWindow.getFocusedWindow()?.close(),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Back',
          accelerator: 'Alt+Left',
          click: () => sendMenuCommand('go-back'),
        },
        {
          label: 'Forward',
          accelerator: 'Alt+Right',
          click: () => sendMenuCommand('go-forward'),
        },
        {
          label: 'Reload Tab',
          accelerator: 'CommandOrControl+R',
          click: () => sendMenuCommand('reload-tab'),
        },
        {
          label: 'Focus Address Bar',
          accelerator: 'CommandOrControl+L',
          click: () => sendMenuCommand('focus-address-bar'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? ([
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

app.whenReady().then(() => {
  registerAccountIpcHandlers();
  registerAppUpdateIpcHandlers();
  registerCoreManagerIpcHandlers();
  registerNodeSettingsIpcHandlers();
  registerQdnIpcHandlers();
  registerQdnViewIpcHandlers();
  registerWindowIpcHandlers();
  buildApplicationMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
