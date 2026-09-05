import {
  BOOKMARK_TOOLBAR_VISIBILITIES,
  type BookmarkToolbarVisibility,
} from './bookmark-toolbar.js';
import { isPublicQdnService } from './qdn-public-services.js';

export const BOOKMARK_MANAGER_SCHEMA_VERSION = 1 as const;

// Saved-place reference, never a wallet ID: real IDs begin with `wallet:`.
// Keeping this nonempty preserves it through schema-1 managers, and older
// Home BOOKMARKS_OPEN bridges reject it as an unavailable account instead of
// inheriting one.
export const SAVED_GUEST_ACCOUNT_ID = 'home-v2:guest' as const;

export const BOOKMARK_MANAGER_TREE_ROOT_IDS = ['bookmarks', 'toolbar'] as const;
export const BOOKMARK_MANAGER_SPECIAL_ROOT_IDS = ['pins', 'startPages'] as const;
export const BOOKMARK_MANAGER_ROOT_IDS = [
  ...BOOKMARK_MANAGER_TREE_ROOT_IDS,
  ...BOOKMARK_MANAGER_SPECIAL_ROOT_IDS,
] as const;
export const BOOKMARK_MANAGER_DROP_POSITIONS = ['after', 'before', 'inside'] as const;

export type BookmarkManagerTreeRootId = (typeof BOOKMARK_MANAGER_TREE_ROOT_IDS)[number];
export type BookmarkManagerSpecialRootId = (typeof BOOKMARK_MANAGER_SPECIAL_ROOT_IDS)[number];
export type BookmarkManagerRootId = (typeof BOOKMARK_MANAGER_ROOT_IDS)[number];
export type BookmarkManagerDropPosition = (typeof BOOKMARK_MANAGER_DROP_POSITIONS)[number];

export type BookmarkManagerLink = {
  accountId?: string | null;
  createdAt: number;
  displayUrl: string;
  id: string;
  title: string;
  type: 'bookmark';
};

export type BookmarkManagerFolder = {
  children: BookmarkManagerTreeItem[];
  createdAt: number;
  id: string;
  title: string;
  type: 'folder';
};

export type BookmarkManagerTreeItem = BookmarkManagerFolder | BookmarkManagerLink;

export type BookmarkManagerDashboardPin = {
  accountId?: string | null;
  createdAt: number;
  customLabel?: string;
  displayUrl: string;
  id: string;
  label: string;
};

export type BookmarkManagerStartPage = {
  accountId: string | null;
  displayUrl: string;
  title?: string;
};

// Safe, permission-scoped account choices for a manager app: just enough to
// let it label and select an account reference, never wallet filenames, keys,
// addresses, or unlock state. A `null` id/activeAccountId means Home's
// built-in "Current" account (the calling tab's active account). The reserved
// SAVED_GUEST_ACCOUNT_ID choice means explicitly no account, not a real wallet.
export type BookmarkManagerAccountChoice = {
  id: string;
  label: string;
};

export type BookmarkManagerSnapshot = {
  activeAccountId?: string | null;
  availableAccounts?: BookmarkManagerAccountChoice[];
  bookmarks: BookmarkManagerTreeItem[];
  dashboardPins: BookmarkManagerDashboardPin[];
  revision: number;
  schemaVersion: typeof BOOKMARK_MANAGER_SCHEMA_VERSION;
  startPages: BookmarkManagerStartPage[];
  toolbar: BookmarkManagerTreeItem[];
  toolbarVisibility: BookmarkToolbarVisibility;
};

export type BookmarkManagerLinkDraft = {
  accountId?: string | null;
  displayUrl: string;
  title: string;
};

