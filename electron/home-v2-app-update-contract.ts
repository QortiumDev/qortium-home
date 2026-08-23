import { randomUUID } from 'node:crypto'
import type { IpcMainInvokeEvent } from 'electron'
import type { StoredHomeV2AppUpdateSettings } from './home-v2-app-update-settings-codec.js'
import {
  compareHomeAppVersions,
  selectTrustedHomeReleaseAsset,
  type HomeAppUpdateChannel,
  type HomeAppUpdatePlatform,
  type TrustedHomeRelease,
  type TrustedHomeReleaseAsset,
} from './app-update-policy.js'

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
  readonly channel: HomeAppUpdateChannel
  readonly checkedAt: string
  readonly currentVersion: string
  readonly issue: HomeV2AppUpdateIssue | null
  readonly platform: HomeAppUpdatePlatform
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

type UpdateEnvironment = {
  readonly currentVersion: string
  readonly platform: HomeAppUpdatePlatform
}

type InternalDownload = HomeV2AppUpdateDownload & {
  readonly filePath: string
}

type Dependencies = {
  readonly downloadAsset: (request: {
    asset: TrustedHomeReleaseAsset
    releaseTag: string
  }) => Promise<{
    canOpen: boolean
    canReveal: boolean
    digestVerified: boolean
    fileName: string
    filePath: string
    releaseTag: string
    size: number
  }>
  readonly fetchRelease: (channel: HomeAppUpdateChannel) => Promise<TrustedHomeRelease | null>
  readonly getEnvironment: () => UpdateEnvironment
  readonly now?: () => Date
  readonly openDownloadedFile: (filePath: string) => void | Promise<void>
  readonly openReleasePage: (url: string) => Promise<void>
  readonly readSettings: () => Promise<StoredHomeV2AppUpdateSettings>
  readonly revealDownloadedFile: (filePath: string) => void | Promise<void>
  readonly uuid?: () => string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function normalizeChannel(value: unknown) {
  if (!exactRecord(value, ['channel', 'revision', 'schema', 'settingsGeneration'])) {
    throw new Error('An exact app update channel request is required.')
  }
  if (value.schema !== 'home-v2-app-update-check-request' || value.revision !== 1) {
    throw new Error('The app update request schema is unsupported.')
  }
  if (value.channel !== 'stable' && value.channel !== 'prerelease') {
    throw new Error('Choose the stable or prerelease update channel.')
  }
  const settingsGeneration = value.settingsGeneration
  if (
    settingsGeneration !== null &&
    (!Number.isSafeInteger(settingsGeneration) || (settingsGeneration as number) < 0)
  ) throw new Error('Choose a valid app update operation.')
  return {
    channel: value.channel,
    settingsGeneration: settingsGeneration as number | null,
  } as const
}

function normalizeReleaseRequest(
  value: unknown,
  schema:
    | 'home-v2-app-update-download-request'
    | 'home-v2-app-update-open-release-request',
) {
  const keys = schema === 'home-v2-app-update-download-request'
    ? ['channel', 'releaseTag', 'revision', 'schema', 'settingsGeneration']
    : ['channel', 'releaseTag', 'revision', 'schema']
  if (!exactRecord(value, keys)) {
    throw new Error('An exact app update release request is required.')
  }
  if (value.schema !== schema || value.revision !== 1) {
    throw new Error('The app update request schema is unsupported.')
  }
  const channel = value.channel
  const releaseTag = typeof value.releaseTag === 'string' ? value.releaseTag.trim() : ''
  if ((channel !== 'stable' && channel !== 'prerelease') || !releaseTag || releaseTag.length > 100) {
    throw new Error('Choose a valid app update release.')
  }
  const settingsGeneration = schema === 'home-v2-app-update-download-request'
    ? value.settingsGeneration
    : null
  if (
    settingsGeneration !== null &&
    (!Number.isSafeInteger(settingsGeneration) || (settingsGeneration as number) < 0)
  ) {
    throw new Error('Choose a valid app update operation.')
  }
  return { channel, releaseTag, settingsGeneration: settingsGeneration as number | null } as const
}

function normalizeDownloadRequest(
  value: unknown,
  schema: 'home-v2-app-update-open-request' | 'home-v2-app-update-reveal-request',
) {
  if (!exactRecord(value, ['downloadId', 'revision', 'schema'])) {
    throw new Error('An exact downloaded update request is required.')
  }
  if (value.schema !== schema || value.revision !== 1) {
    throw new Error('The app update request schema is unsupported.')
  }
  const downloadId = typeof value.downloadId === 'string' ? value.downloadId.trim() : ''
  if (!/^[a-f0-9-]{16,64}$/i.test(downloadId)) {
    throw new Error('Choose a valid downloaded update.')
  }
  return downloadId
}

function redactedPlatform(platform: HomeAppUpdatePlatform): HomeAppUpdatePlatform {
  return {
    arch: platform.arch,
    label: platform.label,
    os: platform.os,
    ...(platform.osVersion ? { osVersion: platform.osVersion } : {}),
    supported: platform.supported,
  }
}

function baseCheck(
  channel: HomeAppUpdateChannel,
  environment: UpdateEnvironment,
  now: () => Date,
) {
  return {
    asset: null,
    channel,
    checkedAt: now().toISOString(),
    currentVersion: environment.currentVersion,
    issue: null,
    platform: redactedPlatform(environment.platform),
    release: null,
    revision: 1,
    schema: 'home-v2-app-update-check',
  } as const
}

function actionResult(
  outcome: HomeV2AppUpdateActionResult['outcome'],
  code: HomeV2AppUpdateIssue | null,
  download: HomeV2AppUpdateDownload | null = null,
): HomeV2AppUpdateActionResult {
  return {
    code,
    download,
    outcome,
    revision: 1,
    schema: 'home-v2-app-update-action',
  }
}

export function createHomeV2AppUpdateService(dependencies: Dependencies) {
  const now = dependencies.now ?? (() => new Date())
  const uuid = dependencies.uuid ?? randomUUID
  const checks = new Map<HomeAppUpdateChannel, Promise<HomeV2AppUpdateCheck>>()
  const downloads = new Map<string, InternalDownload>()
  let downloadInFlight = false

  const performCheck = async (channel: HomeAppUpdateChannel): Promise<HomeV2AppUpdateCheck> => {
    const environment = dependencies.getEnvironment()
    const base = baseCheck(channel, environment, now)
    if (!environment.platform.supported) {
      return { ...base, issue: 'unsupported-platform', state: 'unsupported' }
    }
    let release: TrustedHomeRelease | null
    try {
      release = await dependencies.fetchRelease(channel)
    } catch {
      return { ...base, issue: 'release-unavailable', state: 'unavailable' }
    }
    if (!release) return { ...base, issue: 'release-not-found', state: 'not-found' }
    const releaseSummary = {
      name: release.name,
      publishedAt: release.publishedAt,
      tagName: release.tagName,
    }
    const comparison = compareHomeAppVersions(release.tagName, environment.currentVersion)
    if (comparison === null) {
      return {
        ...base,
        issue: 'invalid-version',
        release: releaseSummary,
        state: 'unavailable',
      }
    }
    const asset = selectTrustedHomeReleaseAsset(release, environment.platform)
    if (comparison <= 0) {
      return {
        ...base,
        asset: asset ? { digestAvailable: true, name: asset.name, size: asset.size } : null,
        release: releaseSummary,
        state: 'up-to-date',
      }
    }
    if (!asset) {
      return {
        ...base,
        issue: 'no-compatible-asset',
        release: releaseSummary,
        state: 'no-compatible-asset',
      }
    }
    return {
      ...base,
      asset: { digestAvailable: true, name: asset.name, size: asset.size },
      release: releaseSummary,
      state: 'available',
    }
  }

  const check = async (value: unknown) => {
    const { channel, settingsGeneration } = normalizeChannel(value)
    if (settingsGeneration !== null) {
      const settings = await dependencies.readSettings()
      if (
        settings.generation !== settingsGeneration ||
        settings.homeUpdatePolicy === 'off' ||
        settings.releaseChannel !== channel
      ) {
        return {
          ...baseCheck(channel, dependencies.getEnvironment(), now),
          issue: 'settings-changed' as const,
          state: 'unavailable' as const,
        }
      }
    }
    const existing = checks.get(channel)
    if (existing) return existing
    const promise = performCheck(channel).finally(() => checks.delete(channel))
    checks.set(channel, promise)
    return promise
  }

  return {
    check,
    async download(value: unknown): Promise<HomeV2AppUpdateActionResult> {
      const { channel, releaseTag, settingsGeneration } = normalizeReleaseRequest(
        value,
        'home-v2-app-update-download-request',
      )
      if (downloadInFlight) return actionResult('blocked', 'operation-in-progress')
      downloadInFlight = true
      try {
        const environment = dependencies.getEnvironment()
        if (!environment.platform.supported) return actionResult('blocked', 'unsupported-platform')
        if (settingsGeneration !== null) {
          const settings = await dependencies.readSettings()
          if (
            settings.generation !== settingsGeneration ||
            settings.homeUpdatePolicy !== 'auto-download' ||
            settings.releaseChannel !== channel
          ) return actionResult('blocked', 'settings-changed')
        }
        let release: TrustedHomeRelease | null
        try {
          release = await dependencies.fetchRelease(channel)
        } catch {
          return actionResult('failed', 'release-unavailable')
        }
        if (!release) return actionResult('blocked', 'release-not-found')
        if (release.tagName !== releaseTag) return actionResult('blocked', 'release-changed')
        const comparison = compareHomeAppVersions(release.tagName, environment.currentVersion)
        if (comparison === null) return actionResult('blocked', 'invalid-version')
        if (comparison <= 0) return actionResult('blocked', 'release-changed')
        const asset = selectTrustedHomeReleaseAsset(release, environment.platform)
        if (!asset) return actionResult('blocked', 'no-compatible-asset')
        if (settingsGeneration !== null) {
          const settings = await dependencies.readSettings()
          if (
            settings.generation !== settingsGeneration ||
            settings.homeUpdatePolicy !== 'auto-download' ||
            settings.releaseChannel !== channel
          ) return actionResult('blocked', 'settings-changed')
        }
        try {
          const result = await dependencies.downloadAsset({ asset, releaseTag })
          if (!result.digestVerified) return actionResult('failed', 'download-failed')
          const downloadId = uuid()
          const internal: InternalDownload = {
            canOpen: result.canOpen,
            canReveal: result.canReveal,
            digestVerified: true,
            downloadId,
            fileName: result.fileName,
            filePath: result.filePath,
            releaseTag: result.releaseTag,
            size: result.size,
          }
          downloads.set(downloadId, internal)
          while (downloads.size > 4) downloads.delete(downloads.keys().next().value as string)
          const { filePath: _filePath, ...redacted } = internal
          return actionResult('completed', null, redacted)
        } catch {
          return actionResult('failed', 'download-failed')
        }
      } finally {
        downloadInFlight = false
      }
    },
    async reveal(value: unknown): Promise<HomeV2AppUpdateActionResult> {
      const downloadId = normalizeDownloadRequest(value, 'home-v2-app-update-reveal-request')
      const download = downloads.get(downloadId)
      if (!download) return actionResult('blocked', 'download-not-found')
      if (!download.canReveal) return actionResult('blocked', 'unsupported-platform')
      try {
        await dependencies.revealDownloadedFile(download.filePath)
        const { filePath: _filePath, ...redacted } = download
        return actionResult('completed', null, redacted)
      } catch {
        return actionResult('failed', 'download-failed')
      }
    },
    async open(value: unknown): Promise<HomeV2AppUpdateActionResult> {
      const downloadId = normalizeDownloadRequest(value, 'home-v2-app-update-open-request')
      const download = downloads.get(downloadId)
      if (!download) return actionResult('blocked', 'download-not-found')
      if (!download.canOpen) return actionResult('blocked', 'unsupported-platform')
      try {
        await dependencies.openDownloadedFile(download.filePath)
        const { filePath: _filePath, ...redacted } = download
        return actionResult('completed', null, redacted)
      } catch {
        return actionResult('failed', 'download-failed')
      }
    },
    async openReleasePage(value: unknown): Promise<HomeV2AppUpdateActionResult> {
      const { channel, releaseTag } = normalizeReleaseRequest(
        value,
        'home-v2-app-update-open-release-request',
      )
      try {
        const release = await dependencies.fetchRelease(channel)
        if (!release) return actionResult('blocked', 'release-not-found')
        if (release.tagName !== releaseTag) return actionResult('blocked', 'release-changed')
        await dependencies.openReleasePage(release.htmlUrl)
        return actionResult('completed', null)
      } catch {
        return actionResult('failed', 'release-unavailable')
      }
    },
  }
}

export function createAuthorizedHomeV2AppUpdateHandlers(
  assertAuthorized: (event: IpcMainInvokeEvent) => void,
  service: ReturnType<typeof createHomeV2AppUpdateService>,
) {
  return {
    check(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.check(value)
    },
    download(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.download(value)
    },
    open(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.open(value)
    },
    reveal(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.reveal(value)
    },
    openReleasePage(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.openReleasePage(value)
    },
  }
}
