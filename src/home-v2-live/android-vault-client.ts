import { Capacitor } from '@capacitor/core'
import { createAndroidHomeV2VaultClient as createPlatformVaultClient } from '../platform'

export function createAndroidHomeV2VaultClient() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    throw new Error('The Android account adapter requires Capacitor on Android.')
  }
  return createPlatformVaultClient()
}
