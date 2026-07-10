import { app, BrowserWindow, Notification } from 'electron';
import { appendFileSync } from 'node:fs';
import { getActiveAccountAddress, onActiveAccountChanged } from './accounts.js';
import { getNodeConnection, onNodeSettingsChanged } from './node-settings.js';
import {
  getQdnNotificationDefaultTitle,
  toWireNotificationSubscription,
  type StoredQdnNotificationRule,
} from './notification-rules.js';
import { onNotificationStoreChanged, readNotificationStore } from './notification-store.js';
import {
  areQdnAppNotificationsEnabled,
  consumeQdnAppNotificationRateLimit,
  getQdnAppDisplayNameFromResourceUrl,
} from './qdn.js';
import { isQdnAppResourceFocused } from './qdn-views.js';

const RECONNECT_MIN_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;

type NotificationMessage = {
  appName?: string;
  event?: string;
  notificationId?: string;
  type: 'notification';
};

let socket: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectDelay = RECONNECT_MIN_MS;
let generation = 0;
let lastFocusedWindow: BrowserWindow | null = null;

function smokeLog(status: 'FIRED' | 'SUPPRESSED', appKey: string, rule: StoredQdnNotificationRule, reason?: string) {
  const logPath = process.env.QORTIUM_HOME_NOTIFICATION_SMOKE_LOG;
  if (!logPath) return;
  appendFileSync(logPath, `${JSON.stringify({ status, appKey, notificationId: rule.notificationId, event: rule.event, ...(reason ? { reason } : {}) })}\n`, 'utf8');
}

function getEligibleRules() {
  const address = getActiveAccountAddress();
  const store = readNotificationStore();
  return Object.entries(store.rules).flatMap(([appKey, rules]) =>
    store.grants[appKey]
      ? rules.filter((rule) => rule.accountAddress === address).map((rule) => ({ appKey, rule }))
      : [],
  );
}

function toWebSocketUrl(nodeApiUrl: string) {
  const url = new URL(nodeApiUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/websockets/notifications';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function sendSubscriptions() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const eligible = getEligibleRules();
  if (!eligible.length) {
    socket.close();
    socket = null;
    return;
  }
  socket.send(JSON.stringify({ action: 'unsubscribe' }));
  socket.send(JSON.stringify({
    action: 'subscribe',
    address: getActiveAccountAddress(),
    subscriptions: eligible.map(({ appKey, rule }) => toWireNotificationSubscription(appKey, rule)),
  }));
}

function findRule(message: NotificationMessage) {
  const candidates = getEligibleRules().filter(({ appKey, rule }) =>
    rule.notificationId === message.notificationId &&
    message.appName === appKey &&
    message.event === rule.event,
  );
  return candidates.length === 1 ? candidates[0] : null;
}

function hasCurrentRule(appKey: string, rule: StoredQdnNotificationRule) {
  return (readNotificationStore().rules[appKey] ?? []).some((candidate) =>
    candidate.notificationId === rule.notificationId &&
    candidate.event === rule.event &&
    candidate.accountAddress === rule.accountAddress &&
    candidate.createdAt === rule.createdAt &&
    candidate.link === rule.link &&
    candidate.text === rule.text &&
    candidate.title === rule.title &&
    JSON.stringify(candidate.filters) === JSON.stringify(rule.filters),
  );
}

function suppress(appKey: string, rule: StoredQdnNotificationRule, reason: string) {
  smokeLog('SUPPRESSED', appKey, rule, reason);
}

function handleNotificationMessage(message: NotificationMessage) {
  const match = findRule(message);
  if (!match) return;
  const { appKey, rule } = match;
  const grant = readNotificationStore().grants[appKey];
  if (!areQdnAppNotificationsEnabled()) return suppress(appKey, rule, 'disabled');
  if (!grant) return suppress(appKey, rule, 'revoked');
  if (grant.muted) return suppress(appKey, rule, 'muted');
  if (!consumeQdnAppNotificationRateLimit(appKey)) return suppress(appKey, rule, 'rate-limited');
  if (isQdnAppResourceFocused(appKey)) return suppress(appKey, rule, 'focused');
  if (!Notification.isSupported()) return suppress(appKey, rule, 'unsupported');

  const notification = new Notification({
    body: rule.text ?? '',
    title: `${rule.title ?? getQdnNotificationDefaultTitle(rule.event)} — ${getQdnAppDisplayNameFromResourceUrl(appKey)}`,
  });
  notification.on('click', () => {
    const window = BrowserWindow.getFocusedWindow() ??
      (lastFocusedWindow && !lastFocusedWindow.isDestroyed() ? lastFocusedWindow : null) ??
      BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    window.webContents.send('qdn-app:open-new-tab', { address: rule.link ?? appKey, sourceTabId: null });
  });

  const latestGrant = readNotificationStore().grants[appKey];
  if (!latestGrant) return suppress(appKey, rule, 'revoked');
  if (latestGrant.muted) return suppress(appKey, rule, 'muted');
  if (!areQdnAppNotificationsEnabled()) return suppress(appKey, rule, 'disabled');
  if (!hasCurrentRule(appKey, rule)) return suppress(appKey, rule, 'removed');

  notification.show();
  smokeLog('FIRED', appKey, rule);
}

function scheduleReconnect(expectedGeneration: number) {
  if (expectedGeneration !== generation || reconnectTimer || !getEligibleRules().length) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect(expectedGeneration);
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

async function connect(expectedGeneration = generation) {
  if (expectedGeneration !== generation || socket || !getEligibleRules().length) return;
  try {
    const { nodeApiUrl } = await getNodeConnection();
    if (expectedGeneration !== generation) return;
    // A wss node using its own private CA may not be accepted by Node's global
    // WebSocket client; v1 intentionally does not add custom TLS plumbing.
    const nextSocket = new WebSocket(toWebSocketUrl(nodeApiUrl));
    socket = nextSocket;
    nextSocket.addEventListener('open', () => {
      if (socket !== nextSocket) return;
      reconnectDelay = RECONNECT_MIN_MS;
      sendSubscriptions();
    });
    nextSocket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as unknown;
        if (message && typeof message === 'object' && (message as { type?: unknown }).type === 'notification') {
          handleNotificationMessage(message as NotificationMessage);
        }
      } catch {
        // Unknown and non-JSON server messages are intentionally ignored.
      }
    });
    const disconnected = () => {
      if (socket === nextSocket) socket = null;
      scheduleReconnect(expectedGeneration);
    };
    nextSocket.addEventListener('close', disconnected);
    nextSocket.addEventListener('error', () => nextSocket.close());
  } catch (error) {
    console.warn('Unable to connect notification watcher.', error);
    scheduleReconnect(expectedGeneration);
  }
}

function refresh(reconnect = false) {
  if (reconnect) {
    generation += 1;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    socket?.close();
    socket = null;
  }
  if (!getEligibleRules().length) {
    socket?.close();
    socket = null;
    return;
  }
  if (socket?.readyState === WebSocket.OPEN) sendSubscriptions();
  else void connect();
}

export function startNotificationWatcher() {
  lastFocusedWindow = BrowserWindow.getFocusedWindow();
  app.on('browser-window-focus', (_event, window) => {
    lastFocusedWindow = window;
  });
  onNotificationStoreChanged(() => refresh());
  onActiveAccountChanged(() => refresh());
  onNodeSettingsChanged(() => refresh(true));
  refresh();
}
