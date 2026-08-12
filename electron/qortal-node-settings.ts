import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  isNodeApiKeyTransportSafe,
  normalizeNodeApiUrl,
} from './node-api-url.js'
import { ensureNodeCa, nodeFetch } from './node-tls.js'
import { assertShellWindowSender } from './shell-window-sender.js'
import {
  isFullySyncedQortalStatus,
  parseQortalNodeSettings,
  QORTAL_PUBLIC_NODE_API_URLS,
  resolveQortalNodePolicy,
  selectQortalPublicNode,
  type QortalNodeProbeResult as ProbeResult,
  type QortalNodeSettings,
  type QortalNodeSettingsMode,
} from './qortal-node-policy.js'

export type { QortalNodeSettings, QortalNodeSettingsMode } from './qortal-node-policy.js'

const DEFAULT_LOCAL_URL = 'https://127.0.0.1:12391'
const PUBLIC_READ_PROBE_PATH =
  '/arbitrary/resources/search?mode=ALL&limit=1&includestatus=false&includemetadata=false'
const SETTINGS_FILE = 'qortal-node-settings.json'
const PROBE_TIMEOUT_MS = 5_000
const IPC_REFUSAL = 'Qortal node settings are only available to a Home window.'

type QortalNodeSettingsRequest = {
  customUrl?: unknown
  mode?: unknown
}

export interface QortalNodeConnection {
  mode: Exclude<QortalNodeSettingsMode, 'disabled'>
  nodeApiUrl: string
}

export type QortalNodeStatusResult =
  | {
      disabled: true
      mode: 'disabled'
      nodeApiUrl: null
      ok: false
      message: string
    }
  | {
      disabled: false
      mode: Exclude<QortalNodeSettingsMode, 'disabled'>
      nodeApiUrl: string
      ok: true
      status: unknown
    }
  | {
      disabled: false
      mode: Exclude<QortalNodeSettingsMode, 'disabled'>
      nodeApiUrl: string | null
      ok: false
      message: string
    }

let selectedPublicNodeUrl: string | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE)
}

function getLocalUrl() {
  try {
    return normalizeNodeApiUrl(
      process.env.QORTIUM_HOME_QORTAL_NODE_API_URL ?? DEFAULT_LOCAL_URL,
    )
  } catch {
    return DEFAULT_LOCAL_URL
  }
}

function getDefaultSettings(): QortalNodeSettings {
  return { customUrl: '', mode: 'local' }
}

function normalizeRequest(value: QortalNodeSettingsRequest): QortalNodeSettings {
  if (!isRecord(value)) throw new Error('Qortal node settings are required.')
  const mode = value.mode
  if (
    mode !== 'disabled' &&
    mode !== 'local' &&
    mode !== 'public' &&
    mode !== 'custom'
  ) {
    throw new Error('Choose Disabled, Local, Public, or Custom.')
  }
  const customValue = getString(value.customUrl)
  const customUrl = customValue ? normalizeNodeApiUrl(customValue) : ''
  if (mode === 'custom' && !customUrl) {
    throw new Error('Custom Qortal node URL is required.')
  }
  return { customUrl, mode }
}

function readSettings(): QortalNodeSettings {
  try {
    return parseQortalNodeSettings(
      JSON.parse(readFileSync(getSettingsPath(), 'utf8')) as unknown,
    )
  } catch {
    return getDefaultSettings()
  }
}

