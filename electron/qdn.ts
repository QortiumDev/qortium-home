import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import extract from 'extract-zip';
import { zipSync } from 'fflate';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { copyFile, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  assertAccountUnlocked,
  getAccountProfile,
  getAccountSecretKey,
  getAccountSigningKey,
  isAccountUnlocked,
  signChatTransaction,
  signTransactionWithNonce,
} from './accounts.js';
import {
  getNodeApiUrl,
  getNodeConnection,
  isInvalidApiKeyResponse,
  refreshNodeConnectionApiKey,
} from './node-settings.js';
import { prepareQdnArchiveRender } from './qdn-archive-render.js';
import {
  QDN_APP_BRIDGE_ACTIONS,
  QDN_PUBLIC_NODE_BRIDGE_ACTIONS,
  QDN_CHAT_ACTIONS,
  QDN_GROUP_ACTIONS,
  QDN_NAME_ACTIONS,
  QDN_PAYMENT_ACTIONS,
  QDN_POLL_ACTIONS,
  QDN_PRIVATE_GROUP_CHAT_WRITE_ACTIONS,
  QDN_TRUST_ACTIONS,
  QDN_WRITE_ACTIONS,
} from './qdn-app-actions.js';
import { getQdnViewContextForWebContents, type QdnViewContext } from './qdn-views.js';

// Resolve our own directory (mirrors electron/main.ts) so the worker_threads
// PoW worker file can be located next to this module both in dev (dist-electron/)
// and in the packaged app (inside app.asar/dist-electron/).
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CHAT memory-pow difficulty. Tracks the chain config (Previewnet
// previewchain.json chatDifficulty); keep in sync with src/platform.ts.
const CHAT_POW_DIFFICULTY = 8;
const ARBITRARY_POW_DIFFICULTY = 11;
const TRANSACTION_NONCE_OFFSET = 48;

const PREVIEW_ACCOUNTS_PATH = path.join(
  os.homedir(),
  'git',
  'qortium',
  'preview',
  'secrets',
  'initial-minting-accounts.json',
);
const QDN_APP_DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const QDN_APP_MAX_BYTES_LIMIT = 5 * 1024 * 1024;
// Public, read-only Qortal nodes for cross-chain QDN reads (no account, API key, or writes).
const QORTAL_PUBLIC_NODE_API_URLS = ['https://ext-node.qortal.link'];
const QORTAL_NODE_CACHE_TTL_MS = 5 * 60_000;
const QORTAL_PROBE_TIMEOUT_MS = 5_000;
// Qortal cross-chain resource fetches (e.g. game ROMs) need a much larger ceiling than QDN text reads.
const QDN_APP_QORTAL_DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const QDN_APP_QORTAL_MAX_BYTES_LIMIT = 64 * 1024 * 1024;
const ARCHIVE_RENDER_SERVICES = new Set(['APP', 'WEBSITE']);
// Must match the Core renderer's index file list and case-sensitive matching.
const QDN_PREVIEW_INDEX_FILES = new Set([
  'index.html',
  'index.htm',
  'default.html',
  'default.htm',
  'home.html',
  'home.htm',
]);
const QDN_PREVIEW_EXTENSION_SERVICES = new Map([
  ['apng', 'IMAGE'],
  ['avif', 'IMAGE'],
  ['bmp', 'IMAGE'],
  ['gif', 'IMAGE'],
  ['ico', 'IMAGE'],
  ['jpeg', 'IMAGE'],
  ['jpg', 'IMAGE'],
  ['png', 'IMAGE'],
  ['svg', 'IMAGE'],
  ['webp', 'IMAGE'],
  ['m4v', 'VIDEO'],
  ['mkv', 'VIDEO'],
  ['mov', 'VIDEO'],
  ['mp4', 'VIDEO'],
  ['ogv', 'VIDEO'],
  ['webm', 'VIDEO'],
  ['aac', 'AUDIO'],
  ['flac', 'AUDIO'],
  ['m4a', 'AUDIO'],
  ['mp3', 'AUDIO'],
  ['oga', 'AUDIO'],
  ['ogg', 'AUDIO'],
  ['opus', 'AUDIO'],
  ['wav', 'AUDIO'],
]);
const qdnPreviewStagingDirs = new Map<string, string>();
const QDN_WRITE_APPROVAL_TIMEOUT_MS = 120_000;
const QDN_WRITE_SMOKE_ROLE = 'local';
const QDN_CHAT_MESSAGE_MAX_BYTES = 4000;
const QDN_OPEN_NEW_TAB_URL_MAX_LENGTH = 2048;
const QDN_MEDIA_PLAYER_SERVICES = new Set(['AUDIO', 'PODCAST', 'VIDEO', 'VOICE']);
const QDN_MEDIA_PLAYER_FIELD_MAX_LENGTH = 1024;
const QDN_DOCUMENT_VIEWER_SERVICES = new Set(['DOCUMENT', 'FILE', 'FILES', 'ATTACHMENT']);
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const PUBLIC_QDN_SERVICES = new Set([
  'APP',
  'WEBSITE',
  'IMAGE',
  'THUMBNAIL',
  'QCHAT_IMAGE',
  'VIDEO',
  'AUDIO',
  'VOICE',
  'PODCAST',
  'DOCUMENT',
  'FILE',
  'FILES',
  'JSON',
  'METADATA',
  'BLOG',
  'BLOG_POST',
  'BLOG_COMMENT',
  'LIST',
  'PLAYLIST',
  'GIT_REPOSITORY',
  'GIF_REPOSITORY',
  'IMAGE_GALLERY',
  'STORE',
  'PRODUCT',
  'OFFER',
  'COUPON',
  'CODE',
  'PLUGIN',
  'EXTENSION',
  'GAME',
  'ITEM',
  'NFT',
  'DATABASE',
  'SNAPSHOT',
  'COMMENT',
  'CHAIN_COMMENT',
  'CHAIN_DATA',
  'ATTACHMENT',
  'MAIL',
  'MESSAGE',
]);

// Core marks its encrypted services with a `_PRIVATE` suffix. Home cannot decrypt
// these yet, so it recognizes them only to return a clearer message than the
// generic public-service rejection.
function isPrivateService(service: string) {
  return /^[A-Z0-9_]+_PRIVATE$/.test(service);
}

type QdnAuthorizeResourceRequest = {
  identifier?: unknown;
  name?: unknown;
  service?: unknown;
};

type QdnRawResourceRequest = QdnAuthorizeResourceRequest & {
  maxBytes?: unknown;
  multiFile?: unknown;
  path?: unknown;
  suggestedFilename?: unknown;
};

type QdnResourcesSearchRequest = {
  exactMatchNames?: unknown;
  includeMetadata?: unknown;
  includeStatus?: unknown;
  limit?: unknown;
  name?: unknown;
  prefix?: unknown;
  service?: unknown;
};

type QdnNamesSearchRequest = {
  limit?: unknown;
  prefix?: unknown;
  query?: unknown;
};

type NodeApiRequest = {
  maxBytes?: unknown;
  method?: unknown;
  path?: unknown;
};

type QdnPreviewContentRequest = {
  kind?: unknown;
  path?: unknown;
};

type QdnAppRequest = {
  action?: unknown;
  maxBytes?: unknown;
  method?: unknown;
  path?: unknown;
  payload?: unknown;
  [key: string]: unknown;
};

type QdnResourceRequest = {
  identifier?: string;
  name: string;
  path: string;
  service: string;
};

type QdnWriteAction = (typeof QDN_WRITE_ACTIONS)[number];
type QdnGroupAction = (typeof QDN_GROUP_ACTIONS)[number];
type QdnNameAction = (typeof QDN_NAME_ACTIONS)[number];
type QdnPaymentAction = (typeof QDN_PAYMENT_ACTIONS)[number];
type QdnPollAction = (typeof QDN_POLL_ACTIONS)[number];
type QdnTrustAction = (typeof QDN_TRUST_ACTIONS)[number];
type QdnChatAction = (typeof QDN_CHAT_ACTIONS)[number];
type QdnPrivateGroupChatWriteAction = (typeof QDN_PRIVATE_GROUP_CHAT_WRITE_ACTIONS)[number];
type QdnWriteApprovalAction =
  | QdnWriteAction
  | QdnGroupAction
  | QdnNameAction
  | QdnPaymentAction
  | QdnPollAction
  | QdnTrustAction
  | QdnChatAction
  | QdnPrivateGroupChatWriteAction
  | 'START_MINTING'
  | 'REMOVE_MINTING_ACCOUNT';
type QdnChatPermissionAction = 'SEND_CHAT_MESSAGE';

type QdnWriteResourceRequest = {
  category?: string;
  description?: string;
  fee?: number;
  identifier?: string;
  name: string;
  service: string;
  tags: string[];
  title?: string;
};

type QdnWriteSourceSelection = {
  dataBase64?: string;
  displayName: string;
  filename?: string;
  kind: 'data' | 'directory' | 'file';
  path?: string;
  size?: number;
};

type QdnWriteProfile = {
  accountId: string;
  address: string;
  label: string;
  name: string | null;
};

type QdnWriteSigner =
  | {
      accountId: string;
      kind: 'account';
    }
  | {
      kind: 'smoke';
      resource: QdnWriteResourceRequest;
    };

type QdnWriteContext = {
  apiKey: string;
  connection: NodeConnection;
  profile: QdnWriteProfile;
  signer: QdnWriteSigner;
};

type QdnChatContext = {
  accountId: string;
  apiKey: string;
  connection: NodeConnection;
  privateKey58: string;
  profile: QdnWriteProfile;
  publicKey58: string;
};

// Context for the keyless open-group chat path on a PUBLIC/network node. It holds
// the raw 64-byte ed25519 secret key for LOCAL signing only; the key is never put
// in a request body. No private-key base58 string is materialised.
type QdnKeylessChatContext = {
  accountId: string;
  apiKey: string;
  connection: NodeConnection;
  profile: QdnWriteProfile;
  publicKey58: string;
  secretKey: Uint8Array;
};

type QdnKeylessWriteContext = QdnKeylessChatContext;

type NodeConnection = Awaited<ReturnType<typeof getNodeConnection>>;

type QdnWriteApprovalDetails = {
  action: QdnWriteApprovalAction;
  amount?: number | string;
  approval?: boolean;
  chatMessagePreview?: string;
  groupId?: number;
  groupName?: string | null;
  mintingKey?: string | null;
  name?: string;
  permissionScope?: 'single-request' | 'session';
  recipientAddress?: string;
  resource?: QdnWriteResourceRequest;
  resourceCount?: number;
  source?: QdnWriteSourceSelection;
};

type NodeApiFetchResult = {
  body: string;
  contentLength?: number;
  contentType: string;
  data: unknown;
  headers: Record<string, string>;
  ok: boolean;
  status: number;
  statusText: string;
};

type QdnWriteApprovalResponse = {
  approved: boolean;
  requestId: string;
};

type PendingQdnApproval = {
  resolve: (approved: boolean) => void;
  windowWebContentsId: number;
};

const approvedQdnChatPermissions = new Set<string>();
const pendingQdnWriteApprovals = new Map<string, PendingQdnApproval>();
const BASE58_ALPHABET_MAP = new Map<string, number>(
  [...BASE58_ALPHABET].map((character, index) => [character, index]),
);

function expandHomePath(filePath: string) {
  if (filePath === '~') {
    return os.homedir();
  }

  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}

function sanitizeQdnWriteApprovalResponse(value: unknown): QdnWriteApprovalResponse {
  if (!isRecord(value)) {
    throw new Error('QDN write request response is required.');
  }

  if (typeof value.requestId !== 'string' || !value.requestId) {
    throw new Error('QDN write request id is required.');
  }

  return {
    approved: value.approved === true,
    requestId: value.requestId,
  };
}

function getQdnViewHostWindow(context: QdnViewContext) {
  return BrowserWindow.getAllWindows().find(
    (window) => !window.isDestroyed() && window.webContents.id === context.windowId,
  ) ?? null;
}

function getQdnViewResourceUrl(context: QdnViewContext) {
  return context.resourceUrl ?? context.currentUrl ?? 'QDN app';
}

function getQdnChatPermissionCacheKey(
  context: QdnViewContext,
  accountId: string,
  action: QdnChatPermissionAction,
) {
  return [
    context.windowId,
    context.tabId,
    context.currentUrl ?? '',
    accountId,
    action,
  ].join('\n');
}

// Sends an approval request to the host window renderer and resolves with the
// user's decision delivered through 'qdn-app:resolveWriteApproval'.
async function awaitQdnApprovalFromHostWindow(
  context: QdnViewContext,
  channel: string,
  payload: Record<string, unknown>,
) {
  const hostWindow = getQdnViewHostWindow(context);

  if (!hostWindow) {
    throw new Error('QDN app request does not belong to an active window.');
  }

  const requestId = randomUUID();

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (nextApproved: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      hostWindow.removeListener('closed', handleWindowClosed);
      pendingQdnWriteApprovals.delete(requestId);
      resolve(nextApproved);
    };
    const handleWindowClosed = () => settle(false);
    const timeoutId = setTimeout(() => settle(false), QDN_WRITE_APPROVAL_TIMEOUT_MS);

    pendingQdnWriteApprovals.set(requestId, {
      resolve: settle,
      windowWebContentsId: hostWindow.webContents.id,
    });
    hostWindow.once('closed', handleWindowClosed);
    hostWindow.webContents.send(channel, {
      ...payload,
      id: requestId,
    });
  });
}

async function requestQdnWriteApproval(
  context: QdnViewContext,
  profile: Awaited<ReturnType<typeof getAccountProfile>>,
  details: QdnWriteApprovalDetails,
) {
  const approved = await awaitQdnApprovalFromHostWindow(context, 'qdn-app:write-request', {
    accountName: profile.name,
    action: details.action,
    address: profile.address,
    amount: typeof details.amount === 'undefined' ? null : String(details.amount),
    approval: typeof details.approval === 'boolean' ? details.approval : null,
    chatMessagePreview: details.chatMessagePreview ?? null,
    groupId: typeof details.groupId === 'number' ? details.groupId : null,
    groupName: details.groupName ?? null,
    mintingKey: details.mintingKey ?? null,
    name: details.name ?? null,
    permissionScope: details.permissionScope ?? 'single-request',
    recipientAddress: details.recipientAddress ?? null,
    resource: details.resource
      ? {
          identifier: details.resource.identifier ?? null,
          name: details.resource.name,
          service: details.resource.service,
        }
      : null,
    resourceCount: details.resourceCount ?? null,
    resourceUrl: getQdnViewResourceUrl(context),
    sourceKind: details.source?.kind ?? null,
    sourceName: details.source?.displayName ?? null,
  });

  if (!approved) {
    throw new Error('QDN write request was denied.');
  }
}

async function requestQdnChatPermissionApproval(
  context: QdnViewContext,
  profile: Awaited<ReturnType<typeof getAccountProfile>>,
  action: QdnChatPermissionAction,
  details: Omit<QdnWriteApprovalDetails, 'action' | 'permissionScope'>,
) {
  const cacheKey = getQdnChatPermissionCacheKey(context, profile.accountId, action);

  if (approvedQdnChatPermissions.has(cacheKey)) {
    return;
  }

  await requestQdnWriteApproval(context, profile, {
    ...details,
    action,
    permissionScope: 'session',
  });

  approvedQdnChatPermissions.add(cacheKey);
}

// Home's own UI resolves account avatars itself now, but QDN apps still receive the
// selected account's avatar URL through the account bridge.
async function getAccountAvatarUrl(name: string | null) {
  if (!name) {
    return null;
  }

  try {
    const nodeApiUrl = await getNodeApiUrl();

    return `${nodeApiUrl}/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/avatar?async=true`;
  } catch {
    return null;
  }
}

function getNameValue(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const name = (value as { name?: unknown }).name;

  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

async function getPrimaryName(address: string, nodeApiUrl: string): Promise<string | null> {
  try {
    const response = await fetchNode(`/names/primary/${encodeURIComponent(address)}`, {}, nodeApiUrl);

    return response.ok ? getNameValue(await response.json()) : null;
  } catch {
    return null;
  }
}

async function getFirstOwnedName(address: string, nodeApiUrl: string): Promise<string | null> {
  try {
    const response = await fetchNode(
      `/names/address/${encodeURIComponent(address)}?limit=0`,
      {},
      nodeApiUrl,
    );

    if (!response.ok) {
      return null;
    }

    const data: unknown = await response.json();

    if (!Array.isArray(data)) {
      return null;
    }

    for (const entry of data) {
      const name = getNameValue(entry);

      if (name) {
        return name;
      }
    }

    return null;
  } catch {
    return null;
  }
}

const MAX_RESOLVE_IDENTITIES = 500;

// Batch-resolves display identities (registered name + avatar URL) for arbitrary
// addresses so a QDN app that shows many accounts makes one bridge call instead
// of several node round-trips per address. Read-only — works on public nodes.
async function resolveIdentitiesForQdnApp(request: QdnAppRequest) {
  const rawAddresses = request.addresses;

  if (!Array.isArray(rawAddresses)) {
    throw new Error('RESOLVE_IDENTITIES requires an "addresses" array.');
  }

  const addresses: string[] = [];
  const seen = new Set<string>();

  for (const value of rawAddresses) {
    const address = getString(value);

    if (address && !seen.has(address)) {
      seen.add(address);
      addresses.push(address);
    }
  }

  if (addresses.length > MAX_RESOLVE_IDENTITIES) {
    throw new Error(`RESOLVE_IDENTITIES accepts at most ${MAX_RESOLVE_IDENTITIES} addresses.`);
  }

  let nodeApiUrl = '';

  try {
    nodeApiUrl = await getNodeApiUrl();
  } catch {
    nodeApiUrl = '';
  }

  return Promise.all(
    addresses.map(async (address) => {
      let name: string | null = null;

      if (nodeApiUrl) {
        name = (await getPrimaryName(address, nodeApiUrl)) ?? (await getFirstOwnedName(address, nodeApiUrl));
      }

      const avatarSrc =
        name && nodeApiUrl
          ? `${nodeApiUrl}/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/avatar?async=true`
          : null;

      return { address, name, avatarSrc };
    }),
  );
}

async function getSelectedAccountForQdnApp(context: QdnViewContext | null) {
  if (!context) {
    throw new Error('QDN app requests are only available to isolated QDN app views.');
  }

  if (!context.accountId) {
    throw new Error('No account is selected for this tab.');
  }

  const profile = await getAccountProfile(context.accountId);

  return {
    address: profile.address,
    avatarUrl: await getAccountAvatarUrl(profile.name),
    isUnlocked: isAccountUnlocked(context.accountId),
    name: profile.name,
  };
}

// Prompts the user to unlock the selected account through Home's own password
// dialog; the app never sees the password. Cancelling is not an error - the
// returned account state tells the app whether the unlock happened.
async function unlockSelectedAccountForQdnApp(context: QdnViewContext | null) {
  if (!context) {
    throw new Error('UNLOCK_SELECTED_ACCOUNT is only available from a QDN app frame.');
  }

  if (!context.accountId) {
    throw new Error('No account is selected for this tab.');
  }

  if (!isAccountUnlocked(context.accountId)) {
    const profile = await getAccountProfile(context.accountId);

    await awaitQdnApprovalFromHostWindow(context, 'qdn-app:unlock-request', {
      accountId: profile.accountId,
      accountLabel: profile.label,
      accountName: profile.name,
      address: profile.address,
      resourceUrl: getQdnViewResourceUrl(context),
    });
  }

  return getSelectedAccountForQdnApp(context);
}

function isQdnWriteSmokeMode() {
  return !app.isPackaged && process.env.QORTIUM_HOME_QDN_WRITE_SMOKE === '1';
}

function getQdnWriteSmokeSourceSelection() {
  if (!isQdnWriteSmokeMode()) {
    return null;
  }

  const sourcePath = getString(process.env.QORTIUM_HOME_QDN_WRITE_SMOKE_SOURCE);

  if (!sourcePath) {
    throw new Error('QDN write smoke source path was not set.');
  }

  const expandedSourcePath = expandHomePath(sourcePath);

  if (!existsSync(expandedSourcePath)) {
    throw new Error('QDN write smoke source path does not exist.');
  }

  return {
    displayName: path.basename(expandedSourcePath) || 'Smoke source',
    kind: getQdnWriteSourceKind(expandedSourcePath),
    path: expandedSourcePath,
  } satisfies QdnWriteSourceSelection;
}

function getQdnWriteSmokeAccountRecord(resource: QdnWriteResourceRequest) {
  const accountsPath = expandHomePath(
    getString(process.env.QORTIUM_HOME_PREVIEW_ACCOUNTS_PATH) || PREVIEW_ACCOUNTS_PATH,
  );
  const role = getString(process.env.QORTIUM_HOME_SMOKE_ACCOUNT_ROLE) || QDN_WRITE_SMOKE_ROLE;
  const allowedName = getString(process.env.QORTIUM_HOME_QDN_WRITE_SMOKE_NAME);

  if (allowedName && resource.name !== allowedName) {
    throw new Error('QDN write smoke request did not match the configured publish name.');
  }

  let parsedAccounts: unknown;

  try {
    parsedAccounts = JSON.parse(readFileSync(accountsPath, 'utf8'));
  } catch {
    throw new Error('QDN write smoke preview account file could not be read.');
  }

  if (!isRecord(parsedAccounts) || !Array.isArray(parsedAccounts.accounts)) {
    throw new Error('QDN write smoke preview account file is invalid.');
  }

  const account = parsedAccounts.accounts.find(
    (candidate) => isRecord(candidate) && getString(candidate.role) === role,
  );

  if (!isRecord(account)) {
    throw new Error(`QDN write smoke preview account role was not found: ${role}.`);
  }

  return {
    account,
    role,
  };
}

function getQdnWriteSmokeProfile(resource: QdnWriteResourceRequest) {
  const { account, role } = getQdnWriteSmokeAccountRecord(resource);
  const address = getString(account.accountAddress);

  if (!address) {
    throw new Error('QDN write smoke preview account is missing account address.');
  }

  return {
    accountId: `preview:${role}`,
    address,
    label: `Preview ${role}`,
    name: resource.name,
  } satisfies QdnWriteProfile;
}

function getQdnWriteSmokePrivateKey(resource: QdnWriteResourceRequest) {
  const { account } = getQdnWriteSmokeAccountRecord(resource);
  const privateKey58 = getString(account.accountPrivateKey);

  if (!privateKey58) {
    throw new Error('QDN write smoke preview account is missing account private key.');
  }

  return privateKey58;
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getInteger(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }

  const stringValue = getString(value);

  if (/^-?\d+$/.test(stringValue)) {
    const parsedValue = Number(stringValue);

    return Number.isSafeInteger(parsedValue) ? parsedValue : undefined;
  }

  return undefined;
}

function getBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getRequestPayload(request: QdnAppRequest) {
  return isRecord(request.payload) ? request.payload : request;
}

function getRequestValue(request: QdnAppRequest, key: string) {
  const payload = getRequestPayload(request);

  return payload[key] ?? request[key];
}

function getRequiredRequestString(request: QdnAppRequest, key: string, label: string) {
  const value = getString(getRequestValue(request, key));

  if (!value) {
    throw new Error(`${label} is required.`);
  }

  return value;
}

function getRequiredGroupId(request: QdnAppRequest, minimumValue = 0) {
  const groupId = getInteger(getRequestValue(request, 'groupId') ?? getRequestValue(request, 'txGroupId'));

  if (typeof groupId !== 'number' || groupId < minimumValue) {
    throw new Error(
      minimumValue > 0
        ? 'Group id must be a positive integer.'
        : 'Group id must be a non-negative integer.',
    );
  }

  return groupId;
}

function getOptionalBase58RequestString(request: QdnAppRequest, key: string) {
  const value = getString(getRequestValue(request, key));

  return value || undefined;
}

function base58Encode(buffer: Uint8Array) {
  if (buffer.length === 0) {
    return '';
  }

  const digits = [0];

  for (const byte of buffer) {
    for (let index = 0; index < digits.length; index += 1) {
      digits[index] <<= 8;
    }

    digits[0] += byte;

    let carry = 0;

    for (let index = 0; index < digits.length; index += 1) {
      digits[index] += carry;
      carry = (digits[index] / 58) | 0;
      digits[index] %= 58;
    }

    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  for (let index = 0; buffer[index] === 0 && index < buffer.length - 1; index += 1) {
    digits.push(0);
  }

  return digits
    .reverse()
    .map((digit) => BASE58_ALPHABET[digit])
    .join('');
}

function base58Decode(value: string) {
  if (value.length === 0) {
    return new Uint8Array(0);
  }

  const bytes = [0];

  for (const character of value) {
    const mappedValue = BASE58_ALPHABET_MAP.get(character);

    if (mappedValue === undefined) {
      throw new Error(`Base58 value contains an invalid character: ${character}`);
    }

    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] *= 58;
    }

    bytes[0] += mappedValue;

    let carry = 0;

    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] += carry;
      carry = bytes[index] >> 8;
      bytes[index] &= 0xff;
    }

    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (let index = 0; value[index] === '1' && index < value.length - 1; index += 1) {
    bytes.push(0);
  }

  return new Uint8Array(bytes.reverse());
}

