import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.qortium.home',
  appName: 'Qortium Home',
  webDir: 'dist',
  // Capacitor's debug logger prints complete plugin request and response
  // objects, including large public JSON and base64 bodies. Home v2 keeps
  // WebView debugging available for deliberate inspection without emitting
  // those payloads to the device log.
  loggingBehavior: 'none',
  backgroundColor: '#0e1312',
  android: {
    allowMixedContent: true,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    // Android 15+ enforces edge-to-edge: the WebView draws under the status bar,
    // camera cutout and navigation bar. @capacitor-community/safe-area owns inset
    // handling and feeds real env(safe-area-inset-*) values to the renderer, which
    // our CSS already consumes. SystemBars.insetsHandling:'disable' stops
    // @capacitor/core's built-in inset handling from also padding the WebView
    // (which would double-inset).
    SystemBars: {
      insetsHandling: 'disable',
    },
    SafeArea: {
      // Plugin enum is counter-intuitive: 'DARK' = light (white) system-bar
      // icons for a dark background, which is what our #0e1312 app needs.
      statusBarStyle: 'DARK',
      navigationBarStyle: 'DARK',
      detectViewportFitCoverChanges: true,
      initialViewportFitCover: true,
    },
  },
};

export default config;
