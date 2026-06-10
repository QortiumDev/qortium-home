import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertAccountUnlocked, getAccountProfile, getAccountSigningKey, isAccountUnlocked } from './accounts.js';
import {
  getNodeConnection,
  isInvalidApiKeyResponse,
  refreshNodeConnectionApiKey,
} from './node-settings.js';
import { prepareQdnArchiveRender } from './qdn-archive-render.js';
import { getQdnViewContextForWebContents, type QdnViewContext } from './qdn-views.js';

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
const ARCHIVE_RENDER_SERVICES = new Set(['APP', 'WEBSITE']);
const QDN_WRITE_APPROVAL_TIMEOUT_MS = 120_000;
const QDN_WRITE_ACTIONS = ['PUBLISH_MULTIPLE_QDN_RESOURCES', 'PUBLISH_QDN_RESOURCE', 'DELETE_QDN_RESOURCE'] as const;
const QDN_GROUP_ACTIONS = [
  'APPROVE_GROUP_JOIN_REQUEST',
  'INVITE_TO_GROUP',
  'JOIN_GROUP',
  'LEAVE_GROUP',
  'UPDATE_GROUP',
] as const;
const QDN_NAME_ACTIONS = [
  'BUY_NAME',
  'CANCEL_SELL_NAME',
  'REGISTER_NAME',
  'SELL_NAME',
  'UPDATE_NAME',
] as const;
const QDN_CHAT_ACTIONS = ['SEND_CHAT_MESSAGE'] as const;
const QDN_PRIVATE_GROUP_CHAT_READ_ACTIONS = [
  'GET_PRIVATE_GROUP_ACTIVE_CHATS',
  'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES',
] as const;
const QDN_PRIVATE_DIRECT_CHAT_READ_ACTIONS = [
  'GET_PRIVATE_DIRECT_ACTIVE_CHATS',
  'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
] as const;
const QDN_WRITE_SMOKE_ROLE = 'local';
const QDN_CHAT_MESSAGE_MAX_BYTES = 4000;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const QDN_APP_BRIDGE_ACTIONS = [
  'FETCH_NODE_API',
  'FETCH_QDN_RESOURCE',
  'GET_ACCOUNT_DATA',
  'GET_ACCOUNT_GROUPS',
  'GET_ACCOUNT_GROUP_JOIN_REQUESTS',
  'GET_ACCOUNT_NAMES',
  'GET_ACTIVE_CHATS',
  'GET_ADMIN_GROUP_JOIN_REQUESTS',
  'GET_BALANCE',
  'GET_GROUP',
  'GET_GROUP_JOIN_REQUESTS',
  'GET_GROUP_MEMBERS',
  'GET_MINTING_STATUS',
  'GET_NAME_DATA',
  'GET_NODE_INFO',
  'GET_NODE_STATUS',
  'GET_SELECTED_ACCOUNT',
  'GET_QDN_RESOURCE_METADATA',
  'GET_QDN_RESOURCE_PROPERTIES',
  'GET_QDN_RESOURCE_STATUS',
  'GET_QDN_RESOURCE_URL',
  'IS_USING_PUBLIC_NODE',
  'LIST_GROUPS',
  'LIST_QDN_RESOURCES',
  ...QDN_WRITE_ACTIONS,
  ...QDN_GROUP_ACTIONS,
  ...QDN_NAME_ACTIONS,
  ...QDN_CHAT_ACTIONS,
  ...QDN_PRIVATE_DIRECT_CHAT_READ_ACTIONS,
  ...QDN_PRIVATE_GROUP_CHAT_READ_ACTIONS,
  'SEARCH_CHAT_MESSAGES',
  'SEARCH_GROUPS',
  'SEARCH_QDN_RESOURCES',
  'START_MINTING',
  'WHICH_UI',
  'SHOW_ACTIONS',
] as const;
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

type QdnAuthorizeResourceRequest = {
  identifier?: unknown;
  name?: unknown;
  service?: unknown;
};

type QdnRawResourceRequest = QdnAuthorizeResourceRequest & {
  maxBytes?: unknown;
  path?: unknown;
  suggestedFilename?: unknown;
};

type QdnResourcesSearchRequest = {
  exactMatchNames?: unknown;
  includeMetadata?: unknown;
  includeStatus?: unknown;
  limit?: unknown;
  name?: unknown;
  service?: unknown;
};

