import { ipcMain, type WebContents } from 'electron'
import {
  getNodeSettingsForHomeV2,
  getNodeStatusForHomeV2,
  saveNodeModeForHomeV2,
} from './node-settings.js'
import {
  getQortalNodeSettingsForHomeV2,
  getQortalNodeStatusForHomeV2,
  saveQortalNodeModeForHomeV2,
} from './qortal-node-settings.js'

type NetworkId = 'qortal' | 'qortium'
type NodeMode = 'custom' | 'disabled' | 'local' | 'public'

const authorizedSenderIds = new Set<number>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringField(value: unknown, key: string) {
  if (!isRecord(value)) return null
  const field = value[key]
  return typeof field === 'string' && field.trim() ? field.trim() : null
}

function numberField(value: unknown, key: string) {
  if (!isRecord(value)) return null
  const field = value[key]
  return typeof field === 'number' && Number.isFinite(field) ? field : null
}

function booleanField(value: unknown, key: string) {
  return isRecord(value) && value[key] === true
}

function assertAuthorized(sender: WebContents) {
  if (!authorizedSenderIds.has(sender.id)) {
    throw new Error('Home v2 node data is only available to an authorized Home v2 window.')
  }
}

function normalizeMode(value: unknown): NodeMode {
  if (
    value !== 'custom' &&
    value !== 'disabled' &&
    value !== 'local' &&
    value !== 'public'
  ) {
    throw new Error('Choose Disabled, Local, Public, or Custom.')
  }
  return value
}

function normalizeNetwork(value: unknown): NetworkId {
  if (value !== 'qortal' && value !== 'qortium') {
    throw new Error('Choose Qortal or Qortium.')
  }
  return value
}

function getNodeState(status: unknown) {
  const syncPhase = stringField(status, 'syncPhase')?.toUpperCase() ?? null
  const syncPercent = numberField(status, 'syncPercent')
  const isSynchronizing = booleanField(status, 'isSynchronizing')
  if (
    isSynchronizing ||
    (syncPhase && syncPhase !== 'SYNCED') ||
    (syncPercent !== null && syncPercent < 100)
  ) {
    return 'syncing' as const
  }
  return 'online' as const
}

function modeLabel(mode: NodeMode) {
  return mode[0].toUpperCase() + mode.slice(1)
}

function endpointHost(nodeApiUrl: string) {
  try {
    return new URL(nodeApiUrl).host
  } catch {
    return nodeApiUrl
  }
}

function normalizeNodeSummary(
  network: NetworkId,
  rawSettings: unknown,
  rawStatus: unknown,
) {
  const settings = isRecord(rawSettings) ? rawSettings : {}
  const internalMode = stringField(settings, 'mode')
  const mode: NodeMode =
    internalMode === 'network'
      ? 'public'
      : internalMode === 'custom' ||
          internalMode === 'disabled' ||
          internalMode === 'public'
        ? internalMode
        : 'local'
  const statusResult = isRecord(rawStatus) ? rawStatus : {}
  const ok = statusResult.ok === true
  const disabled = mode === 'disabled' || statusResult.disabled === true
  const status = ok ? statusResult.status : null
  const nodeApiUrl =
    stringField(statusResult, 'nodeApiUrl') ??
    stringField(settings, 'nodeApiUrl')
  const error = disabled
    ? null
    : ok
      ? null
      : stringField(statusResult, 'message') ??
        stringField(settings, 'resolutionError') ??
        `Unable to reach the ${network === 'qortal' ? 'Qortal' : 'Qortium'} node.`
  const state = disabled ? 'offline' : ok ? getNodeState(status) : 'offline'
  const syncPercent = numberField(status, 'syncPercent')
  const statusText = disabled
    ? 'Disabled'
    : !ok
      ? mode === 'local'
        ? 'Not running'
        : 'Unavailable'
      : state === 'syncing'
        ? syncPercent === null
          ? 'Syncing'
          : `Syncing ${Math.round(syncPercent)}%`
        : 'Online'

  return {
    ref: `home-v2:node:${network}`,
    network,
    label:
      mode === 'public' && nodeApiUrl
        ? endpointHost(nodeApiUrl)
        : nodeApiUrl ?? `${modeLabel(mode)} node`,
    mode,
    state,
    statusText,
    isTrusted: mode === 'local',
    customConfigured: !!stringField(settings, 'customUrl'),
    nodeApiUrl: disabled ? null : nodeApiUrl,
    height: numberField(status, 'height'),
    peerCount:
      numberField(status, 'numberOfConnections') ??
      numberField(status, 'peerCount'),
    syncPercent,
    syncPhase: stringField(status, 'syncPhase'),
    lastCheckedAt: Date.now(),
    error,
    capabilities: {
      admin: false,
      read: ok,
      write: false,
    },
  }
}

async function getSnapshot() {
  const [qortalSettings, qortalStatus, qortiumSettings, qortiumStatus] =
    await Promise.all([
      getQortalNodeSettingsForHomeV2().catch((error: unknown) => ({
        mode: 'local',
        resolutionError: error instanceof Error ? error.message : 'Unable to read Qortal node settings.',
      })),
      getQortalNodeStatusForHomeV2().catch((error: unknown) => ({
        ok: false,
        message: error instanceof Error ? error.message : 'Unable to read Qortal node status.',
      })),
      getNodeSettingsForHomeV2().catch((error: unknown) => ({
        mode: 'local',
        resolutionError: error instanceof Error ? error.message : 'Unable to read Qortium node settings.',
      })),
      getNodeStatusForHomeV2().catch((error: unknown) => ({
        ok: false,
        message: error instanceof Error ? error.message : 'Unable to read Qortium node status.',
      })),
    ])

  return {
    version: 1,
    nodes: {
      qortal: normalizeNodeSummary('qortal', qortalSettings, qortalStatus),
      qortium: normalizeNodeSummary('qortium', qortiumSettings, qortiumStatus),
    },
  }
}

export function authorizeHomeV2NodeBridge(sender: WebContents) {
  authorizedSenderIds.add(sender.id)
  sender.once('destroyed', () => authorizedSenderIds.delete(sender.id))
}

export function registerHomeV2NodeBridgeIpcHandlers() {
  ipcMain.handle('home-v2-nodes:getSnapshot', (event) => {
    assertAuthorized(event.sender)
    return getSnapshot()
  })
  ipcMain.handle(
    'home-v2-nodes:setMode',
    async (event, networkValue: unknown, modeValue: unknown) => {
      assertAuthorized(event.sender)
      const network = normalizeNetwork(networkValue)
      const mode = normalizeMode(modeValue)
      if (network === 'qortal') {
        await saveQortalNodeModeForHomeV2(mode)
      } else {
        await saveNodeModeForHomeV2(mode)
      }
      return getSnapshot()
    },
  )
}
