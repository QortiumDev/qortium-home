import type {
  HomeV2AppBridgeProtocol,
  HomeV2AppNetwork,
} from './home-v2-app-actions.js'

export const HOME_V2_NOTIFICATION_ACTIONS = [
  'NOTIFICATION_HAS_PERMISSION',
  'SHOW_NOTIFICATION',
] as const

export type HomeV2NotificationAction = (typeof HOME_V2_NOTIFICATION_ACTIONS)[number]

export type HomeV2NotificationConversation =
  | { readonly kind: 'group'; readonly groupId: number }
  | { readonly kind: 'direct'; readonly otherAddress: string }

export interface HomeV2NotificationSource {
  readonly kind: 'chat'
  readonly conversation: HomeV2NotificationConversation
}

export interface HomeV2NotificationRequest {
  readonly network: HomeV2AppNetwork
  readonly source: HomeV2NotificationSource | null
  readonly text: string
  readonly title: string
}

const TITLE_MAX_LENGTH = 80
const TEXT_MAX_LENGTH = 240
const ADDRESS_MAX_LENGTH = 128
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function networkForProtocol(protocol: HomeV2AppBridgeProtocol): HomeV2AppNetwork {
  return protocol === 'qortalRequest' ? 'qortal' : 'qortium'
}

function cleanText(value: unknown, label: string, maxLength: number, required: boolean): string {
  if (typeof value !== 'string') {
    if (!required && (value === null || value === undefined)) return ''
    throw new Error(`${label} must be a string.`)
  }
  const cleaned = value.replace(UNSAFE_TEXT, ' ').replace(/\s+/g, ' ').trim()
  if (required && !cleaned) throw new Error(`${label} is required.`)
  if (cleaned.length > maxLength) throw new Error(`${label} is too long.`)
  return cleaned
}

function normalizeSource(value: unknown): HomeV2NotificationSource | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || value.kind !== 'chat' || !isRecord(value.conversation)) {
    throw new Error('Notification source must identify a chat conversation.')
  }
  const conversation = value.conversation
  if (conversation.kind === 'group') {
    if (!Number.isSafeInteger(conversation.groupId) || Number(conversation.groupId) < 0) {
      throw new Error('Notification groupId must be a non-negative safe integer.')
    }
    return Object.freeze({
      kind: 'chat',
      conversation: Object.freeze({ kind: 'group', groupId: Number(conversation.groupId) }),
    })
  }
  if (conversation.kind === 'direct') {
    const otherAddress = cleanText(conversation.otherAddress, 'Notification direct address', ADDRESS_MAX_LENGTH, true)
    if (!/^Q[1-9A-HJ-NP-Za-km-z]{20,80}$/.test(otherAddress)) {
      throw new Error('Notification direct address is invalid.')
    }
    return Object.freeze({
      kind: 'chat',
      conversation: Object.freeze({ kind: 'direct', otherAddress }),
    })
  }
  throw new Error('Notification conversation kind must be group or direct.')
}

export function isHomeV2NotificationAction(value: unknown): value is HomeV2NotificationAction {
  return typeof value === 'string' && (HOME_V2_NOTIFICATION_ACTIONS as readonly string[]).includes(value)
}

export function normalizeHomeV2NotificationRequest(
  protocol: HomeV2AppBridgeProtocol,
  value: unknown,
): HomeV2NotificationRequest {
  if (!isRecord(value)) throw new Error('Notification request must be an object.')
  const network = networkForProtocol(protocol)
  if (value.network !== undefined && value.network !== network) {
    throw new Error(`Notification network must match ${protocol}.`)
  }
  return Object.freeze({
    network,
    source: normalizeSource(value.source),
    text: cleanText(value.text, 'Notification text', TEXT_MAX_LENGTH, false),
    title: cleanText(value.title, 'Notification title', TITLE_MAX_LENGTH, true),
  })
}

export function homeV2NotificationSourceKey(source: HomeV2NotificationSource | null): string | null {
  if (!source) return null
  return source.conversation.kind === 'group'
    ? `chat:group:${source.conversation.groupId}`
    : `chat:direct:${source.conversation.otherAddress}`
}

export function homeV2NotificationChainLabel(network: HomeV2AppNetwork): string {
  return network === 'qortal' ? 'Qortal' : 'Qortium'
}