type NodeApiRequest = {
  maxBytes?: unknown;
  method?: unknown;
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
type QdnChatAction = (typeof QDN_CHAT_ACTIONS)[number];
type QdnWriteApprovalAction =
  | QdnWriteAction
  | QdnGroupAction
  | QdnNameAction
  | QdnChatAction
  | 'START_MINTING';
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
  avatarUrl: string | null;
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

type NodeConnection = Awaited<ReturnType<typeof getNodeConnection>>;

type QdnWriteApprovalDetails = {
  action: QdnWriteApprovalAction;
  amount?: number | string;
  chatMessagePreview?: string;
  groupId?: number;
  groupName?: string | null;
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

async function requestQdnWriteApproval(
  context: QdnViewContext,
  profile: Awaited<ReturnType<typeof getAccountProfile>>,
  details: QdnWriteApprovalDetails,
) {
  const hostWindow = getQdnViewHostWindow(context);

  if (!hostWindow) {
    throw new Error('QDN write request does not belong to an active window.');
  }

  const requestId = randomUUID();
  const approved = await new Promise<boolean>((resolve) => {
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
    hostWindow.webContents.send('qdn-app:write-request', {
      accountName: profile.name,
      action: details.action,
      address: profile.address,
      amount: typeof details.amount === 'undefined' ? null : String(details.amount),
      chatMessagePreview: details.chatMessagePreview ?? null,
      groupId: typeof details.groupId === 'number' ? details.groupId : null,
      groupName: details.groupName ?? null,
      id: requestId,
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
    avatarUrl: profile.avatarUrl,
    isUnlocked: isAccountUnlocked(context.accountId),
    name: profile.name,
  };
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
    avatarUrl: null,
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
    throw new Error('Only public QDN resources can be loaded right now.');
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
    throw new Error('Only public QDN services can be browsed right now.');
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
    queryParams.set('exactmatchnames', String(getBoolean(request.exactMatchNames) ?? true));
  }

  return `/arbitrary/resources/search?${queryParams.toString()}`;
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

  return result.data;
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

function buildQdnDeletePath(resource: QdnWriteResourceRequest) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQueryValue(queryParams, 'fee', resource.fee);

  const queryString = queryParams.toString();

  return `/arbitrary/resource/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}/delete${
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
  const writeContext = await getQdnWriteContext(context, resource);
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

  const apiKey = writeContext.apiKey;
  const privateKey58 = getQdnWritePrivateKey(writeContext);
  const inlineSource = isInlineQdnWriteSource(source) ? source : null;
  const publishPath = inlineSource ? buildQdnPublishBase64Path(resource, inlineSource) : buildQdnPublishPath(resource);
  const publishBody = inlineSource ? inlineSource.dataBase64 : source.path ?? '';
  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    publishPath,
    publishBody,
    apiKey,
    'QDN publish transaction build failed.',
  );
  const processedTransaction = await signAndProcessTransaction(
    writeContext.connection,
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
  const writeContext = await getQdnWriteContext(context, approvalResource ?? resources[0].resource);

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
  const privateKey58 = getQdnWritePrivateKey(writeContext);
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
      const unsignedTransaction = await postLocalNodeText(
        writeContext.connection,
        buildQdnPublishBase64Path(entry.resource, source),
        source.dataBase64 ?? '',
        apiKey,
        'QDN publish transaction build failed.',
      );
      const processedTransaction = await signAndProcessTransaction(
        writeContext.connection,
        apiKey,
        privateKey58,
        unsignedTransaction.body,
      );

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
  const writeContext = await getQdnWriteContext(context, resource);

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
  const privateKey58 = getQdnWritePrivateKey(writeContext);
  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    buildQdnDeletePath(resource),
    '',
    apiKey,
    'QDN delete transaction build failed.',
  );
  const processedTransaction = await signAndProcessTransaction(
    writeContext.connection,
    apiKey,
    privateKey58,
    unsignedTransaction.body,
  );

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

async function sendChatMessageForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const target = getChatMessageTarget(request);
  const message = getChatMessageText(request);
  const chatReference = getOptionalBase58RequestString(request, 'chatReference');
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
  const queryParams = new URLSearchParams(queryString);

  if (resource.identifier) {
    queryParams.set('identifier', resource.identifier);
  }

  applyQdnDisplaySettings(queryParams, context);

  const renderQueryString = queryParams.toString();

  return `${connection.nodeApiUrl}/render/${resource.service}/${encodeURIComponent(resource.name)}${
    encodedPath ? `/${encodedPath}` : ''
  }${renderQueryString ? `?${renderQueryString}` : ''}`;
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

    case 'GET_BALANCE':
      return fetchNodeApiPayload(`/addresses/balance/${encodeURIComponent(await getAddressForQdnRequest(request, context, 'Address'))}`, request);

    case 'GET_GROUP':
      return fetchNodeApiPayload(
        `/groups/${encodeURIComponent(String(getRequiredGroupId(request, 1)))}`,
        request,
      );

    case 'GET_ADMIN_GROUP_JOIN_REQUESTS':
      return fetchNodeApiPayload(await buildAdminGroupJoinRequestsPath(request, context), request);

    case 'GET_GROUP_JOIN_REQUESTS':
      return fetchNodeApiPayload(buildGroupJoinRequestsPath(request), request);

    case 'GET_GROUP_MEMBERS':
      return fetchNodeApiPayload(buildGroupMembersPath(request), request);

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

    case 'APPROVE_GROUP_JOIN_REQUEST':
      return approveGroupJoinRequestForApp(request, context, sender);

    case 'INVITE_TO_GROUP':
      return inviteToGroupForApp(request, context, sender);

    case 'LEAVE_GROUP':
      return leaveGroupForApp(request, context, sender);

    case 'UPDATE_GROUP':
      return updateGroupForApp(request, context, sender);

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

    case 'WHICH_UI':
      return 'QORTIUM_HOME_ELECTRON';

    case 'SHOW_ACTIONS':
      return [...QDN_APP_BRIDGE_ACTIONS];

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

  ipcMain.handle('qdn:prepareArchiveRender', async (_event, request: QdnRawResourceRequest) => {
    const resource = getRawResourceRequest(request);

    if (!ARCHIVE_RENDER_SERVICES.has(resource.service)) {
      throw new Error('Only QDN APP and WEBSITE archives can be rendered inline.');
    }

    const response = await fetchConfiguredRawResource(resource);
    const archiveBuffer = Buffer.from(await response.arrayBuffer());

    return prepareQdnArchiveRender(resource, archiveBuffer);
  });

  ipcMain.handle('qdn:downloadResource', async (event, request: QdnRawResourceRequest) => {
    const resource = getRawResourceRequest(request);
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

    const response = await fetchConfiguredRawResource(resource, true);
    const content = Buffer.from(await response.arrayBuffer());
    writeFileSync(result.filePath, content);

    return {
      canceled: false,
      filePath: result.filePath,
    };
  });
}
