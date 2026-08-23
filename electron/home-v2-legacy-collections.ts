import { BrowserWindow, session } from 'electron'
import path from 'node:path'
import {
  validateBookmarkManagerSnapshot,
  type BookmarkManagerSnapshot,
} from './bookmark-manager-contract.js'

export type HomeV2LegacyCollectionsResult = {
  hadData: boolean
  snapshot: BookmarkManagerSnapshot
}

let readPromise: Promise<HomeV2LegacyCollectionsResult> | null = null

export function readHomeV2LegacyCollections(distDirectory: string) {
  if (readPromise) return readPromise
  readPromise = readOnce(distDirectory).catch((error) => {
    readPromise = null
    throw error
  })
  return readPromise
}

async function readOnce(distDirectory: string): Promise<HomeV2LegacyCollectionsResult> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: session.defaultSession,
      webviewTag: false,
    },
  })
  window.setMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  try {
    await window.loadFile(path.join(distDirectory, 'collections-migration.html'))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('will-redirect', (event) => event.preventDefault())
    const value = await window.webContents.executeJavaScript(
      'window.__QORTIUM_HOME_LEGACY_COLLECTIONS__',
      true,
    ) as unknown
    if (!value || typeof value !== 'object' || !('hadData' in value) || !('snapshot' in value)) {
      throw new Error('Legacy collections migration returned an invalid response.')
    }
    return {
      hadData: value.hadData === true,
      snapshot: validateBookmarkManagerSnapshot(value.snapshot),
    }
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}