function writeSettings(settings: QortalNodeSettings) {
  const settingsPath = getSettingsPath()
  mkdirSync(path.dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  selectedPublicNodeUrl = null
}

async function fetchWithTimeout(url: string) {
  return nodeFetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
}

async function readStatus(nodeApiUrl: string) {
  await ensureNodeCa(nodeApiUrl, null)
  const response = await fetchWithTimeout(`${nodeApiUrl}/admin/status`)
  if (!response.ok) throw new Error(`Qortal status returned HTTP ${response.status}.`)
  return response.json() as Promise<unknown>
}

async function probePublicNode(url: string): Promise<ProbeResult | null> {
  const startedAt = Date.now()
  try {
    const status = await readStatus(url)
    const latencyMs = Date.now() - startedAt
    const readResponse = await fetchWithTimeout(`${url}${PUBLIC_READ_PROBE_PATH}`)
    return {
      isSynced: isFullySyncedQortalStatus(status),
      latencyMs,
      status,
      supportsPublicReads: readResponse.ok,
      url,
    }
  } catch {
    return null
  }
}

async function discoverPublicNode(forceRefresh = false) {
  if (!forceRefresh && selectedPublicNodeUrl) {
    const selected = await probePublicNode(selectedPublicNodeUrl)
    if (selected?.isSynced && selected.supportsPublicReads) {
      return selected.url
    }
    selectedPublicNodeUrl = null
  }
  const selected = await selectQortalPublicNode(
    QORTAL_PUBLIC_NODE_API_URLS,
    probePublicNode,
  )
  if (!selected) throw new Error('No reachable synchronized public Qortal node was found.')
  selectedPublicNodeUrl = selected.url
  return selected.url
}

export async function resolveQortalNodeForSettings(
  settings: QortalNodeSettings,
  forcePublicRefresh = false,
): Promise<QortalNodeConnection> {
  return resolveQortalNodePolicy(settings, {
    localUrl: getLocalUrl(),
    resolvePublic: () => discoverPublicNode(forcePublicRefresh),
  })
}

export async function getQortalNodeConnection(forcePublicRefresh = false) {
  return resolveQortalNodeForSettings(readSettings(), forcePublicRefresh)
}

export function invalidateQortalPublicNode(nodeApiUrl?: string) {
  if (!nodeApiUrl || selectedPublicNodeUrl === nodeApiUrl) {
    selectedPublicNodeUrl = null
  }
}

async function testSettings(
  settings: QortalNodeSettings,
): Promise<QortalNodeStatusResult> {
  if (settings.mode === 'disabled') {
    return {
      disabled: true,
      mode: 'disabled',
      nodeApiUrl: null,
      ok: false,
      message: 'Qortal access is disabled.',
    }
  }
  let connection: QortalNodeConnection | null = null
  try {
    connection = await resolveQortalNodeForSettings(settings)
    return {
      disabled: false,
      mode: connection.mode,
      nodeApiUrl: connection.nodeApiUrl,
      ok: true,
      status: await readStatus(connection.nodeApiUrl),
    }
  } catch (error) {
    return {
      disabled: false,
      mode: settings.mode,
      nodeApiUrl: connection?.nodeApiUrl ?? null,
      ok: false,
      message:
        error instanceof Error ? error.message : 'Unable to reach the Qortal node.',
    }
  }
}

async function getSettingsSnapshot(settings = readSettings()) {
  let nodeApiUrl: string | null = null
  let resolutionError: string | null = null
  if (settings.mode !== 'disabled') {
    try {
      nodeApiUrl = (await resolveQortalNodeForSettings(settings)).nodeApiUrl
    } catch (error) {
      resolutionError = error instanceof Error ? error.message : 'Unable to resolve the Qortal node.'
    }
  }
  return {
    ...settings,
    localUrl: getLocalUrl(),
    publicUrls: [...QORTAL_PUBLIC_NODE_API_URLS],
    nodeApiUrl,
    resolutionError,
  }
}

export async function getQortalNodeSettingsForHomeV2() {
  return getSettingsSnapshot()
}

export async function getQortalNodeStatusForHomeV2() {
  return testSettings(readSettings())
}

export async function getQortalLocalNodeStatusForHomeV2() {
  return testSettings({ customUrl: '', mode: 'local' })
}

export async function saveQortalNodeModeForHomeV2(
  mode: QortalNodeSettingsMode,
) {
  const current = readSettings()
  const settings = normalizeRequest({
    customUrl: current.customUrl,
    mode,
  })
  writeSettings(settings)
  return getSettingsSnapshot(settings)
}

export async function saveQortalCustomUrlForHomeV2(customUrl: string) {
  const normalizedUrl = normalizeNodeApiUrl(customUrl)
  if (!isNodeApiKeyTransportSafe(normalizedUrl)) {
    throw new Error('Remote custom nodes must use HTTPS.')
  }
  const settings = normalizeRequest({ customUrl: normalizedUrl, mode: 'custom' })
  writeSettings(settings)
  return getSettingsSnapshot(settings)
}

export function registerQortalNodeSettingsIpcHandlers() {
  ipcMain.handle('qortal-node:hasStoredSettings', (event) => {
    assertShellWindowSender(event.sender, IPC_REFUSAL)
    return existsSync(getSettingsPath())
  })
  ipcMain.handle('qortal-node:getSettings', (event) => {
    assertShellWindowSender(event.sender, IPC_REFUSAL)
    return getSettingsSnapshot()
  })
  ipcMain.handle('qortal-node:saveSettings', (event, request: QortalNodeSettingsRequest) => {
    assertShellWindowSender(event.sender, IPC_REFUSAL)
    const settings = normalizeRequest(request)
    writeSettings(settings)
    return getSettingsSnapshot(settings)
  })
  ipcMain.handle('qortal-node:testConnection', (event, request: QortalNodeSettingsRequest) => {
    assertShellWindowSender(event.sender, IPC_REFUSAL)
    return testSettings(normalizeRequest(request))
  })
  ipcMain.handle('qortal-node:getStatus', (event) => {
    assertShellWindowSender(event.sender, IPC_REFUSAL)
    return testSettings(readSettings())
  })
}
