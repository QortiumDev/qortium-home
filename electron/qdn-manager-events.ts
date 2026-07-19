export const QDN_MANAGER_EVENT_KINDS = ['bookmarkManager', 'notificationManager'] as const;

export type QdnManagerEventKind = (typeof QDN_MANAGER_EVENT_KINDS)[number];

export type QdnManagerRevisions = {
  bookmarkManager: number;
  notificationManager: number;
};

export type QdnManagerRevisionEventDetail = {
  revision: number;
};

export const QDN_MANAGER_EVENT_NAMES = {
  bookmarkManager: 'qortiumBookmarkManagerChanged',
  notificationManager: 'qortiumNotificationManagerChanged',
} as const satisfies Record<QdnManagerEventKind, string>;

export const QDN_MANAGER_MESSAGE_TYPES = {
  bookmarkManager: 'qortium:bookmark-manager-changed',
  notificationManager: 'qortium:notification-manager-changed',
} as const satisfies Record<QdnManagerEventKind, string>;

export function validateQdnManagerRevision(value: unknown, name = 'revision') {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }

  return value as number;
}

export function validateQdnManagerRevisions(value: unknown): QdnManagerRevisions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Manager revisions must be an object.');
  }

  const record = value as Record<string, unknown>;
  const unknownKey = Object.keys(record).find(
    (key) => !(QDN_MANAGER_EVENT_KINDS as readonly string[]).includes(key),
  );

  if (unknownKey) {
    throw new Error(`Manager revisions.${unknownKey} is not supported.`);
  }

  return {
    bookmarkManager: validateQdnManagerRevision(
      record.bookmarkManager,
      'Manager revisions.bookmarkManager',
    ),
    notificationManager: validateQdnManagerRevision(
      record.notificationManager,
      'Manager revisions.notificationManager',
    ),
  };
}

export function getQdnManagerRevisionEventDetail(revision: unknown): QdnManagerRevisionEventDetail {
  return { revision: validateQdnManagerRevision(revision) };
}
