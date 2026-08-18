import { app, BrowserWindow, ipcMain, type WebContents } from 'electron'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  getHomeV2AppNodeState,
  getHomeV2ReadableNode,
  readHomeV2Identity,
  readResolvedHomeV2Avatar,
} from './home-v2-node-bridge.js'
import { nodeFetch } from './node-tls.js'
import {
  getQdnViewContextForWebContents,
  isQdnRenderUrlSameAppResource,
  type QdnViewContext,
} from './qdn-views.js'
import { encodeQdnBridgeError, encodeQdnBridgeResult } from './qdn-bridge-error.js'
import {
  buildHomeV2AssetReadPath,
  buildHomeV2ChainReadPath,
  buildHomeV2NamePath,
  buildHomeV2ResourcePath,
  buildHomeV2ResourceRenderPath,
  getHomeV2AppActions,
  getHomeV2AppNetwork,
  HOME_V2_APP_LIMITS,
  isHomeV2AppRecord,
  isHomeV2ChainReadAction,
  normalizeHomeV2Address,
  normalizeHomeV2AppAction,
  normalizeHomeV2AppProtocol,
  normalizeHomeV2IdentityAddresses,
  normalizeHomeV2OpenAddress,
  normalizeHomeV2ReadMethod,
  normalizeHomeV2ReadPath,
  normalizeHomeV2ResponseMaxBytes,
  type HomeV2AppBridgeProtocol,
  type HomeV2AppNetwork,
} from './home-v2-app-actions.js'
import {
  fetchHomeV2AvatarAction,
  type HomeV2AvatarAction,
} from './home-v2-avatar-actions.js'
import {
  assertHomeV2OpenPublicGroup,
  buildHomeV2QortiumPublicChatBuildBody,
  createHomeV2UnknownChatBroadcastResult,
  isHomeV2PublicChatAction,
  normalizeHomeV2PublicChatReferenceTarget,
  normalizeHomeV2PublicChatRequest,
  type HomeV2PublicChatAction,
  type HomeV2PublicChatRequest,
} from './home-v2-chat-actions.js'
import {
  encryptQdm1Message,
  encryptQortalDirectMessage,
} from './home-v2-direct-chat-actions.js'
import {
  assertHomeV2DirectReferenceTarget,
  decryptHomeV2DirectChatRow,
  directDecryptFailure,
  isHomeV2DirectChatReadAction,
  isHomeV2DirectChatWriteAction,
  normalizeHomeV2DirectChatReadRequest,
  normalizeHomeV2DirectChatWriteRequest,
  type HomeV2DirectChatWriteAction,
  type HomeV2DirectChatWriteRequest,
} from './home-v2-direct-chat-contract.js'
import {
  appendHomeV2GroupMembershipSignature,
  buildUnsignedQortalGroupMembershipTransactionBytes,
  createHomeV2GroupMembershipSuccess,
  createHomeV2UnknownGroupMembershipBroadcastResult,
  encodeHomeV2GroupMembershipTransaction,
  groupMembershipIdempotentState,
  isHomeV2GroupMembershipAction,
  normalizeHomeV2GroupMembershipRequest,
  normalizeHomeV2GroupMembershipTarget,
  normalizeQortalGroupMembershipFee,
  qortalGroupMembershipFeeType,
  type HomeV2GroupMembershipAction,
  type HomeV2GroupMembershipRequest,
  type HomeV2GroupMembershipTarget,
} from './home-v2-group-actions.js'
import {
  appendHomeV2GroupAdminSignature,
  assertHomeV2GroupAdminAuthority,
  assertUnsignedHomeV2GroupAdminTransaction,
  buildUnsignedQortalGroupAdminTransactionBytes,
  buildUnsignedQortiumGroupAdminTransactionBytes,
  createHomeV2GroupAdminSuccess,
  createHomeV2UnknownGroupAdminBroadcastResult,
  encodeHomeV2GroupAdminTransaction,
  groupAdminIdempotentResult,
  hasHomeV2GroupJoinRequest,
  homeV2GroupAdminOperationLabel,
  isHomeV2GroupAdminAction,
  normalizeHomeV2GroupAdminAddresses,
  normalizeHomeV2GroupAdminFee,
  normalizeHomeV2GroupAdminRequest,
  normalizeHomeV2GroupAdminTarget,
  qortalGroupAdminFeeType,
  type HomeV2GroupAdminAction,
  type HomeV2GroupAdminRequest,
  type HomeV2GroupAdminTarget,
} from './home-v2-group-admin-actions.js'
import {
  createHomeV2BridgeError,
  getHomeV2AppHostInfo,
  getHomeV2AppRouteDescriptor,
  getHomeV2AvailableAppActions,
  normalizeHomeV2BridgeError,
  type HomeV2AppHostInfo,
} from './home-v2-app-runtime.js'
import {
  getAccountProfile,
  getAccountSecretKey,
  getAccountSigningPublicKey,
  isAccountUnlocked,
  signChatTransaction,
  signDetached,
  signTransactionWithNonce,
  stampTransactionNonce,
} from './accounts.js'
import { createHomeV2SendRateLimiter } from './home-v2-send-rate-limiter.js'
import { base58Decode, base58Encode } from './base58.js'
import { computeHomeV2ChatNonce } from './home-v2-chat-pow.js'
import { readableNodeErrorMessage } from './node-error-body.js'
import { getNodeConnection } from './node-settings.js'
import {
  assertPublicChatTransaction,
  assertPublicJoinGroupTransaction,
  assertPublicLeaveGroupTransaction,
} from './public-transaction-validation.js'
import {
  buildUnsignedQortalDirectChatTransactionBytes,
  buildUnsignedQortalGroupChatTransactionBytes,
  qortalChatPowDifficultyForBalanceResponse,
  QORTAL_CHAT_POW_DIFFICULTY_BELOW,
  stampQortalGroupChatNonce,
} from './qortal-chat.js'
import {
  appendSignatureToTransactionBytes,
  getSignatureFromSignedTransactionBytes,
} from './qortal-payment.js'

export { getHomeV2AppActions as getHomeV2ReadOnlyAppActions }

// The Qortium CHAT memory-pow difficulty. Mirrors the private CHAT_POW_DIFFICULTY
// constant in electron/qdn.ts and src/platform.ts (all three must stay equal;
// Core enforces this value server-side).
const QORTIUM_CHAT_POW_DIFFICULTY = 8
const CHAT_WRITE_TIMEOUT_MS = 30_000
// A few hundred KB is ample for a CHAT build/group-metadata/process/error
// response — bounds the signing-path node calls below (FIX #4, security
// review) using the same bounded-read approach as the rest of this file's
// read-only actions (readBoundedResponse / HOME_V2_APP_LIMITS.responseBytes).
const CHAT_SIGNING_RESPONSE_MAX_BYTES = 256 * 1024
const DIRECT_CHAT_READ_RESPONSE_MAX_BYTES = 1024 * 1024

type AccountReadAction =
  | 'GET_SELECTED_ACCOUNT'
  | 'GET_USER_ACCOUNT'
  | 'GET_PRIVATE_DIRECT_ACTIVE_CHATS'
  | 'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES'
  | 'SEND_CHAT_DELETE'
  | 'SEND_CHAT_EDIT'
  | 'SEND_CHAT_MESSAGE'
  | 'SEND_CHAT_REACTION'
  | HomeV2DirectChatWriteAction
  | 'JOIN_GROUP'
  | 'LEAVE_GROUP'
  | HomeV2GroupAdminAction
  | 'UNLOCK_SELECTED_ACCOUNT'
type PermissionDecision = {
  readonly approved: boolean
  readonly scope: 'session' | 'single-request' | null
}

const pendingAccountReads = new Map<string, {
  readonly hostWebContentsId: number
  readonly resolve: (decision: PermissionDecision) => void
  readonly timeout: ReturnType<typeof setTimeout>
}>()
const sessionAccountReadGrants = new Set<string>()
// Fix B (security review finding 8): bounds how often an already-granted tab
// can broadcast chat sends. See home-v2-send-rate-limiter.ts for the shared
// constants/algorithm (also used by Android's requestApp in
// src/home-v2-live/HomeV2LiveApp.tsx).
const chatSendRateLimiter = createHomeV2SendRateLimiter()

// Fix 5 (Sol re-review #6): includes the sender's own WebContents id and its
// host window id, the same sender/window identity accountGrantKey below
// keys permission grants off of — a bare tabId|accountId key let a restored
// or duplicate tab id in a DIFFERENT window (or a different, unrelated
// WebContents that happened to reuse a tab id string) share — and so
// throttle — the SAME rate-limit bucket as this one.
function chatSendRateLimitKey(sender: WebContents, context: QdnViewContext) {
  return [sender.id, context.windowId, context.tabId, context.accountId ?? 'none'].join('|')
}

function accountGrantKey(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: AccountReadAction,
  accountUnlocked: boolean,
  nodeRoute: string,
) {
  return [
    sender.id,
    context.tabId,
    context.accountId ?? 'none',
    context.resourceUrl ?? 'unknown-app',
    protocol,
    action,
    accountUnlocked,
    nodeRoute,
  ].join('|')
}

function sameViewContext(left: QdnViewContext, right: QdnViewContext) {
  return left.accountId === right.accountId &&
    left.resourceUrl === right.resourceUrl &&
    left.tabId === right.tabId &&
    left.windowId === right.windowId
}

// Fix A defense-in-depth (finding 1): a session grant and the permission
// prompt itself are keyed off `context.resourceUrl`, the identity Home's
// trusted top-level UI attached at launch — but that field is never updated
// by in-view navigation, so if a nav-guard path were ever missed,
// `resourceUrl` could keep pointing at the app that was originally granted
// while `currentUrl` (what the view actually has loaded) had drifted to a
// different app. With electron/qdn-views.ts's isAllowedInViewNavigation now
// constraining in-view navigation to the same resource, this should be
// unreachable — this check closes the gap regardless, and specifically
// refuses to honor a stale session grant when the two disagree.
//
// Fix 3 (Sol re-review #3): `context.currentUrl` (getQdnViewContextForWebContents,
// electron/qdn-views.ts) is the TRUSTED live URL — sourced directly from
// webContents.getURL() at the moment of this call, not from a field that
// could have gone stale — so this recheck fails closed against what the view
// actually has loaded right now, not a best-case snapshot. `resourceUrl` or
// `currentUrl` being absent is not itself suspicious (e.g. before the first
// load completes), so this only refuses when both are present and disagree.
function liveResourceMatchesGrant(context: QdnViewContext): boolean {
  if (!context.resourceUrl || !context.currentUrl) return true
  return isQdnRenderUrlSameAppResource(context.currentUrl, {
    nodeOrigin: context.nodeOrigin,
    requestedUrl: null,
    resourceUrl: context.resourceUrl,
  })
}

