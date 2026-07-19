import { sanitizeQdnManagerAppKey } from './qdn-manager-permissions.js';

export const QDN_NOTIFICATION_EVENTS = [
  'RESOURCE_PUBLISHED',
  'PAYMENT_RECEIVED',
  'CHAT_MESSAGE',
  'TRANSACTION_CONFIRMED',
  'FOREIGN_PAYMENT_RECEIVED',
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
  revision: number;
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
  PAYMENT_RECEIVED: new Set(['recipient', 'sender', 'amount', 'created', 'signature']),
  CHAT_MESSAGE: new Set(['recipient', 'sender', 'txGroupId', 'involving']),
  TRANSACTION_CONFIRMED: new Set(['signature', 'address', 'groupId', 'txType']),
  FOREIGN_PAYMENT_RECEIVED: new Set(['coin', 'xpub']),
};

const STRING_ARRAY_FILTERS = new Set(['names', 'keywords']);
const STRING_OR_ARRAY_FILTERS = new Set(['sender', 'recipient', 'address', 'signature', 'involving', 'groupId']);
const BOOLEAN_FILTERS = new Set(['prefix', 'defaultResource', 'followedOnly', 'excludeBlocked']);
// txType is a TransactionType enum NAME (e.g. "PAYMENT"), not a number.
const NUMBER_FILTERS = new Set(['after', 'before', 'created', 'txGroupId']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeFilterValue(key: string, value: unknown) {
  if (key === 'coin') {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('Notification filter coin must be a non-empty string.');
    }

    return value.trim().toUpperCase();
  }

  if (key === 'txType') {
    if (typeof value === 'string') {
      if (!value.trim()) {
        throw new Error('Notification filter txType must be a non-empty string or array of non-empty strings.');
      }
      return value.trim().toUpperCase();
    }

    if (!Array.isArray(value) || !value.length || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
      throw new Error('Notification filter txType must be a non-empty string or array of non-empty strings.');
    }

    return [...new Set(value.map((entry) => entry.trim().toUpperCase()))];
  }

  if (STRING_ARRAY_FILTERS.has(key)) {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      throw new Error(`Notification filter ${key} must be an array of strings.`);
    }

    return value.map((entry) => entry.trim()).filter(Boolean);
  }

  if (STRING_OR_ARRAY_FILTERS.has(key)) {
    if (typeof value === 'string') {
      if (!value.trim()) {
        throw new Error(`Notification filter ${key} must be a non-empty string or array of non-empty strings.`);
      }

      return value.trim();
    }

    if (!Array.isArray(value) || !value.length || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
      throw new Error(`Notification filter ${key} must be a non-empty string or array of non-empty strings.`);
    }

    return [...new Set(value.map((entry) => entry.trim()))];
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

  if (event === 'PAYMENT_RECEIVED' && !('recipient' in filters) && !('sender' in filters)) {
    throw new Error('PAYMENT_RECEIVED requires a recipient or sender filter.');
  }

  if (event === 'TRANSACTION_CONFIRMED' && !('signature' in filters) && !('address' in filters) && !('groupId' in filters)) {
    throw new Error('TRANSACTION_CONFIRMED requires a signature, address, or groupId filter.');
  }

  if (event === 'FOREIGN_PAYMENT_RECEIVED' && (!('coin' in filters) || !('xpub' in filters))) {
    throw new Error('FOREIGN_PAYMENT_RECEIVED requires coin and xpub filters.');
  }

  if (event !== 'RESOURCE_PUBLISHED') {
    let expansionCount = 1;

    for (const [key, filterValue] of Object.entries(filters)) {
      if (key !== 'txType' && Array.isArray(filterValue) && filterValue.length > 1) {
        expansionCount *= filterValue.length;
      }
    }

    if (expansionCount > QDN_NOTIFICATION_RULES_PER_APP_MAX) {
      throw new Error(
        `Notification filters expand to more than ${QDN_NOTIFICATION_RULES_PER_APP_MAX} value combinations; reduce multi-value filter sizes.`,
      );
    }
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

export function coreSupportsArrayFilters(buildVersion: string | undefined): boolean {
  const version = getCoreVersion(buildVersion);
  if (!version) return false;

  const [major, minor, patch] = version;
  return major > 1 || (major === 1 && (minor > 4 || (minor === 4 && patch >= 0)));
}

export function coreSupportsV15Notifications(buildVersion: string | undefined): boolean {
  const version = getCoreVersion(buildVersion);
  if (!version) return false;

  const [major, minor, patch] = version;
  return major > 1 || (major === 1 && (minor > 5 || (minor === 5 && patch >= 0)));
}

function getCoreVersion(buildVersion: string | undefined): [number, number, number] | undefined {
  const match = buildVersion?.match(/-([0-9]+)\.([0-9]+)\.([0-9]+)(?:[-.][0-9A-Za-z.]+)?-([0-9a-fA-F]{6,40})$/);
  if (!match) return undefined;

  return match.slice(1, 4).map(Number) as [number, number, number];
}

// Maps a stored rule to the node's /websockets/notifications subscription shape.
// RESOURCE_PUBLISHED uses the node's typed `resourceFilter` object (which keeps
// arrays/booleans/numbers as-is); every other event uses the generic `filters`
// string map. Core 1.4.0+ accepts generic filter arrays; older Core versions need
// one subscription per identity-filter value. Home still matches multi-value
// txType filters as a safety net. Core 1.5.0 adds groupId anchors and foreign
// payment events, so those subscriptions are omitted or degraded on older nodes.
export function toWireNotificationSubscription(
  appKey: string,
  rule: StoredQdnNotificationRule,
  options: { serverSupportsArrayFilters?: boolean; serverSupportsV15Notifications?: boolean } = {},
) {
  const base = { appName: appKey, event: rule.event, notificationId: rule.notificationId };

  if (rule.event === 'RESOURCE_PUBLISHED') {
    return { ...base, resourceFilter: rule.filters };
  }

  const filters: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(rule.filters)) {
    if (key === 'groupId' && !options.serverSupportsV15Notifications) continue;
    if (key === 'txType' && Array.isArray(value) && value.length > 1) {
      if (options.serverSupportsArrayFilters) filters[key] = value;
      continue;
    }
    if (Array.isArray(value) && value.length > 1 && options.serverSupportsArrayFilters) {
      filters[key] = value;
      continue;
    }
    filters[key] = Array.isArray(value) ? value.join(',') : String(value);
  }

  return { ...base, filters };
}

export function toWireNotificationSubscriptions(
  appKey: string,
  rule: StoredQdnNotificationRule,
  options: { serverSupportsArrayFilters?: boolean; serverSupportsV15Notifications?: boolean } = {},
) {
  if (rule.event === 'FOREIGN_PAYMENT_RECEIVED' && !options.serverSupportsV15Notifications) {
    return [];
  }

  if (
    rule.event === 'TRANSACTION_CONFIRMED' &&
    'groupId' in rule.filters &&
    !('signature' in rule.filters) &&
    !('address' in rule.filters) &&
    !options.serverSupportsV15Notifications
  ) {
    return [];
  }

  if (rule.event === 'RESOURCE_PUBLISHED' || options.serverSupportsArrayFilters) {
    return [toWireNotificationSubscription(appKey, rule, options)];
  }

  const compatibleFilters = { ...rule.filters };
  if (!options.serverSupportsV15Notifications) delete compatibleFilters.groupId;
  let filterVariants: QdnNotificationFilters[] = [compatibleFilters];

  for (const [key, value] of Object.entries(compatibleFilters)) {
    if (key === 'txType' || !Array.isArray(value) || value.length <= 1) {
      continue;
    }

    filterVariants = filterVariants.flatMap((filters) => value.map((entry) => ({ ...filters, [key]: entry })));

    if (filterVariants.length > QDN_NOTIFICATION_RULES_PER_APP_MAX) {
      console.warn(
        `Notification rule ${rule.notificationId} expanded beyond ${QDN_NOTIFICATION_RULES_PER_APP_MAX} subscriptions; truncating.`,
      );
      filterVariants = filterVariants.slice(0, QDN_NOTIFICATION_RULES_PER_APP_MAX);
      break;
    }
  }

  return filterVariants.map((filters, index) => {
    const subscription = toWireNotificationSubscription(appKey, { ...rule, filters }, options);

    return filterVariants.length > 1
      ? { ...subscription, notificationId: `${rule.notificationId}~${index}` }
      : subscription;
  });
}

// Core caps FOREIGN_PAYMENT_RECEIVED rules per websocket session and rejects the
// whole subscribe action when the cap is exceeded. Home merges every app's rules
// into one session, so it must never send more foreign subscriptions than Core
// accepts — dropping the overflow keeps the combined subscription alive.
export const FOREIGN_PAYMENT_WIRE_SUBSCRIPTIONS_MAX = 20;

export function capForeignPaymentWireSubscriptions<T extends { event: string }>(subscriptions: T[]): T[] {
  let foreignCount = 0;
  const capped = subscriptions.filter(
    (subscription) =>
      subscription.event !== 'FOREIGN_PAYMENT_RECEIVED' || ++foreignCount <= FOREIGN_PAYMENT_WIRE_SUBSCRIPTIONS_MAX,
  );
  if (foreignCount > FOREIGN_PAYMENT_WIRE_SUBSCRIPTIONS_MAX) {
    console.warn(
      `Dropping ${foreignCount - FOREIGN_PAYMENT_WIRE_SUBSCRIPTIONS_MAX} foreign-payment subscriptions beyond the Core per-session limit of ${FOREIGN_PAYMENT_WIRE_SUBSCRIPTIONS_MAX}.`,
    );
  }
  return capped;
}

export function stripWireNotificationIdSuffix(notificationId: string | undefined) {
  if (!notificationId) {
    return notificationId;
  }

  const suffixIndex = notificationId.indexOf('~');

  return suffixIndex === -1 ? notificationId : notificationId.slice(0, suffixIndex);
}

export function getQdnNotificationDefaultTitle(event: QdnNotificationEvent) {
  switch (event) {
    case 'RESOURCE_PUBLISHED': return 'New resource published';
    case 'PAYMENT_RECEIVED': return 'Payment received';
    case 'CHAT_MESSAGE': return 'New chat message';
    case 'TRANSACTION_CONFIRMED': return 'Transaction confirmed';
    case 'FOREIGN_PAYMENT_RECEIVED': return 'Foreign payment received';
  }
}

export function matchesQdnNotificationRuleData(
  rule: StoredQdnNotificationRule,
  data: Record<string, unknown> | undefined,
) {
  const txTypes = rule.filters.txType;
  if (rule.event !== 'TRANSACTION_CONFIRMED' || !Array.isArray(txTypes)) return true;
  const pushedType = data?.type;
  return typeof pushedType === 'string' && txTypes.some((txType) => txType.toLowerCase() === pushedType.toLowerCase());
}

const NOTIFICATION_BODY_MAX_LENGTH = 240;
const UNSAFE_NOTIFICATION_TEXT_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function sanitizeNotificationBodyPart(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined;
  const sanitized = String(value).replace(UNSAFE_NOTIFICATION_TEXT_PATTERN, '').replace(/\s+/g, ' ').trim();
  return sanitized || undefined;
}

function shortenNotificationAddress(value: unknown) {
  const address = sanitizeNotificationBodyPart(value);
  if (!address) return undefined;
  return address.length >= 16 && address.length <= 128
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

function finishNotificationBody(value: string | undefined) {
  return sanitizeNotificationBodyPart(value)?.slice(0, NOTIFICATION_BODY_MAX_LENGTH);
}

export function getQdnNotificationDefaultBody(
  rule: StoredQdnNotificationRule,
  data: Record<string, unknown> | undefined,
): string | undefined {
  const sender = shortenNotificationAddress(data?.sender);

  switch (rule.event) {
    case 'TRANSACTION_CONFIRMED': {
      const txType = sanitizeNotificationBodyPart(data?.type);
      if (txType && sender) return finishNotificationBody(`${txType} from ${sender}`);
      return finishNotificationBody(txType ?? (sender ? `From ${sender}` : undefined));
    }
    case 'PAYMENT_RECEIVED': {
      const amount = sanitizeNotificationBodyPart(data?.amount);
      if (amount && sender) return finishNotificationBody(`${amount} from ${sender}`);
      return finishNotificationBody(amount ?? (sender ? `From ${sender}` : undefined));
    }
    case 'CHAT_MESSAGE': {
      const groupId = sanitizeNotificationBodyPart(data?.txGroupId);
      if (groupId && groupId !== '0') return finishNotificationBody(`In group ${groupId}`);
      return finishNotificationBody(sender ? `From ${sender}` : undefined);
    }
    case 'RESOURCE_PUBLISHED':
      return undefined;
    case 'FOREIGN_PAYMENT_RECEIVED': {
      const amount = sanitizeNotificationBodyPart(data?.amount);
      const coin = sanitizeNotificationBodyPart(data?.coin)?.toUpperCase();
      return finishNotificationBody(amount && coin ? `Received ${amount} ${coin}` : undefined);
    }
  }
}

const FOREIGN_PAYMENT_REPLAY_DEDUP_MAX = 1_024;

function getForeignPaymentReplayParts(data: Record<string, unknown> | undefined) {
  const coin = sanitizeNotificationBodyPart(data?.coin)?.toUpperCase();
  const txHash = sanitizeNotificationBodyPart(data?.txHash);
  const address = sanitizeNotificationBodyPart(data?.address);
  const checkpoint = sanitizeNotificationBodyPart(data?.checkpoint);
  if (!coin || !txHash || !address || !checkpoint) return undefined;
  return { checkpoint, identity: `${coin}\u0000${txHash}\u0000${address}` };
}

// Core can replay a foreign payment after a websocket reconnect. Keep both the
// server checkpoint and the stable payment tuple: a changed checkpoint must not
// result in a second user-visible notification for the same payment.
export class ForeignPaymentReplayDeduper {
  private readonly identities = new Set<string>();
  private readonly checkpoints = new Set<string>();

  hasDelivered(data: Record<string, unknown> | undefined) {
    const parts = getForeignPaymentReplayParts(data);
    if (!parts) return false;
    return this.identities.has(parts.identity) || this.checkpoints.has(`${parts.checkpoint}\u0000${parts.identity}`);
  }

  markDelivered(data: Record<string, unknown> | undefined) {
    const parts = getForeignPaymentReplayParts(data);
    if (!parts || this.hasDelivered(data)) return;
    const checkpointKey = `${parts.checkpoint}\u0000${parts.identity}`;
    this.identities.add(parts.identity);
    this.checkpoints.add(checkpointKey);
    while (this.identities.size > FOREIGN_PAYMENT_REPLAY_DEDUP_MAX) {
      const identity = this.identities.values().next().value;
      if (!identity) break;
      this.identities.delete(identity);
      for (const key of this.checkpoints) {
        if (key.endsWith(`\u0000${identity}`)) this.checkpoints.delete(key);
      }
    }
  }
}

export function createEmptyQdnNotificationStore(): QdnNotificationStore {
  return { version: 1, revision: 0, grants: {}, rules: {} };
}

export function sanitizeQdnNotificationStore(value: unknown): QdnNotificationStore {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.grants) || !isRecord(value.rules)) {
    return createEmptyQdnNotificationStore();
  }

  const grants: QdnNotificationStore['grants'] = {};
  const rules: QdnNotificationStore['rules'] = {};

  const canonicalAppKey = (appKey: string) => {
    try {
      return sanitizeQdnManagerAppKey(appKey);
    } catch {
      return /^qdn:\/\/(?:APP|WEBSITE)\//i.test(appKey) ? appKey : null;
    }
  };

  for (const [rawAppKey, grant] of Object.entries(value.grants)) {
    const appKey = canonicalAppKey(rawAppKey);
    if (appKey && isRecord(grant) && typeof grant.grantedAt === 'string') {
      const existing = grants[appKey];
      grants[appKey] = {
        grantedAt: existing && existing.grantedAt < grant.grantedAt ? existing.grantedAt : grant.grantedAt,
        ...(existing?.muted === true || grant.muted === true ? { muted: true } : {}),
      };
    }
  }

  for (const [rawAppKey, entries] of Object.entries(value.rules)) {
    const appKey = canonicalAppKey(rawAppKey);
    if (!appKey || !Array.isArray(entries)) continue;
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
    if (sanitized.length) {
      const merged = new Map((rules[appKey] ?? []).map((rule) => [rule.notificationId, rule]));
      for (const rule of sanitized) {
        const existing = merged.get(rule.notificationId);
        if (!existing || existing.createdAt <= rule.createdAt) merged.set(rule.notificationId, rule);
      }
      rules[appKey] = [...merged.values()]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, QDN_NOTIFICATION_RULES_PER_APP_MAX);
    }
  }

  const revision = Number.isSafeInteger(value.revision) && (value.revision as number) >= 0
    ? value.revision as number
    : 0;

  return { version: 1, revision, grants, rules };
}
