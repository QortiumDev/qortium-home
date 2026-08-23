import { app, BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  validateBookmarkManagerSnapshot,
  type BookmarkManagerMutationRequest,
  type BookmarkManagerMutationResult,
  type BookmarkManagerSnapshot,
} from './bookmark-manager-contract.js'
import { assertAuthorizedHomeV2Sender } from './home-v2-authorized-senders.js'
import { readHomeV2LegacyCollections } from './home-v2-legacy-collections.js'
import type { QdnViewContext } from './qdn-views.js'

const REQUEST_TIMEOUT_MS = 60_000
const pendingRequests = new Map<string, {
  operation: 'apply' | 'get'
  reject(error: Error): void
  resolve(result: BookmarkManagerMutationResult | BookmarkManagerSnapshot): void
  windowWebContentsId: number
}>()

function getHostWindow(context: QdnViewContext) {
  return BrowserWindow.getAllWindows().find((candidate) =>
    !candidate.isDestroyed() && candidate.webContents.id === context.windowId) ?? null
}

export function openHomeV2CollectionAddress(
  context: QdnViewContext,
  request: { accountId: string | null; address: string },
) {
  const hostWindow = getHostWindow(context)
  if (!hostWindow) throw new Error('Bookmark manager open request does not belong to an active window.')
  hostWindow.webContents.send('qdn-app:bookmarks-open', {
    ...request,
    accountId: request.accountId ?? context.accountId,
    sourceTabId: context.tabId,
  })
}

export function requestHomeV2Collections(
  context: QdnViewContext,
  operation: 'apply' | 'get',
  request?: BookmarkManagerMutationRequest,
) {
  const hostWindow = getHostWindow(context)
  if (!hostWindow) throw new Error('Bookmark manager request does not belong to an active window.')
  const requestId = randomUUID()
  return new Promise<BookmarkManagerMutationResult | BookmarkManagerSnapshot>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      settle(() => reject(new Error('Bookmark manager request timed out.')))
    }, REQUEST_TIMEOUT_MS)
    const settle = <T,>(callback: () => T) => {
      if (settled) return undefined
      settled = true
      clearTimeout(timeout)
      hostWindow.removeListener('closed', handleClosed)
      pendingRequests.delete(requestId)
      return callback()
    }
    const handleClosed = () => settle(() => reject(new Error('Bookmark manager request was cancelled.')))
    pendingRequests.set(requestId, {
      operation,
      reject: (error) => settle(() => reject(error)),
      resolve: (result) => settle(() => resolve(result)),
      windowWebContentsId: hostWindow.webContents.id,
    })
    hostWindow.once('closed', handleClosed)
    try {
      hostWindow.webContents.send('qdn-app:bookmark-manager-request', {
        accountId: context.accountId,
        id: requestId,
        operation,
        request: request ?? null,
      })
    } catch (error) {
      settle(() => reject(error instanceof Error ? error : new Error('Bookmark manager request failed.')))
    }
  })
}

export function registerHomeV2CollectionsBridgeIpcHandlers() {
  ipcMain.handle('home-v2-collections:read-legacy', async (event) => {
    assertAuthorizedHomeV2Sender(event)
    return readHomeV2LegacyCollections(path.join(app.getAppPath(), 'dist'))
  })
  ipcMain.handle('qdn-app:resolveBookmarkManagerRequest', (event, response: unknown) => {
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      throw new Error('QDN bookmark manager response is required.')
    }
    const value = response as Record<string, unknown>
    if (typeof value.requestId !== 'string' || !value.requestId) {
      throw new Error('QDN bookmark manager response is required.')
    }
    const pending = pendingRequests.get(value.requestId)
    if (!pending) return
    if (pending.windowWebContentsId !== event.sender.id) {
      throw new Error('QDN bookmark manager response came from the wrong window.')
    }
    if (typeof value.error === 'string' && value.error.trim()) {
      const error = Object.assign(new Error(value.error.trim()), {
        code: typeof value.code === 'string' && value.code ? value.code : 'HOME_DATA_ERROR',
      })
      pending.reject(error)
      return
    }
    try {
      if (pending.operation === 'get') {
        pending.resolve(validateBookmarkManagerSnapshot(value.result))
      } else {
        const result = value.result
        if (!result || typeof result !== 'object' || Array.isArray(result) ||
            typeof (result as Record<string, unknown>).changed !== 'boolean') {
          throw new Error('Bookmark manager mutation result is invalid.')
        }
        pending.resolve({
          changed: (result as Record<string, unknown>).changed as boolean,
          snapshot: validateBookmarkManagerSnapshot((result as Record<string, unknown>).snapshot),
        })
      }
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error('Invalid bookmark manager response.'))
    }
  })
}
