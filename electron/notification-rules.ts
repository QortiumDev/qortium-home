export const QDN_NOTIFICATION_EVENTS = [
  'RESOURCE_PUBLISHED',
  'PAYMENT_RECEIVED',
  'CHAT_MESSAGE',
  'TRANSACTION_CONFIRMED',
] as const;

export type QdnNotificationEvent = (typeof QDN_NOTIFICATION_EVENTS)[number];

export type QdnNotificationFilters = Record<string, boolean | number | string | string[]>;

export type QdnNotificationRuleInput = {
  event: QdnNotificationEvent;
  filters: QdnNotificationFilters;
  link?: string;
  notificationId: string;
  text?: string;
  title?: string;
};

export type StoredQdnNotificationRule = QdnNotificationRuleInput & {
  accountAddress: string;
  createdAt: string;
};

export type QdnNotificationGrant = {
  grantedAt: string;
  muted?: boolean;
};

export type QdnNotificationStore = {
  grants: Record<string, QdnNotificationGrant>;
  rules: Record<string, StoredQdnNotificationRule[]>;
  version: 1;
};

export type QdnNotificationStoreApp = {
  appKey: string;
  grant: QdnNotificationGrant;
  ruleCount: number;
};

export const QDN_NOTIFICATION_RULES_PER_APP_MAX = 20;
export const QDN_NOTIFICATION_ID_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
export const QDN_NOTIFICATION_LINK_PATTERN = /^(?:qdn|home|core):\/\//i;
export const QDN_NOTIFICATION_LINK_MAX_LENGTH = 2048;

const FILTER_KEYS: Record<QdnNotificationEvent, ReadonlySet<string>> = {
  RESOURCE_PUBLISHED: new Set([
    'service',
    'names',
    'identifier',
    'title',
    'description',
    'keywords',
    'query',
    'prefix',
    'defaultResource',
    'followedOnly',
    'excludeBlocked',
    'after',
    'before',
  ]),
  PAYMENT_RECEIVED: new Set(['recipient']),
  CHAT_MESSAGE: new Set(['recipient', 'sender', 'txGroupId', 'involving']),
  TRANSACTION_CONFIRMED: new Set(['signature', 'address', 'txType']),
};

const STRING_ARRAY_FILTERS = new Set(['names', 'keywords']);
const BOOLEAN_FILTERS = new Set(['defaultResource', 'followedOnly', 'excludeBlocked']);
// txType is a TransactionType enum NAME (e.g. "PAYMENT"), not a number.
const NUMBER_FILTERS = new Set(['after', 'before', 'txGroupId']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeFilterValue(key: string, value: unknown) {
  if (STRING_ARRAY_FILTERS.has(key)) {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      throw new Error(`Notification filter ${key} must be an array of strings.`);
    }

    return value.map((entry) => entry.trim()).filter(Boolean);
  }

  if (BOOLEAN_FILTERS.has(key)) {
    if (typeof value !== 'boolean') {
      throw new Error(`Notification filter ${key} must be a boolean.`);
    }

    return value;
  }

  if (NUMBER_FILTERS.has(key)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Notification filter ${key} must be a finite number.`);
    }

    return value;
  }

  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Notification filter ${key} must be a non-empty string.`);
  }

  return value.trim();
}

export function sanitizeQdnNotificationLink(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string' || !QDN_NOTIFICATION_LINK_PATTERN.test(value.trim())) {
    throw new Error('Notification link only accepts qdn://, home://, and core:// addresses.');
  }

  const link = value.trim();

  if (link.length > QDN_NOTIFICATION_LINK_MAX_LENGTH) {
    throw new Error(`Notification link must be at most ${QDN_NOTIFICATION_LINK_MAX_LENGTH} characters.`);
  }

  return link;
}