export type BookmarkManagerMutation =
  | {
      type: 'addTreeLink';
      rootId: BookmarkManagerTreeRootId;
      parentFolderId?: string | null;
      link: BookmarkManagerLinkDraft;
    }
  | {
      type: 'addTreeFolder';
      rootId: BookmarkManagerTreeRootId;
      parentFolderId?: string | null;
      title: string;
    }
  | {
      type: 'updateTreeLink';
      rootId: BookmarkManagerTreeRootId;
      itemId: string;
      link: BookmarkManagerLinkDraft;
    }
  | {
      type: 'updateTreeFolder';
      rootId: BookmarkManagerTreeRootId;
      itemId: string;
      title: string;
    }
  | {
      type: 'removeTreeItem';
      rootId: BookmarkManagerTreeRootId;
      itemId: string;
    }
  | {
      type: 'addDashboardPin';
      pin: BookmarkManagerLinkDraft;
    }
  | {
      type: 'updateDashboardPin';
      pinId: string;
      pin: BookmarkManagerLinkDraft;
    }
  | {
      type: 'removeDashboardPin';
      pinId: string;
    }
  | {
      type: 'addStartPage';
      page: BookmarkManagerLinkDraft;
    }
  | {
      type: 'updateStartPage';
      displayUrl: string;
      page: BookmarkManagerLinkDraft;
    }
  | {
      type: 'removeStartPage';
      displayUrl: string;
    }
  | {
      type: 'moveItem';
      itemId: string;
      sourceRootId: BookmarkManagerRootId;
      targetFolderId?: string | null;
      targetItemId?: string | null;
      targetPosition?: BookmarkManagerDropPosition;
      targetRootId: BookmarkManagerRootId;
    }
  | {
      type: 'setToolbarVisibility';
      toolbarVisibility: BookmarkToolbarVisibility;
    };

export type BookmarkManagerMutationRequest = {
  expectedRevision: number;
  mutation: BookmarkManagerMutation;
};

export type BookmarkManagerMutationResult = {
  changed: boolean;
  snapshot: BookmarkManagerSnapshot;
};

// BOOKMARKS_OPEN request shape: a supported address plus an optional,
// nullable account choice. `accountId: null` means Home's built-in
// "Current" account - inherit whichever account the calling tab is using.
// SAVED_GUEST_ACCOUNT_ID means explicitly no account. This only validates
// shape; the caller must distinguish that reserved reference before checking
// other non-null accountIds against Home's actual saved accounts.
export type BookmarksOpenRequest = {
  accountId: string | null;
  address: string;
};

const MAX_TREE_DEPTH = 32;
const MAX_TREE_ITEMS_PER_FOLDER = 128;
const MAX_TREE_ITEMS_TOTAL = 4096;
const MAX_DASHBOARD_PINS = 32;
const MAX_START_PAGES = 10;
const MAX_ID_LENGTH = 2048;
const MAX_TITLE_LENGTH = 4096;
const MAX_DISPLAY_URL_LENGTH = 16384;
const MAX_ACCOUNT_ID_LENGTH = 256;
const MAX_ACCOUNT_LABEL_LENGTH = 256;
// Matches the sibling OPEN_NEW_TAB/OPEN_CURRENT_TAB address limit, not the
// larger MAX_DISPLAY_URL_LENGTH used for stored bookmark links.
const BOOKMARKS_OPEN_ADDRESS_MAX_LENGTH = 2048;
const MAX_AVAILABLE_ACCOUNTS = 256;

type PlainRecord = Record<string, unknown>;

function getRecord(value: unknown, name: string): PlainRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }

  return value as PlainRecord;
}

function assertKnownKeys(value: PlainRecord, keys: readonly string[], name: string) {
  const allowed = new Set(keys);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));

  if (unknownKey) {
    throw new Error(`${name}.${unknownKey} is not supported.`);
  }
}

