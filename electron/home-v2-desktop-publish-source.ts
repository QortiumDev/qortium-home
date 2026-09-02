import { app, BrowserWindow, dialog } from 'electron'

import {
  HOME_V2_PUBLISH_DIRECTORY_LIMITS,
  describeHomeV2PublishSourcePath,
  homeV2DesktopPublishSources,
  homeV2PublishSourceDialogProperties,
  type HomeV2PublishSourceLimits,
  type HomeV2PublishSourcePickKind,
} from './home-v2-publish-source-selection.js'
import type { HomeV2PublishSourceBinding } from './home-v2-publish-source-tokens.js'

/**
 * The path a smoke run picks instead of opening the native dialog, or null.
 *
 * A native file dialog cannot be driven over CDP, so the publish-source smokes
 * would otherwise be unable to exercise anything past the picker. Mirrors the
 * 1.x hook exactly (isQdnWriteSmokeMode in electron/qdn.ts): a DEVELOPMENT
 * build plus an explicit opt-in env var, so a shipped Home can never take this
 * branch however its environment is set. Everything after the picker -- the
 * path rules, the size caps, the token binding -- is unchanged, so the smoke
 * exercises the real flow and not a bypass of it.
 */
function homeV2PublishSourceSmokePath(): string | null {
  if (app.isPackaged || process.env.QORTIUM_HOME_V2_PUBLISH_SOURCE_SMOKE !== '1') return null
  const smokePath = process.env.QORTIUM_HOME_V2_PUBLISH_SOURCE_SMOKE_PATH?.trim()
  if (!smokePath) {
    throw new Error('The publish-source smoke path was not set.')
  }
  return smokePath
}

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
  // The ceilings the picked path is measured against. The caller supplies
  // them because the FILE ceiling is discovered from the connected node
  // (GET /arbitrary/limits, clamped by Home) rather than fixed, and this
  // module deliberately knows nothing about nodes.
  limits: HomeV2PublishSourceLimits = HOME_V2_PUBLISH_DIRECTORY_LIMITS,
) {
  const hostWindow = BrowserWindow.fromId(windowId)
  if (!hostWindow || hostWindow.isDestroyed()) {
    throw new Error('Publish source selection does not belong to an active Home window.')
  }
  const smokePath = homeV2PublishSourceSmokePath()
  if (smokePath) {
    const source = await describeHomeV2PublishSourcePath(smokePath, kind, limits)
    return {
      canceled: false as const,
      fileName: source.fileName,
      kind: source.kind,
      mimeType: source.mimeType,
      size: source.size,
      sourceToken: homeV2DesktopPublishSources.issue(binding, source),
    }
  }
  const result = await dialog.showOpenDialog(hostWindow, {
    buttonLabel: 'Select',
    properties: homeV2PublishSourceDialogProperties(kind),
    title: `Select ${binding.network === 'qortal' ? 'Qortal' : 'Qortium'} publish source`,
  })
  if (result.canceled || !result.filePaths[0]) return { canceled: true as const }
  const source = await describeHomeV2PublishSourcePath(result.filePaths[0], kind, limits)
  return {
    canceled: false as const,
    fileName: source.fileName,
    kind: source.kind,
    mimeType: source.mimeType,
    size: source.size,
    sourceToken: homeV2DesktopPublishSources.issue(binding, source),
  }
}
