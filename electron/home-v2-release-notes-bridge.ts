import { ipcMain } from 'electron'
import { openExternalUrl } from './app-updates.js'
import { assertAuthorizedHomeV2Sender } from './home-v2-authorized-senders.js'
import {
  createAuthorizedHomeV2ReleaseNotesHandlers,
  createHomeV2ReleaseNotesService,
} from './home-v2-release-notes-contract.js'
import { fetchHomeV2ReleaseNotes } from './home-v2-release-notes-discovery.js'

export function registerHomeV2ReleaseNotesBridgeIpcHandlers() {
  const handlers = createAuthorizedHomeV2ReleaseNotesHandlers(
    assertAuthorizedHomeV2Sender,
    createHomeV2ReleaseNotesService({
      fetchNotes: fetchHomeV2ReleaseNotes,
      openExternal: openExternalUrl,
    }),
  )
  ipcMain.handle('home-v2-release-notes:load', handlers.load)
  ipcMain.handle('home-v2-release-notes:open-link', handlers.openLink)
}