function getSignedTransactionSignature(signedTransactionBytes58: string) {
  const signedTransactionBytes = base58Decode(signedTransactionBytes58);

  if (signedTransactionBytes.length < 64) {
    throw new Error('Signed transaction did not contain a signature.');
  }

  return base58Encode(signedTransactionBytes.slice(-64));
}

function encodeChatTextData(message: string) {
  return base58Encode(Buffer.from(message, 'utf8'));
}

function getChatMessageText(request: QdnAppRequest) {
  const message =
    getString(getRequestValue(request, 'message')) || getString(getRequestValue(request, 'data'));

  if (!message) {
    throw new Error('Chat message is required.');
  }

  const byteLength = Buffer.byteLength(message, 'utf8');

  if (byteLength > QDN_CHAT_MESSAGE_MAX_BYTES) {
    throw new Error(
      `Chat message exceeds the ${QDN_CHAT_MESSAGE_MAX_BYTES.toLocaleString()} byte limit.`,
    );
  }

  return message;
}

function getRequiredAddressRequestString(request: QdnAppRequest, key: string, label: string) {
  const address = getRequiredRequestString(request, key, label);

  return assertQortiumAddress(address, label);
}

function assertQortiumAddress(address: string, label: string) {
  if (!/^Q[1-9A-HJ-NP-Za-km-z]{20,}$/.test(address)) {
    throw new Error(`${label} must be a Qortium address.`);
  }

  return address;
}

function getOptionalAddressRequestString(request: QdnAppRequest, label: string, ...keys: string[]) {
  const address = getOptionalStringRequestValue(request, ...keys);

  return address ? assertQortiumAddress(address, label) : '';
}

function getChatMessagePreview(message: string) {
  return message.length > 120 ? `${message.slice(0, 117)}...` : message;
}

type QdnChatMessageTarget =
  | {
      groupId: number;
      kind: 'group';
    }
  | {
      kind: 'direct';
      recipientAddress: string;
    };

function hasRequestValue(request: QdnAppRequest, key: string) {
  const value = getRequestValue(request, key);

  return typeof value !== 'undefined' && value !== null;
}

function getDirectChatRecipientAddress(request: QdnAppRequest) {
  for (const key of ['destinationAddress', 'recipient', 'recipientAddress']) {
    const value = getString(getRequestValue(request, key));

    if (value) {
      return value;
    }
  }

  if (getString(getRequestValue(request, 'recipientPublicKey'))) {
    throw new Error('Direct private chat requires a recipient address, not a recipient public key.');
  }

  return '';
}

function getDirectChatOtherAddress(request: QdnAppRequest) {
  const otherAddress = getString(getRequestValue(request, 'otherAddress')) || getDirectChatRecipientAddress(request);

  if (!otherAddress) {
    throw new Error('Other direct chat participant address is required.');
  }

  return otherAddress;
}

function getChatMessageTarget(request: QdnAppRequest): QdnChatMessageTarget {
  const hasGroupTarget = hasRequestValue(request, 'groupId') || hasRequestValue(request, 'txGroupId');
  const recipientAddress = getDirectChatRecipientAddress(request);

  if (hasGroupTarget && recipientAddress) {
    throw new Error('Chat message request must target either a group or a direct recipient, not both.');
  }

  if (recipientAddress) {
    return {
      kind: 'direct',
      recipientAddress,
    };
  }

  return {
    kind: 'group',
    groupId: getRequiredGroupId(request),
  };
}

function getAuthorizeRequest(value: QdnAuthorizeResourceRequest) {
  const service = getString(value.service).toUpperCase();
  const name = getString(value.name);
  const identifier = getString(value.identifier);

  if (!PUBLIC_QDN_SERVICES.has(service)) {
    throw new Error(
      isPrivateService(service)
        ? 'Private (encrypted) QDN resources cannot be opened in Home yet.'
        : 'Only public QDN resources can be loaded right now.',
    );
  }

  if (!name) {
    throw new Error('QDN resource name is required.');
  }

  return {
    service,
    name,
    identifier: identifier || undefined,
  };
}

function getService(value: unknown) {
  const service = getString(value).toUpperCase();

  if (!service) {
    return '';
  }

  if (!PUBLIC_QDN_SERVICES.has(service)) {
    throw new Error(
      isPrivateService(service)
        ? 'Private (encrypted) QDN resources cannot be opened in Home yet.'
        : 'Only public QDN services can be browsed right now.',
    );
  }

  return service;
}

function getRawResourceRequest(value: QdnRawResourceRequest) {
  return {
    ...getAuthorizeRequest(value),
    path: getString(value.path),
  };
}

function getRequestTags(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(getString).filter(Boolean);
  }

  const tag = getString(value);

  return tag ? [tag] : [];
}

function getQdnWriteTags(request: QdnAppRequest) {
  const tags = getRequestTags(getRequestValue(request, 'tags'));

  for (let index = 1; index <= 5; index += 1) {
    const tag = getString(getRequestValue(request, `tag${index}`));

    if (tag) {
      tags.push(tag);
    }
  }

  return [...new Set(tags)].slice(0, 5);
}

function getRequestFee(value: unknown) {
  const fee = getNumber(value);

  if (typeof fee === 'undefined') {
    return undefined;
  }

  if (!Number.isSafeInteger(fee) || fee < 0) {
    throw new Error('QDN write fee must be a non-negative integer.');
  }

  return fee;
}

function getTransactionFee(request: QdnAppRequest) {
  return getRequestFee(getRequestValue(request, 'fee')) ?? 0;
}

function getTransactionGroupId(request: QdnAppRequest, fallback = 0) {
  const txGroupId = getInteger(getRequestValue(request, 'txGroupId') ?? getRequestValue(request, 'feeGroupId'));

  if (typeof txGroupId === 'undefined') {
    return fallback;
  }

  if (txGroupId < 0) {
    throw new Error('Transaction group id must be a non-negative integer.');
  }

  return txGroupId;
}

function getRequiredAmountValue(request: QdnAppRequest, key: string, label: string) {
  const value = getRequestValue(request, key);

  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }

  const stringValue = getString(value);

  if (/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(stringValue)) {
    return stringValue;
  }

  throw new Error(`${label} must be a non-negative amount with up to 8 decimal places.`);
}

function getOptionalBooleanRequestValue(request: QdnAppRequest, ...keys: string[]) {
  for (const key of keys) {
    const value = getBoolean(getRequestValue(request, key));

    if (typeof value === 'boolean') {
      return value;
    }
  }

  return undefined;
}

function getOptionalIntegerRequestValue(request: QdnAppRequest, minimumValue: number, ...keys: string[]) {
  for (const key of keys) {
    const value = getInteger(getRequestValue(request, key));

    if (typeof value === 'undefined') {
      continue;
    }

    if (value < minimumValue) {
      throw new Error(`${key} must be at least ${minimumValue}.`);
    }

    return value;
  }

  return undefined;
}

function getOptionalStringRequestValue(request: QdnAppRequest, ...keys: string[]) {
  for (const key of keys) {
    const value = getString(getRequestValue(request, key));

    if (value) {
      return value;
    }
  }

  return '';
}

function getRequiredNameRequestString(request: QdnAppRequest) {
  return getRequiredRequestString(request, 'name', 'Name');
}

function getInlinePublishData(request: QdnAppRequest) {
  return getString(getRequestValue(request, 'data64')) || getString(getRequestValue(request, 'base64'));
}

function getInlinePublishSource(request: QdnAppRequest): QdnWriteSourceSelection | null {
  const dataBase64 = getInlinePublishData(request);

  if (!dataBase64) {
    return null;
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64) || dataBase64.length % 4 !== 0) {
    throw new Error('QDN publish data must be valid base64.');
  }

  const filename = sanitizeFilename(getString(getRequestValue(request, 'filename')) || 'qdn-resource');
  const size = Buffer.from(dataBase64, 'base64').byteLength;

  if (size > QDN_APP_MAX_BYTES_LIMIT) {
    throw new Error(
      `QDN publish data exceeds the ${QDN_APP_MAX_BYTES_LIMIT.toLocaleString()} byte limit.`,
    );
  }

  return {
    dataBase64,
    displayName: filename,
    filename,
    kind: 'data',
    size,
  };
}

function isInlineQdnWriteSource(
  source: QdnWriteSourceSelection,
): source is QdnWriteSourceSelection & { dataBase64: string; kind: 'data' } {
  return source.kind === 'data' && typeof source.dataBase64 === 'string';
}

function getQdnWriteResourceRequest(request: QdnAppRequest): QdnWriteResourceRequest {
  const service = getService(getRequestValue(request, 'service'));
  const name = getString(getRequestValue(request, 'name'));
  const identifier = getString(getRequestValue(request, 'identifier'));
  const title = getString(getRequestValue(request, 'title'));
  const description = getString(getRequestValue(request, 'description'));
  const category = getString(getRequestValue(request, 'category')).toUpperCase();

  if (!service) {
    throw new Error('QDN resource service is required.');
  }

  if (!name) {
    throw new Error('QDN resource name is required.');
  }

  return {
    service,
    name,
    identifier: identifier || undefined,
    title: title || undefined,
    description: description || undefined,
    tags: getQdnWriteTags(request),
    category: category || undefined,
    fee: getRequestFee(getRequestValue(request, 'fee')),
  };
}

function getQdnWriteResourceRequests(request: QdnAppRequest) {
  const resources = getRequestValue(request, 'resources');

  if (!Array.isArray(resources) || resources.length === 0) {
    throw new Error('QDN publish resources must be a non-empty array.');
  }

  return resources.map((resource, index) => {
    if (!isRecord(resource)) {
      throw new Error(`QDN publish resource ${index + 1} must be an object.`);
    }

    return {
      resource: getQdnWriteResourceRequest(resource as QdnAppRequest),
      source: getInlinePublishSource(resource as QdnAppRequest),
    };
  });
}

function splitPathAndQuery(resourcePath: string) {
  const queryIndex = resourcePath.indexOf('?');

  if (queryIndex === -1) {
    return {
      pathOnly: resourcePath,
      queryString: '',
    };
  }

  return {
    pathOnly: resourcePath.slice(0, queryIndex),
    queryString: resourcePath.slice(queryIndex + 1),
  };
}

function buildRawResourceUrl(resource: QdnResourceRequest, nodeApiUrl: string, attachment = false) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const { pathOnly, queryString } = splitPathAndQuery(resource.path);
  const queryParams = new URLSearchParams(queryString);

  if (pathOnly) {
    queryParams.set('filepath', pathOnly);
  }

  if (attachment) {
    queryParams.set('attachment', 'true');
  }

  const rawQueryString = queryParams.toString();

  return `${nodeApiUrl}/arbitrary/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}${
    rawQueryString ? `?${rawQueryString}` : ''
  }`;
}

function getContentLength(response: Response) {
  const rawLength = response.headers.get('content-length');

  if (!rawLength) {
    return undefined;
  }

  const contentLength = Number(rawLength);

  return Number.isFinite(contentLength) ? contentLength : undefined;
}

function sanitizeFilename(value: string) {
  const sanitized = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();

  return sanitized.slice(0, 180) || 'qdn-resource';
}

function getSuggestedFilename(request: QdnRawResourceRequest, resource: QdnResourceRequest) {
  const requestedFilename = getString(request.suggestedFilename);

  if (requestedFilename) {
    return sanitizeFilename(requestedFilename);
  }

  return sanitizeFilename(`${resource.service}_${resource.name}_${resource.identifier ?? 'default'}`);
}

function getAppPath(name: Parameters<typeof app.getPath>[0]) {
  try {
    return app.getPath(name);
  } catch {
    return '';
  }
}

function getDefaultDownloadPath(filename: string) {
  const documentsPath = getAppPath('documents');
  const homePath = getAppPath('home');
  const basePath = documentsPath && existsSync(documentsPath) ? documentsPath : homePath;

  return path.join(basePath || process.cwd(), filename);
}

function getNodeApiPath(value: unknown, nodeApiUrl: string) {
  const apiPath = getString(value);

  if (!apiPath.startsWith('/') || apiPath.startsWith('//')) {
    throw new Error('Node API paths must start with /.');
  }

  if (/[\x00-\x1F]/.test(apiPath)) {
    throw new Error('Node API path contains invalid control characters.');
  }

  const url = new URL(apiPath, nodeApiUrl);

  return `${url.pathname}${url.search}`;
}

function getNodeUnavailableMessage(nodeApiUrl: string) {
  return `Qortium node is unavailable at ${nodeApiUrl}.`;
}

function getNetworkRestrictionMessage() {
  return 'The selected Previewnet network node is public read-only and does not expose that endpoint. Use a local Core or trusted custom node for write, admin, or private API workflows.';
}

function isLoopbackHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();

  return (
    normalizedHostname === 'localhost' ||
    normalizedHostname === '::1' ||
    normalizedHostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalizedHostname)
  );
}

function assertLocalWriteConnection(connection: NodeConnection) {
  if (connection.mode === 'network') {
    throw new Error(getNetworkRestrictionMessage());
  }

  let url: URL;

  try {
    url = new URL(connection.nodeApiUrl);
  } catch {
    throw new Error('QDN write requests require a local Core node.');
  }

  if (!isLoopbackHostname(url.hostname)) {
    throw new Error('QDN write requests require a local Core node so Home never sends private keys or local file paths to a remote node.');
  }
}

function isLocalWriteConnection(connection: NodeConnection) {
  if (connection.mode === 'network') {
    return false;
  }

  try {
    return isLoopbackHostname(new URL(connection.nodeApiUrl).hostname);
  } catch {
    return false;
  }
}

function getNodeApiKey(connection: NodeConnection) {
  const apiKey = connection.apiKey?.trim();

  if (!apiKey) {
    if (connection.mode === 'custom') {
      throw new Error('Save the custom node API key before using protected QDN workflows.');
    }

    throw new Error('Start Qortium Core from Home, or save the local node API key before using protected QDN workflows.');
  }

  return apiKey;
}

async function fetchNode(pathname: string, options: RequestInit = {}, nodeApiUrl: string) {
  let response: Response;

  try {
    response = await fetch(`${nodeApiUrl}${pathname}`, options);
  } catch {
    throw new Error(getNodeUnavailableMessage(nodeApiUrl));
  }

  return response;
}

async function fetchConfiguredNode(pathname: string, options: RequestInit = {}) {
  const connection = await getNodeConnection();

  try {
    return {
      connection,
      response: await fetchNode(pathname, options, connection.nodeApiUrl),
    };
  } catch (error) {
    if (connection.mode !== 'network') {
      throw error;
    }

    const retryConnection = await getNodeConnection(true);

    if (retryConnection.nodeApiUrl === connection.nodeApiUrl) {
      throw error;
    }

    return {
      connection: retryConnection,
      response: await fetchNode(pathname, options, retryConnection.nodeApiUrl),
    };
  }
}

async function fetchRawResource(
  resource: QdnResourceRequest,
  connection: NodeConnection,
  attachment = false,
) {
  const headers: Record<string, string> = {};

  if (connection.mode !== 'network') {
    headers['X-API-KEY'] = getNodeApiKey(connection);
  }

  const response = await fetchNode(
    buildRawResourceUrl(resource, connection.nodeApiUrl, attachment).replace(connection.nodeApiUrl, ''),
    {
      headers,
    },
    connection.nodeApiUrl,
  );

  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(
      response.status === 403 && connection.mode === 'network'
        ? getNetworkRestrictionMessage()
        : message || `QDN raw resource request failed with HTTP ${response.status}.`,
    );
  }

  return response;
}

async function fetchConfiguredRawResource(resource: QdnResourceRequest, attachment = false) {
  const connection = await getNodeConnection();

  try {
    return await fetchRawResource(resource, connection, attachment);
  } catch (error) {
    if (connection.mode !== 'network') {
      throw error;
    }

    const retryConnection = await getNodeConnection(true);

    if (retryConnection.nodeApiUrl === connection.nodeApiUrl) {
      throw error;
    }

    return await fetchRawResource(resource, retryConnection, attachment);
  }
}

// Best-effort lookup of a multi-file resource's declared entry point (Core v1.1.0
// metadata.entryPoint). Used to render APP/WEBSITE archives whose entry file is not
// index.html. Any failure returns undefined so the renderer falls back to the
// conventional index file.
async function fetchResourceEntryPoint(resource: QdnResourceRequest): Promise<string | undefined> {
  try {
    const connection = await getNodeConnection();
    const headers: Record<string, string> = {};

    if (connection.mode !== 'network') {
      headers['X-API-KEY'] = getNodeApiKey(connection);
    }

    const identifier = resource.identifier ? resource.identifier : 'default';
    const metadataPath = `/arbitrary/metadata/${resource.service}/${encodeURIComponent(
      resource.name,
    )}/${encodeURIComponent(identifier)}`;
    const response = await fetchNode(metadataPath, { headers }, connection.nodeApiUrl);

    if (!response.ok) {
      return undefined;
    }

    const metadata: unknown = await response.json();
    const entryPoint =
      metadata && typeof metadata === 'object'
        ? (metadata as { entryPoint?: unknown }).entryPoint
        : undefined;

    return typeof entryPoint === 'string' && entryPoint ? entryPoint : undefined;
  } catch {
    return undefined;
  }
}

