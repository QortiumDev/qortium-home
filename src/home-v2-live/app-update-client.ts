export type HomeV2AppUpdateChannel = 'prerelease' | 'stable'
export type HomeV2AppUpdateSettings = {
  readonly generation: number
  readonly homeUpdatePolicy: 'auto-download' | 'notify' | 'off'
  readonly releaseChannel: HomeV2AppUpdateChannel
  readonly revision: 1
  readonly schema: 'home-v2-app-update-settings'
}
export type HomeV2AppUpdateAutomaticClaim = Omit<HomeV2AppUpdateSettings, 'schema'> & {
  readonly claimed: boolean
  readonly schema: 'home-v2-app-update-automatic-claim'
}
export type HomeV2AppUpdateIssue =
  | 'download-failed'
  | 'download-not-found'
  | 'invalid-version'
  | 'no-compatible-asset'
  | 'operation-in-progress'
  | 'release-changed'
  | 'release-not-found'
  | 'release-unavailable'
  | 'settings-changed'
  | 'unsupported-platform'

export type HomeV2AppUpdateCheck = {
  readonly asset: null | {
    readonly digestAvailable: true
    readonly name: string
    readonly size: number
  }
  readonly channel: HomeV2AppUpdateChannel
  readonly checkedAt: string
  readonly currentVersion: string
  readonly issue: HomeV2AppUpdateIssue | null
  readonly platform: QortiumAppUpdatePlatform
  readonly release: null | {
    readonly name: string
    readonly publishedAt: string | null
    readonly tagName: string
  }
  readonly revision: 1
  readonly schema: 'home-v2-app-update-check'
  readonly state:
    | 'available'
    | 'no-compatible-asset'
    | 'not-found'
    | 'unavailable'
    | 'unsupported'
    | 'up-to-date'
}

export type HomeV2AppUpdateDownload = {
  readonly canOpen: boolean
  readonly canReveal: boolean
  readonly digestVerified: true
  readonly downloadId: string
  readonly fileName: string
  readonly releaseTag: string
  readonly size: number
}

export type HomeV2AppUpdateActionResult = {
  readonly code: HomeV2AppUpdateIssue | null
  readonly download: HomeV2AppUpdateDownload | null
  readonly outcome: 'blocked' | 'completed' | 'failed'
  readonly revision: 1
  readonly schema: 'home-v2-app-update-action'
}

export type HomeV2AppUpdateProgress = Readonly<{
  action: 'downloading' | 'verifying'
  fileName: string
  message: string
  /** null when the server sent no content-length. */
  percent: number | null
  receivedBytes: number
  releaseTag: string
  totalBytes: number | null
}>

/** Parsed, never trusted; a malformed event yields null and is dropped. */
export function parseHomeV2AppUpdateProgress(
  value: unknown,
): HomeV2AppUpdateProgress | null {
  if (!isRecord(value) ||
    !hasExactKeys(value, [
      'action', 'fileName', 'message', 'percent', 'receivedBytes',
      'releaseTag', 'revision', 'schema', 'totalBytes',
    ]) ||
    value.schema !== 'home-v2-app-update-progress' || value.revision !== 1 ||
    (value.action !== 'downloading' && value.action !== 'verifying') ||
    typeof value.fileName !== 'string' || value.fileName.length > 300 ||
    typeof value.message !== 'string' || value.message.length > 500 ||
    typeof value.releaseTag !== 'string' || value.releaseTag.length > 200 ||
    typeof value.receivedBytes !== 'number' || !Number.isFinite(value.receivedBytes) ||
    value.receivedBytes < 0 ||
    !(value.percent === null ||
      (typeof value.percent === 'number' && Number.isFinite(value.percent) &&
        value.percent >= 0 && value.percent <= 100)) ||
    !(value.totalBytes === null ||
      (typeof value.totalBytes === 'number' && Number.isFinite(value.totalBytes) &&
        value.totalBytes >= 0))) {
    return null
  }
  return Object.freeze({
    action: value.action,
    fileName: value.fileName,
    message: value.message,
    percent: value.percent as number | null,
    receivedBytes: value.receivedBytes,
    releaseTag: value.releaseTag,
    totalBytes: value.totalBytes as number | null,
  })
}

