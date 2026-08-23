import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { assertAuthorizedHomeV2Sender } from './home-v2-authorized-senders.js'
import { readHomeV2DesktopResourceStreamBytes } from './home-v2-desktop-resource-stream.js'

const RETAINED_VIEWER_MAX_BYTES = 100 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function suggestedFilename(value: unknown) {
  if (typeof value !== 'string') return 'qdn-resource'
  const leaf = value.split(/[\\/]/).pop()?.trim() ?? ''
  const safe = leaf
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 180)
  return safe || 'qdn-resource'
}

async function chooseAndWriteFile(
  event: Electron.IpcMainInvokeEvent,
  filename: unknown,
  bytes: Uint8Array,
) {
  const file = suggestedFilename(filename)
  const owner = BrowserWindow.fromWebContents(event.sender)
  const selection = owner
    ? await dialog.showSaveDialog(owner, { defaultPath: file })
    : await dialog.showSaveDialog({ defaultPath: file })
  if (selection.canceled || !selection.filePath) return { canceled: true }
  await writeFile(selection.filePath, bytes, { mode: 0o600 })
  return { canceled: false }
}

export function registerHomeV2RetainedViewerBridgeIpcHandlers() {
  ipcMain.handle('home-v2-retained-viewer:readBytes', async (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    if (
      !isRecord(value) ||
      value.maxBytes !== RETAINED_VIEWER_MAX_BYTES ||
      typeof value.url !== 'string' ||
      value.url.length > 512
    ) {
      throw new Error('Retained viewer request is invalid.')
    }
    return readHomeV2DesktopResourceStreamBytes({
      maxBytes: RETAINED_VIEWER_MAX_BYTES,
      targetSession: event.sender.session,
      url: value.url,
    })
  })
  ipcMain.handle('home-v2-retained-viewer:save', async (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    if (!isRecord(value) || typeof value.url !== 'string' || value.url.length > 512) {
      throw new Error('Retained viewer save request is invalid.')
    }
    const result = await readHomeV2DesktopResourceStreamBytes({
      maxBytes: RETAINED_VIEWER_MAX_BYTES,
      targetSession: event.sender.session,
      url: value.url,
    })
    return chooseAndWriteFile(event, value.filename, result.bytes)
  })
  ipcMain.handle('home-v2-retained-viewer:saveBytes', async (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    if (
      !isRecord(value) ||
      !(value.bytes instanceof Uint8Array) ||
      value.bytes.byteLength > RETAINED_VIEWER_MAX_BYTES ||
      typeof value.mimeType !== 'string' ||
      value.mimeType.length > 256
    ) {
      throw new Error('Retained viewer byte-save request is invalid.')
    }
    return chooseAndWriteFile(event, value.filename, value.bytes)
  })
}
