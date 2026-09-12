import { CapacitorHttp } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { checkAppUpdates, GITHUB_JSON_ACCEPT_HEADER, type GithubJsonFetcher } from './appUpdates'
import { HOME_V2_APP_UPDATE_PREFERENCES_KEY } from './home-v2-live/app-update-preferences'

// A release listing is a few hundred KB at most; anything larger is not GitHub.
const MAX_RELEASE_JSON_CHARS = 2 * 1024 * 1024

/**
 * The Home 2 shell's CSP allows no https connect, so the page's own `fetch`
 * never reaches GitHub on Android ("Unable to check Qortium Home releases"
 * on every check, beta.3). The native HTTP plugin does, the same way the
 * release-notes page already reads GitHub. Exported for tests.
 */
export function createAndroidGithubJsonFetcher(
  get: (request: { url: string; headers: Record<string, string>; connectTimeout: number; readTimeout: number }) =>
    Promise<{ status: number; data: unknown }> = (request) => CapacitorHttp.get(request),
): GithubJsonFetcher {
  return async (url) => {
    const response = await get({
      url,
      headers: { Accept: GITHUB_JSON_ACCEPT_HEADER },
      connectTimeout: 8_000,
      readTimeout: 12_000,
    })
    if (response.status === 404) return null
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`GitHub returned HTTP ${response.status}.`)
    }
    // The plugin parses a JSON content type itself; anything else arrives as text.
    if (typeof response.data === 'string') {
      if (response.data.length > MAX_RELEASE_JSON_CHARS) throw new Error('The release listing was too large.')
      return response.data ? JSON.parse(response.data) : null
    }
    if (response.data != null && JSON.stringify(response.data).length > MAX_RELEASE_JSON_CHARS) {
      throw new Error('The release listing was too large.')
    }
    return response.data ?? null
  }
}

export type AndroidHomeV2UpdateHost = {
  readonly check: typeof checkAppUpdates
  readonly client: Window['qortiumHome']['updates']
  readonly loadPreferences: () => Promise<string | null>
  readonly savePreferences: (value: string) => Promise<void>
}

export function createAndroidHomeV2UpdateHost(): AndroidHomeV2UpdateHost | null {
  const client = window.qortiumHome?.updates
  const fetchJson = createAndroidGithubJsonFetcher()
  return client ? {
    check: (environment, channel) => checkAppUpdates(environment, channel, { fetchJson }),
    client,
    loadPreferences: async () => (
      await Preferences.get({ key: HOME_V2_APP_UPDATE_PREFERENCES_KEY })
    ).value,
    savePreferences: async (value) => {
      await Preferences.set({ key: HOME_V2_APP_UPDATE_PREFERENCES_KEY, value })
    },
  } : null
}