// Guards so a pathological resource can't exhaust memory while we build the zip.
const MAX_ZIP_FILE_COUNT = 5000;
const MAX_ZIP_TOTAL_BYTES = 512 * 1024 * 1024;

// Read a multi-file resource's relative file paths from its metadata. The node's
// metadata endpoint always includes the file list.
async function fetchResourceFileList(resource: QdnResourceRequest): Promise<string[]> {
  const connection = await getNodeConnection();
  const headers: Record<string, string> = {};

  if (connection.mode !== 'network') {
    headers['X-API-KEY'] = getNodeApiKey(connection);
  }

  const identifier = resource.identifier ? resource.identifier : 'default';
  const metadataPath = `/arbitrary/metadata/${resource.service}/${encodeURIComponent(
    resource.name,
  )}/${encodeURIComponent(identifier)}`;
  const response = await fetchNode(metadataPath, { headers }, connection.nodeApiUrl);

  if (!response.ok) {
    throw new Error(`Unable to read the resource file list (HTTP ${response.status}).`);
  }

  const metadata: unknown = await response.json();

  return isRecord(metadata) && Array.isArray(metadata.files)
    ? metadata.files.map(getString).filter(Boolean)
    : [];
}

// Multi-file resources have no single artifact to download, so assemble the
// archive client-side: list the files, fetch each one by its relative path, and
// zip them in-process.
async function buildResourceZip(resource: QdnResourceRequest): Promise<Buffer> {
  const files = await fetchResourceFileList(resource);

  if (files.length === 0) {
    throw new Error('This resource has no files to download.');
  }

  if (files.length > MAX_ZIP_FILE_COUNT) {
    throw new Error(`This resource has too many files to download as a zip (${files.length}).`);
  }

  const entries: Record<string, Uint8Array> = {};
  let totalBytes = 0;

  for (const file of files) {
    const response = await fetchConfiguredRawResource({ ...resource, path: file });
    const bytes = new Uint8Array(await response.arrayBuffer());
    totalBytes += bytes.byteLength;

    if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
      throw new Error('This resource is too large to download as a zip.');
    }

    entries[file] = bytes;
  }

  return Buffer.from(zipSync(entries));
}

async function postAuthorizeResource(
  service: string,
  name: string,
  identifier: string | undefined,
  apiKey: string,
  nodeApiUrl: string,
) {
  const identifierPath = identifier ? `/${encodeURIComponent(identifier)}` : '';

  return fetchNode(
    `/render/authorize/${service}/${encodeURIComponent(name)}${identifierPath}`,
    {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
      },
    },
    nodeApiUrl,
  );
}

async function authorizeResource(
  service: string,
  name: string,
  identifier: string | undefined,
  connection: NodeConnection,
) {
  let response = await postAuthorizeResource(
    service,
    name,
    identifier,
    getNodeApiKey(connection),
    connection.nodeApiUrl,
  );

  if (response.ok) {
    return connection;
  }

  let message = (await response.text()).trim();

  if (isInvalidApiKeyResponse(response, message)) {
    const refreshedConnection = await refreshNodeConnectionApiKey(connection);

    if (refreshedConnection) {
      response = await postAuthorizeResource(
        service,
        name,
        identifier,
        getNodeApiKey(refreshedConnection),
        refreshedConnection.nodeApiUrl,
      );

      if (response.ok) {
        return refreshedConnection;
      }

      message = (await response.text()).trim();
    }
  }

  throw new Error(message || `QDN authorization failed with HTTP ${response.status}.`);
}

function buildResourcesSearchPath(request: QdnResourcesSearchRequest) {
  const service = getService(request.service);
  const name = getString(request.name);
  const prefix = getBoolean(request.prefix) ?? false;
  const limit = Math.max(0, Math.floor(getNumber(request.limit) ?? 0));
  const queryParams = new URLSearchParams({
    mode: 'ALL',
    limit: String(limit),
    includestatus: String(getBoolean(request.includeStatus) ?? true),
    includemetadata: String(getBoolean(request.includeMetadata) ?? true),
  });

  if (service) {
    queryParams.set('service', service);
  }

  if (name) {
    queryParams.set('name', name);

    // `prefix` and `exactmatchnames` are mutually exclusive on the node — prefix
    // search matches name/identifier prefixes, so skip exact matching for it.
    if (!prefix) {
      queryParams.set('exactmatchnames', String(getBoolean(request.exactMatchNames) ?? true));
    }
  }

  if (prefix) {
    queryParams.set('prefix', 'true');
  }

  return `/arbitrary/resources/search?${queryParams.toString()}`;
}

function buildNamesSearchPath(request: QdnNamesSearchRequest) {
  const query = getString(request.query);
  const limit = Math.max(0, Math.floor(getNumber(request.limit) ?? 0));
  const queryParams = new URLSearchParams({ query });

  if (limit > 0) {
    queryParams.set('limit', String(limit));
  }

  if (getBoolean(request.prefix) ?? false) {
    queryParams.set('prefix', 'true');
  }

  return `/names/search?${queryParams.toString()}`;
}

function getQdnAppMaxBytes(value: unknown) {
  const maxBytes = Math.floor(getNumber(value) ?? QDN_APP_DEFAULT_MAX_BYTES);

  return Math.max(0, Math.min(maxBytes, QDN_APP_MAX_BYTES_LIMIT));
}

function getReadOnlyMethod(value: unknown) {
  const method = getString(value).toUpperCase() || 'GET';

  if (method !== 'GET' && method !== 'HEAD') {
    throw new Error('QDN app node API requests only support GET and HEAD right now.');
  }

  return method;
}

function getHeaders(response: Response) {
  const headers: Record<string, string> = {};

  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return headers;
}

function parseResponseData(body: string, contentType: string) {
  const normalizedContentType = contentType.toLowerCase();

  if (!body) {
    return null;
  }

  if (
    normalizedContentType.includes('json') ||
    body.trimStart().startsWith('{') ||
    body.trimStart().startsWith('[')
  ) {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return body;
    }
  }

  return body;
}