export interface HomeV2AppUpdateClient {
  /** Optional: absent on hosts without the Electron preload. */
  onDownloadProgress?(listener: (event: unknown) => void): () => void
  check(
    channel: HomeV2AppUpdateChannel,
    settingsGeneration?: number | null,
  ): Promise<unknown>
  claimAutomatic(): Promise<unknown>
  download(
    channel: HomeV2AppUpdateChannel,
    releaseTag: string,
    settingsGeneration?: number | null,
  ): Promise<unknown>
  getSettings(): Promise<unknown>
  open(downloadId: string): Promise<unknown>
  openReleasePage(channel: HomeV2AppUpdateChannel, releaseTag: string): Promise<unknown>
  reveal(downloadId: string): Promise<unknown>
  setSettings(
    expectedGeneration: number,
    settings: Pick<HomeV2AppUpdateSettings, 'homeUpdatePolicy' | 'releaseChannel'>,
  ): Promise<unknown>
}

export function parseHomeV2AppUpdateAutomaticClaim(
  value: unknown,
): HomeV2AppUpdateAutomaticClaim {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'claimed',
      'generation',
      'homeUpdatePolicy',
      'releaseChannel',
      'revision',
      'schema',
    ]) ||
    value.schema !== 'home-v2-app-update-automatic-claim' ||
    value.revision !== 1 ||
    typeof value.claimed !== 'boolean' ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 0 ||
    (value.homeUpdatePolicy !== 'off' &&
      value.homeUpdatePolicy !== 'notify' &&
      value.homeUpdatePolicy !== 'auto-download') ||
    (value.releaseChannel !== 'stable' && value.releaseChannel !== 'prerelease') ||
    (value.claimed && value.homeUpdatePolicy === 'off')
  ) throw new Error('The automatic Home update claim was malformed.')
  return {
    claimed: value.claimed,
    generation: value.generation as number,
    homeUpdatePolicy: value.homeUpdatePolicy,
    releaseChannel: value.releaseChannel,
    revision: 1,
    schema: 'home-v2-app-update-automatic-claim',
  }
}

const issues = new Set<HomeV2AppUpdateIssue>([
  'download-failed',
  'download-not-found',
  'invalid-version',
  'no-compatible-asset',
  'operation-in-progress',
  'release-changed',
  'release-not-found',
  'release-unavailable',
  'settings-changed',
  'unsupported-platform',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function string(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 500 ? value : null
}

function parseIssue(value: unknown) {
  return value === null || issues.has(value as HomeV2AppUpdateIssue)
    ? (value as HomeV2AppUpdateIssue | null)
    : undefined
}

export function parseHomeV2AppUpdateSettings(value: unknown): HomeV2AppUpdateSettings {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'generation',
      'homeUpdatePolicy',
      'releaseChannel',
      'revision',
      'schema',
    ]) ||
    value.schema !== 'home-v2-app-update-settings' ||
    value.revision !== 1 ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 0 ||
    (value.homeUpdatePolicy !== 'off' &&
      value.homeUpdatePolicy !== 'notify' &&
      value.homeUpdatePolicy !== 'auto-download') ||
    (value.releaseChannel !== 'stable' && value.releaseChannel !== 'prerelease')
  ) throw new Error('Home update settings were malformed.')
  return {
    generation: value.generation as number,
    homeUpdatePolicy: value.homeUpdatePolicy,
    releaseChannel: value.releaseChannel,
    revision: 1,
    schema: 'home-v2-app-update-settings',
  }
}

function parsePlatform(value: unknown): QortiumAppUpdatePlatform | null {
  if (!isRecord(value)) return null
  if (!hasExactKeys(
    value,
    value.osVersion === undefined
      ? ['arch', 'label', 'os', 'supported']
      : ['arch', 'label', 'os', 'osVersion', 'supported'],
  )) return null
  const os = value.os
  if (
    os !== 'android' &&
    os !== 'linux' &&
    os !== 'macos' &&
    os !== 'unsupported' &&
    os !== 'windows'
  ) return null
  if (
    !string(value.arch) ||
    !string(value.label) ||
    typeof value.supported !== 'boolean' ||
    (value.osVersion !== undefined && typeof value.osVersion !== 'string')
  ) return null
  return {
    arch: value.arch as string,
    label: value.label as string,
    os,
    ...(typeof value.osVersion === 'string' ? { osVersion: value.osVersion } : {}),
    supported: value.supported,
  }
}