export function sanitizeQdnNotificationRuleInput(
  value: unknown,
  sanitizeText: (value: unknown, maxLength: number) => string | null,
): QdnNotificationRuleInput {
  if (!isRecord(value)) {
    throw new Error('Each notification subscription must be an object.');
  }

  const notificationId = typeof value.notificationId === 'string' ? value.notificationId.trim() : '';

  if (!QDN_NOTIFICATION_ID_PATTERN.test(notificationId)) {
    throw new Error('Notification id must be 1-64 characters using letters, numbers, dot, underscore, or hyphen.');
  }

  if (typeof value.event !== 'string' || !QDN_NOTIFICATION_EVENTS.includes(value.event as QdnNotificationEvent)) {
    throw new Error('Notification event is not supported.');
  }

  const event = value.event as QdnNotificationEvent;

  if (!isRecord(value.filters)) {
    throw new Error('Notification filters must be an object.');
  }

  const allowedKeys = FILTER_KEYS[event];
  const filters: QdnNotificationFilters = {};

  for (const [key, filterValue] of Object.entries(value.filters)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Notification filter ${key} is not supported for ${event}.`);
    }

    filters[key] = sanitizeFilterValue(key, filterValue);
  }

  if (event === 'CHAT_MESSAGE' && !['recipient', 'sender', 'txGroupId', 'involving'].some((key) => key in filters)) {
    throw new Error('CHAT_MESSAGE requires at least one of recipient, sender, txGroupId, or involving.');
  }

  if (event === 'PAYMENT_RECEIVED' && !('recipient' in filters)) {
    throw new Error('PAYMENT_RECEIVED requires a recipient filter.');
  }

  if (event === 'TRANSACTION_CONFIRMED' && !('signature' in filters) && !('address' in filters)) {
    throw new Error('TRANSACTION_CONFIRMED requires a signature or address filter.');
  }

  const title = sanitizeText(value.title, 160) ?? undefined;
  const text = sanitizeText(value.text, 240) ?? undefined;
  const link = sanitizeQdnNotificationLink(value.link);

  return {
    notificationId,
    event,
    filters,
    ...(title ? { title } : {}),
    ...(text ? { text } : {}),
    ...(link ? { link } : {}),
  };
}

export function sanitizeQdnNotificationSubscriptions(
  value: unknown,
  sanitizeText: (value: unknown, maxLength: number) => string | null,
) {
  if (!Array.isArray(value)) {
    throw new Error('Notification subscriptions must be an array.');
  }

  if (value.length > QDN_NOTIFICATION_RULES_PER_APP_MAX) {
    throw new Error(`An app can store at most ${QDN_NOTIFICATION_RULES_PER_APP_MAX} notification rules.`);
  }

  const rules = value.map((entry) => sanitizeQdnNotificationRuleInput(entry, sanitizeText));
  const ids = new Set<string>();

  for (const rule of rules) {
    if (ids.has(rule.notificationId)) {
      throw new Error(`Notification id ${rule.notificationId} is duplicated in this request.`);
    }
    ids.add(rule.notificationId);
  }

  return rules;
}

export function sanitizeQdnNotificationIds(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error('Notification ids must be an array.');
  }

  return value.map((entry) => {
    const notificationId = typeof entry === 'string' ? entry.trim() : '';
    if (!QDN_NOTIFICATION_ID_PATTERN.test(notificationId)) {
      throw new Error('Notification id is invalid.');
    }
    return notificationId;
  });
}

// Maps a stored rule to the node's /websockets/notifications subscription shape.
// RESOURCE_PUBLISHED uses the node's typed `resourceFilter` object (which keeps
// arrays/booleans/numbers as-is); every other event uses the generic `filters`
// string map, so their values are stringified (arrays joined) — the node matches
// them with case-insensitive string equality.
export function toWireNotificationSubscription(appKey: string, rule: StoredQdnNotificationRule) {
  const base = { appName: appKey, event: rule.event, notificationId: rule.notificationId };

  if (rule.event === 'RESOURCE_PUBLISHED') {
    return { ...base, resourceFilter: rule.filters };
  }

  const filters: Record<string, string> = {};

  for (const [key, value] of Object.entries(rule.filters)) {
    filters[key] = Array.isArray(value) ? value.join(',') : String(value);
  }

  return { ...base, filters };
}

export function getQdnNotificationDefaultTitle(event: QdnNotificationEvent) {
  switch (event) {
    case 'RESOURCE_PUBLISHED': return 'New resource published';
    case 'PAYMENT_RECEIVED': return 'Payment received';
    case 'CHAT_MESSAGE': return 'New chat message';
    case 'TRANSACTION_CONFIRMED': return 'Transaction confirmed';
  }
}

export function createEmptyQdnNotificationStore(): QdnNotificationStore {
  return { version: 1, grants: {}, rules: {} };
}

export function sanitizeQdnNotificationStore(value: unknown): QdnNotificationStore {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.grants) || !isRecord(value.rules)) {
    return createEmptyQdnNotificationStore();
  }

  const grants: QdnNotificationStore['grants'] = {};
  const rules: QdnNotificationStore['rules'] = {};

  for (const [appKey, grant] of Object.entries(value.grants)) {
    if (appKey && isRecord(grant) && typeof grant.grantedAt === 'string') {
      grants[appKey] = { grantedAt: grant.grantedAt, ...(grant.muted === true ? { muted: true } : {}) };
    }
  }

  for (const [appKey, entries] of Object.entries(value.rules)) {
    if (!Array.isArray(entries)) continue;
    const sanitized = entries.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.accountAddress !== 'string' || typeof entry.createdAt !== 'string') return [];
      try {
        return [{
          ...sanitizeQdnNotificationRuleInput(entry, (text, max) =>
            typeof text === 'string' && text.trim() ? text.trim().slice(0, max) : null),
          accountAddress: entry.accountAddress,
          createdAt: entry.createdAt,
        }];
      } catch {
        return [];
      }
    }).slice(0, QDN_NOTIFICATION_RULES_PER_APP_MAX);
    if (sanitized.length) rules[appKey] = sanitized;
  }

  return { version: 1, grants, rules };
}
