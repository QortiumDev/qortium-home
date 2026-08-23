export const HOME_V2_RUNTIME_INVALIDATION_KINDS = Object.freeze([
  'account-changed',
  'locked',
  'navigation-changed',
  'node-changed',
  'tab-closed',
] as const)

export type HomeV2RuntimeInvalidationKind =
  (typeof HOME_V2_RUNTIME_INVALIDATION_KINDS)[number]

export interface HomeV2RuntimeInvalidation {
  readonly kind: HomeV2RuntimeInvalidationKind
  readonly network: 'qortal' | 'qortium' | null
  readonly tabId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeHomeV2RuntimeInvalidation(
  value: unknown,
): HomeV2RuntimeInvalidation {
  if (!isRecord(value) || typeof value.kind !== 'string' ||
      !(HOME_V2_RUNTIME_INVALIDATION_KINDS as readonly string[]).includes(value.kind)) {
    throw new Error('Home v2 runtime invalidation is invalid.')
  }
  const kind = value.kind as HomeV2RuntimeInvalidationKind
  let network: 'qortal' | 'qortium' | null = null
  if (value.network !== undefined && value.network !== null) {
    if (value.network !== 'qortal' && value.network !== 'qortium') {
      throw new Error('Home v2 runtime invalidation network is invalid.')
    }
    network = value.network
  }
  let tabId: string | null = null
  if (value.tabId !== undefined && value.tabId !== null) {
    if (typeof value.tabId !== 'string' || !value.tabId || value.tabId.length > 128) {
      throw new Error('Home v2 runtime invalidation tab is invalid.')
    }
    tabId = value.tabId
  }
  if ((kind === 'navigation-changed' || kind === 'tab-closed') && !tabId) {
    throw new Error(`Home v2 ${kind} invalidation requires a tab.`)
  }
  if (kind === 'node-changed' && !network) {
    throw new Error('Home v2 node-changed invalidation requires a network.')
  }
  return Object.freeze({ kind, network, tabId })
}
