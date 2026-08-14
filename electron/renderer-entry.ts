import { app } from 'electron'

// Home 2.0 cannot be exercised through `npm run dev`. Its shell session cancels
// every http and https request (see createWindow in main.ts), which blocks the
// Vite dev server's own renderer, so an unpackaged run has historically had no
// way to display anything. That left packaging as the only route to manual
// verification or to a desktop smoke test, at several minutes per attempt.
//
// QORTIUM_HOME_LOAD_DIST=1 makes an unpackaged run load the built files from
// dist/ exactly as a packaged run does. `npm run build` followed by an Electron
// launch with this set behaves like the shipped app while still allowing
// --inspect-brk, which packaged builds disable through the
// enableNodeCliInspectArguments fuse.
export function shouldLoadRendererFromDist(): boolean {
  return app.isPackaged || process.env.QORTIUM_HOME_LOAD_DIST === '1'
}