async function requireAccountReadPermission(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: AccountReadAction,
  writeDetails?: {
    readonly kind: 'chat'
    readonly targetChainLabel: string
    readonly groupId: number
    readonly messagePreview: string
    readonly operationLabel?: string
    readonly chatReference?: string | null
  } | {
    readonly kind: 'direct'
    readonly targetChainLabel: string
    readonly messagePreview?: string
    readonly operationLabel: string
    readonly otherAddress: string
    readonly routeLabel: string
    readonly singleRequestOnly?: boolean
    readonly chatReference?: string | null
  } | {
    readonly kind: 'group'
    readonly targetChainLabel: string
    readonly groupId: number
    readonly groupName: string
    readonly operationLabel: string
    readonly routeLabel: string
    readonly memberAddress?: string
    readonly reason?: string
    readonly singleRequestOnly?: boolean
    readonly timeToLive?: number
  },
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  // Fix A defense-in-depth: refuse before even consulting the session-grant
  // map when the view's live resource has drifted from what it was granted
  // for — a stale grant for a different, now-loaded app must never be honored.
  if (!liveResourceMatchesGrant(context)) {
    throw new Error('Account access context changed before approval completed.')
  }
  const targetNetwork = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
  const nodeBefore = await getHomeV2ReadableNode(targetNetwork)
  const nodeRoute = `${nodeBefore.mode}|${nodeBefore.nodeApiUrl}`
  const accountUnlocked = isAccountUnlocked(context.accountId)
  const grantKey = [
    accountGrantKey(
      sender,
      context,
      protocol,
      action,
      accountUnlocked,
      nodeRoute,
    ),
    writeDetails?.kind === 'group'
      ? `group:${writeDetails.groupId}`
      : writeDetails?.kind === 'direct'
        ? `direct:${writeDetails.otherAddress}`
        : '',
  ].join('|')
  const singleRequestOnly =
    (writeDetails?.kind === 'group' || writeDetails?.kind === 'direct') &&
    writeDetails.singleRequestOnly === true
  if (!singleRequestOnly && sessionAccountReadGrants.has(grantKey)) return
  const hostWindow = BrowserWindow.fromId(context.windowId)
  if (!hostWindow || hostWindow.isDestroyed()) {
    throw new Error('The app request does not belong to an active Home window.')
  }
  const requestId = randomUUID()
  const decision = await new Promise<PermissionDecision>((resolve) => {
    const timeout = setTimeout(() => {
      pendingAccountReads.delete(requestId)
      resolve({ approved: false, scope: null })
      // The renderer's permission-prompt UI (queuePermissionPrompt) is only
      // told about approval/denial via home-v2-app:permission-resolve, which
      // normally originates FROM the renderer when the user clicks a button.
      // On this main-process-initiated auto-deny, tell it explicitly so the
      // prompt does not stay stuck on screen after the request has already
      // been denied here (FIX #3, security review).
      if (!hostWindow.isDestroyed()) {
        hostWindow.webContents.send('home-v2-app:permission-timeout', { requestId })
      }
    }, 60_000)
    pendingAccountReads.set(requestId, {
      hostWebContentsId: hostWindow.webContents.id,
      resolve,
      timeout,
    })
    hostWindow.webContents.send('home-v2-app:permission-request', {
      accountId: context.accountId,
      action,
      appIdentityKey: context.resourceUrl ?? `home-v2-tab:${context.tabId}`,
      appTitle: context.resourceUrl ?? 'QDN app',
      protocol,
      requestId,
      resourceUrl: context.resourceUrl,
      tabId: context.tabId,
      targetNetwork,
      ...(writeDetails?.kind === 'chat'
        ? {
            writeKind: 'chat',
            chatGroupId: writeDetails.groupId,
            chatMessagePreview: writeDetails.messagePreview,
            writeOperationLabel: writeDetails.operationLabel ?? 'Send message',
            chatReference: writeDetails.chatReference ?? null,
            writeTargetChainLabel: writeDetails.targetChainLabel,
          }
        : writeDetails?.kind === 'direct'
          ? {
              writeKind: 'direct',
              chatMessagePreview: writeDetails.messagePreview ?? null,
              chatReference: writeDetails.chatReference ?? null,
              writeOperationLabel: writeDetails.operationLabel,
              writeOtherAddress: writeDetails.otherAddress,
              writeRouteLabel: writeDetails.routeLabel,
              writeSingleRequestOnly: writeDetails.singleRequestOnly === true,
              writeTargetChainLabel: writeDetails.targetChainLabel,
            }
          : writeDetails?.kind === 'group'
          ? {
              writeKind: 'group',
              groupId: writeDetails.groupId,
              groupName: writeDetails.groupName,
              writeOperationLabel: writeDetails.operationLabel,
              writeRouteLabel: writeDetails.routeLabel,
              writeTargetChainLabel: writeDetails.targetChainLabel,
              writeMemberAddress: writeDetails.memberAddress,
              writeReason: writeDetails.reason,
              writeSingleRequestOnly: writeDetails.singleRequestOnly === true,
              writeTimeToLive: writeDetails.timeToLive,
            }
          : {}),
    })
  })
  if (!decision.approved) throw new Error('Account access was denied.')
  const freshContext = getQdnViewContextForWebContents(sender)
  if (
    !freshContext ||
    !sameViewContext(context, freshContext) ||
    !liveResourceMatchesGrant(freshContext)
  ) {
    throw new Error('Account access context changed before approval completed.')
  }
  if (action === 'UNLOCK_SELECTED_ACCOUNT') {
    if (!isAccountUnlocked(context.accountId)) {
      throw new Error('The account was not unlocked.')
    }
  } else if (isAccountUnlocked(context.accountId) !== accountUnlocked) {
    throw new Error('Account lock state changed before approval completed.')
  }
  const nodeAfter = await getHomeV2ReadableNode(targetNetwork)
  if (`${nodeAfter.mode}|${nodeAfter.nodeApiUrl}` !== nodeRoute) {
    throw new Error('Account access node route changed before approval completed.')
  }
  if (!singleRequestOnly && decision.scope === 'session') sessionAccountReadGrants.add(grantKey)
}

