import { BrowserWindow, dialog } from 'electron'

import {
  describeHomeV2PublishSourcePath,
  homeV2DesktopPublishSources,
  homeV2PublishSourceDialogProperties,
  type HomeV2PublishSourcePickKind,
} from './home-v2-publish-source-selection.js'
import type { HomeV2PublishSourceBinding } from './home-v2-publish-source-tokens.js'

/**
 * The desktop picker. Everything it decides about the picked path — what a
 * source may be, how big it may get, what a folder must contain — lives in
 * home-v2-publish-source-selection.ts, which imports no electron and is
 * therefore testable under plain node.
 */
export async function selectHomeV2DesktopPublishSource(
  windowId: number,
  binding: HomeV2PublishSourceBinding,
  // Defaults to 'file' so the publish and chat-attachment flows are unchanged:
  // only PREVIEW's caller asks for a folder, and only because it asks.
  kind: HomeV2PublishSourcePickKind = 'file',
) {
  const hostWindow = BrowserWindow.fromId(windowId)
  if (!hostWindow || hostWindow.isDestroyed()) {
    throw new Error('Publish source selection does not belong to an active Home window.')
  }
  const result = await dialog.showOpenDialog(hostWindow, {
    buttonLabel: 'Select',
    properties: homeV2PublishSourceDialogProperties(kind),
    title: `Select ${binding.network === 'qortal' ? 'Qortal' : 'Qortium'} publish source`,
  })
  if (result.canceled || !result.filePaths[0]) return { canceled: true as const }
  const source = await describeHomeV2PublishSourcePath(result.filePaths[0], kind)
  return {
    canceled: false as const,
    fileName: source.fileName,
    kind: source.kind,
    mimeType: source.mimeType,
    size: source.size,
    sourceToken: homeV2DesktopPublishSources.issue(binding, source),
  }
}