async function readNodeApiResponse(
  response: Response,
  connection: NodeConnection,
  maxBytes: number,
  readBody = true,
): Promise<NodeApiFetchResult> {
  const contentLength = getContentLength(response);
  const contentType = response.headers.get('content-type') ?? '';
  const headers = getHeaders(response);

  if (maxBytes > 0 && typeof contentLength === 'number' && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Node API response exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  const rawBody = readBody ? await response.text() : '';
  const body =
    response.status === 403 && connection.mode === 'network'
      ? getNetworkRestrictionMessage()
      : rawBody;
  const bodyLength = Buffer.byteLength(body, 'utf8');

  if (maxBytes > 0 && bodyLength > maxBytes) {
    throw new Error(`Node API response exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  return {
    body,
    contentLength: contentLength ?? bodyLength,
    contentType,
    data: parseResponseData(body, contentType),
    headers,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  };
}

async function fetchConfiguredNodeApi(
  apiPath: string,
  maxBytes: number,
  method: 'GET' | 'HEAD' = 'GET',
) {
  const { connection, response } = await fetchConfiguredNode(apiPath, { method });

  return readNodeApiResponse(response, connection, maxBytes, method !== 'HEAD');
}

async function fetchNodeApiPayload(apiPath: string, request: QdnAppRequest) {
  const result = await fetchConfiguredNodeApi(
    apiPath,
    getQdnAppMaxBytes(getRequestValue(request, 'maxBytes')),
  );

  if (!result.ok) {
    throw new Error(result.body || `Qortium node request failed with HTTP ${result.status}.`);
  }

  // Opt-in: return the status + response headers alongside the body, so apps can
  // read headers such as X-Total-Count (used by the paginated trust-derivation
  // listing). Default stays the bare body for backward compatibility.
  if (getBoolean(getRequestValue(request, 'includeHeaders')) ?? false) {
    return { status: result.status, headers: result.headers, data: result.data };
  }

  return result.data;
}

// --- Read-only cross-chain reads from a public Qortal node ---
// Mirrors the desktop QDN read pipeline but targets a public Qortal node: GET/HEAD against public
// QDN services only, no account, API key, signing or writes.

let cachedQortalNodeApiUrl: { url: string; expiresAt: number } | null = null;

async function resolveQortalNodeApiUrl(): Promise<string> {
  if (cachedQortalNodeApiUrl && cachedQortalNodeApiUrl.expiresAt > Date.now()) {
    return cachedQortalNodeApiUrl.url;
  }

  for (const candidate of QORTAL_PUBLIC_NODE_API_URLS) {
    try {
      const response = await fetchNode(
        '/admin/status',
        { method: 'GET', signal: AbortSignal.timeout(QORTAL_PROBE_TIMEOUT_MS) },
        candidate,
      );
      if (response.ok) {
        cachedQortalNodeApiUrl = { url: candidate, expiresAt: Date.now() + QORTAL_NODE_CACHE_TTL_MS };
        return candidate;
      }
    } catch {
      // Try the next public Qortal node.
    }
  }

  throw new Error('No public Qortal node is reachable right now.');
}

async function fetchQortalNodeApi(
  apiPath: string,
  maxBytes: number,
  method: 'GET' | 'HEAD' = 'GET',
): Promise<NodeApiFetchResult> {
  const nodeApiUrl = await resolveQortalNodeApiUrl();
  const response = await fetchNode(apiPath, { method }, nodeApiUrl);

  const contentLength = getContentLength(response);
  const contentType = response.headers.get('content-type') ?? '';
  const headers = getHeaders(response);

  if (maxBytes > 0 && typeof contentLength === 'number' && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Qortal node response exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  const body = method !== 'HEAD' ? await response.text() : '';
  const bodyLength = Buffer.byteLength(body, 'utf8');

  if (maxBytes > 0 && bodyLength > maxBytes) {
    throw new Error(`Qortal node response exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  return {
    body,
    contentLength: contentLength ?? bodyLength,
    contentType,
    data: parseResponseData(body, contentType),
    headers,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  };
}

async function fetchQortalNodeApiPayload(apiPath: string, request: QdnAppRequest) {
  const result = await fetchQortalNodeApi(apiPath, getQdnAppMaxBytes(getRequestValue(request, 'maxBytes')));

  if (!result.ok) {
    throw new Error(result.body || `Qortal node request failed with HTTP ${result.status}.`);
  }

  return result.data;
}

// Qortal resource requests are validated by shape only (read-only public reads); NOT limited to the
// Qortium public-service whitelist, since Qortal resources (ROMs, metadata, etc.) use many services.
function getQortalService(value: unknown) {
  const service = getString(value).toUpperCase();

  if (!service) {
    throw new Error('Qortal resource service is required.');
  }
  if (!/^[A-Z0-9_]+$/.test(service)) {
    throw new Error('Qortal resource service is invalid.');
  }

  return service;
}

function getQortalResourceRequest(request: QdnAppRequest) {
  const service = getQortalService(getRequestValue(request, 'service'));
  const name = getString(getRequestValue(request, 'name'));
  const identifier = getString(getRequestValue(request, 'identifier'));
  const resourcePath = getString(getRequestValue(request, 'path')) || getString(getRequestValue(request, 'filepath'));

  if (!name) {
    throw new Error('Qortal resource name is required.');
  }

  return { service, name, identifier: identifier || undefined, path: resourcePath };
}

function buildQortalResourcePath(resource: { service: string; name: string; identifier?: string; path?: string }) {
  const queryParams = new URLSearchParams();
  if (resource.path) {
    queryParams.set('filepath', resource.path);
  }
  const queryString = queryParams.toString();

  return `/arbitrary/${resource.service}/${encodeURIComponent(resource.name)}${
    resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : ''
  }${queryString ? `?${queryString}` : ''}`;
}

function buildQortalStatusPath(request: QdnAppRequest) {
  const resource = getQortalResourceRequest(request);
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  if (typeof getBoolean(getRequestValue(request, 'build')) === 'boolean') {
    queryParams.set('build', String(getBoolean(getRequestValue(request, 'build'))));
  }

  const queryString = queryParams.toString();

  return `/arbitrary/resource/status/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}${
    queryString ? `?${queryString}` : ''
  }`;
}

function buildQortalMetadataPath(request: QdnAppRequest) {
  const resource = getQortalResourceRequest(request);

  return `/arbitrary/metadata/${resource.service}/${encodeURIComponent(resource.name)}/${encodeURIComponent(
    resource.identifier ?? 'default',
  )}`;
}

function getQortalResourceMaxBytes(value: unknown) {
  const maxBytes = Math.floor(getNumber(value) ?? QDN_APP_QORTAL_DEFAULT_MAX_BYTES);

  return Math.max(0, Math.min(maxBytes, QDN_APP_QORTAL_MAX_BYTES_LIMIT));
}

// Fetches a Qortal QDN resource as binary, returned base64-encoded so the app can build a blob URL
// (e.g. for an emulator ROM). Returns { body: base64, encoding, contentType, contentLength }.
async function fetchQortalResourceBinary(request: QdnAppRequest) {
  const resource = getQortalResourceRequest(request);
  const maxBytes = getQortalResourceMaxBytes(getRequestValue(request, 'maxBytes'));
  const apiPath = buildQortalResourcePath(resource);

  const nodeApiUrl = await resolveQortalNodeApiUrl();
  const response = await fetchNode(apiPath, { method: 'GET' }, nodeApiUrl);

  if (!response.ok) {
    throw new Error(`Qortal resource request failed with HTTP ${response.status}.`);
  }

  const contentLength = getContentLength(response);
  if (maxBytes > 0 && typeof contentLength === 'number' && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Qortal resource exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (maxBytes > 0 && arrayBuffer.byteLength > maxBytes) {
    throw new Error(`Qortal resource exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  return {
    body: Buffer.from(arrayBuffer).toString('base64'),
    encoding: 'base64' as const,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    contentLength: contentLength ?? arrayBuffer.byteLength,
  };
}

// Returns the direct URL of a Qortal resource on the public node. The Qortal node serves these with
// CORS and ranged GET, so an in-app player (e.g. EmulatorJS) can stream the file straight from it.
async function getQortalResourceUrl(request: QdnAppRequest) {
  const resource = getQortalResourceRequest(request);
  const nodeApiUrl = await resolveQortalNodeApiUrl();

  return { url: `${nodeApiUrl.replace(/\/+$/, '')}${buildQortalResourcePath(resource)}` };
}

async function readSuccessfulNodeText(response: Response, fallbackMessage: string) {
  const body = await response.text();

  if (!response.ok) {
    throw new Error(body.trim() || fallbackMessage);
  }

  return {
    body: body.trim(),
    contentType: response.headers.get('content-type') ?? '',
  };
}

async function postLocalNodeText(
  connection: NodeConnection,
  pathname: string,
  body: string,
  apiKey: string,
  fallbackMessage: string,
  contentType = 'text/plain',
) {
  const response = await fetchNode(
    pathname,
    {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'X-API-KEY': apiKey,
      },
      body,
    },
    connection.nodeApiUrl,
  );

  return readSuccessfulNodeText(response, fallbackMessage);
}

async function deleteLocalNodeText(
  connection: NodeConnection,
  pathname: string,
  body: string,
  apiKey: string,
  fallbackMessage: string,
  contentType = 'text/plain',
) {
  const response = await fetchNode(
    pathname,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': contentType,
        'X-API-KEY': apiKey,
      },
      body,
    },
    connection.nodeApiUrl,
  );

  return readSuccessfulNodeText(response, fallbackMessage);
}

async function signAndProcessTransaction(
  connection: NodeConnection,
  apiKey: string,
  privateKey58: string,
  rawUnsignedBytes58: string,
  computePath: string | null = '/arbitrary/compute',
) {
  // A null computePath skips nonce computation for transaction types without a MemoryPoW fee alternative.
  const rawUnsignedWithNonce = computePath
    ? await postLocalNodeText(
        connection,
        computePath,
        rawUnsignedBytes58,
        apiKey,
        'QDN transaction nonce computation failed.',
      )
    : { body: rawUnsignedBytes58 };
  const signedTransaction = await postLocalNodeText(
    connection,
    '/transactions/sign',
    JSON.stringify({
      privateKey: privateKey58,
      transactionBytes: rawUnsignedWithNonce.body,
    }),
    apiKey,
    'QDN transaction signing failed.',
    'application/json',
  );
  const processedTransaction = await postLocalNodeText(
    connection,
    '/transactions/process',
    signedTransaction.body,
    apiKey,
    'QDN transaction processing failed.',
  );

  return {
    body: processedTransaction.body,
    data: parseResponseData(processedTransaction.body, processedTransaction.contentType),
    signature: getSignedTransactionSignature(signedTransaction.body),
    signedTransactionBytes: signedTransaction.body,
  };
}

function clearTransactionNonce(unsignedBytes: Uint8Array) {
  if (unsignedBytes.length < TRANSACTION_NONCE_OFFSET + 4) {
    throw new Error('Unsigned transaction bytes are too short to contain a nonce field.');
  }

  const bytesForPow = unsignedBytes.slice();
  bytesForPow[TRANSACTION_NONCE_OFFSET] = 0;
  bytesForPow[TRANSACTION_NONCE_OFFSET + 1] = 0;
  bytesForPow[TRANSACTION_NONCE_OFFSET + 2] = 0;
  bytesForPow[TRANSACTION_NONCE_OFFSET + 3] = 0;

  return bytesForPow;
}

async function signAndProcessKeylessQdnTransaction(
  keylessContext: QdnKeylessWriteContext,
  rawUnsignedBytes58: string,
) {
  const unsignedBytes = base58Decode(rawUnsignedBytes58);
  const nonce = await computeChatNonce(clearTransactionNonce(unsignedBytes), ARBITRARY_POW_DIFFICULTY);
  const signedBytes = signTransactionWithNonce(unsignedBytes, nonce, keylessContext.secretKey);
  const signedTransactionBytes = base58Encode(signedBytes);
  const processedTransaction = await postLocalNodeText(
    keylessContext.connection,
    '/transactions/process?apiVersion=2',
    signedTransactionBytes,
    keylessContext.apiKey,
    'QDN transaction processing failed.',
  );

  return {
    body: processedTransaction.body,
    data: parseResponseData(processedTransaction.body, processedTransaction.contentType),
    signature: getSignedTransactionSignature(signedTransactionBytes),
    signedTransactionBytes,
  };
}

function appendQdnWriteQuery(queryParams: URLSearchParams, resource: QdnWriteResourceRequest) {
  appendQueryValue(queryParams, 'title', resource.title);
  appendQueryValue(queryParams, 'description', resource.description);
  appendQueryValue(queryParams, 'category', resource.category);
  appendQueryValue(queryParams, 'fee', resource.fee);

  for (const tag of resource.tags) {
    appendQueryValue(queryParams, 'tags', tag);
  }
}

function buildQdnPublishPath(resource: QdnWriteResourceRequest) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQdnWriteQuery(queryParams, resource);

  const queryString = queryParams.toString();

  return `/arbitrary/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}${
    queryString ? `?${queryString}` : ''
  }`;
}

function buildQdnPublishBase64Path(resource: QdnWriteResourceRequest, source: QdnWriteSourceSelection) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQdnWriteQuery(queryParams, resource);
  appendQueryValue(queryParams, 'filename', source.filename);

  const queryString = queryParams.toString();

  return `/arbitrary/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}/base64${
    queryString ? `?${queryString}` : ''
  }`;
}

function buildQdnPublicPublishBase64Path(resource: QdnWriteResourceRequest, source: QdnWriteSourceSelection) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQdnWriteQuery(queryParams, resource);
  appendQueryValue(queryParams, 'filename', source.filename);

  const queryString = queryParams.toString();

  return `/arbitrary/public/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}/base64${
    queryString ? `?${queryString}` : ''
  }`;
}

function buildQdnPublicPublishZipPath(resource: QdnWriteResourceRequest) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQdnWriteQuery(queryParams, resource);

  const queryString = queryParams.toString();

  return `/arbitrary/public/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}/zip${
    queryString ? `?${queryString}` : ''
  }`;
}

function buildQdnDeletePath(resource: QdnWriteResourceRequest) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQueryValue(queryParams, 'fee', resource.fee);

  const queryString = queryParams.toString();

  return `/arbitrary/resource/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}/delete${
    queryString ? `?${queryString}` : ''
  }`;
}

function buildQdnPublicDeletePath(resource: QdnWriteResourceRequest) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQueryValue(queryParams, 'fee', resource.fee);

  const queryString = queryParams.toString();

  return `/arbitrary/public/resource/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}/delete${
    queryString ? `?${queryString}` : ''
  }`;
}

function getQdnWriteAccountId(context: QdnViewContext | null) {
  if (!context) {
    throw new Error('QDN app requests are only available to isolated QDN app views.');
  }

  if (!context.accountId) {
    throw new Error('No account is selected for this tab.');
  }

  return context.accountId;
}

function getQdnWriteSourceKind(filePath: string): QdnWriteSourceSelection['kind'] {
  try {
    return statSync(filePath).isDirectory() ? 'directory' : 'file';
  } catch {
    return 'file';
  }
}

function getQdnPreviewContentRequest(value: QdnPreviewContentRequest) {
  const kind = getString(value.kind);
  const sourcePath = getString(value.path);

  if (kind && kind !== 'directory' && kind !== 'file') {
    throw new Error('QDN preview source kind must be "directory" or "file".');
  }

  return {
    kind: kind === 'directory' ? ('directory' as const) : ('file' as const),
    sourcePath: sourcePath || undefined,
  };
}

async function createQdnPreviewStagingDir(sourcePath: string) {
  const previousDir = qdnPreviewStagingDirs.get(sourcePath);

  if (previousDir) {
    await rm(previousDir, { force: true, recursive: true });
  }

  const stagingDir = await mkdtemp(path.join(os.tmpdir(), 'qortium-home-preview-'));

  qdnPreviewStagingDirs.set(sourcePath, stagingDir);

  return stagingDir;
}

// Match the Core publish flow, which descends into a single extracted folder
// while ignoring "_"-prefixed system entries such as __MACOSX.
async function resolveExtractedQdnPreviewRoot(stagingDir: string) {
  const entries = (await readdir(stagingDir)).filter((entry) => !entry.startsWith('_'));

  if (entries.length === 1) {
    const candidate = path.join(stagingDir, entries[0]);

    if ((await stat(candidate)).isDirectory()) {
      return candidate;
    }
  }

  return stagingDir;
}

async function assertQdnPreviewIndexFile(directoryPath: string) {
  const entries = await readdir(directoryPath);

  if (!entries.some((entry) => QDN_PREVIEW_INDEX_FILES.has(entry))) {
    throw new Error('Website previews need an index file (for example index.html) in the top level of the folder or zip.');
  }
}

async function stageQdnPreviewSource(sourcePath: string) {
  let sourceStats;

  try {
    sourceStats = await stat(sourcePath);
  } catch {
    throw new Error(`Preview source does not exist: ${sourcePath}`);
  }

  if (sourceStats.isDirectory()) {
    await assertQdnPreviewIndexFile(sourcePath);

    return {
      previewPath: sourcePath,
      service: 'WEBSITE',
      sourceKind: 'directory' as const,
    };
  }

  const extension = path.extname(sourcePath).slice(1).toLowerCase();

  if (extension === 'zip') {
    const stagingDir = await createQdnPreviewStagingDir(sourcePath);

    await extract(sourcePath, { dir: stagingDir });
    const previewPath = await resolveExtractedQdnPreviewRoot(stagingDir);

    await assertQdnPreviewIndexFile(previewPath);

    return {
      previewPath,
      service: 'WEBSITE',
      sourceKind: 'file' as const,
    };
  }

  if (extension === 'html' || extension === 'htm') {
    // Stage the file as index.html so the Core accepts it as a standalone website.
    const stagingDir = await createQdnPreviewStagingDir(sourcePath);

    await copyFile(sourcePath, path.join(stagingDir, 'index.html'));

    return {
      previewPath: stagingDir,
      service: 'WEBSITE',
      sourceKind: 'file' as const,
    };
  }

  const service = QDN_PREVIEW_EXTENSION_SERVICES.get(extension);

  if (!service) {
    throw new Error(
      'Unsupported preview content. Choose a folder or zip containing an index.html file, an HTML file, or an image, video, or audio file.',
    );
  }

  return {
    previewPath: sourcePath,
    service,
    sourceKind: 'file' as const,
  };
}

function getQdnPreviewErrorMessage(body: string, status: number) {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };

    if (parsed && typeof parsed.message === 'string' && parsed.message) {
      return parsed.message;
    }
  } catch {
    // Fall through to the generic messages below.
  }

  // Nodes without the preview endpoint route the request elsewhere and answer
  // with a generic 404 or an HTML 500 page instead of a JSON API error.
  if (status === 404 || status === 500) {
    return 'The connected Qortium Core node does not support QDN previews yet. Update Qortium Core and try again.';
  }

  return `Qortium node preview request failed with HTTP ${status}.`;
}

function isSameQdnWriteContext(
  currentContext: QdnViewContext | null,
  originalContext: QdnViewContext,
) {
  return (
    !!currentContext &&
    currentContext.accountId === originalContext.accountId &&
    currentContext.currentUrl === originalContext.currentUrl &&
    currentContext.nodeOrigin === originalContext.nodeOrigin &&
    currentContext.tabId === originalContext.tabId &&
    currentContext.windowId === originalContext.windowId
  );
}

function assertFreshQdnWriteContext(sender: WebContents, originalContext: QdnViewContext) {
  const currentContext = getQdnViewContextForWebContents(sender);

  if (!isSameQdnWriteContext(currentContext, originalContext)) {
    throw new Error('QDN write request is stale because the app view changed before approval.');
  }
}

async function selectQdnPublishSource(context: QdnViewContext) {
  const smokeSource = getQdnWriteSmokeSourceSelection();

  if (smokeSource) {
    return smokeSource;
  }

  const hostWindow = getQdnViewHostWindow(context);

  if (!hostWindow) {
    throw new Error('QDN publish request does not belong to an active window.');
  }

  const result = await dialog.showOpenDialog(hostWindow, {
    buttonLabel: 'Select',
    properties: ['openFile', 'openDirectory'],
    title: 'Select QDN Publish Source',
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const selectedPath = result.filePaths[0];

  return {
    displayName: path.basename(selectedPath) || 'Selected item',
    kind: getQdnWriteSourceKind(selectedPath),
    path: selectedPath,
  } satisfies QdnWriteSourceSelection;
}

function assertPublicQdnPublishSize(size: number, label: string) {
  if (size > QDN_APP_MAX_BYTES_LIMIT) {
    throw new Error(`${label} exceeds the ${QDN_APP_MAX_BYTES_LIMIT.toLocaleString()} byte public-node publish limit.`);
  }
}

async function buildDirectoryZipEntries(
  rootPath: string,
  currentPath: string,
  entries: Record<string, Uint8Array>,
  total: { bytes: number },
) {
  const directoryEntries = await readdir(currentPath, { withFileTypes: true });

  for (const entry of directoryEntries) {
    const entryPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      await buildDirectoryZipEntries(rootPath, entryPath, entries, total);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const bytes = new Uint8Array(await readFile(entryPath));
    total.bytes += bytes.byteLength;
    assertPublicQdnPublishSize(total.bytes, 'Selected QDN publish folder');

    const relativePath = path.relative(rootPath, entryPath).split(path.sep).join('/');
    entries[relativePath] = bytes;
  }
}

async function readDirectoryAsZipBase64(sourcePath: string) {
  const entries: Record<string, Uint8Array> = {};
  const total = { bytes: 0 };

  await buildDirectoryZipEntries(sourcePath, sourcePath, entries, total);

  if (Object.keys(entries).length === 0) {
    throw new Error('Selected QDN publish folder is empty.');
  }

  const zipBytes = Buffer.from(zipSync(entries));
  assertPublicQdnPublishSize(zipBytes.byteLength, 'Selected QDN publish folder archive');

  return {
    dataBase64: zipBytes.toString('base64'),
    size: zipBytes.byteLength,
  };
}

async function normalizePublicQdnPublishSource(source: QdnWriteSourceSelection) {
  if (source.dataBase64) {
    const size = Buffer.from(source.dataBase64, 'base64').byteLength;
    assertPublicQdnPublishSize(size, 'QDN publish data');

    return {
      ...source,
      dataBase64: source.dataBase64,
      filename: source.filename,
      isZip: false,
      kind: 'data' as const,
      size,
    };
  }

  if (!source.path) {
    throw new Error('QDN publish source did not include data or a local path.');
  }

  const sourceStats = await stat(source.path);

  if (sourceStats.isDirectory()) {
    const { dataBase64, size } = await readDirectoryAsZipBase64(source.path);

    return {
      ...source,
      dataBase64,
      filename: `${path.basename(source.path) || 'qdn-resource'}.zip`,
      isZip: true,
      kind: 'directory' as const,
      size,
    };
  }

  if (!sourceStats.isFile()) {
    throw new Error('QDN publish source must be a file or folder.');
  }

  assertPublicQdnPublishSize(sourceStats.size, 'Selected QDN publish file');
  const fileBytes = await readFile(source.path);
  const isZip = path.extname(source.path).toLowerCase() === '.zip';

  return {
    ...source,
    dataBase64: Buffer.from(fileBytes).toString('base64'),
    filename: source.filename ?? path.basename(source.path) ?? 'qdn-resource',
    isZip,
    kind: 'file' as const,
    size: fileBytes.byteLength,
  };
}

async function getQdnWriteContext(
  context: QdnViewContext | null,
  resource: QdnWriteResourceRequest,
): Promise<QdnWriteContext> {
  const connection = await getNodeConnection();

  assertLocalWriteConnection(connection);
  const apiKey = getNodeApiKey(connection);

  if (isQdnWriteSmokeMode()) {
    const smokeProfile = getQdnWriteSmokeProfile(resource);

    return {
      apiKey,
      connection,
      profile: smokeProfile,
      signer: {
        kind: 'smoke',
        resource,
      },
    };
  }

  const accountId = getQdnWriteAccountId(context);
  const profile = await getAccountProfile(accountId);

  assertAccountUnlocked(accountId);

  return {
    apiKey,
    connection,
    profile,
    signer: {
      accountId,
      kind: 'account',
    },
  };
}

function getQdnWritePrivateKey(writeContext: QdnWriteContext) {
  if (writeContext.signer.kind === 'smoke') {
    return getQdnWriteSmokePrivateKey(writeContext.signer.resource);
  }

  return getAccountSigningKey(writeContext.signer.accountId).privateKey58;
}

async function getQdnChatContext(context: QdnViewContext | null): Promise<QdnChatContext> {
  const accountId = getQdnWriteAccountId(context);
  const connection = await getNodeConnection();

  assertLocalWriteConnection(connection);
  assertAccountUnlocked(accountId);

  const apiKey = getNodeApiKey(connection);
  const profile = await getAccountProfile(accountId);
  const signingKey = getAccountSigningKey(accountId);

  return {
    accountId,
    apiKey,
    connection,
    privateKey58: signingKey.privateKey58,
    profile,
    publicKey58: signingKey.publicKey58,
  };
}

// Like getQdnChatContext but for the keyless open-group chat path: it allows a
// public/network node because the private key is NEVER sent to it (the message is
// signed locally). It still requires a selected, unlocked account; the caller
// still runs the SEND_CHAT_MESSAGE approval prompt. Mirrors src/platform.ts
// getKeylessChatContext.
async function getKeylessChatContext(
  context: QdnViewContext | null,
): Promise<QdnKeylessChatContext> {
  const accountId = getQdnWriteAccountId(context);
  const connection = await getNodeConnection();

  // Intentionally NO assertLocalWriteConnection here: the keyless path never
  // sends the private key to the node, so a public/network node is permitted.
  assertAccountUnlocked(accountId);

  // The keyless build/process endpoints are allowlisted and need no API key on a
  // public node; pass through any configured key (custom/local) but do not throw
  // when network mode has none.
  const apiKey = connection.apiKey?.trim() ?? '';
  const profile = await getAccountProfile(accountId);
  const signingKey = getAccountSecretKey(accountId);

  return {
    accountId,
    apiKey,
    connection,
    profile,
    publicKey58: signingKey.publicKey58,
    secretKey: signingKey.secretKey,
  };
}

async function getKeylessQdnWriteContext(context: QdnViewContext | null): Promise<QdnKeylessWriteContext> {
  const accountId = getQdnWriteAccountId(context);
  const connection = await getNodeConnection();

  assertAccountUnlocked(accountId);

  const apiKey = connection.apiKey?.trim() ?? '';
  const profile = await getAccountProfile(accountId);
  const signingKey = getAccountSecretKey(accountId);

  return {
    accountId,
    apiKey,
    connection,
    profile,
    publicKey58: signingKey.publicKey58,
    secretKey: signingKey.secretKey,
  };
}

async function fetchLocalNodeApiPayload(
  connection: NodeConnection,
  apiPath: string,
  fallbackMessage: string,
) {
  const response = await fetchNode(apiPath, {}, connection.nodeApiUrl);
  const result = await readNodeApiResponse(response, connection, QDN_APP_DEFAULT_MAX_BYTES);

  if (!result.ok) {
    throw new Error(result.body || fallbackMessage);
  }

  return result.data;
}

async function getGroupDataForChat(connection: NodeConnection, groupId: number) {
  if (groupId === 0) {
    return null;
  }

  return fetchLocalNodeApiPayload(
    connection,
    `/groups/${encodeURIComponent(String(groupId))}`,
    'Group lookup failed.',
  );
}

async function getNameDataForApp(connection: NodeConnection, name: string) {
  return fetchLocalNodeApiPayload(
    connection,
    `/names/${encodeURIComponent(name)}`,
    'Name lookup failed.',
  );
}

function getGroupName(groupData: unknown) {
  if (!isRecord(groupData)) {
    return null;
  }

  return getString(groupData.groupName) || getString(groupData.name) || null;
}

function getGroupDescription(groupData: unknown) {
  if (!isRecord(groupData)) {
    return '';
  }

  return getString(groupData.description);
}

function getGroupApprovalThreshold(groupData: unknown) {
  if (!isRecord(groupData)) {
    return 'NONE';
  }

  return getString(groupData.approvalThreshold) || 'NONE';
}

function getGroupCreationGroupId(groupData: unknown) {
  if (!isRecord(groupData)) {
    return 0;
  }

  return getInteger(groupData.creationGroupId) ?? 0;
}

function getGroupDelay(groupData: unknown, key: 'maximumBlockDelay' | 'minimumBlockDelay', fallback: number) {
  if (!isRecord(groupData)) {
    return fallback;
  }

  return getInteger(groupData[key]) ?? fallback;
}

function getNameCreationGroupId(nameData: unknown) {
  if (!isRecord(nameData)) {
    return 0;
  }

  return getInteger(nameData.creationGroupId) ?? 0;
}

function getNameSaleAmount(nameData: unknown) {
  if (!isRecord(nameData) || typeof nameData.salePrice === 'undefined' || nameData.salePrice === null) {
    return undefined;
  }

  return typeof nameData.salePrice === 'number' || typeof nameData.salePrice === 'string'
    ? nameData.salePrice
    : undefined;
}

function getNameOwnerAddress(nameData: unknown) {
  if (!isRecord(nameData)) {
    return '';
  }

  return getString(nameData.owner);
}

function isOpenGroupData(groupData: unknown) {
  return !isRecord(groupData) || groupData.isOpen !== false;
}

function parseLocalPostData(result: Awaited<ReturnType<typeof postLocalNodeText>>) {
  return parseResponseData(result.body, result.contentType);
}

async function publishQdnResourceForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const resource = getQdnWriteResourceRequest(request);
  const connection = await getNodeConnection();
  const useLocalWrite = isLocalWriteConnection(connection);
  const writeContext = useLocalWrite
    ? await getQdnWriteContext(context, resource)
    : await getKeylessQdnWriteContext(context);
  const source = getInlinePublishSource(request) ?? (await selectQdnPublishSource(context as QdnViewContext));

  if (!source) {
    throw new Error('QDN publish was canceled.');
  }

  await requestQdnWriteApproval(
    context as QdnViewContext,
    writeContext.profile,
    {
      action: 'PUBLISH_QDN_RESOURCE',
      resource,
      source,
    },
  );

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  if (!useLocalWrite) {
    const keylessWriteContext = writeContext as QdnKeylessWriteContext;
    const publicSource = await normalizePublicQdnPublishSource(source);
    const unsignedTransaction = await postLocalNodeText(
      keylessWriteContext.connection,
      publicSource.isZip ? buildQdnPublicPublishZipPath(resource) : buildQdnPublicPublishBase64Path(resource, publicSource),
      publicSource.dataBase64,
      keylessWriteContext.apiKey,
      'QDN publish transaction build failed.',
    );
    const processedTransaction = await signAndProcessKeylessQdnTransaction(keylessWriteContext, unsignedTransaction.body);

    return {
      accepted: true,
      action: 'PUBLISH_QDN_RESOURCE',
      result: processedTransaction.data,
      resource: {
        identifier: resource.identifier ?? null,
        name: resource.name,
        service: resource.service,
      },
      transactionSignature: processedTransaction.signature,
    };
  }

  const localWriteContext = writeContext as QdnWriteContext;
  const apiKey = localWriteContext.apiKey;
  const privateKey58 = getQdnWritePrivateKey(localWriteContext);
  const inlineSource = isInlineQdnWriteSource(source) ? source : null;
  const publishPath = inlineSource ? buildQdnPublishBase64Path(resource, inlineSource) : buildQdnPublishPath(resource);
  const publishBody = inlineSource ? inlineSource.dataBase64 : source.path ?? '';
  const unsignedTransaction = await postLocalNodeText(
    localWriteContext.connection,
    publishPath,
    publishBody,
    apiKey,
    'QDN publish transaction build failed.',
  );
  const processedTransaction = await signAndProcessTransaction(
    localWriteContext.connection,
    apiKey,
    privateKey58,
    unsignedTransaction.body,
  );

  return {
    accepted: true,
    action: 'PUBLISH_QDN_RESOURCE',
    result: processedTransaction.data,
    resource: {
      identifier: resource.identifier ?? null,
      name: resource.name,
      service: resource.service,
    },
    transactionSignature: processedTransaction.signature,
  };
}

async function publishMultipleQdnResourcesForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const resources = getQdnWriteResourceRequests(request);

  if (resources.some((entry) => !entry.source)) {
    throw new Error('PUBLISH_MULTIPLE_QDN_RESOURCES requires base64 data for each resource.');
  }

  const approvalResource = resources.length === 1 ? resources[0].resource : undefined;
  const connection = await getNodeConnection();
  const useLocalWrite = isLocalWriteConnection(connection);
  const writeContext = useLocalWrite
    ? await getQdnWriteContext(context, approvalResource ?? resources[0].resource)
    : await getKeylessQdnWriteContext(context);

  await requestQdnWriteApproval(
    context as QdnViewContext,
    writeContext.profile,
    {
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      resource: approvalResource,
      resourceCount: resources.length,
      source: {
        displayName: `${resources.length} resources`,
        kind: 'data',
      },
    },
  );

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const apiKey = writeContext.apiKey;
  const privateKey58 = useLocalWrite ? getQdnWritePrivateKey(writeContext as QdnWriteContext) : '';
  const published: Array<{
    result: unknown;
    resource: {
      identifier: string | null;
      name: string;
      service: string;
    };
    transactionSignature: string;
  }> = [];
  const failures: Array<{
    error: string;
    resource: {
      identifier: string | null;
      name: string;
      service: string;
    };
  }> = [];

  for (const entry of resources) {
    const source = entry.source as QdnWriteSourceSelection;

    try {
      const publicSource = useLocalWrite ? null : await normalizePublicQdnPublishSource(source);
      const unsignedTransaction = await postLocalNodeText(
        writeContext.connection,
        publicSource
          ? publicSource.isZip
            ? buildQdnPublicPublishZipPath(entry.resource)
            : buildQdnPublicPublishBase64Path(entry.resource, publicSource)
          : buildQdnPublishBase64Path(entry.resource, source),
        publicSource ? publicSource.dataBase64 : source.dataBase64 ?? '',
        apiKey,
        'QDN publish transaction build failed.',
      );
      const processedTransaction = useLocalWrite
        ? await signAndProcessTransaction(
            writeContext.connection,
            apiKey,
            privateKey58,
            unsignedTransaction.body,
          )
        : await signAndProcessKeylessQdnTransaction(writeContext as QdnKeylessWriteContext, unsignedTransaction.body);

      published.push({
        result: processedTransaction.data,
        resource: {
          identifier: entry.resource.identifier ?? null,
          name: entry.resource.name,
          service: entry.resource.service,
        },
        transactionSignature: processedTransaction.signature,
      });
    } catch (error) {
      failures.push({
        error: error instanceof Error ? error.message : 'QDN publish failed.',
        resource: {
          identifier: entry.resource.identifier ?? null,
          name: entry.resource.name,
          service: entry.resource.service,
        },
      });
    }
  }

  return {
    accepted: true,
    action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
    failures,
    published,
  };
}

async function deleteQdnResourceForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const resource = getQdnWriteResourceRequest(request);
  const connection = await getNodeConnection();
  const useLocalWrite = isLocalWriteConnection(connection);
  const writeContext = useLocalWrite
    ? await getQdnWriteContext(context, resource)
    : await getKeylessQdnWriteContext(context);

  await requestQdnWriteApproval(
    context as QdnViewContext,
    writeContext.profile,
    {
      action: 'DELETE_QDN_RESOURCE',
      resource,
    },
  );

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const apiKey = writeContext.apiKey;
  const privateKey58 = useLocalWrite ? getQdnWritePrivateKey(writeContext as QdnWriteContext) : '';
  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    useLocalWrite ? buildQdnDeletePath(resource) : buildQdnPublicDeletePath(resource),
    '',
    apiKey,
    'QDN delete transaction build failed.',
  );
  const processedTransaction = useLocalWrite
    ? await signAndProcessTransaction(
        writeContext.connection,
        apiKey,
        privateKey58,
        unsignedTransaction.body,
      )
    : await signAndProcessKeylessQdnTransaction(writeContext as QdnKeylessWriteContext, unsignedTransaction.body);

  return {
    accepted: true,
    action: 'DELETE_QDN_RESOURCE',
    result: processedTransaction.data,
    resource: {
      identifier: resource.identifier ?? null,
      name: resource.name,
      service: resource.service,
    },
  };
}

async function joinGroupForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const chatContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(chatContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, chatContext.profile, {
    action: 'JOIN_GROUP',
    groupId,
    groupName,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  // Joining a minting group authorizes a minting key on chain, so include the
  // self-share public key derived from the joiner's own keypair.
  const mintingPublicKey58 =
    isRecord(groupData) && groupData.isMintingGroup === true
      ? (await deriveMintingKeyPair(chatContext)).publicKey58
      : null;

  const unsignedTransaction = await postLocalNodeText(
    chatContext.connection,
    '/groups/join',
    JSON.stringify({
      type: 'JOIN_GROUP',
      timestamp: Date.now(),
      txGroupId: 0,
      fee: 0,
      joinerPublicKey: chatContext.publicKey58,
      groupId,
      ...(mintingPublicKey58 ? { mintingPublicKey: mintingPublicKey58 } : {}),
    }),
    chatContext.apiKey,
    'Join group transaction build failed.',
    'application/json',
  );
  const processedTransaction = await signAndProcessTransaction(
    chatContext.connection,
    chatContext.apiKey,
    chatContext.privateKey58,
    unsignedTransaction.body,
    '/transactions/mempow/compute',
  );

  return {
    accepted: true,
    action: 'JOIN_GROUP',
    groupId,
    groupName,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

function isSelfShareRewardShare(value: unknown, address: string) {
  return (
    isRecord(value) &&
    getString(value.mintingAccount) === address &&
    getString(value.recipient) === address
  );
}

async function getSelfShareRewardShares(connection: NodeConnection, address: string) {
  const encodedAddress = encodeURIComponent(address);
  const rewardShares = await fetchLocalNodeApiPayload(
    connection,
    `/addresses/rewardshares?minters=${encodedAddress}&recipients=${encodedAddress}`,
    'Reward share lookup failed.',
  );

  if (!Array.isArray(rewardShares)) {
    return [];
  }

  return rewardShares.filter((rewardShare) => isSelfShareRewardShare(rewardShare, address));
}

async function deriveMintingKeyPair(chatContext: QdnChatContext) {
  const mintingPrivateKey = await postLocalNodeText(
    chatContext.connection,
    '/addresses/rewardsharekey',
    JSON.stringify({
      mintingAccountPrivateKey: chatContext.privateKey58,
      recipientAccountPublicKey: chatContext.publicKey58,
    }),
    chatContext.apiKey,
    'Minting key derivation failed.',
    'application/json',
  );
  const mintingPublicKey = await postLocalNodeText(
    chatContext.connection,
    '/utils/publickey',
    mintingPrivateKey.body,
    chatContext.apiKey,
    'Minting public key derivation failed.',
  );

  return {
    privateKey58: mintingPrivateKey.body,
    publicKey58: mintingPublicKey.body,
  };
}

async function getMintingStatusForApp(request: QdnAppRequest, context: QdnViewContext | null) {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const connection = await getNodeConnection();
  const selfShares = await getSelfShareRewardShares(connection, address);
  const hasRewardShare = selfShares.length > 0;

  if (connection.mode === 'network') {
    // A public read-only node cannot report the user's own node-side minting state.
    return {
      address,
      hasRewardShare,
      isMinting: null,
      keyOnNode: null,
      nodeMintingPossible: null,
    };
  }

  const mintingAccounts = await fetchLocalNodeApiPayload(
    connection,
    '/admin/mintingaccounts',
    'Minting account lookup failed.',
  );
  const keyOnNode =
    Array.isArray(mintingAccounts) &&
    mintingAccounts.some(
      (mintingAccount) =>
        isRecord(mintingAccount) &&
        getString(mintingAccount.mintingAccount) === address &&
        getString(mintingAccount.recipientAccount) === address,
    );

  const nodeStatus = await fetchLocalNodeApiPayload(
    connection,
    '/admin/status',
    'Node status lookup failed.',
  );
  const nodeMintingPossible = isRecord(nodeStatus) && nodeStatus.isMintingPossible === true;

  return {
    address,
    hasRewardShare,
    isMinting: hasRewardShare && keyOnNode,
    keyOnNode,
    nodeMintingPossible,
  };
}

async function startMintingForApp(context: QdnViewContext | null, sender: WebContents) {
  const chatContext = await getQdnChatContext(context);
  const address = chatContext.profile.address;

  await requestQdnWriteApproval(context as QdnViewContext, chatContext.profile, {
    action: 'START_MINTING',
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const selfShares = await getSelfShareRewardShares(chatContext.connection, address);
  const mintingKeyPair = await deriveMintingKeyPair(chatContext);

  if (selfShares.length === 0) {
    // No on-chain authorization yet (the account joined its minting group before joins
    // carried minting keys) — submit a zero-fee self-share REWARD_SHARE transaction.
    // The minting key can be added to the node once this confirms.
    const unsignedTransaction = await postLocalNodeText(
      chatContext.connection,
      '/addresses/rewardshare',
      JSON.stringify({
        type: 'REWARD_SHARE',
        timestamp: Date.now(),
        txGroupId: 0,
        fee: 0,
        minterPublicKey: chatContext.publicKey58,
        recipient: address,
        rewardSharePublicKey: mintingKeyPair.publicKey58,
        sharePercent: 0,
      }),
      chatContext.apiKey,
      'Minting authorization transaction build failed.',
      'application/json',
    );
    const processedTransaction = await signAndProcessTransaction(
      chatContext.connection,
      chatContext.apiKey,
      chatContext.privateKey58,
      unsignedTransaction.body,
      null,
    );

    return {
      accepted: true,
      action: 'START_MINTING',
      address,
      keyAdded: false,
      rewardSharePending: true,
      transactionSignature: processedTransaction.signature,
    };
  }

  if (
    !selfShares.some(
      (selfShare) =>
        isRecord(selfShare) && getString(selfShare.rewardSharePublicKey) === mintingKeyPair.publicKey58,
    )
  ) {
    throw new Error(
      'The minting key authorization on chain does not match the key derived from the selected account.',
    );
  }

  // The derived minting private key goes only to the local node; it is never returned to the app.
  await postLocalNodeText(
    chatContext.connection,
    '/admin/mintingaccounts',
    mintingKeyPair.privateKey58,
    chatContext.apiKey,
    'Adding the minting key to the node failed.',
  );

  return {
    accepted: true,
    action: 'START_MINTING',
    address,
    keyAdded: true,
  };
}

async function removeMintingAccountForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const publicKey = getRequiredRequestString(request, 'publicKey', 'Public key');

  // Basic shape check; the node fully validates the key and returns "false" if not present.
  if (!new RegExp(`^[${BASE58_ALPHABET}]{32,64}$`).test(publicKey)) {
    throw new Error('Public key must be a base58-encoded key.');
  }

  const chatContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, chatContext.profile, {
    action: 'REMOVE_MINTING_ACCOUNT',
    mintingKey: publicKey,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  // DELETE /admin/mintingaccounts takes the public (or private) key as the plain-text body.
  const result = await deleteLocalNodeText(
    chatContext.connection,
    '/admin/mintingaccounts',
    publicKey,
    chatContext.apiKey,
    'Removing the minting key from the node failed.',
  );

  // Core returns "true" on removal, "false" when no matching key was on the node.
  if (result.body.trim() !== 'true') {
    throw new Error('The node did not have a matching minting key to remove.');
  }

  return {
    accepted: true,
    action: 'REMOVE_MINTING_ACCOUNT',
    publicKey,
    removed: true,
  };
}

async function approveGroupJoinRequestForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const invitee = getRequiredAddressRequestString(request, 'joiner', 'Joiner address');
  const chatContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(chatContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, chatContext.profile, {
    action: 'APPROVE_GROUP_JOIN_REQUEST',
    groupId,
    groupName,
    recipientAddress: invitee,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    chatContext.connection,
    '/groups/invite',
    JSON.stringify({
      type: 'GROUP_INVITE',
      timestamp: Date.now(),
      txGroupId: 0,
      fee: 0,
      adminPublicKey: chatContext.publicKey58,
      groupId,
      invitee,
      timeToLive: 0,
    }),
    chatContext.apiKey,
    'Group invite transaction build failed.',
    'application/json',
  );
  const processedTransaction = await signAndProcessTransaction(
    chatContext.connection,
    chatContext.apiKey,
    chatContext.privateKey58,
    unsignedTransaction.body,
    '/transactions/mempow/compute',
  );

  return {
    accepted: true,
    action: 'APPROVE_GROUP_JOIN_REQUEST',
    groupId,
    groupName,
    invitee,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function requestGroupApprovalForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const pendingSignature = getOptionalBase58RequestString(request, 'pendingSignature');

  if (!pendingSignature) {
    throw new Error('pendingSignature (base58) is required.');
  }

  // Required boolean: false is an explicit "oppose" vote, so never default it.
  const approval = getBoolean(getRequestValue(request, 'approval'));

  if (typeof approval !== 'boolean') {
    throw new Error('approval boolean is required.');
  }

  // groupId is display-only context for the consent dialog; the GROUP_APPROVAL vote
  // itself always rides in the root group (txGroupId 0).
  const displayGroupId = getInteger(getRequestValue(request, 'groupId'));

  const chatContext = await getQdnChatContext(context);

  let groupName: string | null = null;
  if (typeof displayGroupId === 'number' && displayGroupId >= 0) {
    const groupData = await getGroupDataForChat(chatContext.connection, displayGroupId);
    groupName = getGroupName(groupData);
  }

  await requestQdnWriteApproval(context as QdnViewContext, chatContext.profile, {
    action: 'GROUP_APPROVAL',
    approval,
    groupId: typeof displayGroupId === 'number' ? displayGroupId : undefined,
    groupName,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    chatContext.connection,
    '/groups/approval',
    JSON.stringify({
      type: 'GROUP_APPROVAL',
      timestamp: Date.now(),
      txGroupId: 0,
      fee: 0,
      adminPublicKey: chatContext.publicKey58,
      pendingSignature,
      approval,
    }),
    chatContext.apiKey,
    'Group approval transaction build failed.',
    'application/json',
  );
  const processedTransaction = await signAndProcessTransaction(
    chatContext.connection,
    chatContext.apiKey,
    chatContext.privateKey58,
    unsignedTransaction.body,
    '/transactions/mempow/compute',
  );

  return {
    accepted: true,
    action: 'GROUP_APPROVAL',
    approval,
    groupId: typeof displayGroupId === 'number' ? displayGroupId : undefined,
    pendingSignature,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function processQdnAccountTransaction(
  writeContext: QdnChatContext,
  unsignedTransaction: Awaited<ReturnType<typeof postLocalNodeText>>,
) {
  return signAndProcessTransaction(
    writeContext.connection,
    writeContext.apiKey,
    writeContext.privateKey58,
    unsignedTransaction.body,
    '/transactions/mempow/compute',
  );
}

async function inviteToGroupForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const invitee = getOptionalAddressRequestString(
    request,
    'Invitee address',
    'invitee',
    'recipientAddress',
    'recipient',
  );
  const timeToLive = getOptionalIntegerRequestValue(request, 0, 'timeToLive', 'ttl') ?? 0;
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);

  if (!invitee) {
    throw new Error('Invitee address is required.');
  }

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'INVITE_TO_GROUP',
    groupId,
    groupName,
    recipientAddress: invitee,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/invite',
    JSON.stringify({
      type: 'GROUP_INVITE',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      adminPublicKey: writeContext.publicKey58,
      groupId,
      invitee,
      timeToLive,
    }),
    writeContext.apiKey,
    'Group invite transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'INVITE_TO_GROUP',
    groupId,
    groupName,
    invitee,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function leaveGroupForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'LEAVE_GROUP',
    groupId,
    groupName,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/leave',
    JSON.stringify({
      type: 'LEAVE_GROUP',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      leaverPublicKey: writeContext.publicKey58,
      groupId,
    }),
    writeContext.apiKey,
    'Leave group transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'LEAVE_GROUP',
    groupId,
    groupName,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function updateGroupForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);
  const newName = getOptionalStringRequestValue(request, 'newName', 'groupName');
  const newDescription =
    getOptionalStringRequestValue(request, 'newDescription', 'description') || getGroupDescription(groupData);
  const newIsOpen =
    getOptionalBooleanRequestValue(request, 'newIsOpen', 'isOpen') ??
    (isRecord(groupData) && typeof groupData.isOpen === 'boolean' ? groupData.isOpen : true);
  const newApprovalThreshold =
    getOptionalStringRequestValue(request, 'newApprovalThreshold', 'approvalThreshold') ||
    getGroupApprovalThreshold(groupData);
  const newMinimumBlockDelay =
    getOptionalIntegerRequestValue(request, 0, 'newMinimumBlockDelay', 'minimumBlockDelay') ??
    getGroupDelay(groupData, 'minimumBlockDelay', 0);
  const newMaximumBlockDelay =
    getOptionalIntegerRequestValue(request, 1, 'newMaximumBlockDelay', 'maximumBlockDelay') ??
    getGroupDelay(groupData, 'maximumBlockDelay', Math.max(1, newMinimumBlockDelay));

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'UPDATE_GROUP',
    groupId,
    groupName,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/update',
    JSON.stringify({
      type: 'UPDATE_GROUP',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request, getGroupCreationGroupId(groupData)),
      fee: getTransactionFee(request),
      ownerPublicKey: writeContext.publicKey58,
      groupId,
      newName,
      newDescription,
      newIsOpen,
      newApprovalThreshold,
      newMinimumBlockDelay,
      newMaximumBlockDelay,
    }),
    writeContext.apiKey,
    'Update group transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'UPDATE_GROUP',
    groupId,
    groupName,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

const QDN_GROUP_APPROVAL_THRESHOLDS = new Set([
  'NONE',
  'ONE',
  'PCT20',
  'PCT40',
  'PCT60',
  'PCT80',
  'PCT100',
]);

function getGroupApprovalThresholdInput(request: QdnAppRequest) {
  const value = getString(getRequestValue(request, 'approvalThreshold')).toUpperCase();

  if (!value) {
    return 'NONE';
  }

  if (!QDN_GROUP_APPROVAL_THRESHOLDS.has(value)) {
    throw new Error('approvalThreshold must be NONE, ONE, PCT20, PCT40, PCT60, PCT80, or PCT100.');
  }

  return value;
}

function getRequiredIntegerRequestValue(
  request: QdnAppRequest,
  minimumValue: number,
  label: string,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = getInteger(getRequestValue(request, key));

    if (typeof value === 'number') {
      if (value < minimumValue) {
        throw new Error(`${label} must be at least ${minimumValue}.`);
      }

      return value;
    }
  }

  throw new Error(`${label} is required.`);
}

function getRequiredMemberAddress(request: QdnAppRequest, label: string, ...keys: string[]) {
  const address = getOptionalAddressRequestString(request, label, ...keys);

  if (!address) {
    throw new Error(`${label} is required.`);
  }

  return address;
}

function getPollOptionsInput(request: QdnAppRequest, ...keys: string[]) {
  let raw: unknown;

  for (const key of keys) {
    const value = getRequestValue(request, key);

    if (typeof value !== 'undefined' && value !== null) {
      raw = value;
      break;
    }
  }

  const names: string[] = [];

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const name = isRecord(entry)
        ? getString(entry.optionName) || getString(entry.name) || getString(entry.value)
        : getString(entry);

      if (name) {
        names.push(name);
      }
    }
  } else {
    const text = getString(raw);

    if (text) {
      for (const part of text.split(',')) {
        const name = part.trim();

        if (name) {
          names.push(name);
        }
      }
    }
  }

  if (names.length < 2) {
    throw new Error('A poll requires at least two options.');
  }

  if (new Set(names).size !== names.length) {
    throw new Error('Poll options must be unique.');
  }

  return names.map((optionName) => ({ optionName }));
}

async function createGroupForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupName = getRequiredRequestString(request, 'groupName', 'Group name');
  const description = getString(getRequestValue(request, 'description'));
  const isOpen = getOptionalBooleanRequestValue(request, 'isOpen', 'open') ?? false;
  const approvalThreshold = getGroupApprovalThresholdInput(request);
  const minimumBlockDelay = getOptionalIntegerRequestValue(request, 0, 'minimumBlockDelay', 'minBlockDelay') ?? 5;
  const maximumBlockDelay =
    getOptionalIntegerRequestValue(request, 0, 'maximumBlockDelay', 'maxBlockDelay') ??
    Math.max(10, minimumBlockDelay);
  const writeContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'CREATE_GROUP',
    name: groupName,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/create',
    JSON.stringify({
      type: 'CREATE_GROUP',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      creatorPublicKey: writeContext.publicKey58,
      groupName,
      description,
      isOpen,
      approvalThreshold,
      minimumBlockDelay,
      maximumBlockDelay,
    }),
    writeContext.apiKey,
    'Create group transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'CREATE_GROUP',
    groupName,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function addGroupAdminForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const member = getRequiredMemberAddress(request, 'Member address', 'member', 'address', 'memberAddress');
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'ADD_GROUP_ADMIN',
    groupId,
    groupName,
    recipientAddress: member,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/addadmin',
    JSON.stringify({
      type: 'ADD_GROUP_ADMIN',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      ownerPublicKey: writeContext.publicKey58,
      groupId,
      member,
    }),
    writeContext.apiKey,
    'Add group admin transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'ADD_GROUP_ADMIN',
    groupId,
    groupName,
    member,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function removeGroupAdminForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const admin = getRequiredMemberAddress(request, 'Admin address', 'admin', 'address', 'memberAddress');
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'REMOVE_GROUP_ADMIN',
    groupId,
    groupName,
    recipientAddress: admin,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/removeadmin',
    JSON.stringify({
      type: 'REMOVE_GROUP_ADMIN',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      ownerPublicKey: writeContext.publicKey58,
      groupId,
      admin,
    }),
    writeContext.apiKey,
    'Remove group admin transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'REMOVE_GROUP_ADMIN',
    groupId,
    groupName,
    admin,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function banFromGroupForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const offender = getRequiredMemberAddress(request, 'Offender address', 'offender', 'member', 'address');
  const reason = getString(getRequestValue(request, 'reason'));
  const timeToLive = getOptionalIntegerRequestValue(request, 0, 'timeToLive', 'ttl', 'banTime') ?? 0;
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'GROUP_BAN',
    groupId,
    groupName,
    recipientAddress: offender,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/ban',
    JSON.stringify({
      type: 'GROUP_BAN',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      adminPublicKey: writeContext.publicKey58,
      groupId,
      offender,
      reason,
      timeToLive,
    }),
    writeContext.apiKey,
    'Group ban transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'GROUP_BAN',
    groupId,
    groupName,
    offender,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function cancelGroupBanForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const member = getRequiredMemberAddress(request, 'Member address', 'member', 'offender', 'address');
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'CANCEL_GROUP_BAN',
    groupId,
    groupName,
    recipientAddress: member,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/ban/cancel',
    JSON.stringify({
      type: 'CANCEL_GROUP_BAN',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      adminPublicKey: writeContext.publicKey58,
      groupId,
      member,
    }),
    writeContext.apiKey,
    'Cancel group ban transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'CANCEL_GROUP_BAN',
    groupId,
    groupName,
    member,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function kickFromGroupForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const member = getRequiredMemberAddress(request, 'Member address', 'member', 'address');
  const reason = getString(getRequestValue(request, 'reason'));
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'GROUP_KICK',
    groupId,
    groupName,
    recipientAddress: member,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/kick',
    JSON.stringify({
      type: 'GROUP_KICK',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      adminPublicKey: writeContext.publicKey58,
      groupId,
      member,
      reason,
    }),
    writeContext.apiKey,
    'Group kick transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'GROUP_KICK',
    groupId,
    groupName,
    member,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function cancelGroupInviteForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const invitee = getRequiredMemberAddress(request, 'Invitee address', 'invitee', 'address', 'recipientAddress');
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'CANCEL_GROUP_INVITE',
    groupId,
    groupName,
    recipientAddress: invitee,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/invite/cancel',
    JSON.stringify({
      type: 'CANCEL_GROUP_INVITE',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      adminPublicKey: writeContext.publicKey58,
      groupId,
      invitee,
    }),
    writeContext.apiKey,
    'Cancel group invite transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'CANCEL_GROUP_INVITE',
    groupId,
    groupName,
    invitee,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function setDefaultGroupForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const defaultGroupId = getRequiredIntegerRequestValue(
    request,
    0,
    'Default group id',
    'defaultGroupId',
    'groupId',
  );
  const writeContext = await getQdnChatContext(context);
  const groupData = defaultGroupId > 0 ? await getGroupDataForChat(writeContext.connection, defaultGroupId) : null;
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'SET_GROUP',
    groupId: defaultGroupId,
    groupName,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/setdefault',
    JSON.stringify({
      type: 'SET_GROUP',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      creatorPublicKey: writeContext.publicKey58,
      defaultGroupId,
    }),
    writeContext.apiKey,
    'Set default group transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'SET_GROUP',
    defaultGroupId,
    groupName,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function sendCoinForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
  action: 'PAYMENT' | 'SEND_COIN',
) {
  const recipient = getRequiredMemberAddress(
    request,
    'Recipient address',
    'recipient',
    'recipientAddress',
    'address',
    'destinationAddress',
  );
  const amount = getRequiredAmountValue(request, 'amount', 'Amount');
  const writeContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action,
    amount,
    recipientAddress: recipient,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/payments/pay',
    JSON.stringify({
      type: 'PAYMENT',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      senderPublicKey: writeContext.publicKey58,
      recipient,
      amount,
    }),
    writeContext.apiKey,
    'Payment transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action,
    recipient,
    amount,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function transferAssetForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const recipient = getRequiredMemberAddress(
    request,
    'Recipient address',
    'recipient',
    'recipientAddress',
    'address',
    'destinationAddress',
  );
  const amount = getRequiredAmountValue(request, 'amount', 'Amount');
  const assetId = getRequiredIntegerRequestValue(request, 0, 'Asset id', 'assetId');
  const writeContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'TRANSFER_ASSET',
    amount,
    name: `Asset #${assetId}`,
    recipientAddress: recipient,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/assets/transfer',
    JSON.stringify({
      type: 'TRANSFER_ASSET',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      senderPublicKey: writeContext.publicKey58,
      recipient,
      amount,
      assetId,
    }),
    writeContext.apiKey,
    'Transfer asset transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'TRANSFER_ASSET',
    recipient,
    amount,
    assetId,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function createPollForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const pollName = getRequiredRequestString(request, 'pollName', 'Poll name');
  const description = getString(getRequestValue(request, 'description'));
  const pollOptions = getPollOptionsInput(request, 'pollOptions', 'options');
  const ownerInput = getOptionalAddressRequestString(request, 'Owner address', 'owner');
  const endTime = getOptionalIntegerRequestValue(request, 0, 'endTime', 'pollEndTime');
  const writeContext = await getQdnChatContext(context);
  const resolvedOwner = ownerInput || writeContext.profile.address;

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'CREATE_POLL',
    name: pollName,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/polls/create',
    JSON.stringify({
      type: 'CREATE_POLL',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      pollCreatorPublicKey: writeContext.publicKey58,
      owner: resolvedOwner,
      pollName,
      description,
      pollOptions,
      ...(typeof endTime === 'number' ? { endTime } : {}),
    }),
    writeContext.apiKey,
    'Create poll transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'CREATE_POLL',
    pollName,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function voteOnPollForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const pollId = getRequiredIntegerRequestValue(request, 0, 'Poll id', 'pollId', 'poll');
  const optionIndex = getRequiredIntegerRequestValue(request, 0, 'Option index', 'optionIndex', 'option');
  const writeContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'VOTE_ON_POLL',
    name: `Poll #${pollId} · option ${optionIndex}`,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/polls/vote',
    JSON.stringify({
      type: 'VOTE_ON_POLL',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      voterPublicKey: writeContext.publicKey58,
      pollId,
      optionIndex,
    }),
    writeContext.apiKey,
    'Vote on poll transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'VOTE_ON_POLL',
    pollId,
    optionIndex,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

// Rating range is -4..+4 inclusive; 0 means "remove the existing rating" (not a
// neutral score). Core is the final authority on validity (cooldown, self-rating,
// unknown account, no-op) — this only screens out values that can never be valid.
function getRequiredRatingValue(request: QdnAppRequest) {
  const rating = getInteger(getRequestValue(request, 'rating'));

  if (typeof rating !== 'number') {
    throw new Error('Rating is required.');
  }

  if (rating < -4 || rating > 4) {
    throw new Error('Rating must be an integer between -4 and 4 (0 removes the rating).');
  }

  return rating;
}

function describeRating(rating: number) {
  return rating === 0 ? 'remove rating' : `rating ${rating > 0 ? '+' : ''}${rating}`;
}

async function rateAccountForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const targetPublicKey = getRequiredRequestString(request, 'targetPublicKey', 'Target public key');
  const category = getRequiredRequestString(request, 'category', 'Rating category');
  const rating = getRequiredRatingValue(request);
  const writeContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'RATE_ACCOUNT',
    name: `${category} · ${describeRating(rating)}`,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/account-ratings/rate',
    JSON.stringify({
      type: 'RATE_ACCOUNT',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      raterPublicKey: writeContext.publicKey58,
      targetPublicKey,
      category,
      rating,
    }),
    writeContext.apiKey,
    'Rate account transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'RATE_ACCOUNT',
    targetPublicKey,
    category,
    rating,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function updatePollForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const pollId = getRequiredIntegerRequestValue(request, 0, 'Poll id', 'pollId', 'poll');
  const newPollName = getRequiredRequestString(request, 'newPollName', 'New poll name');
  const newDescription = getString(getRequestValue(request, 'newDescription') ?? getRequestValue(request, 'description'));
  const newPollOptions = getPollOptionsInput(request, 'newPollOptions', 'pollOptions', 'options');
  const newEndTime = getOptionalIntegerRequestValue(request, 0, 'newEndTime', 'endTime');
  const writeContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'UPDATE_POLL',
    name: newPollName,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/polls/update',
    JSON.stringify({
      type: 'UPDATE_POLL',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      ownerPublicKey: writeContext.publicKey58,
      pollId,
      newPollName,
      newDescription,
      newPollOptions,
      ...(typeof newEndTime === 'number' ? { newEndTime } : {}),
    }),
    writeContext.apiKey,
    'Update poll transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'UPDATE_POLL',
    pollId,
    newPollName,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function registerNameForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const name = getRequiredNameRequestString(request);
  const data = getString(getRequestValue(request, 'data')) || getString(getRequestValue(request, 'nameData'));
  const writeContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'REGISTER_NAME',
    name,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/names/register',
    JSON.stringify({
      type: 'REGISTER_NAME',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      registrantPublicKey: writeContext.publicKey58,
      name,
      data,
    }),
    writeContext.apiKey,
    'Register name transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'REGISTER_NAME',
    name,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function updateNameForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const name = getRequiredNameRequestString(request);
  const writeContext = await getQdnChatContext(context);
  const nameData = await getNameDataForApp(writeContext.connection, name);
  const newName = getString(getRequestValue(request, 'newName'));
  const newData =
    getString(getRequestValue(request, 'newData')) ||
    getString(getRequestValue(request, 'data')) ||
    getString(getRequestValue(request, 'nameData'));
  const primary = getOptionalBooleanRequestValue(request, 'primary', 'isPrimary');

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'UPDATE_NAME',
    name,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/names/update',
    JSON.stringify({
      type: 'UPDATE_NAME',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request, getNameCreationGroupId(nameData)),
      fee: getTransactionFee(request),
      ownerPublicKey: writeContext.publicKey58,
      name,
      newName,
      newData,
      primary,
    }),
    writeContext.apiKey,
    'Update name transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'UPDATE_NAME',
    name,
    newName: newName || null,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function sellNameForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const name = getRequiredNameRequestString(request);
  const amount = getRequiredAmountValue(request, 'amount', 'Name sale amount');
  const recipient = getOptionalAddressRequestString(request, 'Recipient address', 'recipient', 'recipientAddress');
  const writeContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'SELL_NAME',
    amount,
    name,
    permissionScope: 'single-request',
    recipientAddress: recipient || undefined,
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/names/sell',
    JSON.stringify({
      type: 'SELL_NAME',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      ownerPublicKey: writeContext.publicKey58,
      name,
      amount,
      recipient: recipient || undefined,
    }),
    writeContext.apiKey,
    'Sell name transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'SELL_NAME',
    amount,
    name,
    recipient: recipient || null,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function cancelSellNameForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const name = getRequiredNameRequestString(request);
  const writeContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'CANCEL_SELL_NAME',
    name,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/names/sell/cancel',
    JSON.stringify({
      type: 'CANCEL_SELL_NAME',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      ownerPublicKey: writeContext.publicKey58,
      name,
    }),
    writeContext.apiKey,
    'Cancel name sale transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'CANCEL_SELL_NAME',
    name,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function buyNameForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const name = getRequiredNameRequestString(request);
  const writeContext = await getQdnChatContext(context);
  const nameData = await getNameDataForApp(writeContext.connection, name);
  const seller = getString(getRequestValue(request, 'seller')) || getNameOwnerAddress(nameData);
  const amount =
    typeof getRequestValue(request, 'amount') === 'undefined'
      ? getNameSaleAmount(nameData)
      : getRequiredAmountValue(request, 'amount', 'Name purchase amount');

  if (!seller) {
    throw new Error('Name seller address is required.');
  }

  assertQortiumAddress(seller, 'Seller address');

  if (typeof amount === 'undefined') {
    throw new Error('Name purchase amount is required.');
  }

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'BUY_NAME',
    amount,
    name,
    permissionScope: 'single-request',
    recipientAddress: seller,
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/names/buy',
    JSON.stringify({
      type: 'BUY_NAME',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      buyerPublicKey: writeContext.publicKey58,
      name,
      amount,
      seller,
    }),
    writeContext.apiKey,
    'Buy name transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'BUY_NAME',
    amount,
    name,
    result: processedTransaction.data,
    seller,
    transactionSignature: processedTransaction.signature,
  };
}