async function readBoundedResponse(
  response: Response,
  method: 'GET' | 'HEAD',
  maxBytes = HOME_V2_APP_LIMITS.responseBytes,
) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel()
    throw new Error('Node API response exceeded the requested size limit.')
  }
  let body = ''
  if (method !== 'HEAD' && response.body) {
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) {
        await reader.cancel()
        throw new Error('Node API response exceeded the requested size limit.')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    body = new TextDecoder().decode(bytes)
  }
  const contentType = response.headers.get('content-type') ?? ''
  let data: unknown = body
  if (body && (contentType.includes('json') || /^[\[{]/.test(body.trim()))) {
    try {
      data = JSON.parse(body) as unknown
    } catch {
      data = body
    }
  }
  return {
    body,
    contentLength: Number.isFinite(declared) ? declared : Buffer.byteLength(body, 'utf8'),
    contentType,
    data,
    headers: Object.fromEntries(response.headers.entries()),
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  }
}

async function fetchRead(
  network: HomeV2AppNetwork,
  path: string,
  method: 'GET' | 'HEAD',
  maxBytes = HOME_V2_APP_LIMITS.responseBytes,
) {
  const node = await getHomeV2ReadableNode(network)
  const response = await nodeFetch(`${node.nodeApiUrl}${path}`, {
    method,
    signal: AbortSignal.timeout(15_000),
  })
  return { node, result: await readBoundedResponse(response, method, maxBytes) }
}

function stringField(value: unknown, key: string) {
  if (!isHomeV2AppRecord(value)) return null
  const field = value[key]
  return typeof field === 'string' && field.trim() ? field.trim() : null
}

function responseDataOrThrow(
  result: Awaited<ReturnType<typeof fetchRead>>['result'],
  label: string,
) {
  if (!result.ok) throw new Error(`${label} returned HTTP ${result.status}.`)
  return result.data
}

async function readIdentityData(
  network: HomeV2AppNetwork,
  kind: 'accountAvatarInfo' | 'name' | 'namesByAddress' | 'primaryName',
  value: string,
) {
  const response = await readHomeV2Identity(network, { kind, value })
  if (response.status === 404) return null
  if (response.status !== 200) {
    throw new Error(`Identity lookup returned HTTP ${response.status}.`)
  }
  return response.data
}

async function resolveIdentities(request: Record<string, unknown>) {
  const addresses = normalizeHomeV2IdentityAddresses(request.addresses)
  return Promise.all(addresses.map(async (address) => {
    const [primary, owned] = await Promise.all([
      readIdentityData('qortium', 'primaryName', address),
      readIdentityData('qortium', 'namesByAddress', address),
    ])
    const primaryName = stringField(primary, 'name')
    const firstOwnedName = Array.isArray(owned)
      ? owned.map((entry) => stringField(entry, 'name')).find(Boolean) ?? null
      : null
    const name = primaryName ?? firstOwnedName
    return {
      address,
      name,
      avatarSrc: name
        ? `${(await getHomeV2ReadableNode('qortium')).nodeApiUrl}/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/avatar?async=true`
        : null,
      avatarContract: 'legacy-named-thumbnail',
    }
  }))
}

async function fetchAvatar(
  network: HomeV2AppNetwork,
  action: HomeV2AvatarAction,
  request: Record<string, unknown>,
) {
  return fetchHomeV2AvatarAction(network, action, request, {
    async readAvatar(path, legacyAsync) {
      return readResolvedHomeV2Avatar(network, { legacyAsync, path })
    },
    async readJson(path) {
      const { result } = await fetchRead(network, path, 'GET', 256 * 1024)
      return { data: result.data, status: result.status }
    },
  })
}

async function postHomeV2ChatText(
  nodeApiUrl: string,
  path: string,
  body: string,
  contentType: string,
  fallbackMessage: string,
  apiKey = '',
) {
  const response = await nodeFetch(`${nodeApiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      ...(apiKey ? { 'X-API-KEY': apiKey } : {}),
    },
    body,
    signal: AbortSignal.timeout(CHAT_WRITE_TIMEOUT_MS),
  })
  // Bounded like the read-only actions below (FIX #4, security review): a
  // hostile or misbehaving node answering /chat/public/build or
  // /transactions/process with an unbounded body previously had to be read
  // to completion before Home could react. 'GET' here only tells
  // readBoundedResponse to read the body (this is a POST); it does not
  // change the HTTP method actually sent above.
  const result = await readBoundedResponse(response, 'GET', CHAT_SIGNING_RESPONSE_MAX_BYTES)
  const text = result.body.trim()
  if (!result.ok) {
    throw Object.assign(
      new Error(readableNodeErrorMessage(text, `${fallbackMessage} HTTP ${result.status}.`)),
      { status: result.status },
    )
  }
  return text
}

type HomeV2ChatSigningKey = { address: string; publicKey58: string; secretKey: Uint8Array }

async function getHomeV2TrustedWriteApiKey(
  network: HomeV2AppNetwork,
  expectedNodeApiUrl: string,
) {
  if (network === 'qortal') return ''
  const connection = await getNodeConnection()
  if (connection.nodeApiUrl !== expectedNodeApiUrl) {
    throw new Error('The selected Qortium route changed before the write could start.')
  }
  return connection.apiKey ?? ''
}

function chatOperationLabel(action: HomeV2PublicChatAction) {
  if (action === 'SEND_CHAT_EDIT') return 'Edit message'
  if (action === 'SEND_CHAT_DELETE') return 'Delete message'
  if (action === 'SEND_CHAT_REACTION') return 'React to message'
  return 'Send message'
}

async function readHomeV2ChatJson(
  nodeApiUrl: string,
  path: string,
  label: string,
  apiKey = '',
  maxBytes = CHAT_SIGNING_RESPONSE_MAX_BYTES,
) {
  const response = await nodeFetch(`${nodeApiUrl}${path}`, {
    headers: apiKey ? { 'X-API-KEY': apiKey } : undefined,
    method: 'GET',
    signal: AbortSignal.timeout(15_000),
  })
  const result = await readBoundedResponse(response, 'GET', maxBytes)
  if (!result.ok) {
    throw Object.assign(new Error(`${label} returned HTTP ${result.status}.`), { status: result.status })
  }
  return result.data
}

async function validateHomeV2PublicChatTarget(
  nodeApiUrl: string,
  network: HomeV2AppNetwork,
  request: HomeV2PublicChatRequest,
  senderPublicKey: string,
  apiKey = '',
) {
  if (request.txGroupId !== 0) {
    const group = await readHomeV2ChatJson(
      nodeApiUrl,
      `/groups/${encodeURIComponent(String(request.txGroupId))}`,
      'Group lookup',
      apiKey,
    )
    assertHomeV2OpenPublicGroup(group, request.txGroupId, network)
  }
  if (!request.chatReference) return
  normalizeHomeV2PublicChatReferenceTarget(
    await readHomeV2ChatJson(
      nodeApiUrl,
      `/chat/message/${encodeURIComponent(request.chatReference)}?encoding=BASE58`,
      'Referenced chat lookup',
      apiKey,
    ),
    {
      chatReference: request.chatReference,
      requireOriginal: true,
      requireSenderOwnership:
        request.action === 'SEND_CHAT_EDIT' || request.action === 'SEND_CHAT_DELETE',
      senderPublicKey,
      txGroupId: request.txGroupId,
    },
  )
}

// Keyless open-group chat send for the Qortium network. Builds the unsigned
// CHAT bytes via the keyless /chat/public/build endpoint (no API key, no
// private key ever leaves this process), validates the node's response
// against what we asked it to build, computes the memory-pow nonce locally,
// signs locally, then broadcasts. Mirrors src/platform.ts
// sendKeylessPublicGroupChatMessage and electron/qdn.ts's v1 equivalent.
async function sendHomeV2QortiumChatMessage(
  nodeApiUrl: string,
  request: HomeV2PublicChatRequest,
  signingKey: HomeV2ChatSigningKey,
  isStillValid: () => boolean | Promise<boolean>,
  validateTarget: () => Promise<void>,
  apiKey = '',
) {
  const timestamp = Date.now()
  const buildRequest = buildHomeV2QortiumPublicChatBuildBody({
    request,
    senderPublicKey: signingKey.publicKey58,
    timestamp,
  })
  const buildBody = await postHomeV2ChatText(
    nodeApiUrl,
    '/chat/public/build',
    JSON.stringify(buildRequest),
    'application/json',
    'Chat transaction build failed.',
    apiKey,
  )
  const unsignedBytes = base58Decode(buildBody)
  // Never sign node-provided bytes without checking they encode exactly the
  // sender/group/message/timestamp we asked for.
  assertPublicChatTransaction(unsignedBytes, {
    ...(request.chatReference ? { chatReference: base58Decode(request.chatReference) } : {}),
    data: base58Decode(buildRequest.data),
    publicKey: base58Decode(signingKey.publicKey58),
    timestamp,
    txGroupId: request.txGroupId,
  })
  const nonce = await computeHomeV2ChatNonce(unsignedBytes, QORTIUM_CHAT_POW_DIFFICULTY, isStillValid)
  if (!(await isStillValid())) {
    throw new Error('The signing context changed before the chat message could be submitted.')
  }
  await validateTarget()
  if (!(await isStillValid())) {
    throw new Error('The signing context changed before the chat message could be submitted.')
  }
  const signedBytes = signChatTransaction(unsignedBytes, nonce, signingKey.secretKey)
  const signature = getSignatureFromSignedTransactionBytes(signedBytes)
  try {
    await postHomeV2ChatText(
      nodeApiUrl,
      '/transactions/process?apiVersion=2',
      base58Encode(signedBytes),
      'text/plain',
      'Chat transaction processing failed.',
      apiKey,
    )
    return { signature, timestamp }
  } catch (error) {
    return createHomeV2UnknownChatBroadcastResult(error, signature, timestamp)
  }
}

// Qortal CHAT PoW difficulty depends on the sender's confirmed QORT balance
// (electron/qortal-chat.ts qortalChatPowDifficultyForBalanceResponse). If the
// balance fetch fails for any reason (network error, non-2xx, malformed
// body), fall back to the safer, higher difficulty rather than failing the
// send outright — a slower send beats one Core rejects for insufficient
// proof-of-work.
async function resolveHomeV2QortalChatPowDifficulty(nodeApiUrl: string, address: string) {
  try {
    const response = await nodeFetch(`${nodeApiUrl}/addresses/balance/${encodeURIComponent(address)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    })
    const result = await readBoundedResponse(response, 'GET', CHAT_SIGNING_RESPONSE_MAX_BYTES)
    if (!result.ok) throw new Error(`Balance lookup returned HTTP ${result.status}.`)
    return qortalChatPowDifficultyForBalanceResponse(result.data)
  } catch {
    return QORTAL_CHAT_POW_DIFFICULTY_BELOW
  }
}

// Fully client-side Qortal group chat send: transaction bytes are built here
// (no node build call), the memory-pow nonce is computed locally, and the
// account key signs locally. Mirrors electron/qdn.ts's v1
// sendQortalGroupChatForApp / src/platform.ts's equivalent, minus the
// Hub-shaped payload construction (v2's message is already the app's opaque,
// fully-formed payload).
async function sendHomeV2QortalChatMessage(
  nodeApiUrl: string,
  request: HomeV2PublicChatRequest,
  signingKey: HomeV2ChatSigningKey,
  isStillValid: () => boolean | Promise<boolean>,
  validateTarget: () => Promise<void>,
) {
  const timestamp = Date.now()
  const unsignedBytes = buildUnsignedQortalGroupChatTransactionBytes({
    ...(request.chatReference ? { chatReference: request.chatReference } : {}),
    lastReference: new Uint8Array(randomBytes(64)),
    message: request.message,
    senderPublicKey: signingKey.publicKey58,
    timestamp,
    txGroupId: request.txGroupId,
  })
  const difficulty = await resolveHomeV2QortalChatPowDifficulty(nodeApiUrl, signingKey.address)
  const nonce = await computeHomeV2ChatNonce(unsignedBytes, difficulty, isStillValid)
  if (!(await isStillValid())) {
    throw new Error('The signing context changed before the chat message could be submitted.')
  }
  await validateTarget()
  if (!(await isStillValid())) {
    throw new Error('The signing context changed before the chat message could be submitted.')
  }
  const stampedBytes = stampQortalGroupChatNonce(unsignedBytes, nonce)
  const signatureBytes = signDetached(stampedBytes, signingKey.secretKey)
  const signedBytes = appendSignatureToTransactionBytes(stampedBytes, signatureBytes)
  const signature = getSignatureFromSignedTransactionBytes(signedBytes)
  try {
    await postHomeV2ChatText(
      nodeApiUrl,
      '/transactions/process?apiVersion=2',
      base58Encode(signedBytes),
      'text/plain',
      'Qortal chat message broadcast failed.',
    )
    return { signature, timestamp }
  } catch (error) {
    return createHomeV2UnknownChatBroadcastResult(error, signature, timestamp)
  }
}

