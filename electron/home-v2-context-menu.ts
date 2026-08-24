import {
  normalizeHomeV2Address,
  type HomeV2AppBridgeProtocol,
  type HomeV2AppNetwork,
} from './home-v2-app-actions.js'

export const HOME_V2_CONTEXT_MENU_VERSION = 1 as const

export type HomeV2ContextMenuActionId =
  | 'account.copy-address'
  | 'account.copy-name'
  | 'group.copy-id'
  | 'group.copy-name'
  | 'resource.copy-address'
  | 'resource.open-new-tab'

export type HomeV2ContextMenuTarget =
  | {
      readonly address: string
      readonly kind: 'account'
      readonly name: string | null
      readonly network: HomeV2AppNetwork
    }
  | {
      readonly groupId: number
      readonly kind: 'group'
      readonly name: string | null
      readonly network: HomeV2AppNetwork
    }
  | {
      readonly address: string
      readonly kind: 'resource'
      readonly name: string
      readonly network: HomeV2AppNetwork
      readonly service: string
    }

export interface HomeV2ContextMenuAnchor {
  readonly x: number
  readonly y: number
}

export interface HomeV2ContextMenuHostBounds {
  readonly height: number
  readonly width: number
  readonly x: number
  readonly y: number
}

export interface HomeV2ContextMenuRequest {
  readonly anchor: HomeV2ContextMenuAnchor | null
  readonly target: HomeV2ContextMenuTarget
  readonly version: typeof HOME_V2_CONTEXT_MENU_VERSION
}

export interface HomeV2ContextMenuItem {
  readonly action: HomeV2ContextMenuActionId
  readonly group: 'copy' | 'open'
  readonly label: string
}

export type HomeV2ContextMenuResult =
  | {
      readonly action: HomeV2ContextMenuActionId
      readonly status: 'handled'
      readonly version: typeof HOME_V2_CONTEXT_MENU_VERSION
    }
  | {
      readonly status: 'dismissed'
      readonly version: typeof HOME_V2_CONTEXT_MENU_VERSION
    }

export type HomeV2ContextMenuOperation =
  | { readonly kind: 'copy'; readonly value: string }
  | { readonly address: string; readonly kind: 'open-new-tab' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function networkForProtocol(protocol: HomeV2AppBridgeProtocol): HomeV2AppNetwork {
  return protocol === 'qortalRequest' ? 'qortal' : 'qortium'
}

function optionalLabel(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error(`${label} must be text.`)
  const normalized = value.trim()
  if (!normalized || normalized.length > 128 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} must contain 1 to 128 visible characters.`)
  }
  return normalized
}

function normalizeAnchor(value: unknown): HomeV2ContextMenuAnchor | null {
  if (value === undefined || value === null) return null
  if (!isRecord(value)) throw new Error('Context menu anchor must contain x and y coordinates.')
  const x = value.x
  const y = value.y
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    Math.abs(x) > 1_000_000 ||
    Math.abs(y) > 1_000_000
  ) {
    throw new Error('Context menu anchor coordinates are invalid.')
  }
  return Object.freeze({ x, y })
}

function normalizeGroupId(value: unknown) {
  const groupId = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(groupId) || groupId < 1) {
    throw new Error('Context menu groupId must be a positive safe integer.')
  }
  return groupId
}

function normalizeResourceAddress(
  value: unknown,
  protocol: HomeV2AppBridgeProtocol,
): Pick<Extract<HomeV2ContextMenuTarget, { kind: 'resource' }>, 'address' | 'name' | 'network' | 'service'> {
  if (typeof value !== 'string') throw new Error('Context menu resource address is required.')
  const address = value.trim()
  if (!address || address.length > 2_048 || /[\u0000-\u001f\u007f\\]/.test(address)) {
    throw new Error('Context menu resource address is invalid or too long.')
  }
  if (/(?:^|\/)(?:\.|%2e){1,2}(?=\/|[?#]|$)/i.test(address)) {
    throw new Error('Context menu resource address cannot contain dot path segments.')
  }
  let parsed: URL
  try {
    parsed = new URL(address)
  } catch {
    throw new Error('Use a complete qdn:// or qortal:// resource address.')
  }
  const scheme = parsed.protocol.slice(0, -1).toLowerCase()
  const expectedScheme = protocol === 'qortalRequest' ? 'qortal' : 'qdn'
  if (scheme !== expectedScheme) {
    throw new Error(`${protocol} context menus only accept ${expectedScheme}:// resources.`)
  }
  if (parsed.username || parsed.password || parsed.port) {
    throw new Error('Context menu resource addresses cannot contain credentials or ports.')
  }
  const service = parsed.hostname.toUpperCase()
  if (!/^[A-Z0-9_]{1,64}$/.test(service)) {
    throw new Error('Context menu resource service is invalid.')
  }
  const rawSegments = parsed.pathname.split('/').filter(Boolean)
  if (rawSegments.length === 0) throw new Error('Context menu resource name is required.')
  const decodedSegments = rawSegments.map((segment, index) => {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      throw new Error('Context menu resource address contains invalid encoding.')
    }
    if (
      !decoded ||
      decoded === '.' ||
      decoded === '..' ||
      decoded.length > (index === 0 ? 128 : 512) ||
      /[\u0000-\u001f\u007f\\/]/.test(decoded)
    ) {
      throw new Error('Context menu resource path is invalid.')
    }
    return decoded
  })
  return Object.freeze({
    address,
    name: decodedSegments[0],
    network: networkForProtocol(protocol),
    service,
  })
}