async function sendPublicGroupChatMessage(
  chatContext: QdnChatContext,
  groupId: number,
  message: string,
  chatReference?: string,
) {
  const unsignedTransaction = await postLocalNodeText(
    chatContext.connection,
    '/chat',
    JSON.stringify({
      type: 'CHAT',
      timestamp: Date.now(),
      txGroupId: groupId,
      fee: 0,
      senderPublicKey: chatContext.publicKey58,
      chatReference,
      data: encodeChatTextData(message),
      isText: true,
      isEncrypted: false,
    }),
    chatContext.apiKey,
    'Chat transaction build failed.',
    'application/json',
  );
  const processedTransaction = await signAndProcessTransaction(
    chatContext.connection,
    chatContext.apiKey,
    chatContext.privateKey58,
    unsignedTransaction.body,
    '/chat/compute',
  );

  return processedTransaction.data;
}

async function sendPrivateGroupChatMessage(
  chatContext: QdnChatContext,
  groupId: number,
  message: string,
  chatReference?: string,
) {
  const result = await postLocalNodeText(
    chatContext.connection,
    '/chat/private/group/send',
    JSON.stringify({
      senderPrivateKey: chatContext.privateKey58,
      groupId,
      data: encodeChatTextData(message),
      isText: true,
      chatReference,
    }),
    chatContext.apiKey,
    'Private group chat send failed.',
    'application/json',
  );

  return parseLocalPostData(result);
}