export function parseHomeV2AppUpdateCheck(value: unknown): HomeV2AppUpdateCheck {
  if (!isRecord(value) || value.schema !== 'home-v2-app-update-check' || value.revision !== 1) {
    throw new Error('Home update status used an unsupported schema.')
  }
  if (!hasExactKeys(value, [
    'asset',
    'channel',
    'checkedAt',
    'currentVersion',
    'issue',
    'platform',
    'release',
    'revision',
    'schema',
    'state',
  ])) throw new Error('Home update status had unexpected fields.')
  const channel = value.channel
  const state = value.state
  const issue = parseIssue(value.issue)
  const platform = parsePlatform(value.platform)
  if (
    (channel !== 'stable' && channel !== 'prerelease') ||
    !['available', 'no-compatible-asset', 'not-found', 'unavailable', 'unsupported', 'up-to-date'].includes(String(state)) ||
    issue === undefined ||
    !platform ||
    !string(value.checkedAt) ||
    !Number.isFinite(Date.parse(value.checkedAt as string)) ||
    !string(value.currentVersion) ||
    (value.currentVersion as string).length > 100
  ) throw new Error('Home update status was malformed.')
  let release: HomeV2AppUpdateCheck['release'] = null
  if (value.release !== null) {
    if (
      !isRecord(value.release) ||
      !hasExactKeys(value.release, ['name', 'publishedAt', 'tagName']) ||
      !string(value.release.name) ||
      !string(value.release.tagName)
    ) {
      throw new Error('Home update release was malformed.')
    }
    if (value.release.publishedAt !== null && typeof value.release.publishedAt !== 'string') {
      throw new Error('Home update release date was malformed.')
    }
    release = {
      name: value.release.name as string,
      publishedAt: value.release.publishedAt as string | null,
      tagName: value.release.tagName as string,
    }
  }
  let asset: HomeV2AppUpdateCheck['asset'] = null
  if (value.asset !== null) {
    if (
      !isRecord(value.asset) ||
      !hasExactKeys(value.asset, ['digestAvailable', 'name', 'size']) ||
      value.asset.digestAvailable !== true ||
      !string(value.asset.name) ||
      typeof value.asset.size !== 'number' ||
      !Number.isSafeInteger(value.asset.size) ||
      value.asset.size <= 0
    ) throw new Error('Home update asset was malformed.')
    asset = {
      digestAvailable: true,
      name: value.asset.name as string,
      size: value.asset.size,
    }
  }
  const coherent =
    (state === 'available' && issue === null && !!release && !!asset) ||
    (state === 'up-to-date' && issue === null && !!release) ||
    (state === 'no-compatible-asset' && issue === 'no-compatible-asset' && !!release && !asset) ||
    (state === 'not-found' && issue === 'release-not-found' && !release && !asset) ||
    (state === 'unsupported' && issue === 'unsupported-platform' && !release && !asset) ||
    (state === 'unavailable' &&
      (issue === 'release-unavailable' || issue === 'invalid-version') &&
      !asset)
  if (!coherent) throw new Error('Home update status fields were inconsistent.')
  return {
    asset,
    channel,
    checkedAt: value.checkedAt as string,
    currentVersion: value.currentVersion as string,
    issue,
    platform,
    release,
    revision: 1,
    schema: 'home-v2-app-update-check',
    state: state as HomeV2AppUpdateCheck['state'],
  }
}

export function parseHomeV2AppUpdateAction(value: unknown): HomeV2AppUpdateActionResult {
  if (!isRecord(value) || value.schema !== 'home-v2-app-update-action' || value.revision !== 1) {
    throw new Error('Home update action used an unsupported schema.')
  }
  if (!hasExactKeys(value, ['code', 'download', 'outcome', 'revision', 'schema'])) {
    throw new Error('Home update action had unexpected fields.')
  }
  const outcome = value.outcome
  const code = parseIssue(value.code)
  if (!['blocked', 'completed', 'failed'].includes(String(outcome)) || code === undefined) {
    throw new Error('Home update action was malformed.')
  }
  let download: HomeV2AppUpdateDownload | null = null
  if (value.download !== null) {
    const candidate = value.download
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, [
        'canOpen',
        'canReveal',
        'digestVerified',
        'downloadId',
        'fileName',
        'releaseTag',
        'size',
      ]) ||
      typeof candidate.canOpen !== 'boolean' ||
      typeof candidate.canReveal !== 'boolean' ||
      candidate.digestVerified !== true ||
      !string(candidate.downloadId) ||
      !string(candidate.fileName) ||
      !string(candidate.releaseTag) ||
      (candidate.fileName as string).length > 200 ||
      (candidate.releaseTag as string).length > 100 ||
      typeof candidate.size !== 'number' ||
      !Number.isSafeInteger(candidate.size) ||
      candidate.size <= 0
    ) throw new Error('Downloaded Home update was malformed.')
    download = candidate as HomeV2AppUpdateDownload
  }
  if (
    (outcome === 'completed' && code !== null) ||
    (outcome !== 'completed' && (code === null || download !== null))
  ) throw new Error('Home update action fields were inconsistent.')
  return {
    code,
    download,
    outcome: outcome as HomeV2AppUpdateActionResult['outcome'],
    revision: 1,
    schema: 'home-v2-app-update-action',
  }
}

declare global {
  interface Window {
    homeV2AppUpdates?: HomeV2AppUpdateClient
  }
}
