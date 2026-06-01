import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertAccountUnlocked, getAccountProfile, getAccountSigningKey } from './accounts.js';
import { getNodeConnection } from './node-settings.js';
import { getQdnViewContextForWebContents, type QdnViewContext } from './qdn-views.js';

const PREVIEW_API_KEY_PATH = path.join(os.homedir(), 'git', 'qortium', 'preview', 'apikey.txt');
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
const QDN_ACCOUNT_READ_APPROVAL_TIMEOUT_MS = 120_000;
const QDN_WRITE_APPROVAL_TIMEOUT_MS = 120_000;
const QDN_WRITE_ACTIONS = ['PUBLISH_QDN_RESOURCE', 'DELETE_QDN_RESOURCE'] as const;
const QDN_CHAT_ACTIONS = ['JOIN_GROUP', 'SEND_CHAT_MESSAGE'] as const;
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
  'GET_ACCOUNT_NAMES',
  'GET_ACTIVE_CHATS',
  'GET_BALANCE',
  'GET_GROUP',
  'GET_GROUP_MEMBERS',
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
  ...QDN_CHAT_ACTIONS,
  ...QDN_PRIVATE_DIRECT_CHAT_READ_ACTIONS,
  ...QDN_PRIVATE_GROUP_CHAT_READ_ACTIONS,
  'SEARCH_CHAT_MESSAGES',
  'SEARCH_GROUPS',
  'SEARCH_QDN_RESOURCES',
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
type QdnChatAction = (typeof QDN_CHAT_ACTIONS)[number];
type QdnWriteApprovalAction =
  | QdnWriteAction
  | QdnChatAction
  | 'READ_PRIVATE_GROUP_CHAT'
  | 'READ_PRIVATE_DIRECT_CHAT';
type QdnChatPermissionAction =
  | 'SEND_CHAT_MESSAGE'
  | 'READ_PRIVATE_GROUP_CHAT'
  | 'READ_PRIVATE_DIRECT_CHAT';

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
  displayName: string;
  kind: 'directory' | 'file';
  path: string;
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
  chatMessagePreview?: string;
  groupId?: number;
  groupName?: string | null;
  permissionScope?: 'single-request' | 'session';
  recipientAddress?: string;
  resource?: QdnWriteResourceRequest;
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

type AccountReadApprovalResponse = {
  approved: boolean;
  requestId: string;
};

type QdnWriteApprovalResponse = AccountReadApprovalResponse;

type PendingAccountReadApproval = {
  resolve: (approved: boolean) => void;
  windowWebContentsId: number;
};

const approvedAccountReadRequests = new Set<string>();
const approvedQdnChatPermissions = new Set<string>();
const pendingAccountReadApprovals = new Map<string, PendingAccountReadApproval>();
const pendingQdnWriteApprovals = new Map<string, PendingAccountReadApproval>();

function expandHomePath(filePath: string) {
  if (filePath === '~') {
    return os.homedir();
  }

  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}

function sanitizeAccountReadApprovalResponse(value: unknown): AccountReadApprovalResponse {
  if (!isRecord(value)) {
    throw new Error('QDN account request response is required.');
  }

  if (typeof value.requestId !== 'string' || !value.requestId) {
    throw new Error('QDN account request id is required.');
  }

  return {
    approved: value.approved === true,
    requestId: value.requestId,
  };
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

function getAccountReadApprovalCacheKey(context: QdnViewContext, accountId: string) {
  return [
    context.windowId,
    context.tabId,
    context.currentUrl ?? '',
    accountId,
    'GET_SELECTED_ACCOUNT',
  ].join('\n');
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

async function requestAccountReadApproval(
  context: QdnViewContext,
  profile: Awaited<ReturnType<typeof getAccountProfile>>,
) {
  const cacheKey = getAccountReadApprovalCacheKey(context, profile.accountId);

  if (approvedAccountReadRequests.has(cacheKey)) {
    return;
  }

  const hostWindow = getQdnViewHostWindow(context);

  if (!hostWindow) {
    throw new Error('QDN account request does not belong to an active window.');
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
      pendingAccountReadApprovals.delete(requestId);
      resolve(nextApproved);
    };
    const handleWindowClosed = () => settle(false);
    const timeoutId = setTimeout(() => settle(false), QDN_ACCOUNT_READ_APPROVAL_TIMEOUT_MS);

    pendingAccountReadApprovals.set(requestId, {
      resolve: settle,
      windowWebContentsId: hostWindow.webContents.id,
    });
    hostWindow.once('closed', handleWindowClosed);
    hostWindow.webContents.send('qdn-app:account-read-request', {
      action: 'GET_SELECTED_ACCOUNT',
      address: profile.address,
      avatarUrl: profile.avatarUrl,
      id: requestId,
      name: profile.name,
      resourceUrl: context.currentUrl ?? 'QDN app',
    });
  });

  if (!approved) {
    throw new Error('Account request was denied.');
  }

  approvedAccountReadRequests.add(cacheKey);
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
      chatMessagePreview: details.chatMessagePreview ?? null,
      groupId: typeof details.groupId === 'number' ? details.groupId : null,
      groupName: details.groupName ?? null,
      id: requestId,
      permissionScope: details.permissionScope ?? 'single-request',
      recipientAddress: details.recipientAddress ?? null,
      resource: details.resource
        ? {
            identifier: details.resource.identifier ?? null,
            name: details.resource.name,
            service: details.resource.service,
          }
        : null,
      resourceUrl: context.currentUrl ?? 'QDN app',
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

  await requestAccountReadApproval(context, profile);

  return {
    address: profile.address,
    avatarUrl: profile.avatarUrl,
    name: profile.name,
  };
}

