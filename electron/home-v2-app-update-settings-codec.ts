export type StoredHomeV2AppUpdatePolicy = 'auto-download' | 'notify' | 'off'
/**
 * Where release listings and packages come from. `qdn-then-github` asks the
 * connected Qortium node for the QDN manifest first and falls back to
 * GitHub when the node has none (or the network is off).
 */
export type StoredHomeV2AppUpdateReleaseSource = 'github' | 'qdn' | 'qdn-then-github'
export type StoredHomeV2AppUpdateSettings = {
  readonly generation: number
  readonly homeUpdatePolicy: StoredHomeV2AppUpdatePolicy
  readonly releaseChannel: 'prerelease' | 'stable'
  readonly releaseSource: StoredHomeV2AppUpdateReleaseSource
}

export const DEFAULT_HOME_V2_APP_UPDATE_SETTINGS: StoredHomeV2AppUpdateSettings = {
  generation: 0,
  homeUpdatePolicy: 'notify',
  releaseChannel: 'stable',
  releaseSource: 'qdn-then-github',
}

export function isStoredHomeV2AppUpdateReleaseSource(value: unknown): value is StoredHomeV2AppUpdateReleaseSource {
  return value === 'github' || value === 'qdn' || value === 'qdn-then-github'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function parseStoredHomeV2AppUpdateSettings(value: unknown): StoredHomeV2AppUpdateSettings {
  if (!isRecord(value)) throw new Error('Stored app update settings are malformed.')
  const keys = Object.keys(value).sort()
  // Version 1 files predate the release source; they read as the default.
  const expected = value.version === 1
    ? ['generation', 'homeUpdatePolicy', 'releaseChannel', 'schema', 'version']
    : ['generation', 'homeUpdatePolicy', 'releaseChannel', 'releaseSource', 'schema', 'version']
  if (keys.length !== expected.length || !keys.every((key, index) => key === expected[index])) {
    throw new Error('Stored app update settings have unexpected fields.')
  }
  if (
    value.schema !== 'qortium-home-v2-app-update-settings' ||
    (value.version !== 1 && value.version !== 2) ||
    (value.version === 2 && !isStoredHomeV2AppUpdateReleaseSource(value.releaseSource)) ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 0 ||
    (value.generation as number) >= Number.MAX_SAFE_INTEGER ||
    (value.homeUpdatePolicy !== 'off' &&
      value.homeUpdatePolicy !== 'notify' &&
      value.homeUpdatePolicy !== 'auto-download') ||
    (value.releaseChannel !== 'stable' && value.releaseChannel !== 'prerelease')
  ) throw new Error('Stored app update settings are malformed.')
  return {
    generation: value.generation as number,
    homeUpdatePolicy: value.homeUpdatePolicy,
    releaseChannel: value.releaseChannel,
    releaseSource: value.version === 2
      ? (value.releaseSource as StoredHomeV2AppUpdateReleaseSource)
      : DEFAULT_HOME_V2_APP_UPDATE_SETTINGS.releaseSource,
  }
}
