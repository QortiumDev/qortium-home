export const HOME_V2_RUNTIME_INVALIDATION_KINDS = Object.freeze([
  'account-changed',
  // One app tab's app was replaced in place (OPEN_CURRENT_TAB). Deliberately
  // distinct from 'navigation-changed', which is an app moving around inside
  // ITSELF and therefore keeps that tab's account.read binding alive: here the
  // tab now hosts a DIFFERENT app, so every tab-bound grant the outgoing app
  // held must go, exactly as if the tab had been closed and reopened. Also
  // kept distinct from 'tab-closed', because the tab is NOT closing — nothing
  // may read this as a signal to tear the tab or its view down.
  'app-replaced',
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
  if ((kind === 'navigation-changed' || kind === 'tab-closed' || kind === 'app-replaced') && !tabId) {
    throw new Error(`Home v2 ${kind} invalidation requires a tab.`)
  }
  if (kind === 'node-changed' && !network) {
    throw new Error('Home v2 node-changed invalidation requires a network.')
  }
  return Object.freeze({ kind, network, tabId })
}
