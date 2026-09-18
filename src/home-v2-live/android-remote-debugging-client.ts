import { Capacitor, registerPlugin } from '@capacitor/core'
import {
  createHomeV2RemoteDebuggingClient,
  type HomeV2RemoteDebuggingAdapter,
  type HomeV2RemoteDebuggingClient,
} from './remote-debugging-client'

// android/.../RemoteDebuggingPlugin.java. The plugin persists the switch in
// its own preference file and applies WebView.setWebContentsDebuggingEnabled
// both on each change and again at startup, before the WebView loads.
const RemoteDebugging = registerPlugin<HomeV2RemoteDebuggingAdapter>('RemoteDebugging')

/**
 * The client for this host, or null anywhere but Capacitor on Android (desktop
 * has real developer tools; the browser preview has no host to ask).
 */
export function resolveHomeV2RemoteDebuggingClient(): HomeV2RemoteDebuggingClient | null {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return null
  }
  return createHomeV2RemoteDebuggingClient(RemoteDebugging)
}