async function sendHomeV2PublicChatAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  action: HomeV2PublicChatAction,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  const request = normalizeHomeV2PublicChatRequest(protocol, action, requestValue)
  const effectiveAction = request.action
  // The Chat app is expected to drive UNLOCK_SELECTED_ACCOUNT first on
  // qdnRequest; a pure-Qortal app cannot unlock in Phase 1 (documented
  // limitation, docs/HOME_V2_BRIDGE_COMPATIBILITY.md). Failing fast here also
  // avoids prompting the user for a send that cannot possibly proceed.
  if (!isAccountUnlocked(accountId)) {
    throw new Error('The selected account is locked.')
  }
  const node = await getHomeV2ReadableNode(network)
  const nodeApiKey = await getHomeV2TrustedWriteApiKey(network, node.nodeApiUrl)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  const approvedSenderPublicKey = getAccountSigningPublicKey(accountId)
  const validateTarget = () => validateHomeV2PublicChatTarget(
    node.nodeApiUrl,
    network,
    request,
    approvedSenderPublicKey,
    nodeApiKey,
  )
  // Reference ownership/conversation binding and public-group metadata are
  // checked before the user sees a prompt, then checked again immediately
  // before signing by the chain-specific sender below.
  await validateTarget()
  const targetChainLabel = network === 'qortal' ? 'Qortal' : 'Qortium'
  const groupLabel = request.txGroupId === 0 ? 'General chat' : `Group ${request.txGroupId}`
  await requireAccountReadPermission(sender, context, protocol, effectiveAction, {
    kind: 'chat',
    chatReference: request.chatReference,
    groupId: request.txGroupId,
    messagePreview: request.message.slice(0, 180),
    operationLabel: chatOperationLabel(effectiveAction),
    targetChainLabel: `${targetChainLabel} · ${groupLabel}`,
  })
  // Fix B: reject an excessive send BEFORE any node call or proof-of-work —
  // the single-in-flight-PoW guard (isStillValid below) already prevents
  // overlap, but nothing previously bounded how many sends a granted tab
  // could queue back-to-back.
  const rateLimitDecision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
  if (!rateLimitDecision.allowed) {
    throw new Error(rateLimitDecision.message)
  }
  const signingKey = getAccountSecretKey(accountId)
  if (signingKey.address !== profile.address || signingKey.publicKey58 !== approvedSenderPublicKey) {
    signingKey.secretKey.fill(0)
    throw new Error('Selected account signing key changed before the chat action could be signed.')
  }
  const isStillValid = async () => {
    const freshContext = getQdnViewContextForWebContents(sender)
    if (!freshContext || !sameViewContext(context, freshContext)) return false
    if (!liveResourceMatchesGrant(freshContext)) return false
    if (!isAccountUnlocked(accountId)) return false
    const nodeNow = await getHomeV2ReadableNode(network).catch(() => null)
    return !!nodeNow &&
      `${nodeNow.mode}|${nodeNow.nodeApiUrl}` === nodeRoute &&
      (await getHomeV2TrustedWriteApiKey(network, node.nodeApiUrl).catch(() => null)) === nodeApiKey
  }
  try {
    if (!(await isStillValid())) {
      throw new Error('Account access context changed before approval completed.')
    }
    return await (network === 'qortium'
      ? sendHomeV2QortiumChatMessage(node.nodeApiUrl, request, signingKey, isStillValid, validateTarget, nodeApiKey)
      : sendHomeV2QortalChatMessage(node.nodeApiUrl, request, signingKey, isStillValid, validateTarget))
  } finally {
    signingKey.secretKey.fill(0)
  }
}

function directChatOperationLabel(action: HomeV2DirectChatWriteAction) {
  if (action === 'SEND_DIRECT_CHAT_EDIT') return 'Edit direct message'
  if (action === 'SEND_DIRECT_CHAT_DELETE') return 'Clear direct message content'
  if (action === 'SEND_DIRECT_CHAT_REACTION') return 'React to direct message'
  return 'Send direct message'
}

function canonicalDirectPublicKey(value: unknown, network: HomeV2AppNetwork, otherAddress: string) {
  const publicKey = typeof value === 'string'
    ? value.trim()
    : isHomeV2AppRecord(value) && typeof value.publicKey === 'string'
      ? value.publicKey.trim()
      : ''
  try {
    const bytes = base58Decode(publicKey)
    if (bytes.length !== 32 || base58Encode(bytes) !== publicKey) throw new Error('invalid')
    return { bytes, value: publicKey }
  } catch {
    throw createHomeV2BridgeError('The direct-message recipient does not have a usable public key.', {
      action: 'DIRECT_CHAT',
      code: 'MISSING_RECIPIENT_PUBLIC_KEY',
      network,
      retryable: false,
      target: { kind: 'direct', otherAddress },
    })
  }
}

async function readHomeV2DirectPublicKey(
  nodeApiUrl: string,
  network: HomeV2AppNetwork,
  otherAddress: string,
  apiKey = '',
) {
  try {
    return canonicalDirectPublicKey(
      await readHomeV2ChatJson(
        nodeApiUrl,
        `/addresses/publickey/${encodeURIComponent(otherAddress)}`,
        'Direct-message public-key lookup',
        apiKey,
      ),
      network,
      otherAddress,
    )
  } catch (error) {
    if ('code' in Object(error) && (error as { code?: unknown }).code === 'MISSING_RECIPIENT_PUBLIC_KEY') throw error
    throw createHomeV2BridgeError('The direct-message recipient does not have a usable public key.', {
      action: 'DIRECT_CHAT',
      code: 'MISSING_RECIPIENT_PUBLIC_KEY',
      network,
      retryable: false,
      target: { kind: 'direct', otherAddress },
    })
  }
}

async function validateHomeV2DirectChatTarget(input: {
  action: HomeV2DirectChatWriteAction
  apiKey: string
  localAddress: string
  localPublicKey: string
  nodeApiUrl: string
  otherAddress: string
  otherPublicKey: string
  request: HomeV2DirectChatWriteRequest
}) {
  if (!input.request.chatReference) return
  assertHomeV2DirectReferenceTarget(
    await readHomeV2ChatJson(
      input.nodeApiUrl,
      `/chat/message/${encodeURIComponent(input.request.chatReference)}?encoding=BASE58`,
      'Referenced direct-message lookup',
      input.apiKey,
    ),
    {
      action: input.action,
      localAddress: input.localAddress,
      localPublicKey: input.localPublicKey,
      otherAddress: input.otherAddress,
      otherPublicKey: input.otherPublicKey,
      signature: input.request.chatReference,
    },
  )
}

async function sendHomeV2QortiumDirectChat(input: {
  apiKey: string
  isStillValid: () => boolean | Promise<boolean>
  nodeApiUrl: string
  peerPublicKey: Uint8Array
  request: HomeV2DirectChatWriteRequest
  signingKey: HomeV2ChatSigningKey
  validateTarget: () => Promise<void>
}) {
  const timestamp = Date.now()
  const envelope = await encryptQdm1Message({
    nonce: new Uint8Array(randomBytes(12)),
    plaintext: new TextEncoder().encode(input.request.message),
    recipientPublicKey: input.peerPublicKey,
    selectedAccountSecretKey: input.signingKey.secretKey,
    senderPublicKey: base58Decode(input.signingKey.publicKey58),
  })
  if (!(await input.isStillValid())) throw new Error('The signing context changed before direct-message construction.')
  const buildRequest = {
    ...(input.request.chatReference ? { chatReference: input.request.chatReference } : {}),
    data: base58Encode(envelope),
    fee: 0,
    isEncrypted: true,
    isText: true,
    recipient: input.request.otherAddress,
    senderPublicKey: input.signingKey.publicKey58,
    timestamp,
    txGroupId: 0,
  }
  const unsignedBytes = base58Decode(await postHomeV2ChatText(
    input.nodeApiUrl,
    '/chat/public/build',
    JSON.stringify(buildRequest),
    'application/json',
    'Direct CHAT transaction build failed.',
    input.apiKey,
  ))
  assertPublicChatTransaction(unsignedBytes, {
    ...(input.request.chatReference ? { chatReference: base58Decode(input.request.chatReference) } : {}),
    data: envelope,
    encrypted: true,
    publicKey: base58Decode(input.signingKey.publicKey58),
    recipient: base58Decode(input.request.otherAddress),
    timestamp,
    txGroupId: 0,
  })
  const nonce = await computeHomeV2ChatNonce(unsignedBytes, QORTIUM_CHAT_POW_DIFFICULTY, input.isStillValid)
  if (!(await input.isStillValid())) throw new Error('The signing context changed before the direct message could be submitted.')
  await input.validateTarget()
  if (!(await input.isStillValid())) throw new Error('The signing context changed before the direct message could be submitted.')
  const signedBytes = signChatTransaction(unsignedBytes, nonce, input.signingKey.secretKey)
  const signature = getSignatureFromSignedTransactionBytes(signedBytes)
  try {
    await postHomeV2ChatText(
      input.nodeApiUrl,
      '/transactions/process?apiVersion=2',
      base58Encode(signedBytes),
      'text/plain',
      'Direct CHAT transaction processing failed.',
      input.apiKey,
    )
    return { signature, timestamp }
  } catch (error) {
    return createHomeV2UnknownChatBroadcastResult(error, signature, timestamp)
  }
}

async function sendHomeV2QortalDirectChat(input: {
  isStillValid: () => boolean | Promise<boolean>
  nodeApiUrl: string
  peerPublicKey: Uint8Array
  request: HomeV2DirectChatWriteRequest
  signingKey: HomeV2ChatSigningKey
  validateTarget: () => Promise<void>
}) {
  const timestamp = Date.now()
  const lastReference = new Uint8Array(randomBytes(64))
  const ciphertext = await encryptQortalDirectMessage({
    lastReference,
    peerPublicKey: input.peerPublicKey,
    plaintext: new TextEncoder().encode(input.request.message),
    selectedAccountSecretKey: input.signingKey.secretKey,
  })
  const unsignedBytes = buildUnsignedQortalDirectChatTransactionBytes({
    ...(input.request.chatReference ? { chatReference: input.request.chatReference } : {}),
    ciphertext,
    lastReference,
    recipientAddress: input.request.otherAddress,
    senderPublicKey: input.signingKey.publicKey58,
    timestamp,
  })
  const difficulty = await resolveHomeV2QortalChatPowDifficulty(input.nodeApiUrl, input.signingKey.address)
  const nonce = await computeHomeV2ChatNonce(unsignedBytes, difficulty, input.isStillValid)
  if (!(await input.isStillValid())) throw new Error('The signing context changed before the direct message could be submitted.')
  await input.validateTarget()
  if (!(await input.isStillValid())) throw new Error('The signing context changed before the direct message could be submitted.')
  const stampedBytes = stampQortalGroupChatNonce(unsignedBytes, nonce)
  const signedBytes = appendSignatureToTransactionBytes(
    stampedBytes,
    signDetached(stampedBytes, input.signingKey.secretKey),
  )
  const signature = getSignatureFromSignedTransactionBytes(signedBytes)
  try {
    await postHomeV2ChatText(
      input.nodeApiUrl,
      '/transactions/process?apiVersion=2',
      base58Encode(signedBytes),
      'text/plain',
      'Qortal direct-message broadcast failed.',
    )
    return { signature, timestamp }
  } catch (error) {
    return createHomeV2UnknownChatBroadcastResult(error, signature, timestamp)
  }
}