export function normalizeHomeV2ContextMenuRequest(
  protocol: HomeV2AppBridgeProtocol,
  value: unknown,
): HomeV2ContextMenuRequest {
  if (!isRecord(value)) throw new Error('SHOW_CONTEXT_MENU requires a request object.')
  if (value.version !== HOME_V2_CONTEXT_MENU_VERSION) {
    throw new Error(`SHOW_CONTEXT_MENU requires version ${HOME_V2_CONTEXT_MENU_VERSION}.`)
  }
  if (!isRecord(value.target)) throw new Error('SHOW_CONTEXT_MENU requires a target.')
  const network = networkForProtocol(protocol)
  const kind = value.target.kind
  let target: HomeV2ContextMenuTarget
  if (kind === 'account') {
    target = Object.freeze({
      address: normalizeHomeV2Address(value.target.address, 'Context menu account address'),
      kind,
      name: optionalLabel(value.target.name, 'Context menu account name'),
      network,
    })
  } else if (kind === 'group') {
    target = Object.freeze({
      groupId: normalizeGroupId(value.target.groupId),
      kind,
      name: optionalLabel(value.target.name, 'Context menu group name'),
      network,
    })
  } else if (kind === 'resource') {
    target = Object.freeze({
      kind,
      ...normalizeResourceAddress(value.target.address, protocol),
    })
  } else {
    throw new Error('Context menu target kind must be account, group, or resource.')
  }
  return Object.freeze({
    anchor: normalizeAnchor(value.anchor),
    target,
    version: HOME_V2_CONTEXT_MENU_VERSION,
  })
}

export function getHomeV2ContextMenuItems(
  target: HomeV2ContextMenuTarget,
): readonly HomeV2ContextMenuItem[] {
  if (target.kind === 'account') {
    return Object.freeze([
      Object.freeze({ action: 'account.copy-address', group: 'copy', label: 'Copy address' }),
      ...(target.name
        ? [Object.freeze({ action: 'account.copy-name' as const, group: 'copy' as const, label: 'Copy name' })]
        : []),
    ])
  }
  if (target.kind === 'group') {
    return Object.freeze([
      Object.freeze({ action: 'group.copy-id', group: 'copy', label: 'Copy group ID' }),
      ...(target.name
        ? [Object.freeze({ action: 'group.copy-name' as const, group: 'copy' as const, label: 'Copy group name' })]
        : []),
    ])
  }
  return Object.freeze([
    ...(target.service === 'APP'
      ? [Object.freeze({ action: 'resource.open-new-tab' as const, group: 'open' as const, label: 'Open in new tab' })]
      : []),
    Object.freeze({ action: 'resource.copy-address', group: 'copy', label: 'Copy resource link' }),
  ])
}

export function getHomeV2ContextMenuOperation(
  target: HomeV2ContextMenuTarget,
  action: HomeV2ContextMenuActionId,
): HomeV2ContextMenuOperation {
  if (target.kind === 'account') {
    if (action === 'account.copy-address') return { kind: 'copy', value: target.address }
    if (action === 'account.copy-name' && target.name) return { kind: 'copy', value: target.name }
  } else if (target.kind === 'group') {
    if (action === 'group.copy-id') return { kind: 'copy', value: String(target.groupId) }
    if (action === 'group.copy-name' && target.name) return { kind: 'copy', value: target.name }
  } else {
    if (action === 'resource.copy-address') return { kind: 'copy', value: target.address }
    if (action === 'resource.open-new-tab' && target.service === 'APP') {
      return { address: target.address, kind: 'open-new-tab' }
    }
  }
  throw new Error('That context menu action is not available for this target.')
}

export function handledHomeV2ContextMenuResult(
  action: HomeV2ContextMenuActionId,
): HomeV2ContextMenuResult {
  return Object.freeze({ action, status: 'handled', version: HOME_V2_CONTEXT_MENU_VERSION })
}

export function dismissedHomeV2ContextMenuResult(): HomeV2ContextMenuResult {
  return Object.freeze({ status: 'dismissed', version: HOME_V2_CONTEXT_MENU_VERSION })
}

export function getHomeV2ContextMenuPopupPoint(
  bounds: HomeV2ContextMenuHostBounds,
  zoomFactor: number,
  anchor: HomeV2ContextMenuAnchor | null,
) {
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width < 1 ||
    bounds.height < 1 ||
    !Number.isFinite(zoomFactor) ||
    zoomFactor <= 0
  ) {
    throw new Error('The context menu host bounds are invalid.')
  }
  const localX = Math.min(Math.max(anchor?.x ?? bounds.width / 2, 0), bounds.width - 1)
  const localY = Math.min(Math.max(anchor?.y ?? bounds.height / 2, 0), bounds.height - 1)
  return Object.freeze({
    x: Math.round((bounds.x + localX) * zoomFactor),
    y: Math.round((bounds.y + localY) * zoomFactor),
  })
}
