export type StoredHomeV2AppUpdatePolicy = 'auto-download' | 'notify' | 'off'
export type StoredHomeV2AppUpdateSettings = {
  readonly generation: number
  readonly homeUpdatePolicy: StoredHomeV2AppUpdatePolicy
  readonly releaseChannel: 'prerelease' | 'stable'
}

export const DEFAULT_HOME_V2_APP_UPDATE_SETTINGS: StoredHomeV2AppUpdateSettings = {
  generation: 0,
  homeUpdatePolicy: 'notify',
  releaseChannel: 'stable',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function parseStoredHomeV2AppUpdateSettings(value: unknown): StoredHomeV2AppUpdateSettings {
  if (!isRecord(value)) throw new Error('Stored app update settings are malformed.')
  const keys = Object.keys(value).sort()
  const expected = ['generation', 'homeUpdatePolicy', 'releaseChannel', 'schema', 'version']
  if (keys.length !== expected.length || !keys.every((key, index) => key === expected[index])) {
    throw new Error('Stored app update settings have unexpected fields.')
  }
  if (
    value.schema !== 'qortium-home-v2-app-update-settings' ||
    value.version !== 1 ||
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
  }
}