async function sendHomeV2DirectChatAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  action: HomeV2DirectChatWriteAction,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  const request = normalizeHomeV2DirectChatWriteRequest(protocol, action, requestValue)
  if (!isAccountUnlocked(accountId)) throw createHomeV2BridgeError('The selected account is locked.', {
    action,
    code: 'ACCOUNT_LOCKED',
    network,
    retryable: false,
    target: { kind: 'direct', otherAddress: request.otherAddress },
  })
  const node = await getHomeV2ReadableNode(network)
  const apiKey = await getHomeV2TrustedWriteApiKey(network, node.nodeApiUrl)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  if (profile.address === request.otherAddress) throw new Error('Direct-message recipient must be another account.')
  const approvedPublicKey = getAccountSigningPublicKey(accountId)
  const peerKey = await readHomeV2DirectPublicKey(node.nodeApiUrl, network, request.otherAddress, apiKey)
  const validateTarget = async () => {
    const currentPeerKey = await readHomeV2DirectPublicKey(node.nodeApiUrl, network, request.otherAddress, apiKey)
    if (currentPeerKey.value !== peerKey.value) throw new Error('Recipient public key changed before signing.')
    await validateHomeV2DirectChatTarget({
      action,
      apiKey,
      localAddress: profile.address,
      localPublicKey: approvedPublicKey,
      nodeApiUrl: node.nodeApiUrl,
      otherAddress: request.otherAddress,
      otherPublicKey: peerKey.value,
      request,
    })
  }
  await validateTarget()
  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'direct',
    chatReference: request.chatReference,
    messagePreview: request.message.slice(0, 180),
    operationLabel: directChatOperationLabel(action),
    otherAddress: request.otherAddress,
    routeLabel: `${node.mode} · ${node.nodeApiUrl}`,
    singleRequestOnly: true,
    targetChainLabel: network === 'qortal' ? 'Qortal' : 'Qortium',
  })
  const rateLimitDecision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
  if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
  const signingKey = getAccountSecretKey(accountId)
  if (
    signingKey.address !== profile.address ||
    signingKey.publicKey58 !== approvedPublicKey
  ) {
    signingKey.secretKey.fill(0)
    throw new Error('Selected account signing key changed before the direct message could be signed.')
  }
  const isStillValid = async () => {
    const freshContext = getQdnViewContextForWebContents(sender)
    if (!freshContext || !sameViewContext(context, freshContext) || !liveResourceMatchesGrant(freshContext)) return false
    if (!isAccountUnlocked(accountId)) return false
    const nodeNow = await getHomeV2ReadableNode(network).catch(() => null)
    return !!nodeNow &&
      `${nodeNow.mode}|${nodeNow.nodeApiUrl}` === nodeRoute &&
      (await getHomeV2TrustedWriteApiKey(network, node.nodeApiUrl).catch(() => null)) === apiKey
  }
  try {
    if (!(await isStillValid())) throw new Error('Account access context changed before approval completed.')
    return await (network === 'qortium'
      ? sendHomeV2QortiumDirectChat({
          apiKey,
          isStillValid,
          nodeApiUrl: node.nodeApiUrl,
          peerPublicKey: peerKey.bytes,
          request,
          signingKey,
          validateTarget,
        })
      : sendHomeV2QortalDirectChat({
          isStillValid,
          nodeApiUrl: node.nodeApiUrl,
          peerPublicKey: peerKey.bytes,
          request,
          signingKey,
          validateTarget,
        }))
  } finally {
    signingKey.secretKey.fill(0)
  }
}

async function readHomeV2DirectChatAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  action: 'GET_PRIVATE_DIRECT_ACTIVE_CHATS' | 'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  const request = normalizeHomeV2DirectChatReadRequest(protocol, action, requestValue)
  if (!isAccountUnlocked(accountId)) throw createHomeV2BridgeError('The selected account is locked.', {
    action,
    code: 'ACCOUNT_LOCKED',
    network,
    retryable: false,
    ...(request.otherAddress ? { target: { kind: 'direct' as const, otherAddress: request.otherAddress } } : {}),
  })
  const node = await getHomeV2ReadableNode(network)
  const apiKey = await getHomeV2TrustedWriteApiKey(network, node.nodeApiUrl)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'direct',
    operationLabel: action === 'GET_PRIVATE_DIRECT_ACTIVE_CHATS'
      ? 'Read active direct conversations'
      : 'Read direct-message history',
    otherAddress: request.otherAddress ?? 'all-direct-conversations',
    routeLabel: `${node.mode} · ${node.nodeApiUrl}`,
    targetChainLabel: network === 'qortal' ? 'Qortal' : 'Qortium',
  })
  const signingKey = getAccountSecretKey(accountId)
  if (signingKey.address !== profile.address) {
    signingKey.secretKey.fill(0)
    throw new Error('Selected account signing key changed before direct-message decryption.')
  }
  try {
    const query = new URLSearchParams()
    query.set('encoding', 'BASE64')
    if (request.hasChatReference !== undefined) {
      query.set('haschatreference', String(request.hasChatReference))
    }
    let path: string
    if (action === 'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES') {
      query.append('involving', profile.address)
      query.append('involving', request.otherAddress as string)
      if (request.before !== undefined) query.set('before', String(request.before))
      query.set('limit', String(request.limit))
      query.set('reverse', String(request.reverse))
      path = `/chat/messages?${query.toString()}`
    } else {
      path = `/chat/active/${encodeURIComponent(profile.address)}?${query.toString()}`
    }
    const raw = await readHomeV2ChatJson(
      node.nodeApiUrl,
      path,
      'Encrypted direct-chat read',
      apiKey,
      DIRECT_CHAT_READ_RESPONSE_MAX_BYTES,
    )
    const rows = action === 'GET_PRIVATE_DIRECT_ACTIVE_CHATS'
      ? isHomeV2AppRecord(raw) && Array.isArray(raw.direct) ? raw.direct : []
      : Array.isArray(raw) ? raw : []
    const peerKeys = new Map<string, Awaited<ReturnType<typeof readHomeV2DirectPublicKey>>>()
    const decrypted = []
    for (const value of rows.slice(0, 100)) {
      if (!isHomeV2AppRecord(value)) continue
      try {
        const senderAddress = normalizeHomeV2Address(value.sender)
        const recipientAddress = normalizeHomeV2Address(value.recipient)
        const otherAddress = senderAddress === profile.address
          ? recipientAddress
          : recipientAddress === profile.address
            ? senderAddress
            : ''
        if (!otherAddress || (request.otherAddress && otherAddress !== request.otherAddress)) {
          throw new Error('Direct chat row does not match the approved participants.')
        }
        let peerKey = peerKeys.get(otherAddress)
        if (!peerKey) {
          peerKey = await readHomeV2DirectPublicKey(node.nodeApiUrl, network, otherAddress, apiKey)
          peerKeys.set(otherAddress, peerKey)
        }
        decrypted.push(await decryptHomeV2DirectChatRow({
          encoding: request.encoding,
          localAddress: profile.address,
          localPublicKey: base58Decode(signingKey.publicKey58),
          network,
          peerAddress: otherAddress,
          peerPublicKey: peerKey.bytes,
          row: value,
          selectedAccountSecretKey: signingKey.secretKey,
        }))
      } catch (error) {
        decrypted.push(directDecryptFailure(value, error))
      }
    }
    const freshContext = getQdnViewContextForWebContents(sender)
    const nodeNow = await getHomeV2ReadableNode(network).catch(() => null)
    if (
      !freshContext ||
      !sameViewContext(context, freshContext) ||
      !liveResourceMatchesGrant(freshContext) ||
      !isAccountUnlocked(accountId) ||
      !nodeNow ||
      `${nodeNow.mode}|${nodeNow.nodeApiUrl}` !== nodeRoute
    ) throw new Error('Direct-message read context changed before decryption completed.')
    return decrypted
  } finally {
    signingKey.secretKey.fill(0)
  }
}

function membershipOperationLabel(action: HomeV2GroupMembershipAction) {
  return action === 'JOIN_GROUP' ? 'Join group' : 'Leave group'
}

function parseMempowFeeAlternativeDifficulty(value: unknown) {
  if (
    !isHomeV2AppRecord(value) ||
    !Number.isInteger(value.mempowFeeAlternativeDifficulty) ||
    (value.mempowFeeAlternativeDifficulty as number) < 1 ||
    (value.mempowFeeAlternativeDifficulty as number) > 31
  ) {
    throw createHomeV2BridgeError(
      'The selected Qortium node does not advertise a compatible MemoryPoW fee difficulty.',
      {
        action: 'GROUP_MEMBERSHIP',
        code: 'NODE_CAPABILITY_MISSING',
        network: 'qortium',
        retryable: false,
      },
    )
  }
  return value.mempowFeeAlternativeDifficulty as number
}

async function readHomeV2GroupTarget(
  nodeApiUrl: string,
  network: HomeV2AppNetwork,
  groupId: number,
  apiKey = '',
) {
  return normalizeHomeV2GroupMembershipTarget(
    await readHomeV2ChatJson(
      nodeApiUrl,
      `/groups/${encodeURIComponent(String(groupId))}`,
      'Group lookup',
      apiKey,
    ),
    groupId,
    network,
  )
}

function idempotentGroupResult(
  action: HomeV2GroupMembershipAction,
  error: unknown,
  network: HomeV2AppNetwork,
  target: HomeV2GroupMembershipTarget,
) {
  const membership = groupMembershipIdempotentState(action, error)
  return membership
    ? createHomeV2GroupMembershipSuccess({
        action,
        changed: false,
        groupId: target.groupId,
        groupName: target.groupName,
        membership,
        network,
      })
    : null
}

function groupBuilderUnavailable(error: unknown) {
  return isHomeV2AppRecord(error) && (error.status === 403 || error.status === 404)
}

