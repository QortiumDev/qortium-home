import {
  sanitizeQdnNotificationIds,
  sanitizeQdnNotificationStore,
  type QdnNotificationEvent,
  type QdnNotificationFilters,
  type QdnNotificationGrant,
  type QdnNotificationStore,
  type StoredQdnNotificationRule,
} from './notification-rules.js';

export type QdnNotificationManagerRuleSummary = {
  createdAt: string;
  event: QdnNotificationEvent;
  filters: QdnNotificationFilters;
  link?: string;
  maskedFilterKeys: string[];
  notificationId: string;
  text?: string;
  title?: string;
};

export type QdnNotificationManagerAppSummary = {
  appKey: string;
  grant: QdnNotificationGrant | null;
  rules: QdnNotificationManagerRuleSummary[];
};

export type QdnNotificationManagerSummary = {
  apps: QdnNotificationManagerAppSummary[];
  revision: number;
  version: 1;
};

export type QdnNotificationManagerMutation =
  | { type: 'SET_APP_MUTED'; appKey: string; muted: boolean }
  | { type: 'REMOVE_APP_RULES'; appKey: string; notificationIds: string[] }
  | { type: 'REVOKE_APP'; appKey: string };

const APP_KEY_MAX_LENGTH = 2_048;
const UNSAFE_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireOnlyKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>) {
  const unsupportedKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unsupportedKey) {
    throw new Error(`Notification manager mutation field ${unsupportedKey} is not supported.`);
  }
}

function sanitizeManagerAppKey(value: unknown) {
  if (typeof value !== 'string') {
    throw new Error('Notification manager app key must be a string.');
  }

  const appKey = value.trim();
  if (
    !appKey
    || appKey.length > APP_KEY_MAX_LENGTH
    || UNSAFE_RECORD_KEYS.has(appKey)
    || !/^qdn:\/\/(?:APP|WEBSITE)\//i.test(appKey)
  ) {
    throw new Error('Notification manager app key is invalid.');
  }

  return appKey;
}

export function sanitizeQdnNotificationManagerMutation(value: unknown): QdnNotificationManagerMutation {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error('Notification manager mutation must be an object with a supported type.');
  }

  const appKey = sanitizeManagerAppKey(value.appKey);

  switch (value.type) {
    case 'SET_APP_MUTED': {
      requireOnlyKeys(value, new Set(['type', 'appKey', 'muted']));
      if (typeof value.muted !== 'boolean') {
        throw new Error('Notification manager muted state must be a boolean.');
      }
      return { type: value.type, appKey, muted: value.muted };
    }
    case 'REMOVE_APP_RULES': {
      requireOnlyKeys(value, new Set(['type', 'appKey', 'notificationIds']));
      const notificationIds = sanitizeQdnNotificationIds(value.notificationIds);
      if (!notificationIds?.length) {
        throw new Error('Notification manager rule removal requires at least one notification id.');
      }
      return { type: value.type, appKey, notificationIds: [...new Set(notificationIds)] };
    }
    case 'REVOKE_APP':
      requireOnlyKeys(value, new Set(['type', 'appKey']));
      return { type: value.type, appKey };
    default:
      throw new Error('Notification manager mutation type is not supported.');
  }
}

function summarizeRule(rule: StoredQdnNotificationRule): QdnNotificationManagerRuleSummary {
  const filters = { ...rule.filters };
  const maskedFilterKeys: string[] = [];
  const sensitiveKeys = ['address', 'involving', 'recipient', 'sender', 'signature'];

  for (const key of sensitiveKeys) {
    if (Object.hasOwn(filters, key)) {
      delete filters[key];
      maskedFilterKeys.push(key);
    }
  }

  if (rule.event === 'FOREIGN_PAYMENT_RECEIVED' && Object.hasOwn(filters, 'xpub')) {
    delete filters.xpub;
    maskedFilterKeys.push('xpub');
  }

  return {
    notificationId: rule.notificationId,
    event: rule.event,
    filters,
    maskedFilterKeys,
    createdAt: rule.createdAt,
    ...(rule.title ? { title: rule.title } : {}),
    ...(rule.text ? { text: rule.text } : {}),
    ...(rule.link ? { link: rule.link } : {}),
  };
}

export function getQdnNotificationManagerSummary(value: unknown): QdnNotificationManagerSummary {
  const store = sanitizeQdnNotificationStore(value);
  const appKeys = new Set([...Object.keys(store.grants), ...Object.keys(store.rules)]);
  const apps = [...appKeys]
    .sort((left, right) => left.localeCompare(right))
    .map((appKey) => ({
      appKey,
      grant: store.grants[appKey] ? { ...store.grants[appKey] } : null,
      rules: (store.rules[appKey] ?? []).map(summarizeRule),
    }));

  return { version: 1, revision: store.revision, apps };
}

// This is deliberately a closed administrative mutation surface. Rule creation
// and replacement remain exclusive to each originating app's existing actions.
export function applyQdnNotificationManagerMutation(
  value: unknown,
  requestedMutation: unknown,
): QdnNotificationStore {
  const store = sanitizeQdnNotificationStore(value);
  const mutation = sanitizeQdnNotificationManagerMutation(requestedMutation);

  switch (mutation.type) {
    case 'SET_APP_MUTED': {
      const grant = store.grants[mutation.appKey];
      if (!grant) {
        throw new Error('Notification permission is not granted for this app.');
      }
      store.grants[mutation.appKey] = {
        grantedAt: grant.grantedAt,
        ...(mutation.muted ? { muted: true } : {}),
      };
      break;
    }
    case 'REMOVE_APP_RULES': {
      const ids = new Set(mutation.notificationIds);
      const rules = (store.rules[mutation.appKey] ?? []).filter((rule) => !ids.has(rule.notificationId));
      if (rules.length) store.rules[mutation.appKey] = rules;
      else delete store.rules[mutation.appKey];
      break;
    }
    case 'REVOKE_APP':
      delete store.grants[mutation.appKey];
      delete store.rules[mutation.appKey];
      break;
  }

  return store;
}