function getString(
  value: unknown,
  name: string,
  maxLength: number,
  options: { allowEmpty?: boolean } = {},
) {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string.`);
  }

  const normalized = value.trim();

  if (!options.allowEmpty && !normalized) {
    throw new Error(`${name} must not be empty.`);
  }

  if (normalized.length > maxLength) {
    throw new Error(`${name} must be at most ${maxLength} characters.`);
  }

  return normalized;
}

function getOptionalString(value: unknown, name: string, maxLength: number) {
  if (value === undefined) {
    return undefined;
  }

  return getString(value, name, maxLength);
}

function getOptionalNullableString(value: unknown, name: string, maxLength: number) {
  if (value === undefined || value === null) {
    return value;
  }

  return getString(value, name, maxLength);
}

function getFiniteTimestamp(value: unknown, name: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number.`);
  }

  return value;
}

function getRevision(value: unknown, name = 'revision') {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }

  return value as number;
}

function getTreeRootId(value: unknown, name: string): BookmarkManagerTreeRootId {
  if (BOOKMARK_MANAGER_TREE_ROOT_IDS.includes(value as BookmarkManagerTreeRootId)) {
    return value as BookmarkManagerTreeRootId;
  }

  throw new Error(`${name} must be bookmarks or toolbar.`);
}

function getRootId(value: unknown, name: string): BookmarkManagerRootId {
  if (BOOKMARK_MANAGER_ROOT_IDS.includes(value as BookmarkManagerRootId)) {
    return value as BookmarkManagerRootId;
  }

  throw new Error(`${name} is not a supported bookmark root.`);
}

function getDropPosition(value: unknown, name: string): BookmarkManagerDropPosition | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (BOOKMARK_MANAGER_DROP_POSITIONS.includes(value as BookmarkManagerDropPosition)) {
    return value as BookmarkManagerDropPosition;
  }

  throw new Error(`${name} is not a supported drop position.`);
}

function getToolbarVisibility(value: unknown, name: string): BookmarkToolbarVisibility {
  if (BOOKMARK_TOOLBAR_VISIBILITIES.includes(value as BookmarkToolbarVisibility)) {
    return value as BookmarkToolbarVisibility;
  }

  throw new Error(`${name} is not a supported toolbar visibility.`);
}

