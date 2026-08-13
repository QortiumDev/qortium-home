import { app, BrowserWindow, ipcMain, type WebContents } from 'electron'
import { randomBytes, randomUUID } from 'node:crypto'
import {
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
  normalizeHomeV2ChatMessageText,
  normalizeHomeV2IdentityAddresses,
  normalizeHomeV2OpenAddress,
  normalizeHomeV2ReadMethod,
  normalizeHomeV2ReadPath,
  normalizeHomeV2ResponseMaxBytes,
  normalizeHomeV2SendTxGroupId,
  type HomeV2AppBridgeProtocol,
  type HomeV2AppNetwork,
} from './home-v2-app-actions.js'
import { getAccountProfile, getAccountSecretKey, isAccountUnlocked, signChatTransaction, signDetached } from './accounts.js'
import { createHomeV2SendRateLimiter } from './home-v2-send-rate-limiter.js'
import { base58Decode, base58Encode } from './base58.js'
import { computeHomeV2ChatNonce } from './home-v2-chat-pow.js'
import { readableNodeErrorMessage } from './node-error-body.js'
import { assertPublicChatTransaction } from './public-transaction-validation.js'
import {
  assertOpenQortalGroupMetadata,
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
  | 'SEND_CHAT_MESSAGE'
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

function chatSendRateLimitKey(context: QdnViewContext) {
  return `${context.tabId}|${context.accountId ?? 'none'}`
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
// refuses to honor a stale session grant when the two disagree. `resourceUrl`
// or `currentUrl` being absent is not itself suspicious (e.g. before the
// first load completes), so this only refuses when both are present and
// disagree.
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
  chatDetails?: {
    readonly targetChainLabel: string
    readonly groupId: number
    readonly messagePreview: string
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
  const grantKey = accountGrantKey(
    sender,
    context,
    protocol,
    action,
    accountUnlocked,
    nodeRoute,
  )
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
      ...(chatDetails
        ? {
            chatGroupId: chatDetails.groupId,
            chatMessagePreview: chatDetails.messagePreview,
            chatTargetChainLabel: chatDetails.targetChainLabel,
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
) {
  const response = await nodeFetch(`${nodeApiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
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
    throw new Error(readableNodeErrorMessage(text, `${fallbackMessage} HTTP ${result.status}.`))
  }
  return text
}

type HomeV2ChatSigningKey = { address: string; publicKey58: string; secretKey: Uint8Array }

// Keyless open-group chat send for the Qortium network. Builds the unsigned
// CHAT bytes via the keyless /chat/public/build endpoint (no API key, no
// private key ever leaves this process), validates the node's response
// against what we asked it to build, computes the memory-pow nonce locally,
// signs locally, then broadcasts. Mirrors src/platform.ts
// sendKeylessPublicGroupChatMessage and electron/qdn.ts's v1 equivalent.
async function sendHomeV2QortiumChatMessage(
  nodeApiUrl: string,
  txGroupId: number,
  message: string,
  signingKey: HomeV2ChatSigningKey,
  isStillValid: () => boolean | Promise<boolean>,
) {
  const timestamp = Date.now()
  const data = base58Encode(new TextEncoder().encode(message))
  const buildBody = await postHomeV2ChatText(
    nodeApiUrl,
    '/chat/public/build',
    JSON.stringify({
      data,
      fee: 0,
      isEncrypted: false,
      isText: true,
      senderPublicKey: signingKey.publicKey58,
      timestamp,
      txGroupId,
    }),
    'application/json',
    'Chat transaction build failed.',
  )
  const unsignedBytes = base58Decode(buildBody)
  // Never sign node-provided bytes without checking they encode exactly the
  // sender/group/message/timestamp we asked for.
  assertPublicChatTransaction(unsignedBytes, {
    data: base58Decode(data),
    publicKey: base58Decode(signingKey.publicKey58),
    timestamp,
    txGroupId,
  })
  const nonce = await computeHomeV2ChatNonce(unsignedBytes, QORTIUM_CHAT_POW_DIFFICULTY, isStillValid)
  if (!(await isStillValid())) {
    throw new Error('The signing context changed before the chat message could be submitted.')
  }
  const signedBytes = signChatTransaction(unsignedBytes, nonce, signingKey.secretKey)
  await postHomeV2ChatText(
    nodeApiUrl,
    '/transactions/process?apiVersion=2',
    base58Encode(signedBytes),
    'text/plain',
    'Chat transaction processing failed.',
  )
  return { signature: getSignatureFromSignedTransactionBytes(signedBytes), timestamp }
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
  txGroupId: number,
  message: string,
  signingKey: HomeV2ChatSigningKey,
  isStillValid: () => boolean | Promise<boolean>,
) {
  // Home does not implement Qortal private-group encryption yet
  // (docs/CHAT_2_0_PLAN.md); refuse to broadcast plaintext into a group that
  // is not verifiably open, the same guard v1's Qortal group send applies.
  const groupResponse = await nodeFetch(`${nodeApiUrl}/groups/${encodeURIComponent(String(txGroupId))}`, {
    method: 'GET',
    signal: AbortSignal.timeout(15_000),
  })
  const groupResult = await readBoundedResponse(groupResponse, 'GET', CHAT_SIGNING_RESPONSE_MAX_BYTES)
  assertOpenQortalGroupMetadata(groupResult.ok ? groupResult.data : null, txGroupId)

  const timestamp = Date.now()
  const unsignedBytes = buildUnsignedQortalGroupChatTransactionBytes({
    lastReference: new Uint8Array(randomBytes(64)),
    message,
    senderPublicKey: signingKey.publicKey58,
    timestamp,
    txGroupId,
  })
  const difficulty = await resolveHomeV2QortalChatPowDifficulty(nodeApiUrl, signingKey.address)
  const nonce = await computeHomeV2ChatNonce(unsignedBytes, difficulty, isStillValid)
  if (!(await isStillValid())) {
    throw new Error('The signing context changed before the chat message could be submitted.')
  }
  const stampedBytes = stampQortalGroupChatNonce(unsignedBytes, nonce)
  const signatureBytes = signDetached(stampedBytes, signingKey.secretKey)
  const signedBytes = appendSignatureToTransactionBytes(stampedBytes, signatureBytes)
  await postHomeV2ChatText(
    nodeApiUrl,
    '/transactions/process?apiVersion=2',
    base58Encode(signedBytes),
    'text/plain',
    'Qortal chat message broadcast failed.',
  )
  return { signature: getSignatureFromSignedTransactionBytes(signedBytes), timestamp }
}

async function sendHomeV2ChatMessage(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  const txGroupId = normalizeHomeV2SendTxGroupId(protocol, requestValue.txGroupId)
  const message = normalizeHomeV2ChatMessageText(requestValue.message)
  // The Chat app is expected to drive UNLOCK_SELECTED_ACCOUNT first on
  // qdnRequest; a pure-Qortal app cannot unlock in Phase 1 (documented
  // limitation, docs/HOME_V2_BRIDGE_COMPATIBILITY.md). Failing fast here also
  // avoids prompting the user for a send that cannot possibly proceed.
  if (!isAccountUnlocked(accountId)) {
    throw new Error('The selected account is locked.')
  }
  const targetChainLabel = network === 'qortal' ? 'Qortal' : 'Qortium'
  const groupLabel = txGroupId === 0 ? 'General chat' : `Group ${txGroupId}`
  await requireAccountReadPermission(sender, context, protocol, 'SEND_CHAT_MESSAGE', {
    groupId: txGroupId,
    messagePreview: message.slice(0, 180),
    targetChainLabel: `${targetChainLabel} · ${groupLabel}`,
  })
  // Fix B: reject an excessive send BEFORE any node call or proof-of-work —
  // the single-in-flight-PoW guard (isStillValid below) already prevents
  // overlap, but nothing previously bounded how many sends a granted tab
  // could queue back-to-back.
  const rateLimitDecision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(context))
  if (!rateLimitDecision.allowed) {
    throw new Error(rateLimitDecision.message)
  }
  const node = await getHomeV2ReadableNode(network)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  const signingKey = getAccountSecretKey(accountId)
  if (signingKey.address !== profile.address) {
    throw new Error('Selected account signing key does not match the saved account address.')
  }
  const isStillValid = async () => {
    const freshContext = getQdnViewContextForWebContents(sender)
    if (!freshContext || !sameViewContext(context, freshContext)) return false
    if (!liveResourceMatchesGrant(freshContext)) return false
    if (!isAccountUnlocked(accountId)) return false
    const nodeNow = await getHomeV2ReadableNode(network).catch(() => null)
    return !!nodeNow && `${nodeNow.mode}|${nodeNow.nodeApiUrl}` === nodeRoute
  }
  if (!(await isStillValid())) {
    throw new Error('Account access context changed before approval completed.')
  }
  return network === 'qortium'
    ? sendHomeV2QortiumChatMessage(node.nodeApiUrl, txGroupId, message, signingKey, isStillValid)
    : sendHomeV2QortalChatMessage(node.nodeApiUrl, txGroupId, message, signingKey, isStillValid)
}

async function handleRequest(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  requestValue: unknown,
) {
  if (!isHomeV2AppRecord(requestValue)) throw new Error('App requests must be objects.')
  const action = normalizeHomeV2AppAction(requestValue)
  const availableActions = getHomeV2AppActions(protocol)
  if (action === 'SHOW_ACTIONS') return [...availableActions]
  if (!availableActions.includes(action)) {
    throw new Error(`${action} is not available in Home v2 read-only mode.`)
  }
  if (action === 'WHICH_UI') return 'QORTIUM_HOME_ELECTRON'
  if (action === 'GET_HOST_INFO') {
    return {
      hostName: 'qortium-home',
      hostVersion: app.getVersion(),
      platform: 'desktop',
      platformVersion: '2.0',
    }
  }
  const network = getHomeV2AppNetwork(protocol, action)
  if (action === 'IS_USING_PUBLIC_NODE') {
    return (await getHomeV2ReadableNode(network)).mode === 'public'
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
  if (action === 'SEND_CHAT_MESSAGE') {
    return sendHomeV2ChatMessage(sender, context, protocol, network, requestValue)
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
