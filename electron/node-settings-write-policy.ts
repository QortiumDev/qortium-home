export interface ComparableNodeSettings {
  apiKey: string
  customUrl: string
  mode: string
}

function settingsMatch(
  first: ComparableNodeSettings,
  second: ComparableNodeSettings,
) {
  return (
    first.apiKey === second.apiKey &&
    first.customUrl === second.customUrl &&
    first.mode === second.mode
  )
}

/**
 * A local API-key lookup crosses asynchronous Core/runtime checks. Do not let
 * its stale local-mode result overwrite a connection-mode change made while
 * those checks were in flight.
 */
export function chooseResolvedLocalSettingsWrite<
  Settings extends ComparableNodeSettings,
>(current: Settings, expected: Settings, resolved: Settings) {
  return settingsMatch(current, expected) ? resolved : current
}