async function sendHomeV2QortiumGroupMembership(
  nodeApiUrl: string,
  request: HomeV2GroupMembershipRequest,
  target: HomeV2GroupMembershipTarget,
  signingKey: HomeV2ChatSigningKey,
  isStillValid: () => boolean | Promise<boolean>,
  validateTarget: () => Promise<void>,
  apiKey: string,
) {
  const timestamp = Date.now()
  const buildBody = JSON.stringify({
    fee: 0,
    groupId: request.groupId,
    [request.action === 'JOIN_GROUP' ? 'joinerPublicKey' : 'leaverPublicKey']: signingKey.publicKey58,
    timestamp,
    txGroupId: 0,
  })
  let unsignedText: string
  try {
    unsignedText = await postHomeV2ChatText(
      nodeApiUrl,
      request.action === 'JOIN_GROUP' ? '/groups/public/join' : '/groups/public/leave',
      buildBody,
      'application/json',
      `${membershipOperationLabel(request.action)} transaction build failed.`,
      apiKey,
    )
  } catch (error) {
    const idempotent = idempotentGroupResult(request.action, error, 'qortium', target)
    if (idempotent) return idempotent
    if (groupBuilderUnavailable(error)) {
      throw createHomeV2BridgeError(
        'The selected Qortium node does not expose the public group-membership builder.',
        {
          action: request.action,
          code: 'NODE_CAPABILITY_MISSING',
          network: 'qortium',
          retryable: false,
          target: { groupId: request.groupId, kind: 'group' },
        },
      )
    }
    throw error
  }
  const unsignedBytes = base58Decode(unsignedText)
  const expected = {
    groupId: request.groupId,
    publicKey: base58Decode(signingKey.publicKey58),
    timestamp,
    txGroupId: 0,
  }
  if (request.action === 'JOIN_GROUP') {
    // Deliberately omit the optional mintingPublicKey: group membership must
    // not silently create minting authority. Home exposes minting as a
    // separate explicit operation.
    assertPublicJoinGroupTransaction(unsignedBytes, expected)
  } else {
    assertPublicLeaveGroupTransaction(unsignedBytes, expected)
  }
  let difficulty: number
  try {
    difficulty = parseMempowFeeAlternativeDifficulty(await readHomeV2ChatJson(
      nodeApiUrl,
      '/polls/public/capabilities',
      'MemoryPoW capability lookup',
      apiKey,
    ))
  } catch (error) {
    if (groupBuilderUnavailable(error)) {
      throw createHomeV2BridgeError(
        'The selected Qortium node does not expose the MemoryPoW capability needed for group membership.',
        {
          action: request.action,
          code: 'NODE_CAPABILITY_MISSING',
          network: 'qortium',
          retryable: false,
          target: { groupId: request.groupId, kind: 'group' },
        },
      )
    }
    throw error
  }
  const nonce = await computeHomeV2ChatNonce(unsignedBytes, difficulty, isStillValid)
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  await validateTarget()
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  const signedBytes = signTransactionWithNonce(unsignedBytes, nonce, signingKey.secretKey)
  const signature = getSignatureFromSignedTransactionBytes(signedBytes)
  try {
    await postHomeV2ChatText(
      nodeApiUrl,
      '/transactions/process?apiVersion=2',
      base58Encode(signedBytes),
      'text/plain',
      `${membershipOperationLabel(request.action)} transaction processing failed.`,
      apiKey,
    )
    return createHomeV2GroupMembershipSuccess({
      action: request.action,
      changed: true,
      groupId: request.groupId,
      groupName: target.groupName,
      membership: request.action === 'JOIN_GROUP' && !target.isOpen ? 'requested' : undefined,
      network: 'qortium',
      signature,
      timestamp,
    })
  } catch (error) {
    const idempotent = idempotentGroupResult(request.action, error, 'qortium', target)
    if (idempotent) return idempotent
    return createHomeV2UnknownGroupMembershipBroadcastResult({
      action: request.action,
      error,
      groupId: request.groupId,
      groupName: target.groupName,
      network: 'qortium',
      signedBytes,
      timestamp,
    })
  }
}

async function sendHomeV2QortalGroupMembership(
  nodeApiUrl: string,
  request: HomeV2GroupMembershipRequest,
  target: HomeV2GroupMembershipTarget,
  signingKey: HomeV2ChatSigningKey,
  isStillValid: () => boolean | Promise<boolean>,
  validateTarget: () => Promise<void>,
) {
  const feeType = qortalGroupMembershipFeeType(request.action)
  const [feeValue, lastReferenceValue] = await Promise.all([
    readHomeV2ChatJson(
      nodeApiUrl,
      `/transactions/unitfee?txType=${encodeURIComponent(feeType)}`,
      'Qortal group transaction fee lookup',
    ),
    readHomeV2ChatJson(
      nodeApiUrl,
      `/addresses/lastreference/${encodeURIComponent(signingKey.address)}`,
      'Qortal last-reference lookup',
    ),
  ])
  const feeAtomic = normalizeQortalGroupMembershipFee(feeValue)
  const lastReference = typeof lastReferenceValue === 'string'
    ? lastReferenceValue.trim()
    : ''
  if (!lastReference) {
    throw new Error('The selected Qortal account does not have a last reference. It may need QORT before it can join or leave groups.')
  }
  const timestamp = Date.now()
  const unsignedBytes = buildUnsignedQortalGroupMembershipTransactionBytes({
    action: request.action,
    feeAtomic,
    groupId: request.groupId,
    lastReference,
    senderPublicKey: signingKey.publicKey58,
    timestamp,
  })
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  await validateTarget()
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  const [freshFeeValue, freshReferenceValue] = await Promise.all([
    readHomeV2ChatJson(
      nodeApiUrl,
      `/transactions/unitfee?txType=${encodeURIComponent(feeType)}`,
      'Qortal group transaction fee recheck',
    ),
    readHomeV2ChatJson(
      nodeApiUrl,
      `/addresses/lastreference/${encodeURIComponent(signingKey.address)}`,
      'Qortal last-reference recheck',
    ),
  ])
  if (
    normalizeQortalGroupMembershipFee(freshFeeValue) !== feeAtomic ||
    typeof freshReferenceValue !== 'string' ||
    freshReferenceValue.trim() !== lastReference
  ) {
    throw new Error('The Qortal fee or account reference changed before signing. Please try the group action again.')
  }
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  const signatureBytes = signDetached(unsignedBytes, signingKey.secretKey)
  const signedBytes = appendHomeV2GroupMembershipSignature(unsignedBytes, signatureBytes)
  const signature = getSignatureFromSignedTransactionBytes(signedBytes)
  try {
    await postHomeV2ChatText(
      nodeApiUrl,
      '/transactions/process?apiVersion=2',
      encodeHomeV2GroupMembershipTransaction(signedBytes),
      'text/plain',
      `Qortal ${membershipOperationLabel(request.action).toLowerCase()} broadcast failed.`,
    )
    return createHomeV2GroupMembershipSuccess({
      action: request.action,
      changed: true,
      groupId: request.groupId,
      groupName: target.groupName,
      membership: request.action === 'JOIN_GROUP' && !target.isOpen ? 'requested' : undefined,
      network: 'qortal',
      signature,
      timestamp,
    })
  } catch (error) {
    const idempotent = idempotentGroupResult(request.action, error, 'qortal', target)
    if (idempotent) return idempotent
    return createHomeV2UnknownGroupMembershipBroadcastResult({
      action: request.action,
      error,
      groupId: request.groupId,
      groupName: target.groupName,
      network: 'qortal',
      signedBytes,
      timestamp,
    })
  }
}

async function readHomeV2GroupAdminTarget(
  nodeApiUrl: string,
  network: HomeV2AppNetwork,
  request: HomeV2GroupAdminRequest,
  apiKey = '',
) {
  const [groupValue, adminValue, joinRequestsValue] = await Promise.all([
    readHomeV2ChatJson(
      nodeApiUrl,
      `/groups/${encodeURIComponent(String(request.groupId))}`,
      'Group lookup',
      apiKey,
    ),
    readHomeV2ChatJson(
      nodeApiUrl,
      `/groups/members/${encodeURIComponent(String(request.groupId))}?onlyAdmins=true&limit=0`,
      'Group administrator lookup',
      apiKey,
    ),
    request.action === 'APPROVE_GROUP_JOIN_REQUEST'
      ? readHomeV2ChatJson(
          nodeApiUrl,
          `/groups/joinrequests/${encodeURIComponent(String(request.groupId))}`,
          'Group join-request lookup',
          apiKey,
        )
      : Promise.resolve(null),
  ])
  return Object.freeze({
    adminAddresses: normalizeHomeV2GroupAdminAddresses(adminValue),
    hasJoinRequest: request.action === 'APPROVE_GROUP_JOIN_REQUEST'
      ? hasHomeV2GroupJoinRequest(joinRequestsValue, request.groupId, request.memberAddress)
      : null,
    target: normalizeHomeV2GroupAdminTarget(groupValue, request.groupId, network),
  })
}

function assertHomeV2GroupAdminIntent(
  accountAddress: string,
  request: HomeV2GroupAdminRequest,
  target: HomeV2GroupAdminTarget,
  adminAddresses: readonly string[],
  hasJoinRequest: boolean | null,
) {
  assertHomeV2GroupAdminAuthority({ accountAddress, action: request.action, adminAddresses, target })
  if (request.action === 'APPROVE_GROUP_JOIN_REQUEST' && hasJoinRequest !== true) {
    throw new Error('The selected account does not have a current join request for this group.')
  }
  if (
    request.memberAddress === target.ownerAddress &&
    (request.action === 'REMOVE_GROUP_ADMIN' || request.action === 'GROUP_BAN' || request.action === 'GROUP_KICK')
  ) {
    throw new Error('The group owner cannot be removed, banned, or kicked.')
  }
}

function idempotentGroupAdminResult(
  request: HomeV2GroupAdminRequest,
  error: unknown,
  network: HomeV2AppNetwork,
  target: HomeV2GroupAdminTarget,
) {
  return groupAdminIdempotentResult(request.action, error)
    ? createHomeV2GroupAdminSuccess({ changed: false, network, request, target })
    : null
}

async function sendHomeV2QortiumGroupAdmin(
  nodeApiUrl: string,
  request: HomeV2GroupAdminRequest,
  target: HomeV2GroupAdminTarget,
  signingKey: HomeV2ChatSigningKey,
  isStillValid: () => boolean | Promise<boolean>,
  validateTarget: () => Promise<void>,
  apiKey: string,
) {
  const timestamp = Date.now()
  const unsignedBytes = buildUnsignedQortiumGroupAdminTransactionBytes({
    request,
    senderPublicKey: signingKey.publicKey58,
    timestamp,
  })
  assertUnsignedHomeV2GroupAdminTransaction(unsignedBytes, {
    feeAtomic: 0n,
    network: 'qortium',
    request,
    senderPublicKey: signingKey.publicKey58,
    timestamp,
  })
  let difficulty: number
  try {
    difficulty = parseMempowFeeAlternativeDifficulty(await readHomeV2ChatJson(
      nodeApiUrl,
      '/polls/public/capabilities',
      'MemoryPoW capability lookup',
      apiKey,
    ))
  } catch (error) {
    if (groupBuilderUnavailable(error)) {
      throw createHomeV2BridgeError(
        'The selected Qortium node does not expose the MemoryPoW capability needed for group administration.',
        {
          action: request.action,
          code: 'NODE_CAPABILITY_MISSING',
          network: 'qortium',
          retryable: false,
          target: { groupId: request.groupId, kind: 'group' },
        },
      )
    }
    throw error
  }
  const nonce = await computeHomeV2ChatNonce(unsignedBytes, difficulty, isStillValid)
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  await validateTarget()
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  const stampedBytes = stampTransactionNonce(unsignedBytes, nonce)
  assertUnsignedHomeV2GroupAdminTransaction(stampedBytes, {
    feeAtomic: 0n,
    network: 'qortium',
    nonce,
    request,
    senderPublicKey: signingKey.publicKey58,
    timestamp,
  })
  const signedBytes = appendHomeV2GroupAdminSignature(
    stampedBytes,
    signDetached(stampedBytes, signingKey.secretKey),
  )
  const signature = getSignatureFromSignedTransactionBytes(signedBytes)
  try {
    await postHomeV2ChatText(
      nodeApiUrl,
      '/transactions/process?apiVersion=2',
      base58Encode(signedBytes),
      'text/plain',
      `${homeV2GroupAdminOperationLabel(request.action)} transaction processing failed.`,
      apiKey,
    )
    return createHomeV2GroupAdminSuccess({ changed: true, network: 'qortium', request, signature, target, timestamp })
  } catch (error) {
    const idempotent = idempotentGroupAdminResult(request, error, 'qortium', target)
    if (idempotent) return idempotent
    return createHomeV2UnknownGroupAdminBroadcastResult({ error, network: 'qortium', request, signedBytes, target, timestamp })
  }
}