async function sendDirectPrivateChatMessage(
  chatContext: QdnChatContext,
  recipientAddress: string,
  message: string,
  chatReference?: string,
) {
  const result = await postLocalNodeText(
    chatContext.connection,
    '/chat/private/direct/send',
    JSON.stringify({
      senderPrivateKey: chatContext.privateKey58,
      recipient: recipientAddress,
      data: encodeChatTextData(message),
      isText: true,
      chatReference,
    }),
    chatContext.apiKey,
    'Direct private chat send failed.',
    'application/json',
  );

  return parseLocalPostData(result);
}

type MemoryPowWorkerResponse =
  | { id: string; nonce: number }
  | { id: string; error: string };

let memoryPowWorker: Worker | null = null;

function getMemoryPowWorker(): Worker {
  if (!memoryPowWorker) {
    // The compiled worker sits next to this module (dist-electron/) in dev and
    // inside app.asar/dist-electron/ when packaged. It is pure JS, so no
    // asarUnpack is required. Mirrors how preload.cjs is resolved in main.ts.
    const worker = new Worker(path.join(__dirname, 'memoryPow.worker.js'));

    // Reset the singleton if the worker dies so the next request re-spawns it.
    worker.on('error', () => {
      if (memoryPowWorker === worker) {
        memoryPowWorker = null;
      }
    });
    worker.on('exit', () => {
      if (memoryPowWorker === worker) {
        memoryPowWorker = null;
      }
    });

    memoryPowWorker = worker;
  }

  return memoryPowWorker;
}

// Runs the CHAT memory-pow off the main process and resolves with the nonce.
// Mirrors src/platform.ts computeChatNonce.
function computeChatNonce(data: Uint8Array, difficulty: number): Promise<number> {
  const worker = getMemoryPowWorker();
  const id = randomUUID();

  return new Promise<number>((resolve, reject) => {
    const onMessage = (response: MemoryPowWorkerResponse) => {
      if (response.id !== id) {
        return;
      }

      worker.off('message', onMessage);
      worker.off('error', onError);

      if ('error' in response) {
        reject(new Error(response.error));
        return;
      }

      resolve(response.nonce);
    };

    const onError = (error: Error) => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      reject(new Error(error.message || 'Memory-pow computation failed.'));
    };

    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.postMessage({ id, data, difficulty });
  });
}

// Keyless open-group chat send for PUBLIC/network nodes. Builds the unsigned CHAT
// bytes via the keyless /chat/public/build endpoint, computes the memory-pow
// nonce locally in a worker thread, signs locally with the account's ed25519 key,
// then broadcasts the fully signed bytes. The private key is NEVER sent to the
// node. Mirrors src/platform.ts sendKeylessPublicGroupChatMessage.
async function sendKeylessPublicGroupChatMessage(
  keylessContext: QdnKeylessChatContext,
  groupId: number,
  message: string,
) {
  const unsignedTransaction = await postLocalNodeText(
    keylessContext.connection,
    '/chat/public/build',
    JSON.stringify({
      senderPublicKey: keylessContext.publicKey58,
      data: encodeChatTextData(message),
      isText: true,
      isEncrypted: false,
      txGroupId: groupId,
      timestamp: Date.now(),
      fee: 0,
    }),
    keylessContext.apiKey,
    'Chat transaction build failed.',
    'application/json',
  );

  const unsignedBytes = base58Decode(unsignedTransaction.body);
  // The build endpoint returns nonce-free bytes (nonce field already zeroed), so
  // we hash the bytes as-is to seed the memory-pow.
  const nonce = await computeChatNonce(unsignedBytes, CHAT_POW_DIFFICULTY);
  const signedBytes = signChatTransaction(unsignedBytes, nonce, keylessContext.secretKey);

  const processedTransaction = await postLocalNodeText(
    keylessContext.connection,
    '/transactions/process?apiVersion=2',
    base58Encode(signedBytes),
    keylessContext.apiKey,
    'Chat transaction processing failed.',
  );

  return parseLocalPostData(processedTransaction);
}

// Keyless open-group send path for PUBLIC/network nodes. Direct messages and
// closed/private groups are rejected here because they would require sending the
// private key to a public node. Returns null when the node is not in network mode
// so the caller falls back to the existing server-side signing path. Mirrors
// src/platform.ts trySendChatMessageOnNetworkNode.
async function trySendChatMessageOnNetworkNode(
  context: QdnViewContext | null,
  sender: WebContents,
  target: QdnChatMessageTarget,
  message: string,
) {
  const connection = await getNodeConnection();

  if (connection.mode !== 'network') {
    return null;
  }

  if (target.kind === 'direct') {
    throw new Error(
      'Direct (private) chat requires a local Core or a trusted custom node so Home never sends your private key to a public node.',
    );
  }

  const keylessContext = await getKeylessChatContext(context);
  const groupId = target.groupId;
  const groupData = await getGroupDataForChat(keylessContext.connection, groupId);
  const groupName = getGroupName(groupData);
  // Fail closed on a public node: only send when the group is confirmed open.
  // An unverifiable/missing group lookup is treated as not-open and rejected.
  const isOpenGroup = groupId === 0 || (isRecord(groupData) && groupData.isOpen === true);

  if (!isOpenGroup) {
    throw new Error(
      'Sending to a closed or private group requires a local Core or a trusted custom node so Home never sends your private key to a public node.',
    );
  }

  await requestQdnChatPermissionApproval(
    context as QdnViewContext,
    keylessContext.profile,
    'SEND_CHAT_MESSAGE',
    {
      chatMessagePreview: getChatMessagePreview(message),
      groupId,
      groupName,
    },
  );

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const result = await sendKeylessPublicGroupChatMessage(keylessContext, groupId, message);

  return {
    accepted: true,
    action: 'SEND_CHAT_MESSAGE' as const,
    encrypted: false,
    groupId,
    groupName,
    result,
  };
}

async function sendChatMessageForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const target = getChatMessageTarget(request);
  const message = getChatMessageText(request);
  const chatReference = getOptionalBase58RequestString(request, 'chatReference');

  // Network (public) nodes get the keyless local-sign path for open groups; any
  // path that would leak the private key is rejected. Local/custom nodes keep the
  // existing server-side signing behaviour below.
  const networkResult = await trySendChatMessageOnNetworkNode(context, sender, target, message);

  if (networkResult) {
    return networkResult;
  }

  const chatContext = await getQdnChatContext(context);

  if (target.kind === 'direct') {
    await requestQdnChatPermissionApproval(
      context as QdnViewContext,
      chatContext.profile,
      'SEND_CHAT_MESSAGE',
      {
        chatMessagePreview: getChatMessagePreview(message),
        recipientAddress: target.recipientAddress,
      },
    );

    assertFreshQdnWriteContext(sender, context as QdnViewContext);

    const result = await sendDirectPrivateChatMessage(
      chatContext,
      target.recipientAddress,
      message,
      chatReference,
    );

    return {
      accepted: true,
      action: 'SEND_CHAT_MESSAGE',
      direct: true,
      encrypted: true,
      recipientAddress: target.recipientAddress,
      result,
    };
  }

  const groupId = target.groupId;
  const groupData = await getGroupDataForChat(chatContext.connection, groupId);
  const groupName = getGroupName(groupData);
  const isOpenGroup = groupId === 0 || isOpenGroupData(groupData);

  await requestQdnChatPermissionApproval(
    context as QdnViewContext,
    chatContext.profile,
    'SEND_CHAT_MESSAGE',
    {
      chatMessagePreview: getChatMessagePreview(message),
      groupId,
      groupName,
    },
  );

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const result = isOpenGroup
    ? await sendPublicGroupChatMessage(chatContext, groupId, message, chatReference)
    : await sendPrivateGroupChatMessage(chatContext, groupId, message, chatReference);

  return {
    accepted: true,
    action: 'SEND_CHAT_MESSAGE',
    encrypted: !isOpenGroup,
    groupId,
    groupName,
    result,
  };
}

async function getPrivateGroupActiveChatsForApp(request: QdnAppRequest, context: QdnViewContext | null) {
  const chatContext = await getQdnChatContext(context);

  const result = await postLocalNodeText(
    chatContext.connection,
    '/chat/private/group/active',
    JSON.stringify({
      recipientPrivateKey: chatContext.privateKey58,
      encoding: getString(getRequestValue(request, 'encoding')) || undefined,
    }),
    chatContext.apiKey,
    'Private group active chat lookup failed.',
    'application/json',
  );

  return parseLocalPostData(result);
}

async function searchPrivateGroupChatMessagesForApp(request: QdnAppRequest, context: QdnViewContext | null) {
  const chatContext = await getQdnChatContext(context);
  const groupId = getRequiredGroupId(request, 1);

  const result = await postLocalNodeText(
    chatContext.connection,
    '/chat/private/group/messages',
    JSON.stringify(buildPrivateGroupChatMessagesBody(request, chatContext.privateKey58)),
    chatContext.apiKey,
    'Private group chat message lookup failed.',
    'application/json',
  );

  return parseLocalPostData(result);
}

async function requestPrivateGroupChatKeyForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const chatContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, chatContext.profile, {
    action: 'REQUEST_PRIVATE_GROUP_CHAT_KEY',
    groupId,
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const result = await postLocalNodeText(
    chatContext.connection,
    '/chat/private/group/key-request',
    JSON.stringify(buildPrivateGroupChatKeyRequestBody(request, chatContext.privateKey58)),
    chatContext.apiKey,
    'Private group chat key request failed.',
    'application/json',
  );

  return {
    accepted: true,
    action: 'REQUEST_PRIVATE_GROUP_CHAT_KEY',
    groupId,
    result: parseLocalPostData(result),
  };
}

