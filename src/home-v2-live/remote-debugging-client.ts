/**
 * The Settings > Developer "Allow remote debugging of app tabs" switch, as the
 * renderer sees it.
 *
 * Android only. The value belongs to the host — WebView debugging is a
 * process-wide flag the native side has to apply before the WebView loads —
 * so, like the desktop window settings, Settings reads and writes it through
 * the host rather than keeping a copy in the shell state. Desktop and the
 * browser preview have no counterpart (desktop has real devtools instead), so
 * the client resolves to null there and the settings group is not rendered.
 */
export interface HomeV2RemoteDebuggingState {
  /** True in a debuggable build, where debugging is always on and the switch is read-only. */
  readonly alwaysOn: boolean
  readonly enabled: boolean
}

export interface HomeV2RemoteDebuggingClient {
  get(): Promise<HomeV2RemoteDebuggingState>
  set(enabled: boolean): Promise<HomeV2RemoteDebuggingState>
}

/** What the host reports; the renderer re-validates it (parse below). */
export interface HomeV2RemoteDebuggingAdapter {
  getState(): Promise<unknown>
  setEnabled(request: { enabled: boolean }): Promise<unknown>
}

export const DEFAULT_HOME_V2_REMOTE_DEBUGGING: HomeV2RemoteDebuggingState = Object.freeze({
  alwaysOn: false,
  enabled: false,
})

/**
 * Tolerant, field by field: an unreadable field shows its default (off)
 * rather than leaving the switch stuck on "loading". A debuggable build's
 * always-on state implies enabled, whatever the host said about it.
 */
export function parseHomeV2RemoteDebuggingState(value: unknown): HomeV2RemoteDebuggingState {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const alwaysOn =
    typeof record.alwaysOn === 'boolean'
      ? record.alwaysOn
      : DEFAULT_HOME_V2_REMOTE_DEBUGGING.alwaysOn
  const enabled =
    typeof record.enabled === 'boolean'
      ? record.enabled
      : DEFAULT_HOME_V2_REMOTE_DEBUGGING.enabled

  return Object.freeze({ alwaysOn, enabled: alwaysOn || enabled })
}

export function createHomeV2RemoteDebuggingClient(
  adapter: HomeV2RemoteDebuggingAdapter,
): HomeV2RemoteDebuggingClient {
  return {
    async get() {
      return parseHomeV2RemoteDebuggingState(await adapter.getState())
    },
    async set(enabled) {
      // The reply is the state as it now stands, so the caller never has to
      // reconstruct what its own change produced.
      return parseHomeV2RemoteDebuggingState(await adapter.setEnabled({ enabled }))
    },
  }
}