async function sendHomeV2QortalGroupAdmin(
  nodeApiUrl: string,
  request: HomeV2GroupAdminRequest,
  target: HomeV2GroupAdminTarget,
  signingKey: HomeV2ChatSigningKey,
  isStillValid: () => boolean | Promise<boolean>,
  validateTarget: () => Promise<void>,
) {
  const feeType = qortalGroupAdminFeeType(request)
  const [feeValue, lastReferenceValue] = await Promise.all([
    readHomeV2ChatJson(nodeApiUrl, `/transactions/unitfee?txType=${encodeURIComponent(feeType)}`, 'Qortal group transaction fee lookup'),
    readHomeV2ChatJson(nodeApiUrl, `/addresses/lastreference/${encodeURIComponent(signingKey.address)}`, 'Qortal last-reference lookup'),
  ])
  const feeAtomic = normalizeHomeV2GroupAdminFee(feeValue)
  const lastReference = typeof lastReferenceValue === 'string' ? lastReferenceValue.trim() : ''
  if (!lastReference) {
    throw new Error('The selected Qortal account does not have a last reference. It may need QORT before it can administer groups.')
  }
  const timestamp = Date.now()
  const unsignedBytes = buildUnsignedQortalGroupAdminTransactionBytes({
    feeAtomic,
    lastReference,
    request,
    senderPublicKey: signingKey.publicKey58,
    timestamp,
  })
  assertUnsignedHomeV2GroupAdminTransaction(unsignedBytes, {
    feeAtomic,
    lastReference,
    network: 'qortal',
    request,
    senderPublicKey: signingKey.publicKey58,
    timestamp,
  })
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  await validateTarget()
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  const [freshFeeValue, freshReferenceValue] = await Promise.all([
    readHomeV2ChatJson(nodeApiUrl, `/transactions/unitfee?txType=${encodeURIComponent(feeType)}`, 'Qortal group transaction fee recheck'),
    readHomeV2ChatJson(nodeApiUrl, `/addresses/lastreference/${encodeURIComponent(signingKey.address)}`, 'Qortal last-reference recheck'),
  ])
  if (
    normalizeHomeV2GroupAdminFee(freshFeeValue) !== feeAtomic ||
    typeof freshReferenceValue !== 'string' ||
    freshReferenceValue.trim() !== lastReference
  ) {
    throw new Error('The Qortal fee or account reference changed before signing. Please try the group action again.')
  }
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  const signedBytes = appendHomeV2GroupAdminSignature(unsignedBytes, signDetached(unsignedBytes, signingKey.secretKey))
  const signature = getSignatureFromSignedTransactionBytes(signedBytes)
  try {
    await postHomeV2ChatText(
      nodeApiUrl,
      '/transactions/process?apiVersion=2',
      encodeHomeV2GroupAdminTransaction(signedBytes),
      'text/plain',
      `Qortal ${homeV2GroupAdminOperationLabel(request.action).toLowerCase()} broadcast failed.`,
    )
    return createHomeV2GroupAdminSuccess({ changed: true, network: 'qortal', request, signature, target, timestamp })
  } catch (error) {
    const idempotent = idempotentGroupAdminResult(request, error, 'qortal', target)
    if (idempotent) return idempotent
    return createHomeV2UnknownGroupAdminBroadcastResult({ error, network: 'qortal', request, signedBytes, target, timestamp })
  }
}

async function sendHomeV2GroupAdminAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  action: HomeV2GroupAdminAction,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  const request = normalizeHomeV2GroupAdminRequest(action, requestValue)
  if (!isAccountUnlocked(accountId)) throw new Error('The selected account is locked.')
  const node = await getHomeV2ReadableNode(network)
  const nodeApiKey = await getHomeV2TrustedWriteApiKey(network, node.nodeApiUrl)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  const initial = await readHomeV2GroupAdminTarget(node.nodeApiUrl, network, request, nodeApiKey)
  assertHomeV2GroupAdminIntent(profile.address, request, initial.target, initial.adminAddresses, initial.hasJoinRequest)
  const targetChainLabel = network === 'qortal' ? 'Qortal' : 'Qortium'
  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'group',
    groupId: request.groupId,
    groupName: initial.target.groupName,
    memberAddress: request.memberAddress,
    operationLabel: homeV2GroupAdminOperationLabel(action),
    reason: request.reason,
    routeLabel: `${node.mode} · ${node.nodeApiUrl}`,
    singleRequestOnly: true,
    targetChainLabel,
    timeToLive: request.action === 'APPROVE_GROUP_JOIN_REQUEST' ||
      request.action === 'INVITE_TO_GROUP' ||
      request.action === 'GROUP_BAN'
      ? request.timeToLive
      : undefined,
  })
  const rateLimitDecision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
  if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
  const signingKey = getAccountSecretKey(accountId)
  if (signingKey.address !== profile.address) {
    signingKey.secretKey.fill(0)
    throw new Error('Selected account signing key changed before the group action could be signed.')
  }
  const isStillValid = async () => {
    const freshContext = getQdnViewContextForWebContents(sender)
    if (!freshContext || !sameViewContext(context, freshContext)) return false
    if (!liveResourceMatchesGrant(freshContext) || !isAccountUnlocked(accountId)) return false
    const nodeNow = await getHomeV2ReadableNode(network).catch(() => null)
    return !!nodeNow &&
      `${nodeNow.mode}|${nodeNow.nodeApiUrl}` === nodeRoute &&
      (await getHomeV2TrustedWriteApiKey(network, node.nodeApiUrl).catch(() => null)) === nodeApiKey
  }
  const validateTarget = async () => {
    const current = await readHomeV2GroupAdminTarget(node.nodeApiUrl, network, request, nodeApiKey)
    if (
      current.target.groupName !== initial.target.groupName ||
      current.target.ownerAddress !== initial.target.ownerAddress
    ) {
      throw new Error('The selected group changed before the group action could be signed.')
    }
    assertHomeV2GroupAdminIntent(profile.address, request, current.target, current.adminAddresses, current.hasJoinRequest)
  }
  try {
    if (!(await isStillValid())) throw new Error('Account access context changed before approval completed.')
    return await (network === 'qortium'
      ? sendHomeV2QortiumGroupAdmin(node.nodeApiUrl, request, initial.target, signingKey, isStillValid, validateTarget, nodeApiKey)
      : sendHomeV2QortalGroupAdmin(node.nodeApiUrl, request, initial.target, signingKey, isStillValid, validateTarget))
  } finally {
    signingKey.secretKey.fill(0)
  }
}

async function sendHomeV2GroupMembershipAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  action: HomeV2GroupMembershipAction,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  const request = normalizeHomeV2GroupMembershipRequest(action, requestValue)
  if (!isAccountUnlocked(accountId)) throw new Error('The selected account is locked.')
  const node = await getHomeV2ReadableNode(network)
  const nodeApiKey = await getHomeV2TrustedWriteApiKey(network, node.nodeApiUrl)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  const target = await readHomeV2GroupTarget(node.nodeApiUrl, network, request.groupId, nodeApiKey)
  const targetChainLabel = network === 'qortal' ? 'Qortal' : 'Qortium'
  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'group',
    groupId: request.groupId,
    groupName: target.groupName,
    operationLabel: membershipOperationLabel(action),
    routeLabel: `${node.mode} · ${node.nodeApiUrl}`,
    targetChainLabel,
  })
  const rateLimitDecision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
  if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
  const signingKey = getAccountSecretKey(accountId)
  if (signingKey.address !== profile.address) {
    signingKey.secretKey.fill(0)
    throw new Error('Selected account signing key changed before the group action could be signed.')
  }
  const isStillValid = async () => {
    const freshContext = getQdnViewContextForWebContents(sender)
    if (!freshContext || !sameViewContext(context, freshContext)) return false
    if (!liveResourceMatchesGrant(freshContext) || !isAccountUnlocked(accountId)) return false
    const nodeNow = await getHomeV2ReadableNode(network).catch(() => null)
    return !!nodeNow &&
      `${nodeNow.mode}|${nodeNow.nodeApiUrl}` === nodeRoute &&
      (await getHomeV2TrustedWriteApiKey(network, node.nodeApiUrl).catch(() => null)) === nodeApiKey
  }
  const validateTarget = async () => {
    const currentTarget = await readHomeV2GroupTarget(
      node.nodeApiUrl,
      network,
      request.groupId,
      nodeApiKey,
    )
    if (
      currentTarget.groupName !== target.groupName ||
      currentTarget.isOpen !== target.isOpen
    ) {
      throw new Error('The selected group changed before the group action could be signed.')
    }
  }
  try {
    if (!(await isStillValid())) throw new Error('Account access context changed before approval completed.')
    return await (network === 'qortium'
      ? sendHomeV2QortiumGroupMembership(node.nodeApiUrl, request, target, signingKey, isStillValid, validateTarget, nodeApiKey)
      : sendHomeV2QortalGroupMembership(node.nodeApiUrl, request, target, signingKey, isStillValid, validateTarget))
  } finally {
    signingKey.secretKey.fill(0)
  }
}

