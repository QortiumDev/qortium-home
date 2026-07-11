import { Capacitor } from '@capacitor/core';
import {
  getQdnNotificationDefaultBody,
  getQdnNotificationDefaultTitle,
  matchesQdnNotificationRuleData,
  toWireNotificationSubscription,
  type StoredQdnNotificationRule,
} from '../electron/notification-rules';
import { loadDisplaySettings } from './displaySettings';
import { getNotificationStore, onNotificationStoreChanged } from './notificationStore';

type WatcherOptions = {
  activeAccountAddress: string;
  isAppFocused: (appKey: string) => boolean;
  nodeApiUrl: string;
  onOpenLink: (address: string) => void;
};

const lastNotificationAt = new Map<string, number>();
const notificationLinks = new Map<number, string>();
let nextNotificationId = 10_000;

function getDisplayName(appKey: string) {
  const match = /^qdn:\/\/[^/]+\/([^/]+)/i.exec(appKey);
  if (!match) return appKey || 'QDN app';
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

function toWebSocketUrl(nodeApiUrl: string) {
  const url = new URL(nodeApiUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/websockets/notifications';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function startForegroundNotificationWatcher(options: WatcherOptions) {
  let socket: WebSocket | null = null;
  let stopped = false;
  let reconnectTimer: number | null = null;
  let reconnectDelay = 5_000;
  let subscriptionRevision = 0;
  let removeStoreListener: (() => void) | null = null;
  let removeActionListener: (() => Promise<void>) | null = null;
  let disposed = false;

  const eligibleRules = async () => {
    const store = await getNotificationStore();
    return Object.entries(store.rules).flatMap(([appKey, rules]) =>
      store.grants[appKey]
        ? rules.filter((rule) => rule.accountAddress === options.activeAccountAddress).map((rule) => ({ appKey, rule }))
        : [],
    );
  };

  const sendSubscriptions = async () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const revision = ++subscriptionRevision;
    const eligible = await eligibleRules();
    if (stopped || revision !== subscriptionRevision || !socket || socket.readyState !== WebSocket.OPEN) return;
    if (!eligible.length) {
      socket.close();
      return;
    }
    socket.send(JSON.stringify({ action: 'unsubscribe' }));
    socket.send(JSON.stringify({
      action: 'subscribe',
      address: options.activeAccountAddress,
      subscriptions: eligible.map(({ appKey, rule }) => toWireNotificationSubscription(appKey, rule)),
    }));
  };

  const hasCurrentRule = (
    store: Awaited<ReturnType<typeof getNotificationStore>>,
    appKey: string,
    rule: StoredQdnNotificationRule,
  ) => (store.rules[appKey] ?? []).some((candidate) =>
    candidate.notificationId === rule.notificationId &&
    candidate.event === rule.event &&
    candidate.accountAddress === rule.accountAddress &&
    candidate.createdAt === rule.createdAt &&
    candidate.link === rule.link &&
    candidate.text === rule.text &&
    candidate.title === rule.title &&
    JSON.stringify(candidate.filters) === JSON.stringify(rule.filters),
  );

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer !== null) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
  };

  const fire = async (appKey: string, rule: StoredQdnNotificationRule, data?: Record<string, unknown>) => {
    const store = await getNotificationStore();
    const grant = store.grants[appKey];
    if (!(await loadDisplaySettings()).appNotifications || !grant || grant.muted) return;
    const now = Date.now();
    if (now - (lastNotificationAt.get(appKey) ?? 0) < 3_000) return;
    lastNotificationAt.set(appKey, now);
    if (options.isAppFocused(appKey)) return;

    const title = `${rule.title ?? getQdnNotificationDefaultTitle(rule.event)} — ${getDisplayName(appKey)}`;
    if (Capacitor.isNativePlatform()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const permission = await LocalNotifications.requestPermissions();
      if (permission.display !== 'granted') return;
      const [latestStore, enabled] = await Promise.all([
        getNotificationStore(),
        loadDisplaySettings().then((settings) => settings.appNotifications),
      ]);
      const latestGrant = latestStore.grants[appKey];
      if (!latestGrant || latestGrant.muted || !enabled || !hasCurrentRule(latestStore, appKey, rule)) return;
      const id = nextNotificationId++;
      notificationLinks.set(id, rule.link ?? appKey);
      await LocalNotifications.schedule({ notifications: [{ id, title, body: rule.text ?? getQdnNotificationDefaultBody(rule, data) ?? '' }] });
    } else if (typeof window.Notification === 'function' && window.Notification.permission === 'granted') {
      const [latestStore, enabled] = await Promise.all([
        getNotificationStore(),
        loadDisplaySettings().then((settings) => settings.appNotifications),
      ]);
      const latestGrant = latestStore.grants[appKey];
      if (!latestGrant || latestGrant.muted || !enabled || !hasCurrentRule(latestStore, appKey, rule)) return;
      new window.Notification(title, { body: rule.text ?? getQdnNotificationDefaultBody(rule, data) ?? '' });
    }
  };

  const connect = async () => {
    if (stopped || socket || !(await eligibleRules()).length) return;
    try {
      const next = new WebSocket(toWebSocketUrl(options.nodeApiUrl));
      socket = next;
      next.addEventListener('open', () => {
        reconnectDelay = 5_000;
        void sendSubscriptions();
      });
      next.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data)) as {
            appName?: string;
            data?: Record<string, unknown>;
            event?: string;
            notificationId?: string;
            type?: string;
          };
          if (message.type !== 'notification' || !message.notificationId) return;
          void eligibleRules().then((eligible) => {
            const matches = eligible.filter(({ appKey, rule }) =>
              rule.notificationId === message.notificationId &&
              message.appName === appKey &&
              message.event === rule.event);
            if (matches.length === 1 && matchesQdnNotificationRuleData(matches[0].rule, message.data)) {
              void fire(matches[0].appKey, matches[0].rule, message.data);
            }
          });
        } catch {
          // Unknown node messages are ignored.
        }
      });
      next.addEventListener('close', () => {
        if (socket === next) socket = null;
        scheduleReconnect();
      });
      next.addEventListener('error', () => next.close());
    } catch {
      socket = null;
      scheduleReconnect();
    }
  };

  removeStoreListener = onNotificationStoreChanged(() => {
    if (socket?.readyState === WebSocket.OPEN) void sendSubscriptions();
    else void connect();
  });

  if (Capacitor.isNativePlatform()) {
    void import('@capacitor/local-notifications').then(async ({ LocalNotifications }) => {
      const handle = await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
        const address = notificationLinks.get(event.notification.id);
        if (address) options.onOpenLink(address);
      });
      if (disposed) {
        await handle.remove();
        return;
      }
      removeActionListener = () => handle.remove();
    });
  }

  void connect();

  return () => {
    stopped = true;
    disposed = true;
    subscriptionRevision += 1;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    socket?.close();
    removeStoreListener?.();
    void removeActionListener?.();
  };
}
