import { checkAppUpdates } from './appUpdates'
import { Preferences } from '@capacitor/preferences'
import { HOME_V2_APP_UPDATE_PREFERENCES_KEY } from './home-v2-live/app-update-preferences'

export type AndroidHomeV2UpdateHost = {
  readonly check: typeof checkAppUpdates
  readonly client: Window['qortiumHome']['updates']
  readonly loadPreferences: () => Promise<string | null>
  readonly savePreferences: (value: string) => Promise<void>
}

export function createAndroidHomeV2UpdateHost(): AndroidHomeV2UpdateHost | null {
  const client = window.qortiumHome?.updates
  return client ? {
    check: checkAppUpdates,
    client,
    loadPreferences: async () => (
      await Preferences.get({ key: HOME_V2_APP_UPDATE_PREFERENCES_KEY })
    ).value,
    savePreferences: async (value) => {
      await Preferences.set({ key: HOME_V2_APP_UPDATE_PREFERENCES_KEY, value })
    },
  } : null
}