async function handleRequestWithRuntime(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  requestValue: Record<string, unknown>,
  action: string,
  hostInfo: HomeV2AppHostInfo,
  availableActions: readonly string[],
) {
  if (action === 'SHOW_ACTIONS') return [...availableActions]
  if (!availableActions.includes(action)) {
    const implemented = getHomeV2AppActions(protocol).includes(action)
    throw createHomeV2BridgeError(
      implemented
        ? `${action} is unavailable on the configured ${hostInfo.network} route.`
        : `${action} is not implemented for ${protocol}.`,
      {
        action,
        code: implemented ? 'NODE_CAPABILITY_MISSING' : 'UNSUPPORTED_PROTOCOL',
        network: hostInfo.network,
        retryable: false,
        routeRevision: hostInfo.route.revision,
      },
    )
  }
  if (action === 'WHICH_UI') return 'QORTIUM_HOME_ELECTRON'
  if (action === 'GET_HOST_INFO') return hostInfo
  const network = getHomeV2AppNetwork(protocol, action)
  if (action === 'IS_USING_PUBLIC_NODE') {
    return hostInfo.route.configuredKind === 'public'
  }
  if (action === 'OPEN_NEW_TAB') {
    const address = normalizeHomeV2OpenAddress(requestValue)
    const hostWindow = BrowserWindow.fromId(context.windowId)
    if (!hostWindow || hostWindow.isDestroyed()) {
      throw new Error('The app request does not belong to an active Home window.')
    }
    hostWindow.webContents.send('home-v2-app:open-address', {
      address,
      sourceTabId: context.tabId,
    })
    return true
  }
  if (action === 'GET_SELECTED_ACCOUNT' || action === 'GET_USER_ACCOUNT') {
    await requireAccountReadPermission(sender, context, protocol, action)
    const profile = await getAccountProfile(context.accountId as string)
    if (action === 'GET_USER_ACCOUNT') {
      const { result } = await fetchRead(
        'qortal',
        `/addresses/${encodeURIComponent(profile.address)}`,
        'GET',
        256 * 1024,
      )
      const accountData = responseDataOrThrow(result, 'Qortal account lookup')
      const publicKey = stringField(accountData, 'publicKey')
      return { address: profile.address, publicKey }
    }
    return {
      address: profile.address,
      avatarContract: 'pointer-aware-account-avatar-v1',
      avatarUrl: null,
      isUnlocked: isAccountUnlocked(context.accountId as string),
      name: profile.name,
    }
  }
  if (action === 'UNLOCK_SELECTED_ACCOUNT') {
    await requireAccountReadPermission(sender, context, protocol, action)
    const profile = await getAccountProfile(context.accountId as string)
    return {
      address: profile.address,
      avatarContract: 'pointer-aware-account-avatar-v1',
      avatarUrl: null,
      isUnlocked: true,
      name: profile.name,
    }
  }
  if (isHomeV2PublicChatAction(action)) {
    return sendHomeV2PublicChatAction(sender, context, protocol, network, action, requestValue)
  }
  if (isHomeV2DirectChatWriteAction(action)) {
    return sendHomeV2DirectChatAction(sender, context, protocol, network, action, requestValue)
  }
  if (isHomeV2DirectChatReadAction(action)) {
    return readHomeV2DirectChatAction(sender, context, protocol, network, action, requestValue)
  }
  if (isHomeV2GroupMembershipAction(action)) {
    return sendHomeV2GroupMembershipAction(sender, context, protocol, network, action, requestValue)
  }
  if (isHomeV2GroupAdminAction(action)) {
    return sendHomeV2GroupAdminAction(sender, context, protocol, network, action, requestValue)
  }
  if (action === 'GET_NAME_DATA' || action === 'GET_ACCOUNT_NAMES' || action === 'GET_PRIMARY_NAME') {
    const path = buildHomeV2NamePath(action, requestValue)
    const { result } = await fetchRead(network, path, 'GET', normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes))
    return responseDataOrThrow(result, `${action} request`)
  }
  if (action === 'GET_ACCOUNT_DATA' || action === 'GET_BALANCE') {
    const address = normalizeHomeV2Address(requestValue.address)
    const path = action === 'GET_BALANCE'
      ? `/addresses/balance/${encodeURIComponent(address)}`
      : `/addresses/${encodeURIComponent(address)}`
    const { result } = await fetchRead(
      network,
      path,
      'GET',
      normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes),
    )
    return responseDataOrThrow(result, `${action} request`)
  }
  if (
    action === 'GET_ASSET_INFO' ||
    action === 'GET_ASSET_BALANCES' ||
    action === 'GET_ASSET_TRANSFERS'
  ) {
    const { result } = await fetchRead(
      network,
      buildHomeV2AssetReadPath(action, requestValue),
      'GET',
      normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes),
    )
    return responseDataOrThrow(result, `${action} request`)
  }
  if (isHomeV2ChainReadAction(action)) {
    const path = buildHomeV2ChainReadPath(action, requestValue)
    const { result } = await fetchRead(
      network,
      path,
      'GET',
      normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes),
    )
    // Both cores answer a valid-but-absent AT with an empty 2xx body (Qortal
    // 204s); normalize that to one documented error instead of returning ''.
    if (
      (action === 'GET_AT' || action === 'GET_AT_DATA') &&
      result.ok &&
      (result.status === 204 || result.data === '' || result.data === null)
    ) {
      throw new Error('AT not found.')
    }
    return responseDataOrThrow(result, `${action} request`)
  }
  if (action === 'RESOLVE_IDENTITIES') return resolveIdentities(requestValue)
  if (action === 'FETCH_ACCOUNT_AVATAR' || action === 'FETCH_GROUP_AVATAR') {
    return fetchAvatar(network, action, requestValue)
  }
  if (
    action === 'FETCH_QDN_RESOURCE' ||
    action === 'LIST_QDN_RESOURCES' ||
    action === 'SEARCH_QDN_RESOURCES' ||
    action === 'GET_QDN_RESOURCE_METADATA' ||
    action === 'GET_QDN_RESOURCE_PROPERTIES' ||
    action === 'GET_QDN_RESOURCE_STATUS'
  ) {
    const path = buildHomeV2ResourcePath(action, requestValue)
    const { result } = await fetchRead(
      network,
      path,
      'GET',
      normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes),
    )
    return responseDataOrThrow(result, `${action} request`)
  }
  if (action === 'GET_QDN_RESOURCE_URL') {
    const statusPath = buildHomeV2ResourcePath('GET_QDN_RESOURCE_STATUS', requestValue)
    const { node, result } = await fetchRead(network, statusPath, 'GET')
    const status = responseDataOrThrow(result, 'QDN resource status request')
    if (!isHomeV2AppRecord(status) || !status.status || status.status === 'NOT_PUBLISHED') {
      throw new Error('Resource does not exist.')
    }
    return `${node.nodeApiUrl}${buildHomeV2ResourceRenderPath(requestValue, context.displaySettings)}`
  }
  const path =
    action === 'GET_NODE_STATUS'
      ? '/admin/status'
      : action === 'GET_NODE_INFO'
        ? '/admin/info'
        : action === 'FETCH_NODE_API' || action === 'FETCH_QORTAL_NODE_API'
          ? normalizeHomeV2ReadPath(requestValue.path)
          : null
  if (!path) throw new Error(`${action} is not available in Home v2 read-only mode.`)
  const method = normalizeHomeV2ReadMethod(requestValue.method)
  const { result } = await fetchRead(
    network,
    path,
    method,
    normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes),
  )
  if (action === 'GET_NODE_STATUS' || action === 'GET_NODE_INFO') {
    if (!result.ok) throw new Error(`Node request returned HTTP ${result.status}.`)
    return result.data
  }
  return result
}

async function handleRequest(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  requestValue: unknown,
) {
  let action = 'UNKNOWN'
  let hostInfo: HomeV2AppHostInfo | null = null
  try {
    if (!isHomeV2AppRecord(requestValue)) {
      throw createHomeV2BridgeError('App requests must be objects.', {
        action,
        code: 'VALIDATION_FAILED',
        network: getHomeV2AppNetwork(protocol, action),
        retryable: false,
      })
    }
    action = normalizeHomeV2AppAction(requestValue)
    const network = getHomeV2AppNetwork(protocol, action)
    const [qortalNode, qortiumNode] = await Promise.all([
      getHomeV2AppNodeState('qortal'),
      getHomeV2AppNodeState('qortium'),
    ])
    hostInfo = getHomeV2AppHostInfo({
      accountId: context.accountId,
      hostVersion: app.getVersion(),
      node: network === 'qortal' ? qortalNode : qortiumNode,
      platform: 'desktop',
      platformVersion: '2.0',
      protocol,
    })
    const routes = {
      qortal: getHomeV2AppRouteDescriptor({
        accountId: context.accountId,
        network: 'qortal',
        node: qortalNode,
        platform: 'desktop',
        protocol: 'qortalRequest',
      }),
      qortium: getHomeV2AppRouteDescriptor({
        accountId: context.accountId,
        network: 'qortium',
        node: qortiumNode,
        platform: 'desktop',
        protocol: 'qdnRequest',
      }),
    }
    return await handleRequestWithRuntime(
      sender,
      context,
      protocol,
      requestValue,
      action,
      hostInfo,
      getHomeV2AvailableAppActions(protocol, routes),
    )
  } catch (error) {
    throw normalizeHomeV2BridgeError(error, {
      action,
      network: hostInfo?.network ?? getHomeV2AppNetwork(protocol, action),
      routeRevision: hostInfo?.route.revision,
    })
  }
}

export function registerHomeV2AppBridgeIpcHandlers() {
  ipcMain.on('home-v2-app:account-locked', (event) => {
    sessionAccountReadGrants.clear()
    chatSendRateLimiter.reset()
    for (const [requestId, pending] of pendingAccountReads) {
      if (pending.hostWebContentsId !== event.sender.id) continue
      pendingAccountReads.delete(requestId)
      clearTimeout(pending.timeout)
      pending.resolve({ approved: false, scope: null })
    }
  })
  ipcMain.on('home-v2-app:permission-resolve', (event, value: unknown) => {
    if (!isHomeV2AppRecord(value) || typeof value.requestId !== 'string') return
    const pending = pendingAccountReads.get(value.requestId)
    if (!pending || pending.hostWebContentsId !== event.sender.id) return
    pendingAccountReads.delete(value.requestId)
    clearTimeout(pending.timeout)
    const approved = value.approved === true
    const scope = value.scope === 'session' ? 'session' : 'single-request'
    pending.resolve({ approved, scope: approved ? scope : null })
  })
  ipcMain.handle(
    'home-v2-app:request',
    async (event, protocolValue: unknown, request: unknown) => {
      try {
        const context = getQdnViewContextForWebContents(event.sender)
        if (!context) {
          throw new Error('Home v2 app requests require an isolated app view.')
        }
        return encodeQdnBridgeResult(
          await handleRequest(
            event.sender,
            context,
            normalizeHomeV2AppProtocol(protocolValue),
            request,
          ),
        )
      } catch (error) {
        return encodeQdnBridgeError(error)
      }
    },
  )
}
