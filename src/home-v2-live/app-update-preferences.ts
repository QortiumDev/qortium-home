import packageJson from '../../package.json'

export type HomeV2AppUpdatePolicy = 'auto-download' | 'notify' | 'off'

export type HomeV2AppUpdatePreferences = {
  readonly homeUpdatePolicy: HomeV2AppUpdatePolicy
  readonly releaseChannel: 'prerelease' | 'stable'
}

export const HOME_V2_APP_UPDATE_PREFERENCES_KEY = 'qortium-home-app-update-preferences'
const MAX_PREFERENCES_BYTES = 16 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function getDefaultHomeV2AppUpdateChannel(version = packageJson.version) {
  return version.includes('-') ? 'prerelease' as const : 'stable' as const
}

export function getDefaultHomeV2AppUpdatePreferences(
  version = packageJson.version,
): HomeV2AppUpdatePreferences {
  return {
    homeUpdatePolicy: 'notify',
    releaseChannel: getDefaultHomeV2AppUpdateChannel(version),
  }
}

export function parseHomeV2AppUpdatePreferences(
  raw: string | null,
  version = packageJson.version,
): HomeV2AppUpdatePreferences {
  const defaults = getDefaultHomeV2AppUpdatePreferences(version)
  if (raw === null) return defaults
  if (!raw || raw.length > MAX_PREFERENCES_BYTES) {
    throw new Error('Stored Android app update preferences are malformed.')
  }
  const value: unknown = JSON.parse(raw)
  if (!isRecord(value)) throw new Error('Stored Android app update preferences are malformed.')
  const homeUpdatePolicy = value.homeUpdatePolicy
  const releaseChannel = value.releaseChannel
  if (
    (homeUpdatePolicy !== 'off' &&
      homeUpdatePolicy !== 'notify' &&
      homeUpdatePolicy !== 'auto-download') ||
    (releaseChannel !== undefined &&
      releaseChannel !== null &&
      releaseChannel !== 'stable' &&
      releaseChannel !== 'prerelease')
  ) throw new Error('Stored Android app update preferences are malformed.')
  return {
    homeUpdatePolicy,
    releaseChannel: releaseChannel === 'stable' || releaseChannel === 'prerelease'
      ? releaseChannel
      : defaults.releaseChannel,
  }
}

export function serializeHomeV2AppUpdatePreferences(
  preferences: HomeV2AppUpdatePreferences,
) {
  return JSON.stringify({
    // Keep the legacy field null so an older renderer can read this record
    // without ever receiving a Home 2 opaque download handle as a file path.
    downloadedUpdate: null,
    homeUpdatePolicy: preferences.homeUpdatePolicy,
    releaseChannel: preferences.releaseChannel,
    revision: 1,
    schema: 'home-v2-app-update-preferences',
  })
}

export function getHomeV2AutomaticUpdateAction(policy: HomeV2AppUpdatePolicy) {
  if (policy === 'off') return 'none' as const
  return policy === 'auto-download' ? 'check-and-download' as const : 'check' as const
}
