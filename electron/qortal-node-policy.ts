import { normalizeNodeApiUrl } from './node-api-url.js'

export type QortalNodeSettingsMode =
  | 'disabled'
  | 'local'
  | 'public'
  | 'custom'

export interface QortalNodeSettings {
  customUrl: string
  mode: QortalNodeSettingsMode
}

export interface QortalNodePolicyConnection {
  mode: Exclude<QortalNodeSettingsMode, 'disabled'>
  nodeApiUrl: string
}

export interface QortalNodeProbeResult {
  isSynced: boolean
  status: unknown
  supportsPublicReads: boolean
  url: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberField(status: unknown, key: string) {
  if (!isRecord(status)) return null
  const value = status[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringField(status: unknown, key: string) {
  if (!isRecord(status)) return ''
  const value = status[key]
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function booleanField(status: unknown, key: string) {
  return isRecord(status) && status[key] === true
}

export function parseQortalNodeSettings(value: unknown): QortalNodeSettings {
  if (!isRecord(value)) return { customUrl: '', mode: 'local' }
  const customValue = getString(value.customUrl)
  let customUrl = ''
  if (customValue) {
    try {
      customUrl = normalizeNodeApiUrl(customValue)
    } catch {
      customUrl = ''
    }
  }
  const mode = value.mode
  if (
    mode !== 'disabled' &&
    mode !== 'local' &&
    mode !== 'public' &&
    mode !== 'custom'
  ) {
    return { customUrl: '', mode: 'local' }
  }
  return { customUrl, mode }
}

export function isFullySyncedQortalStatus(status: unknown) {
  const syncPhase = stringField(status, 'syncPhase')
  const syncBlocksRemaining = numberField(status, 'syncBlocksRemaining')
  return (
    (numberField(status, 'height') ?? 0) > 0 &&
    numberField(status, 'syncPercent') === 100 &&
    !booleanField(status, 'isSynchronizing') &&
    (!syncPhase || syncPhase === 'SYNCED') &&
    (syncBlocksRemaining === null || syncBlocksRemaining === 0)
  )
}

export async function selectQortalPublicNode(
  publicUrls: readonly string[],
  probe: (url: string) => Promise<QortalNodeProbeResult | null>,
) {
  const results = await Promise.all(publicUrls.map((url) => probe(url)))
  const candidates = results.filter(
    (result): result is QortalNodeProbeResult =>
      !!result && result.isSynced && result.supportsPublicReads,
  )
  candidates.sort((left, right) => {
    const heightDifference =
      (numberField(right.status, 'height') ?? 0) -
      (numberField(left.status, 'height') ?? 0)
    if (heightDifference !== 0) return heightDifference
    return left.url.localeCompare(right.url)
  })
  return candidates[0] ?? null
}

export async function resolveQortalNodePolicy(
  settings: QortalNodeSettings,
  options: {
    localUrl: string
    resolvePublic: () => Promise<string>
  },
): Promise<QortalNodePolicyConnection> {
  if (settings.mode === 'disabled') {
    throw Object.assign(new Error('Qortal access is disabled.'), {
      code: 'NODE_DISABLED',
    })
  }
  if (settings.mode === 'local') {
    return { mode: 'local', nodeApiUrl: options.localUrl }
  }
  if (settings.mode === 'custom') {
    if (!settings.customUrl) {
      throw Object.assign(new Error('Custom Qortal node URL is required.'), {
        code: 'CUSTOM_URL_REQUIRED',
      })
    }
    return { mode: 'custom', nodeApiUrl: settings.customUrl }
  }
  return { mode: 'public', nodeApiUrl: await options.resolvePublic() }
}
