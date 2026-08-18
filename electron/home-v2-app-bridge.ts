import { app, BrowserWindow, ipcMain, type WebContents } from 'electron'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  getHomeV2AppNodeState,
  getHomeV2ReadableNode,
  readHomeV2Avatar,
  readHomeV2Identity,
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
  normalizeHomeV2AvatarMaxBytes,
  normalizeHomeV2IdentityAddresses,
  normalizeHomeV2OpenAddress,
  normalizeHomeV2ReadMethod,
  normalizeHomeV2ReadPath,
  normalizeHomeV2ResponseMaxBytes,
  type HomeV2AppBridgeProtocol,
  type HomeV2AppNetwork,
} from './home-v2-app-actions.js'
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

type AccountReadAction =
  | 'GET_SELECTED_ACCOUNT'
  | 'GET_USER_ACCOUNT'
  | 'SEND_CHAT_DELETE'
  | 'SEND_CHAT_EDIT'
  | 'SEND_CHAT_MESSAGE'
  | 'SEND_CHAT_REACTION'
  | 'JOIN_GROUP'
  | 'LEAVE_GROUP'
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
    readonly kind: 'group'
    readonly targetChainLabel: string
    readonly groupId: number
    readonly groupName: string
    readonly operationLabel: string
    readonly routeLabel: string
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
    writeDetails?.kind === 'group' ? `group:${writeDetails.groupId}` : '',
  ].join('|')
  if (sessionAccountReadGrants.has(grantKey)) return
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
        : writeDetails?.kind === 'group'
          ? {
              writeKind: 'group',
              groupId: writeDetails.groupId,
              groupName: writeDetails.groupName,
              writeOperationLabel: writeDetails.operationLabel,
              writeRouteLabel: writeDetails.routeLabel,
              writeTargetChainLabel: writeDetails.targetChainLabel,
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
  if (decision.scope === 'session') sessionAccountReadGrants.add(grantKey)
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

function translateAvatarResult(
  address: string,
  source: 'LEGACY' | 'POINTER',
  descriptor: { identifier: string; name: string; service: string } | null,
  result: Awaited<ReturnType<typeof readHomeV2Avatar>>,
  maxBytes: number,
) {
  if (result.status === 'pending') {
    return {
      address,
      descriptor,
      retryAfterSeconds: result.retryAfterSeconds,
      source,
      status: 'PENDING',
    }
  }
  if (result.status !== 'ready') throw new Error('Account avatar is not set.')
  if (result.contentLength > maxBytes) {
    throw new Error('Account avatar exceeded the requested size limit.')
  }
  return {
    address,
    body: result.body,
    contentLength: result.contentLength,
    contentType: result.contentType,
    descriptor,
    encoding: 'base64',
    source,
  }
}

async function fetchAccountAvatar(request: Record<string, unknown>) {
  const address = normalizeHomeV2Address(request.address)
  const maxBytes = normalizeHomeV2AvatarMaxBytes(request.maxBytes)
  const pointer = await readIdentityData('qortium', 'accountAvatarInfo', address)
  if (isHomeV2AppRecord(pointer)) {
    const service = stringField(pointer, 'service')
    const name = stringField(pointer, 'name')
    const identifier = stringField(pointer, 'identifier')
    if (service && name && identifier) {
      const descriptor = { identifier, name, service }
      return translateAvatarResult(
        address,
        'POINTER',
        descriptor,
        await readHomeV2Avatar('qortium', {
          address,
          pointer: { ...descriptor, source: 'account-pointer' },
        }),
        maxBytes,
      )
    }
  }
  const primary = await readIdentityData('qortium', 'primaryName', address)
  const name = stringField(primary, 'name')
  if (!name) throw new Error('Account avatar is not set.')
  const descriptor = { identifier: 'avatar', name, service: 'THUMBNAIL' }
  return translateAvatarResult(
    address,
    'LEGACY',
    null,
    await readHomeV2Avatar('qortium', {
      address,
      pointer: { ...descriptor, source: 'legacy-name' },
    }),
    maxBytes,
  )
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

async function readHomeV2ChatJson(nodeApiUrl: string, path: string, label: string, apiKey = '') {
  const response = await nodeFetch(`${nodeApiUrl}${path}`, {
    headers: apiKey ? { 'X-API-KEY': apiKey } : undefined,
    method: 'GET',
    signal: AbortSignal.timeout(15_000),
  })
  const result = await readBoundedResponse(response, 'GET', CHAT_SIGNING_RESPONSE_MAX_BYTES)
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
  if (isHomeV2GroupMembershipAction(action)) {
    return sendHomeV2GroupMembershipAction(sender, context, protocol, network, action, requestValue)
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
  if (action === 'FETCH_ACCOUNT_AVATAR') return fetchAccountAvatar(requestValue)
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
