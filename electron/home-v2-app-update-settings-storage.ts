import { app } from 'electron'
import path from 'node:path'
import type { StoredHomeV2AppUpdateSettings } from './home-v2-app-update-settings-codec.js'
import { createHomeV2AppUpdateSettingsFile } from './home-v2-app-update-settings-file.js'

const SETTINGS_FILE = 'home-v2-app-update-settings.json'
const settingsFile = createHomeV2AppUpdateSettingsFile(
  () => path.join(app.getPath('userData'), SETTINGS_FILE),
)

export async function readHomeV2AppUpdateSettings() {
  return settingsFile.read()
}

export async function writeHomeV2AppUpdateSettings(
  expectedGeneration: number,
  next: Omit<StoredHomeV2AppUpdateSettings, 'generation'>,
) {
  return settingsFile.write(expectedGeneration, next)
}