async function resolvePrivateGroupChatKeyRequestsForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const chatContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, chatContext.profile, {
    action: 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS',
    groupId,
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const result = await postLocalNodeText(
    chatContext.connection,
    '/chat/private/group/key-requests/resolve',
    JSON.stringify(buildPrivateGroupChatKeyRequestRecoveryBody(request, chatContext.privateKey58)),
    chatContext.apiKey,
    'Private group chat key request resolution failed.',
    'application/json',
  );

  return {
    accepted: true,
    action: 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS',
    groupId,
    result: parseLocalPostData(result),
  };
}

async function getPrivateDirectActiveChatsForApp(request: QdnAppRequest, context: QdnViewContext | null) {
  const chatContext = await getQdnChatContext(context);

  const result = await postLocalNodeText(
    chatContext.connection,
    '/chat/private/direct/active',
    JSON.stringify({
      accountPrivateKey: chatContext.privateKey58,
      encoding: getString(getRequestValue(request, 'encoding')) || undefined,
      hasChatReference: getBoolean(getRequestValue(request, 'hasChatReference')),
    }),
    chatContext.apiKey,
    'Direct private active chat lookup failed.',
    'application/json',
  );

  return parseLocalPostData(result);
}

async function searchPrivateDirectChatMessagesForApp(request: QdnAppRequest, context: QdnViewContext | null) {
  const chatContext = await getQdnChatContext(context);
  const otherAddress = getDirectChatOtherAddress(request);

  const result = await postLocalNodeText(
    chatContext.connection,
    '/chat/private/direct/messages',
    JSON.stringify(buildPrivateDirectChatMessagesBody(request, chatContext.privateKey58, otherAddress)),
    chatContext.apiKey,
    'Direct private chat message lookup failed.',
    'application/json',
  );

  return parseLocalPostData(result);
}

function getQdnAppResourceRequest(request: QdnAppRequest) {
  const service = getService(getRequestValue(request, 'service'));
  const name = getString(getRequestValue(request, 'name'));
  const identifier = getString(getRequestValue(request, 'identifier'));
  const resourcePath = getString(getRequestValue(request, 'path')) || getString(getRequestValue(request, 'filepath'));

  if (!service) {
    throw new Error('QDN resource service is required.');
  }

  if (!name) {
    throw new Error('QDN resource name is required.');
  }

  return {
    service,
    name,
    identifier: identifier || undefined,
    path: resourcePath,
  };
}

function getEncodedResourcePath(resourcePath: string) {
  return resourcePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildQdnResourceStatusPath(request: QdnAppRequest) {
  const resource = getQdnAppResourceRequest(request);
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  if (typeof getBoolean(getRequestValue(request, 'build')) === 'boolean') {
    queryParams.set('build', String(getBoolean(getRequestValue(request, 'build'))));
  }

  const queryString = queryParams.toString();

  return `/arbitrary/resource/status/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}${
    queryString ? `?${queryString}` : ''
  }`;
}

function buildQdnResourcePropertiesPath(request: QdnAppRequest) {
  const resource = getQdnAppResourceRequest(request);

  return `/arbitrary/resource/properties/${resource.service}/${encodeURIComponent(resource.name)}/${encodeURIComponent(
    resource.identifier ?? 'default',
  )}`;
}

function buildQdnResourceMetadataPath(request: QdnAppRequest) {
  const resource = getQdnAppResourceRequest(request);

  return `/arbitrary/metadata/${resource.service}/${encodeURIComponent(resource.name)}/${encodeURIComponent(
    resource.identifier ?? 'default',
  )}`;
}

function buildFetchQdnResourcePath(request: QdnAppRequest) {
  const resource = getQdnAppResourceRequest(request);
  const queryParams = new URLSearchParams();

  if (resource.path) {
    queryParams.set('filepath', resource.path);
  }

  for (const key of ['encoding', 'rebuild', 'async']) {
    const value = getRequestValue(request, key);

    if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
      queryParams.set(key, String(value));
    }
  }

  const queryString = queryParams.toString();

  return `/arbitrary/${resource.service}/${encodeURIComponent(resource.name)}${
    resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : ''
  }${queryString ? `?${queryString}` : ''}`;
}

function appendQueryValue(queryParams: URLSearchParams, key: string, value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) {
      appendQueryValue(queryParams, key, item);
    }

    return;
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    queryParams.append(key, String(value));
    return;
  }

  const stringValue = getString(value);

  if (stringValue) {
    queryParams.append(key, stringValue);
  }
}

function buildQdnResourcesPath(request: QdnAppRequest, pathBase: string) {
  const queryParams = new URLSearchParams();
  const queryFields: Record<string, string> = {
    default: 'default',
    description: 'description',
    exactMatchNames: 'exactmatchnames',
    excludeBlocked: 'excludeblocked',
    followedOnly: 'followedonly',
    identifier: 'identifier',
    includeMetadata: 'includemetadata',
    includeStatus: 'includestatus',
    keywords: 'keywords',
    limit: 'limit',
    mode: 'mode',
    name: 'name',
    nameListFilter: 'namefilter',
    names: 'name',
    offset: 'offset',
    prefix: 'prefix',
    query: 'query',
    reverse: 'reverse',
    service: 'service',
    title: 'title',
  };

  for (const [requestKey, queryKey] of Object.entries(queryFields)) {
    appendQueryValue(queryParams, queryKey, getRequestValue(request, requestKey));
  }

  const queryString = queryParams.toString();

  return `${pathBase}${queryString ? `?${queryString}` : ''}`;
}

function appendRequestQueryFields(
  queryParams: URLSearchParams,
  request: QdnAppRequest,
  queryFields: Record<string, string>,
) {
  for (const [requestKey, queryKey] of Object.entries(queryFields)) {
    appendQueryValue(queryParams, queryKey, getRequestValue(request, requestKey));
  }
}

function buildGroupsPath(request: QdnAppRequest) {
  const queryParams = new URLSearchParams();

  appendRequestQueryFields(queryParams, request, {
    limit: 'limit',
    offset: 'offset',
    reverse: 'reverse',
  });

  const queryString = queryParams.toString();

  return `/groups${queryString ? `?${queryString}` : ''}`;
}

function buildSearchGroupsPath(request: QdnAppRequest) {
  const queryParams = new URLSearchParams();

  appendRequestQueryFields(queryParams, request, {
    limit: 'limit',
    offset: 'offset',
    prefixOnly: 'prefixOnly',
    query: 'query',
    reverse: 'reverse',
    visibility: 'visibility',
  });

  const queryString = queryParams.toString();

  return `/groups/search${queryString ? `?${queryString}` : ''}`;
}

function buildGroupMembersPath(request: QdnAppRequest) {
  const groupId = getRequiredGroupId(request, 1);
  const queryParams = new URLSearchParams();

  appendRequestQueryFields(queryParams, request, {
    limit: 'limit',
    offset: 'offset',
    onlyAdmins: 'onlyAdmins',
    reverse: 'reverse',
  });

  const queryString = queryParams.toString();

  return `/groups/members/${encodeURIComponent(String(groupId))}${queryString ? `?${queryString}` : ''}`;
}

function buildGroupJoinRequestsPath(request: QdnAppRequest) {
  return `/groups/joinrequests/${encodeURIComponent(String(getRequiredGroupId(request, 1)))}`;
}

function buildGroupKicksPath(request: QdnAppRequest) {
  const groupId = getRequiredGroupId(request, 1);
  const queryParams = new URLSearchParams();

  appendRequestQueryFields(queryParams, request, {
    address: 'address',
    before: 'before',
    after: 'after',
    limit: 'limit',
    offset: 'offset',
    reverse: 'reverse',
  });

  const queryString = queryParams.toString();

  return `/groups/kicks/${encodeURIComponent(String(groupId))}${queryString ? `?${queryString}` : ''}`;
}

function buildGroupBansPath(request: QdnAppRequest) {
  const groupId = getRequiredGroupId(request, 1);

  return `/groups/bans/${encodeURIComponent(String(groupId))}`;
}

async function buildMemberKicksPath(request: QdnAppRequest, context: QdnViewContext | null) {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const queryParams = new URLSearchParams({ address });

  appendRequestQueryFields(queryParams, request, {
    groupId: 'groupId',
    before: 'before',
    after: 'after',
    limit: 'limit',
    offset: 'offset',
    reverse: 'reverse',
  });

  return `/groups/kicks/member?${queryParams.toString()}`;
}

async function buildMemberBansPath(request: QdnAppRequest, context: QdnViewContext | null) {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const queryParams = new URLSearchParams({ address });

  appendRequestQueryFields(queryParams, request, {
    limit: 'limit',
    offset: 'offset',
    reverse: 'reverse',
  });

  return `/groups/bans/member?${queryParams.toString()}`;
}

async function buildAccountGroupJoinRequestsPath(request: QdnAppRequest, context: QdnViewContext | null) {
  const address = await getAddressForQdnRequest(request, context, 'Address');

  return `/groups/joinrequests/address/${encodeURIComponent(address)}`;
}

async function buildAdminGroupJoinRequestsPath(request: QdnAppRequest, context: QdnViewContext | null) {
  const address = await getAddressForQdnRequest(request, context, 'Address');

  return `/groups/joinrequests/admin/${encodeURIComponent(address)}`;
}

async function getAddressForQdnRequest(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  label: string,
) {
  const requestedAddress = getString(getRequestValue(request, 'address'));

  if (requestedAddress) {
    return requestedAddress;
  }

  const selectedAccount = await getSelectedAccountForQdnApp(context);

  if (!selectedAccount.address) {
    throw new Error(`${label} is required.`);
  }

  return selectedAccount.address;
}

async function buildAccountGroupsPath(request: QdnAppRequest, context: QdnViewContext | null) {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const queryParams = new URLSearchParams();

  appendRequestQueryFields(queryParams, request, {
    adminOnly: 'adminOnly',
    ownerOnly: 'ownerOnly',
  });

  const queryString = queryParams.toString();

  return `/groups/member/${encodeURIComponent(address)}${queryString ? `?${queryString}` : ''}`;
}

function buildSearchChatMessagesPath(request: QdnAppRequest) {
  const queryParams = new URLSearchParams();
  const groupId = getInteger(getRequestValue(request, 'groupId') ?? getRequestValue(request, 'txGroupId'));

  if (typeof groupId === 'number') {
    if (groupId < 0) {
      throw new Error('Group id must be a non-negative integer.');
    }

    queryParams.set('txGroupId', String(groupId));
  }

  appendRequestQueryFields(queryParams, request, {
    after: 'after',
    before: 'before',
    chatReference: 'chatreference',
    encoding: 'encoding',
    hasChatReference: 'haschatreference',
    involving: 'involving',
    limit: 'limit',
    offset: 'offset',
    reverse: 'reverse',
    sender: 'sender',
  });

  return `/chat/messages?${queryParams.toString()}`;
}

async function buildActiveChatsPath(request: QdnAppRequest, context: QdnViewContext | null) {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const queryParams = new URLSearchParams();

  appendRequestQueryFields(queryParams, request, {
    encoding: 'encoding',
    hasChatReference: 'haschatreference',
  });

  const queryString = queryParams.toString();

  return `/chat/active/${encodeURIComponent(address)}${queryString ? `?${queryString}` : ''}`;
}

function buildPrivateGroupChatKeyRequestBody(request: QdnAppRequest, privateKey58: string) {
  return {
    requesterPrivateKey: privateKey58,
    groupId: getRequiredGroupId(request, 1),
    // epochId/keyId are optional base58 byte[]; omitted => Core uses the current epoch.
    epochId: getOptionalBase58RequestString(request, 'epochId'),
    keyId: getOptionalBase58RequestString(request, 'keyId'),
  };
}

function buildPrivateGroupChatKeyRequestRecoveryBody(request: QdnAppRequest, privateKey58: string) {
  return {
    relayerPrivateKey: privateKey58,
    groupId: getRequiredGroupId(request, 1),
    limit: getOptionalIntegerRequestValue(request, 1, 'limit'),
  };
}

function buildPrivateGroupChatMessagesBody(request: QdnAppRequest, privateKey58: string) {
  const chatReference = getOptionalBase58RequestString(request, 'chatReference');

  return {
    recipientPrivateKey: privateKey58,
    groupId: getRequiredGroupId(request, 1),
    before: getInteger(getRequestValue(request, 'before')),
    after: getInteger(getRequestValue(request, 'after')),
    chatReference,
    hasChatReference: getBoolean(getRequestValue(request, 'hasChatReference')),
    sender: getString(getRequestValue(request, 'sender')) || undefined,
    encoding: getString(getRequestValue(request, 'encoding')) || undefined,
    limit: getInteger(getRequestValue(request, 'limit')),
    offset: getInteger(getRequestValue(request, 'offset')),
    reverse: getBoolean(getRequestValue(request, 'reverse')),
  };
}

function buildPrivateDirectChatMessagesBody(
  request: QdnAppRequest,
  privateKey58: string,
  otherAddress: string,
) {
  const chatReference = getOptionalBase58RequestString(request, 'chatReference');

  return {
    accountPrivateKey: privateKey58,
    otherAddress,
    before: getInteger(getRequestValue(request, 'before')),
    after: getInteger(getRequestValue(request, 'after')),
    chatReference,
    hasChatReference: getBoolean(getRequestValue(request, 'hasChatReference')),
    sender: getString(getRequestValue(request, 'sender')) || undefined,
    encoding: getString(getRequestValue(request, 'encoding')) || undefined,
    limit: getInteger(getRequestValue(request, 'limit')),
    offset: getInteger(getRequestValue(request, 'offset')),
    reverse: getBoolean(getRequestValue(request, 'reverse')),
  };
}

function applyQdnDisplaySettings(queryParams: URLSearchParams, context: QdnViewContext | null) {
  if (!context?.displaySettings) {
    return;
  }

  queryParams.set('theme', context.displaySettings.theme);
  queryParams.set('lang', context.displaySettings.language);
  queryParams.set('textSize', context.displaySettings.textSize);
  queryParams.set('accent', context.displaySettings.accent);
  queryParams.set('uiStyle', context.displaySettings.ui);
}

async function getQdnResourceUrl(request: QdnAppRequest, context: QdnViewContext | null) {
  const resource = getQdnAppResourceRequest(request);
  const status = await fetchNodeApiPayload(buildQdnResourceStatusPath(request), request);

  if (
    !isRecord(status) ||
    !status.status ||
    status.status === 'NOT_PUBLISHED'
  ) {
    throw new Error('Resource does not exist.');
  }

  const connection = await getNodeConnection();
  const { pathOnly, queryString } = splitPathAndQuery(resource.path);
  const encodedPath = getEncodedResourcePath(pathOnly);
  const identifierSegment = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams(queryString);

  applyQdnDisplaySettings(queryParams, context);

  const renderQueryString = queryParams.toString();

  return `${connection.nodeApiUrl}/render/${resource.service}/${encodeURIComponent(resource.name)}${identifierSegment}${
    encodedPath ? `/${encodedPath}` : ''
  }${renderQueryString ? `?${renderQueryString}` : ''}`;
}

function getRequiredListName(request: QdnAppRequest) {
  const listName = getRequiredRequestString(request, 'listName', 'List name');

  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(listName)) {
    throw new Error('List name must start with a letter and contain only letters, numbers, or underscores.');
  }

  return listName;
}

function getRequiredListItems(request: QdnAppRequest) {
  const items = getRequestValue(request, 'items');

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Items must be a non-empty array.');
  }

  const itemStrings = items.map(getString).filter(Boolean);

  if (itemStrings.length === 0) {
    throw new Error('Items must contain at least one non-empty string.');
  }

  return itemStrings;
}

async function getAllListsForApp() {
  const connection = await getNodeConnection();

  assertLocalWriteConnection(connection);

  const apiKey = getNodeApiKey(connection);
  const response = await fetchNode(
    '/lists',
    { headers: { 'X-API-KEY': apiKey } },
    connection.nodeApiUrl,
  );
  const result = await readNodeApiResponse(response, connection, QDN_APP_DEFAULT_MAX_BYTES);

  if (!result.ok) {
    throw new Error(result.body || `Failed to get lists with HTTP ${result.status}.`);
  }

  return result.data;
}

async function getListForApp(request: QdnAppRequest) {
  const listName = getRequiredListName(request);
  const connection = await getNodeConnection();

  assertLocalWriteConnection(connection);

  const apiKey = getNodeApiKey(connection);
  const response = await fetchNode(
    `/lists/${encodeURIComponent(listName)}`,
    { headers: { 'X-API-KEY': apiKey } },
    connection.nodeApiUrl,
  );
  const result = await readNodeApiResponse(response, connection, QDN_APP_DEFAULT_MAX_BYTES);

  if (response.status === 404) {
    return [];
  }

  if (!result.ok) {
    throw new Error(result.body || `Failed to get list with HTTP ${result.status}.`);
  }

  return result.data;
}

async function addToListForApp(request: QdnAppRequest) {
  const listName = getRequiredListName(request);
  const itemStrings = getRequiredListItems(request);
  const connection = await getNodeConnection();

  assertLocalWriteConnection(connection);

  const apiKey = getNodeApiKey(connection);
  const result = await postLocalNodeText(
    connection,
    `/lists/${encodeURIComponent(listName)}`,
    JSON.stringify({ items: itemStrings }),
    apiKey,
    'Failed to add items to list.',
    'application/json',
  );

  return parseLocalPostData(result);
}

async function removeFromListForApp(request: QdnAppRequest) {
  const listName = getRequiredListName(request);
  const itemStrings = getRequiredListItems(request);
  const connection = await getNodeConnection();

  assertLocalWriteConnection(connection);

  const apiKey = getNodeApiKey(connection);
  const result = await deleteLocalNodeText(
    connection,
    `/lists/${encodeURIComponent(listName)}`,
    JSON.stringify({ items: itemStrings }),
    apiKey,
    'Failed to remove items from list.',
    'application/json',
  );

  return parseLocalPostData(result);
}

