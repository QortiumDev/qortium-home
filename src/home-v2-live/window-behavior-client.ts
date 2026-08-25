import type { HomeV2WindowsBridge } from './node-client'

/**
 * The two app-level window settings, as the renderer sees them.
 *
 * They belong to the main process rather than to the shell state file: what a
 * close does has to be decided at a moment when no renderer can be consulted.
 * Settings therefore reads and writes them over the window bridge instead of
 * keeping its own copy.
 *
 * Desktop only. There is no Android or web counterpart — the concepts do not
 * exist there — so the client resolves to null and the settings group is not
 * rendered at all.
 */
export interface HomeV2WindowBehaviorState {
  readonly closeToTray: boolean
  readonly warnOnCloseWithMultipleTabs: boolean
}

export type HomeV2WindowBehaviorChange = Partial<HomeV2WindowBehaviorState>

export interface HomeV2WindowBehaviorClient {
  get(): Promise<HomeV2WindowBehaviorState>
  set(change: HomeV2WindowBehaviorChange): Promise<HomeV2WindowBehaviorState>
}

export const DEFAULT_HOME_V2_WINDOW_BEHAVIOR: HomeV2WindowBehaviorState = Object.freeze({
  closeToTray: false,
  warnOnCloseWithMultipleTabs: true,
})

/**
 * Re-validates what the bridge returned. Deliberately tolerant, like the main
 * process's own read of the stored file: an unreadable field shows its default
 * rather than leaving the toggles stuck on "loading" for ever.
 */
export function parseHomeV2WindowBehavior(value: unknown): HomeV2WindowBehaviorState {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}

  return Object.freeze({
    closeToTray:
      typeof record.closeToTray === 'boolean'
        ? record.closeToTray
        : DEFAULT_HOME_V2_WINDOW_BEHAVIOR.closeToTray,
    warnOnCloseWithMultipleTabs:
      typeof record.warnOnCloseWithMultipleTabs === 'boolean'
        ? record.warnOnCloseWithMultipleTabs
        : DEFAULT_HOME_V2_WINDOW_BEHAVIOR.warnOnCloseWithMultipleTabs,
  })
}

export function createHomeV2WindowBehaviorClient(
  adapter: Required<Pick<HomeV2WindowsBridge, 'getBehavior' | 'setBehavior'>>,
): HomeV2WindowBehaviorClient {
  return {
    async get() {
      return parseHomeV2WindowBehavior(await adapter.getBehavior())
    },
    async set(change) {
      // The reply is the whole record as it now stands, so the caller never
      // has to reconstruct what its own change produced.
      return parseHomeV2WindowBehavior(await adapter.setBehavior(change))
    },
  }
}

/**
 * The client for this host, or null where the desktop window bridge is absent
 * (Android, and the browser preview).
 */
export function resolveHomeV2WindowBehaviorClient(
  injectedBridge?: HomeV2WindowsBridge | null,
): HomeV2WindowBehaviorClient | null {
  const bridge =
    injectedBridge === undefined && typeof window !== 'undefined'
      ? window.homeV2Windows
      : injectedBridge

  const getBehavior = bridge?.getBehavior
  const setBehavior = bridge?.setBehavior

  if (typeof getBehavior !== 'function' || typeof setBehavior !== 'function') {
    return null
  }

  return createHomeV2WindowBehaviorClient({
    getBehavior: getBehavior.bind(bridge),
    setBehavior: setBehavior.bind(bridge),
  })
}