function parseLinkDraft(value: unknown, name: string): BookmarkManagerLinkDraft {
  const record = getRecord(value, name);
  assertKnownKeys(record, ['accountId', 'displayUrl', 'title'], name);

  const accountId = getOptionalNullableString(record.accountId, `${name}.accountId`, MAX_ACCOUNT_ID_LENGTH);

  const displayUrl = getString(record.displayUrl, `${name}.displayUrl`, MAX_DISPLAY_URL_LENGTH);
  const isHomeUrl = /^home:\/\/(?:dashboard|settings|bookmarks|welcome)\/?$/i.test(displayUrl)
    || /^home:\/\/releases\/(?:core|home)\/[^/?#\s]+\/?$/i.test(displayUrl);
  // qortal:// and qortal-core:// are the Qortal-network spellings of qdn://
  // and core:// (src/v2/resource-location.ts). A Qortal app tab produces one
  // of them, so rejecting them here made those tabs unbookmarkable.
  const isCoreUrl = /^(?:core|qortal-core):\/\/(?:[^?\s]*)?(?:#[^\s]*)?$/i.test(displayUrl);
  const qdnMatch = /^(?:qdn|qortal):\/\/([a-z0-9_]+)(?:\/[^\s?#]*)?(?:\?[^\s#]*)?(?:#[^\s]*)?$/i.exec(displayUrl);
  const isQdnWildcardUrl = /^(?:qdn|qortal):\/\/\*\/[^/?#\s]+\/?$/i.test(displayUrl);
  const isQdnUrl = isQdnWildcardUrl
    || (!!qdnMatch && isPublicQdnService(qdnMatch[1].toUpperCase()));
  if (!isHomeUrl && !isCoreUrl && !isQdnUrl) {
    // Stable code, like HOME_DATA_STALE: manager apps key localized errors off
    // it rather than parsing the message.
    throw Object.assign(
      new Error(`${name}.displayUrl must be a supported qdn://, core://, or home:// address.`),
      { code: 'INVALID_ADDRESS' },
    );
  }

  return {
    ...(accountId !== undefined ? { accountId } : {}),
    displayUrl,
    title: getString(record.title, `${name}.title`, MAX_TITLE_LENGTH, { allowEmpty: true }),
  };
}

function parseTreeItem(value: unknown, name: string, depth: number, count: { value: number }): BookmarkManagerTreeItem {
  if (depth > MAX_TREE_DEPTH) {
    throw new Error(`${name} exceeds the maximum folder depth of ${MAX_TREE_DEPTH}.`);
  }

  count.value += 1;
  if (count.value > MAX_TREE_ITEMS_TOTAL) {
    throw new Error(`Bookmark tree must contain at most ${MAX_TREE_ITEMS_TOTAL} items.`);
  }

  const record = getRecord(value, name);
  const type = record.type;

  if (type === 'folder') {
    assertKnownKeys(record, ['children', 'createdAt', 'id', 'title', 'type'], name);

    if (!Array.isArray(record.children) || record.children.length > MAX_TREE_ITEMS_PER_FOLDER) {
      throw new Error(`${name}.children must contain at most ${MAX_TREE_ITEMS_PER_FOLDER} items.`);
    }

    return {
      children: record.children.map((item, index) => parseTreeItem(item, `${name}.children[${index}]`, depth + 1, count)),
      createdAt: getFiniteTimestamp(record.createdAt, `${name}.createdAt`),
      id: getString(record.id, `${name}.id`, MAX_ID_LENGTH),
      title: getString(record.title, `${name}.title`, MAX_TITLE_LENGTH),
      type,
    };
  }

  if (type === 'bookmark') {
    assertKnownKeys(record, ['accountId', 'createdAt', 'displayUrl', 'id', 'title', 'type'], name);
    const accountId = getOptionalNullableString(record.accountId, `${name}.accountId`, MAX_ACCOUNT_ID_LENGTH);

    return {
      ...(accountId !== undefined ? { accountId } : {}),
      createdAt: getFiniteTimestamp(record.createdAt, `${name}.createdAt`),
      displayUrl: getString(record.displayUrl, `${name}.displayUrl`, MAX_DISPLAY_URL_LENGTH),
      id: getString(record.id, `${name}.id`, MAX_ID_LENGTH),
      // Empty is allowed here for the same reason it is allowed on the draft at
      // parseLinkDraft: a link may legitimately have no title, and it derives a
      // display label from its address instead. Requiring non-empty here meant a
      // draft the contract accepts could never round-trip — the snapshot parse
      // threw, and loadBookmarkManagerSnapshot turns that throw into a discarded
      // tree. Folders above keep requiring a title: they have no address to
      // derive one from.
      title: getString(record.title, `${name}.title`, MAX_TITLE_LENGTH, { allowEmpty: true }),
      type,
    };
  }

  throw new Error(`${name}.type must be bookmark or folder.`);
}

function parseTree(value: unknown, name: string) {
  if (!Array.isArray(value) || value.length > MAX_TREE_ITEMS_PER_FOLDER) {
    throw new Error(`${name} must contain at most ${MAX_TREE_ITEMS_PER_FOLDER} items.`);
  }

  const count = { value: 0 };
  return value.map((item, index) => parseTreeItem(item, `${name}[${index}]`, 0, count));
}

function parseDashboardPin(value: unknown, name: string): BookmarkManagerDashboardPin {
  const record = getRecord(value, name);
  assertKnownKeys(record, ['accountId', 'createdAt', 'customLabel', 'displayUrl', 'id', 'label'], name);
  const accountId = getOptionalNullableString(record.accountId, `${name}.accountId`, MAX_ACCOUNT_ID_LENGTH);
  const customLabel = getOptionalString(record.customLabel, `${name}.customLabel`, MAX_TITLE_LENGTH);

  return {
    ...(accountId !== undefined ? { accountId } : {}),
    createdAt: getFiniteTimestamp(record.createdAt, `${name}.createdAt`),
    ...(customLabel !== undefined ? { customLabel } : {}),
    displayUrl: getString(record.displayUrl, `${name}.displayUrl`, MAX_DISPLAY_URL_LENGTH),
    id: getString(record.id, `${name}.id`, MAX_ID_LENGTH),
    label: getString(record.label, `${name}.label`, MAX_TITLE_LENGTH),
  };
}

function parseStartPage(value: unknown, name: string): BookmarkManagerStartPage {
  const record = getRecord(value, name);
  assertKnownKeys(record, ['accountId', 'displayUrl', 'title'], name);
  const accountId = getOptionalNullableString(record.accountId, `${name}.accountId`, MAX_ACCOUNT_ID_LENGTH);
  const title = getOptionalString(record.title, `${name}.title`, MAX_TITLE_LENGTH);

  return {
    accountId: accountId ?? null,
    displayUrl: getString(record.displayUrl, `${name}.displayUrl`, MAX_DISPLAY_URL_LENGTH),
    ...(title !== undefined ? { title } : {}),
  };
}

function parseAccountChoice(value: unknown, name: string): BookmarkManagerAccountChoice {
  const record = getRecord(value, name);
  assertKnownKeys(record, ['id', 'label'], name);

  return {
    id: getString(record.id, `${name}.id`, MAX_ACCOUNT_ID_LENGTH),
    label: getString(record.label, `${name}.label`, MAX_ACCOUNT_LABEL_LENGTH),
  };
}

function parseAvailableAccounts(value: unknown, name: string): BookmarkManagerAccountChoice[] {
  if (!Array.isArray(value) || value.length > MAX_AVAILABLE_ACCOUNTS) {
    throw new Error(`${name} must contain at most ${MAX_AVAILABLE_ACCOUNTS} items.`);
  }

  return value.map((account, index) => parseAccountChoice(account, `${name}[${index}]`));
}

export function validateBookmarkManagerSnapshot(value: unknown): BookmarkManagerSnapshot {
  const record = getRecord(value, 'snapshot');
  assertKnownKeys(record, [
    'activeAccountId',
    'availableAccounts',
    'bookmarks',
    'dashboardPins',
    'revision',
    'schemaVersion',
    'startPages',
    'toolbar',
    'toolbarVisibility',
  ], 'snapshot');

  if (record.schemaVersion !== BOOKMARK_MANAGER_SCHEMA_VERSION) {
    throw new Error(`snapshot.schemaVersion must be ${BOOKMARK_MANAGER_SCHEMA_VERSION}.`);
  }

  if (!Array.isArray(record.dashboardPins) || record.dashboardPins.length > MAX_DASHBOARD_PINS) {
    throw new Error(`snapshot.dashboardPins must contain at most ${MAX_DASHBOARD_PINS} items.`);
  }

  if (!Array.isArray(record.startPages) || record.startPages.length > MAX_START_PAGES) {
    throw new Error(`snapshot.startPages must contain at most ${MAX_START_PAGES} items.`);
  }

  // Both fields are optional so legacy/local snapshots without account
  // choices (e.g. disk-persisted collections) keep validating unchanged.
  const activeAccountId = getOptionalNullableString(record.activeAccountId, 'snapshot.activeAccountId', MAX_ACCOUNT_ID_LENGTH);
  const availableAccounts = record.availableAccounts === undefined
    ? undefined
    : parseAvailableAccounts(record.availableAccounts, 'snapshot.availableAccounts');

  return {
    ...(activeAccountId !== undefined ? { activeAccountId } : {}),
    ...(availableAccounts !== undefined ? { availableAccounts } : {}),
    bookmarks: parseTree(record.bookmarks, 'snapshot.bookmarks'),
    dashboardPins: record.dashboardPins.map((pin, index) => parseDashboardPin(pin, `snapshot.dashboardPins[${index}]`)),
    revision: getRevision(record.revision),
    schemaVersion: BOOKMARK_MANAGER_SCHEMA_VERSION,
    startPages: record.startPages.map((page, index) => parseStartPage(page, `snapshot.startPages[${index}]`)),
    toolbar: parseTree(record.toolbar, 'snapshot.toolbar'),
    toolbarVisibility: getToolbarVisibility(record.toolbarVisibility, 'snapshot.toolbarVisibility'),
  };
}

export function validateBookmarkManagerMutation(value: unknown): BookmarkManagerMutation {
  const record = getRecord(value, 'mutation');
  const type = record.type;

  switch (type) {
    case 'addTreeLink': {
      assertKnownKeys(record, ['link', 'parentFolderId', 'rootId', 'type'], 'mutation');
      const parentFolderId = getOptionalNullableString(record.parentFolderId, 'mutation.parentFolderId', MAX_ID_LENGTH);
      return {
        type,
        rootId: getTreeRootId(record.rootId, 'mutation.rootId'),
        ...(parentFolderId !== undefined ? { parentFolderId } : {}),
        link: parseLinkDraft(record.link, 'mutation.link'),
      };
    }
    case 'addTreeFolder': {
      assertKnownKeys(record, ['parentFolderId', 'rootId', 'title', 'type'], 'mutation');
      const parentFolderId = getOptionalNullableString(record.parentFolderId, 'mutation.parentFolderId', MAX_ID_LENGTH);
      return {
        type,
        rootId: getTreeRootId(record.rootId, 'mutation.rootId'),
        ...(parentFolderId !== undefined ? { parentFolderId } : {}),
        title: getString(record.title, 'mutation.title', MAX_TITLE_LENGTH),
      };
    }
    case 'updateTreeLink': {
      assertKnownKeys(record, ['itemId', 'link', 'rootId', 'type'], 'mutation');
      return {
        type,
        rootId: getTreeRootId(record.rootId, 'mutation.rootId'),
        itemId: getString(record.itemId, 'mutation.itemId', MAX_ID_LENGTH),
        link: parseLinkDraft(record.link, 'mutation.link'),
      };
    }
    case 'updateTreeFolder': {
      assertKnownKeys(record, ['itemId', 'rootId', 'title', 'type'], 'mutation');
      return {
        type,
        rootId: getTreeRootId(record.rootId, 'mutation.rootId'),
        itemId: getString(record.itemId, 'mutation.itemId', MAX_ID_LENGTH),
        title: getString(record.title, 'mutation.title', MAX_TITLE_LENGTH),
      };
    }
    case 'removeTreeItem': {
      assertKnownKeys(record, ['itemId', 'rootId', 'type'], 'mutation');
      return {
        type,
        rootId: getTreeRootId(record.rootId, 'mutation.rootId'),
        itemId: getString(record.itemId, 'mutation.itemId', MAX_ID_LENGTH),
      };
    }
    case 'addDashboardPin': {
      assertKnownKeys(record, ['pin', 'type'], 'mutation');
      return { type, pin: parseLinkDraft(record.pin, 'mutation.pin') };
    }
    case 'updateDashboardPin': {
      assertKnownKeys(record, ['pin', 'pinId', 'type'], 'mutation');
      return {
        type,
        pinId: getString(record.pinId, 'mutation.pinId', MAX_ID_LENGTH),
        pin: parseLinkDraft(record.pin, 'mutation.pin'),
      };
    }
    case 'removeDashboardPin': {
      assertKnownKeys(record, ['pinId', 'type'], 'mutation');
      return { type, pinId: getString(record.pinId, 'mutation.pinId', MAX_ID_LENGTH) };
    }
    case 'addStartPage': {
      assertKnownKeys(record, ['page', 'type'], 'mutation');
      return { type, page: parseLinkDraft(record.page, 'mutation.page') };
    }
    case 'updateStartPage': {
      assertKnownKeys(record, ['displayUrl', 'page', 'type'], 'mutation');
      return {
        type,
        displayUrl: getString(record.displayUrl, 'mutation.displayUrl', MAX_DISPLAY_URL_LENGTH),
        page: parseLinkDraft(record.page, 'mutation.page'),
      };
    }
    case 'removeStartPage': {
      assertKnownKeys(record, ['displayUrl', 'type'], 'mutation');
      return { type, displayUrl: getString(record.displayUrl, 'mutation.displayUrl', MAX_DISPLAY_URL_LENGTH) };
    }
    case 'moveItem': {
      assertKnownKeys(record, [
        'itemId',
        'sourceRootId',
        'targetFolderId',
        'targetItemId',
        'targetPosition',
        'targetRootId',
        'type',
      ], 'mutation');
      const sourceRootId = getRootId(record.sourceRootId, 'mutation.sourceRootId');
      const targetRootId = getRootId(record.targetRootId, 'mutation.targetRootId');
      const targetFolderId = getOptionalNullableString(record.targetFolderId, 'mutation.targetFolderId', MAX_ID_LENGTH);
      const targetItemId = getOptionalNullableString(record.targetItemId, 'mutation.targetItemId', MAX_ID_LENGTH);
      const targetPosition = getDropPosition(record.targetPosition, 'mutation.targetPosition');

      if (BOOKMARK_MANAGER_SPECIAL_ROOT_IDS.includes(targetRootId as BookmarkManagerSpecialRootId)) {
        if (targetFolderId) {
          throw new Error('mutation.targetFolderId is only supported for bookmarks and toolbar.');
        }
        if (targetPosition === 'inside') {
          throw new Error('mutation.targetPosition cannot be inside for pins or startPages.');
        }
      }
      if (targetPosition === 'inside' && !targetFolderId) {
        throw new Error('mutation.targetPosition inside requires mutation.targetFolderId.');
      }

      return {
        type,
        itemId: getString(record.itemId, 'mutation.itemId', MAX_ID_LENGTH),
        sourceRootId,
        ...(targetFolderId !== undefined ? { targetFolderId } : {}),
        ...(targetItemId !== undefined ? { targetItemId } : {}),
        ...(targetPosition !== undefined ? { targetPosition } : {}),
        targetRootId,
      };
    }
    case 'setToolbarVisibility': {
      assertKnownKeys(record, ['toolbarVisibility', 'type'], 'mutation');
      return {
        type,
        toolbarVisibility: getToolbarVisibility(record.toolbarVisibility, 'mutation.toolbarVisibility'),
      };
    }
    default:
      throw new Error('mutation.type is not supported.');
  }
}

export function validateBookmarkManagerMutationRequest(value: unknown): BookmarkManagerMutationRequest {
  const record = getRecord(value, 'request');
  assertKnownKeys(record, ['expectedRevision', 'mutation'], 'request');

  return {
    expectedRevision: getRevision(record.expectedRevision, 'request.expectedRevision'),
    mutation: validateBookmarkManagerMutation(record.mutation),
  };
}

export function validateBookmarksOpenRequest(value: unknown): BookmarksOpenRequest {
  const record = getRecord(value, 'request');
  assertKnownKeys(record, ['accountId', 'address'], 'request');

  const address = getString(record.address, 'request.address', BOOKMARKS_OPEN_ADDRESS_MAX_LENGTH);
  if (!/^(?:qdn|qortal|home|core|qortal-core):\/\//i.test(address)) {
    throw Object.assign(
      new Error('request.address must be a supported qdn://, home://, or core:// address.'),
      { code: 'INVALID_ADDRESS' },
    );
  }

  const accountId = getOptionalNullableString(record.accountId, 'request.accountId', MAX_ACCOUNT_ID_LENGTH);

  return { accountId: accountId ?? null, address };
}