async function handleQdnAppRequest(
  value: unknown,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  if (!isRecord(value)) {
    throw new Error('QDN app requests must be objects.');
  }

  const request: QdnAppRequest = value;
  const action = getString(request.action).toUpperCase();

  if (!action) {
    throw new Error('QDN app request action is required.');
  }

  switch (action) {
    case 'FETCH_NODE_API': {
      const apiPath = getNodeApiPath(getRequestValue(request, 'path'), 'http://127.0.0.1');
      const method = getReadOnlyMethod(getRequestValue(request, 'method'));

      return fetchConfiguredNodeApi(apiPath, getQdnAppMaxBytes(getRequestValue(request, 'maxBytes')), method);
    }

    case 'GET_NODE_INFO':
      return fetchNodeApiPayload('/admin/info', request);

    case 'GET_NODE_STATUS':
      return fetchNodeApiPayload('/admin/status', request);

    case 'GET_ACCOUNT_DATA':
      return fetchNodeApiPayload(`/addresses/${encodeURIComponent(await getAddressForQdnRequest(request, context, 'Address'))}`, request);

    case 'GET_ACCOUNT_GROUPS':
      return fetchNodeApiPayload(await buildAccountGroupsPath(request, context), request);

    case 'GET_ACCOUNT_GROUP_JOIN_REQUESTS':
      return fetchNodeApiPayload(await buildAccountGroupJoinRequestsPath(request, context), request);

    case 'GET_ACCOUNT_NAMES':
      return fetchNodeApiPayload(`/names/address/${encodeURIComponent(await getAddressForQdnRequest(request, context, 'Address'))}`, request);

    case 'GET_SELECTED_ACCOUNT':
      return getSelectedAccountForQdnApp(context);

    case 'RESOLVE_IDENTITIES':
      return resolveIdentitiesForQdnApp(request);

    case 'UNLOCK_SELECTED_ACCOUNT':
      return unlockSelectedAccountForQdnApp(context);

    case 'GET_BALANCE':
      return fetchNodeApiPayload(`/addresses/balance/${encodeURIComponent(await getAddressForQdnRequest(request, context, 'Address'))}`, request);

    case 'GET_GROUP':
      return fetchNodeApiPayload(
        `/groups/${encodeURIComponent(String(getRequiredGroupId(request, 1)))}`,
        request,
      );

    case 'GET_ADMIN_GROUP_JOIN_REQUESTS':
      return fetchNodeApiPayload(await buildAdminGroupJoinRequestsPath(request, context), request);

    case 'GET_GROUP_BANS':
      return fetchNodeApiPayload(buildGroupBansPath(request), request);

    case 'GET_GROUP_JOIN_REQUESTS':
      return fetchNodeApiPayload(buildGroupJoinRequestsPath(request), request);

    case 'GET_GROUP_KICKS':
      return fetchNodeApiPayload(buildGroupKicksPath(request), request);

    case 'GET_GROUP_MEMBERS':
      return fetchNodeApiPayload(buildGroupMembersPath(request), request);

    case 'GET_MEMBER_BANS':
      return fetchNodeApiPayload(await buildMemberBansPath(request, context), request);

    case 'GET_MEMBER_KICKS':
      return fetchNodeApiPayload(await buildMemberKicksPath(request, context), request);

    case 'GET_MINTING_STATUS':
      return getMintingStatusForApp(request, context);

    case 'GET_NAME_DATA':
      return fetchNodeApiPayload(
        `/names/${encodeURIComponent(getRequiredRequestString(request, 'name', 'Name'))}`,
        request,
      );

    case 'GET_QDN_RESOURCE_METADATA':
      return fetchNodeApiPayload(buildQdnResourceMetadataPath(request), request);

    case 'GET_QDN_RESOURCE_PROPERTIES':
      return fetchNodeApiPayload(buildQdnResourcePropertiesPath(request), request);

    case 'GET_QDN_RESOURCE_STATUS':
      return fetchNodeApiPayload(buildQdnResourceStatusPath(request), request);

    case 'GET_QDN_RESOURCE_URL':
      return getQdnResourceUrl(request, context);

    case 'FETCH_QDN_RESOURCE':
      return fetchNodeApiPayload(buildFetchQdnResourcePath(request), request);

    case 'LIST_QDN_RESOURCES':
      return fetchNodeApiPayload(buildQdnResourcesPath(request, '/arbitrary/resources'), request);

    case 'SEARCH_QDN_RESOURCES':
      return fetchNodeApiPayload(buildQdnResourcesPath(request, '/arbitrary/resources/search'), request);

    case 'FETCH_QORTAL_RESOURCE':
      return fetchQortalResourceBinary(request);

    case 'GET_QORTAL_RESOURCE_METADATA':
      return fetchQortalNodeApiPayload(buildQortalMetadataPath(request), request);

    case 'GET_QORTAL_RESOURCE_STATUS':
      return fetchQortalNodeApiPayload(buildQortalStatusPath(request), request);

    case 'GET_QORTAL_RESOURCE_URL':
      return getQortalResourceUrl(request);

    case 'SEARCH_QORTAL_RESOURCES':
      return fetchQortalNodeApiPayload(buildQdnResourcesPath(request, '/arbitrary/resources/search'), request);

    case 'LIST_GROUPS':
      return fetchNodeApiPayload(buildGroupsPath(request), request);

    case 'SEARCH_GROUPS':
      return fetchNodeApiPayload(buildSearchGroupsPath(request), request);

    case 'SEARCH_CHAT_MESSAGES':
      return fetchNodeApiPayload(buildSearchChatMessagesPath(request), request);

    case 'GET_ACTIVE_CHATS':
      return fetchNodeApiPayload(await buildActiveChatsPath(request, context), request);

    case 'GET_PRIVATE_DIRECT_ACTIVE_CHATS':
      return getPrivateDirectActiveChatsForApp(request, context);

    case 'GET_PRIVATE_GROUP_ACTIVE_CHATS':
      return getPrivateGroupActiveChatsForApp(request, context);

    case 'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES':
      return searchPrivateDirectChatMessagesForApp(request, context);

    case 'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES':
      return searchPrivateGroupChatMessagesForApp(request, context);

    case 'REQUEST_PRIVATE_GROUP_CHAT_KEY':
      return requestPrivateGroupChatKeyForApp(request, context, sender);

    case 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS':
      return resolvePrivateGroupChatKeyRequestsForApp(request, context, sender);

    case 'PUBLISH_QDN_RESOURCE':
      return publishQdnResourceForApp(request, context, sender);

    case 'PUBLISH_MULTIPLE_QDN_RESOURCES':
      return publishMultipleQdnResourcesForApp(request, context, sender);

    case 'DELETE_QDN_RESOURCE':
      return deleteQdnResourceForApp(request, context, sender);

    case 'JOIN_GROUP':
      return joinGroupForApp(request, context, sender);

    case 'START_MINTING':
      return startMintingForApp(context, sender);

    case 'REMOVE_MINTING_ACCOUNT':
      return removeMintingAccountForApp(request, context, sender);

    case 'APPROVE_GROUP_JOIN_REQUEST':
      return approveGroupJoinRequestForApp(request, context, sender);

    case 'GROUP_APPROVAL':
      return requestGroupApprovalForApp(request, context, sender);

    case 'INVITE_TO_GROUP':
      return inviteToGroupForApp(request, context, sender);

    case 'LEAVE_GROUP':
      return leaveGroupForApp(request, context, sender);

    case 'UPDATE_GROUP':
      return updateGroupForApp(request, context, sender);

    case 'CREATE_GROUP':
      return createGroupForApp(request, context, sender);

    case 'ADD_GROUP_ADMIN':
      return addGroupAdminForApp(request, context, sender);

    case 'REMOVE_GROUP_ADMIN':
      return removeGroupAdminForApp(request, context, sender);

    case 'GROUP_BAN':
      return banFromGroupForApp(request, context, sender);

    case 'CANCEL_GROUP_BAN':
      return cancelGroupBanForApp(request, context, sender);

    case 'GROUP_KICK':
      return kickFromGroupForApp(request, context, sender);

    case 'CANCEL_GROUP_INVITE':
      return cancelGroupInviteForApp(request, context, sender);

    case 'SET_GROUP':
      return setDefaultGroupForApp(request, context, sender);

    case 'PAYMENT':
      return sendCoinForApp(request, context, sender, 'PAYMENT');

    case 'SEND_COIN':
      return sendCoinForApp(request, context, sender, 'SEND_COIN');

    case 'TRANSFER_ASSET':
      return transferAssetForApp(request, context, sender);

    case 'CREATE_POLL':
      return createPollForApp(request, context, sender);

    case 'VOTE_ON_POLL':
      return voteOnPollForApp(request, context, sender);

    case 'UPDATE_POLL':
      return updatePollForApp(request, context, sender);

    case 'RATE_ACCOUNT':
      return rateAccountForApp(request, context, sender);

    case 'REGISTER_NAME':
      return registerNameForApp(request, context, sender);

    case 'UPDATE_NAME':
      return updateNameForApp(request, context, sender);

    case 'SELL_NAME':
      return sellNameForApp(request, context, sender);

    case 'CANCEL_SELL_NAME':
      return cancelSellNameForApp(request, context, sender);

    case 'BUY_NAME':
      return buyNameForApp(request, context, sender);

    case 'SEND_CHAT_MESSAGE':
      return sendChatMessageForApp(request, context, sender);

    case 'IS_USING_PUBLIC_NODE': {
      const connection = await getNodeConnection();

      return connection.mode === 'network';
    }

    case 'OPEN_NEW_TAB': {
      const address =
        getString(getRequestValue(request, 'address')) || getString(getRequestValue(request, 'qdnUrl'));

      if (!address) {
        throw new Error('Address is required.');
      }

      if (!/^(qdn|home|core):\/\//i.test(address)) {
        throw new Error('OPEN_NEW_TAB only accepts qdn://, home://, and core:// addresses.');
      }

      if (address.length > QDN_OPEN_NEW_TAB_URL_MAX_LENGTH) {
        throw new Error('Address is too long.');
      }

      const hostWindow = context ? getQdnViewHostWindow(context) : null;

      if (!context || !hostWindow) {
        throw new Error('QDN open new tab request does not belong to an active window.');
      }

      hostWindow.webContents.send('qdn-app:open-new-tab', {
        address,
        sourceTabId: context.tabId,
      });

      return true;
    }

    case 'OPEN_CURRENT_TAB': {
      const address =
        getString(getRequestValue(request, 'address')) || getString(getRequestValue(request, 'qdnUrl'));

      if (!address) {
        throw new Error('Address is required.');
      }

      if (!/^(qdn|home|core):\/\//i.test(address)) {
        throw new Error('OPEN_CURRENT_TAB only accepts qdn://, home://, and core:// addresses.');
      }

      if (address.length > QDN_OPEN_NEW_TAB_URL_MAX_LENGTH) {
        throw new Error('Address is too long.');
      }

      const hostWindow = context ? getQdnViewHostWindow(context) : null;

      if (!context || !hostWindow) {
        throw new Error('QDN navigate current tab request does not belong to an active window.');
      }

      hostWindow.webContents.send('qdn-app:open-current-tab', {
        address,
        sourceTabId: context.tabId,
      });

      return true;
    }

    case 'OPEN_QDN_MEDIA_PLAYER': {
      const service = getRequiredRequestString(request, 'service', 'Service').toUpperCase();

      if (!QDN_MEDIA_PLAYER_SERVICES.has(service)) {
        throw new Error('OPEN_QDN_MEDIA_PLAYER only supports AUDIO, VOICE, PODCAST, and VIDEO resources.');
      }

      const name = getRequiredRequestString(request, 'name', 'Name');
      const identifier = getString(getRequestValue(request, 'identifier'));
      const resourcePath = getString(getRequestValue(request, 'path'));

      if (
        name.length > QDN_MEDIA_PLAYER_FIELD_MAX_LENGTH ||
        identifier.length > QDN_MEDIA_PLAYER_FIELD_MAX_LENGTH ||
        resourcePath.length > QDN_MEDIA_PLAYER_FIELD_MAX_LENGTH
      ) {
        throw new Error('QDN media player request fields are too long.');
      }

      const hostWindow = context ? getQdnViewHostWindow(context) : null;

      if (!context || !hostWindow) {
        throw new Error('QDN media player request does not belong to an active window.');
      }

      hostWindow.webContents.send('qdn-app:open-media-player', {
        identifier: identifier || null,
        name,
        path: resourcePath || null,
        service,
      });

      return true;
    }

    case 'OPEN_QDN_DOCUMENT_VIEWER': {
      const service = getRequiredRequestString(request, 'service', 'Service').toUpperCase();

      if (!QDN_DOCUMENT_VIEWER_SERVICES.has(service)) {
        throw new Error('OPEN_QDN_DOCUMENT_VIEWER only supports DOCUMENT, FILE, FILES, and ATTACHMENT resources.');
      }

      const name = getRequiredRequestString(request, 'name', 'Name');
      const identifier = getString(getRequestValue(request, 'identifier'));
      const resourcePath = getString(getRequestValue(request, 'path'));

      if (
        name.length > QDN_MEDIA_PLAYER_FIELD_MAX_LENGTH ||
        identifier.length > QDN_MEDIA_PLAYER_FIELD_MAX_LENGTH ||
        resourcePath.length > QDN_MEDIA_PLAYER_FIELD_MAX_LENGTH
      ) {
        throw new Error('QDN document viewer request fields are too long.');
      }

      const hostWindow = context ? getQdnViewHostWindow(context) : null;

      if (!context || !hostWindow) {
        throw new Error('QDN document viewer request does not belong to an active window.');
      }

      hostWindow.webContents.send('qdn-app:open-document-viewer', {
        identifier: identifier || null,
        name,
        path: resourcePath || null,
        service,
      });

      return true;
    }

    case 'GET_ALL_LISTS':
      return getAllListsForApp();

    case 'GET_LIST':
      return getListForApp(request);

    case 'ADD_TO_LIST':
      return addToListForApp(request);

    case 'REMOVE_FROM_LIST':
      return removeFromListForApp(request);

    case 'SAVE_QDN_RESOURCE': {
      const resource = getQdnAppResourceRequest(request);
      const rawFilename = getString(getRequestValue(request, 'filename')) ||
        `${resource.service}_${resource.name}_${resource.identifier ?? 'default'}`;
      const filename = sanitizeFilename(rawFilename);
      const hostWindow = context ? getQdnViewHostWindow(context) : null;
      const saveDialogOptions = {
        title: 'Save QDN Resource',
        defaultPath: getDefaultDownloadPath(filename),
      };
      const result = hostWindow
        ? await dialog.showSaveDialog(hostWindow, saveDialogOptions)
        : await dialog.showSaveDialog(saveDialogOptions);
      if (result.canceled || !result.filePath) return { canceled: true };
      const response = await fetchConfiguredRawResource(resource, false);
      writeFileSync(result.filePath, Buffer.from(await response.arrayBuffer()));
      return { canceled: false };
    }

    case 'WHICH_UI':
      return 'QORTIUM_HOME_ELECTRON';

    case 'SHOW_ACTIONS': {
      // On a public/network node, only report actions that can actually succeed
      // there, so apps that gate UI off SHOW_ACTIONS don't show controls (e.g.
      // RATE_ACCOUNT) that would throw for lack of a local write connection.
      const connection = await getNodeConnection();

      return connection.mode === 'network'
        ? [...QDN_PUBLIC_NODE_BRIDGE_ACTIONS]
        : [...QDN_APP_BRIDGE_ACTIONS];
    }

    default:
      throw new Error(`${action || 'This'} QDN app request is not supported yet.`);
  }
}

export function registerQdnIpcHandlers() {
  ipcMain.handle('qdn-app:request', async (event, request: unknown) => {
    const context = getQdnViewContextForWebContents(event.sender);

    if (!context) {
      throw new Error('QDN app requests are only available to isolated QDN app views.');
    }

    return handleQdnAppRequest(request, context, event.sender);
  });

  ipcMain.handle('qdn-app:resolveWriteApproval', (event, rawResponse: unknown) => {
    const response = sanitizeQdnWriteApprovalResponse(rawResponse);
    const pendingApproval = pendingQdnWriteApprovals.get(response.requestId);

    if (!pendingApproval) {
      return;
    }

    if (pendingApproval.windowWebContentsId !== event.sender.id) {
      throw new Error('QDN write request response came from the wrong window.');
    }

    pendingApproval.resolve(response.approved);
  });

  ipcMain.handle('qdn:authorizeResource', async (_event, request: QdnAuthorizeResourceRequest) => {
    const { service, name, identifier } = getAuthorizeRequest(request);
    let connection = await getNodeConnection();

    if (connection.mode === 'network') {
      return {
        authorized: true,
        nodeApiUrl: connection.nodeApiUrl,
      };
    }

    connection = await authorizeResource(service, name, identifier, connection);

    return {
      authorized: true,
      nodeApiUrl: connection.nodeApiUrl,
    };
  });

  ipcMain.handle('qdn:listResources', async (_event, request: QdnResourcesSearchRequest) => {
    const { connection, response } = await fetchConfiguredNode(buildResourcesSearchPath(request));
    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        response.status === 403 && connection.mode === 'network'
          ? getNetworkRestrictionMessage()
          : text || `Qortium node request failed with HTTP ${response.status}.`,
      );
    }

    return text ? (JSON.parse(text) as unknown) : null;
  });

  ipcMain.handle('qdn:searchNames', async (_event, request: QdnNamesSearchRequest) => {
    // Guard against an empty query, which would list every registered name.
    if (!getString(request.query)) {
      return [];
    }

    const { connection, response } = await fetchConfiguredNode(buildNamesSearchPath(request));
    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        response.status === 403 && connection.mode === 'network'
          ? getNetworkRestrictionMessage()
          : text || `Qortium node request failed with HTTP ${response.status}.`,
      );
    }

    return text ? (JSON.parse(text) as unknown) : null;
  });

  ipcMain.handle('qdn:fetchNodeApi', async (_event, request: NodeApiRequest) => {
    const apiPath = getNodeApiPath(request.path, 'http://127.0.0.1');
    const maxBytes = Math.max(0, Math.floor(getNumber(request.maxBytes) ?? 0));
    const method = getReadOnlyMethod(request.method);
    const { connection, response } = await fetchConfiguredNode(apiPath, { method });
    const contentLength = getContentLength(response);
    const contentType = response.headers.get('content-type') ?? '';

    if (maxBytes > 0 && typeof contentLength === 'number' && contentLength > maxBytes) {
      await response.body?.cancel();

      return {
        contentLength,
        contentType,
        status: response.status,
        statusText: response.statusText,
        tooLarge: true,
      };
    }

    const rawBody = method === 'HEAD' ? '' : await response.text();
    const body =
      response.status === 403 && connection.mode === 'network'
        ? getNetworkRestrictionMessage()
        : rawBody;
    const bodyLength = Buffer.byteLength(body, 'utf8');

    if (maxBytes > 0 && bodyLength > maxBytes) {
      return {
        contentLength: bodyLength,
        contentType,
        status: response.status,
        statusText: response.statusText,
        tooLarge: true,
      };
    }

    return {
      body,
      contentLength: contentLength ?? bodyLength,
      contentType,
      status: response.status,
      statusText: response.statusText,
      tooLarge: false,
    };
  });

  ipcMain.handle('qdn:fetchResourceText', async (_event, request: QdnRawResourceRequest) => {
    const resource = getRawResourceRequest(request);
    const maxBytes = Math.max(0, Math.floor(getNumber(request.maxBytes) ?? 0));
    const response = await fetchConfiguredRawResource(resource);
    const contentLength = getContentLength(response);
    const contentType = response.headers.get('content-type') ?? '';

    if (maxBytes > 0 && typeof contentLength === 'number' && contentLength > maxBytes) {
      await response.body?.cancel();

      return {
        contentLength,
        contentType,
        tooLarge: true,
      };
    }

    const content = await response.text();

    if (maxBytes > 0 && Buffer.byteLength(content, 'utf8') > maxBytes) {
      return {
        contentLength: Buffer.byteLength(content, 'utf8'),
        contentType,
        tooLarge: true,
      };
    }

    return {
      content,
      contentLength,
      contentType,
      tooLarge: false,
    };
  });

  ipcMain.handle('qdn:fetchResourceData', async (_event, request: QdnRawResourceRequest) => {
    const resource = getRawResourceRequest(request);
    const maxBytes = Math.max(0, Math.floor(getNumber(request.maxBytes) ?? 0));
    const response = await fetchConfiguredRawResource(resource);
    const contentLength = getContentLength(response);
    const contentType = response.headers.get('content-type') ?? '';

    if (maxBytes > 0 && typeof contentLength === 'number' && contentLength > maxBytes) {
      await response.body?.cancel();

      return {
        data: '',
        contentLength,
        contentType,
        tooLarge: true,
      };
    }

    const arrayBuffer = await response.arrayBuffer();

    if (maxBytes > 0 && arrayBuffer.byteLength > maxBytes) {
      return {
        data: '',
        contentLength: arrayBuffer.byteLength,
        contentType,
        tooLarge: true,
      };
    }

    return {
      data: Buffer.from(arrayBuffer).toString('base64'),
      contentLength: contentLength ?? arrayBuffer.byteLength,
      contentType,
    };
  });

  ipcMain.handle('qdn:prepareArchiveRender', async (_event, request: QdnRawResourceRequest) => {
    const resource = getRawResourceRequest(request);

    if (!ARCHIVE_RENDER_SERVICES.has(resource.service)) {
      throw new Error('Only QDN APP and WEBSITE archives can be rendered inline.');
    }

    const response = await fetchConfiguredRawResource(resource);
    const archiveBuffer = Buffer.from(await response.arrayBuffer());
    const entryPoint = await fetchResourceEntryPoint(resource);

    return prepareQdnArchiveRender(resource, archiveBuffer, entryPoint);
  });

  ipcMain.handle('qdn:previewContent', async (event, request: QdnPreviewContentRequest) => {
    const { kind, sourcePath: requestedPath } = getQdnPreviewContentRequest(request);
    let sourcePath = requestedPath;

    if (!sourcePath) {
      const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const dialogOptions = {
        buttonLabel: 'Preview',
        properties: [kind === 'directory' ? ('openDirectory' as const) : ('openFile' as const)],
        title: 'Select Preview Content',
      };
      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);

      if (result.canceled || result.filePaths.length === 0) {
        return {
          canceled: true,
        };
      }

      sourcePath = result.filePaths[0];
    }

    const connection = await getNodeConnection();

    assertLocalWriteConnection(connection);
    const apiKey = getNodeApiKey(connection);
    const { previewPath, service, sourceKind } = await stageQdnPreviewSource(sourcePath);
    const response = await fetchNode(
      `/arbitrary/preview/${service}`,
      {
        body: previewPath,
        headers: {
          'Content-Type': 'text/plain',
          'X-API-KEY': apiKey,
        },
        method: 'POST',
      },
      connection.nodeApiUrl,
    );
    const text = await response.text();

    if (!response.ok) {
      throw new Error(getQdnPreviewErrorMessage(text, response.status));
    }

    if (!text.startsWith('/render/')) {
      throw new Error('Qortium node returned an unexpected preview URL.');
    }

    return {
      canceled: false,
      renderUrl: `${connection.nodeApiUrl.replace(/\/+$/, '')}${text}`,
      service,
      sourceKind,
      sourceName: path.basename(sourcePath),
      sourcePath,
    };
  });

  ipcMain.handle('qdn:downloadResource', async (event, request: QdnRawResourceRequest) => {
    const resource = getRawResourceRequest(request);
    const multiFile = getBoolean(request.multiFile) === true;
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const saveDialogOptions = {
      title: 'Save QDN Resource',
      defaultPath: getDefaultDownloadPath(getSuggestedFilename(request, resource)),
    };
    const result = parentWindow
      ? await dialog.showSaveDialog(parentWindow, saveDialogOptions)
      : await dialog.showSaveDialog(saveDialogOptions);

    if (result.canceled || !result.filePath) {
      return {
        canceled: true,
      };
    }

    // Multi-file resources have no single artifact on the node, so build the zip
    // client-side from the file list; single-file resources are served directly.
    const content = multiFile
      ? await buildResourceZip(resource)
      : Buffer.from(await (await fetchConfiguredRawResource(resource, true)).arrayBuffer());
    writeFileSync(result.filePath, content);

    return {
      canceled: false,
      filePath: result.filePath,
    };
  });
}