function readTrimmedFile(filePath: string) {
  const expandedPath = expandHomePath(filePath);

  if (!existsSync(expandedPath)) {
    return '';
  }

  return readFileSync(expandedPath, 'utf8').trim();
}

function readNodeApiKey() {
  const explicitApiKey = process.env.QORTIUM_HOME_NODE_API_KEY?.trim();

  if (explicitApiKey) {
    return explicitApiKey;
  }

  const explicitApiKeyPath = process.env.QORTIUM_HOME_NODE_API_KEY_PATH?.trim();

  if (explicitApiKeyPath) {
    return readTrimmedFile(explicitApiKeyPath);
  }

  return readTrimmedFile(PREVIEW_API_KEY_PATH);
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
    tags: getRequestTags(getRequestValue(request, 'tags')),
    category: category || undefined,
    fee: getRequestFee(getRequestValue(request, 'fee')),
  };
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

function getNodeApiKey() {
  const apiKey = readNodeApiKey();

  if (!apiKey) {
    throw new Error('Qortium node API key was not found.');
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
    headers['X-API-KEY'] = getNodeApiKey();
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

async function authorizeResource(
  service: string,
  name: string,
  identifier: string | undefined,
  apiKey: string,
  nodeApiUrl: string,
) {
  const identifierPath = identifier ? `/${encodeURIComponent(identifier)}` : '';
  const response = await fetchNode(
    `/render/authorize/${service}/${encodeURIComponent(name)}${identifierPath}`,
    {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
      },
    },
    nodeApiUrl,
  );

  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(message || `QDN authorization failed with HTTP ${response.status}.`);
  }
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
  computePath = '/arbitrary/compute',
) {
  const rawUnsignedWithNonce = await postLocalNodeText(
    connection,
    computePath,
    rawUnsignedBytes58,
    apiKey,
    'QDN transaction nonce computation failed.',
  );
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

  if (isQdnWriteSmokeMode()) {
    const smokeProfile = getQdnWriteSmokeProfile(resource);

    return {
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

  const apiKey = getNodeApiKey();
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

function getGroupName(groupData: unknown) {
  if (!isRecord(groupData)) {
    return null;
  }

  return getString(groupData.groupName) || getString(groupData.name) || null;
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
  const source = await selectQdnPublishSource(context as QdnViewContext);

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

  const apiKey = getNodeApiKey();
  const privateKey58 = getQdnWritePrivateKey(writeContext);
  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    buildQdnPublishPath(resource),
    source.path,
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

  const apiKey = getNodeApiKey();
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

  await requestQdnChatPermissionApproval(
    context as QdnViewContext,
    chatContext.profile,
    'READ_PRIVATE_GROUP_CHAT',
    {
      groupName: 'All closed groups',
    },
  );

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
  const groupData = await getGroupDataForChat(chatContext.connection, groupId);

  await requestQdnChatPermissionApproval(
    context as QdnViewContext,
    chatContext.profile,
    'READ_PRIVATE_GROUP_CHAT',
    {
      groupId,
      groupName: getGroupName(groupData),
    },
  );

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

  await requestQdnChatPermissionApproval(
    context as QdnViewContext,
    chatContext.profile,
    'READ_PRIVATE_DIRECT_CHAT',
    {},
  );

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

  await requestQdnChatPermissionApproval(
    context as QdnViewContext,
    chatContext.profile,
    'READ_PRIVATE_DIRECT_CHAT',
    {
      recipientAddress: otherAddress,
    },
  );

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

async function getQdnResourceUrl(request: QdnAppRequest) {
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
      return fetchNodeApiPayload(
        `/addresses/${encodeURIComponent(getRequiredRequestString(request, 'address', 'Address'))}`,
        request,
      );

    case 'GET_ACCOUNT_GROUPS':
      return fetchNodeApiPayload(await buildAccountGroupsPath(request, context), request);

    case 'GET_ACCOUNT_NAMES':
      return fetchNodeApiPayload(
        `/names/address/${encodeURIComponent(getRequiredRequestString(request, 'address', 'Address'))}`,
        request,
      );

    case 'GET_SELECTED_ACCOUNT':
      return getSelectedAccountForQdnApp(context);

    case 'GET_BALANCE':
      return fetchNodeApiPayload(
        `/addresses/balance/${encodeURIComponent(getRequiredRequestString(request, 'address', 'Address'))}`,
        request,
      );

    case 'GET_GROUP':
      return fetchNodeApiPayload(
        `/groups/${encodeURIComponent(String(getRequiredGroupId(request, 1)))}`,
        request,
      );

    case 'GET_GROUP_MEMBERS':
      return fetchNodeApiPayload(buildGroupMembersPath(request), request);

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
      return getQdnResourceUrl(request);

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

    case 'DELETE_QDN_RESOURCE':
      return deleteQdnResourceForApp(request, context, sender);

    case 'JOIN_GROUP':
      return joinGroupForApp(request, context, sender);

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

  ipcMain.handle('qdn-app:resolveAccountReadApproval', (event, rawResponse: unknown) => {
    const response = sanitizeAccountReadApprovalResponse(rawResponse);
    const pendingApproval = pendingAccountReadApprovals.get(response.requestId);

    if (!pendingApproval) {
      return;
    }

    if (pendingApproval.windowWebContentsId !== event.sender.id) {
      throw new Error('QDN account request response came from the wrong window.');
    }

    pendingApproval.resolve(response.approved);
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
    const connection = await getNodeConnection();

    if (connection.mode === 'network') {
      return {
        authorized: true,
        nodeApiUrl: connection.nodeApiUrl,
      };
    }

    const apiKey = getNodeApiKey();

    await authorizeResource(service, name, undefined, apiKey, connection.nodeApiUrl);

    if (identifier) {
      await authorizeResource(service, name, identifier, apiKey, connection.nodeApiUrl);
    }

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
