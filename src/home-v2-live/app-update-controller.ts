import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import type { AndroidHomeV2UpdateHost } from '../home-v2-android-app-updates'
import {
  getDefaultHomeV2AppUpdatePreferences,
  getHomeV2AutomaticUpdateAction,
  parseHomeV2AppUpdatePreferences,
  serializeHomeV2AppUpdatePreferences,
  type HomeV2AppUpdatePolicy,
  type HomeV2AppUpdatePreferences,
} from './app-update-preferences'
import {
  parseHomeV2AppUpdateAction,
  parseHomeV2AppUpdateAutomaticClaim,
  parseHomeV2AppUpdateCheck,
  parseHomeV2AppUpdateProgress,
  parseHomeV2AppUpdateSettings,
  type HomeV2AppUpdateChannel,
  type HomeV2AppUpdateCheck,
  type HomeV2AppUpdateDownload,
  type HomeV2AppUpdateIssue,
  type HomeV2AppUpdateProgress,
} from './app-update-client'

type NativeDownload = QortiumAppUpdateDownloadResult & { digest: string }

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const MAX_UPDATE_ASSET_BYTES = 512 * 1024 * 1024

function isTrustedGithubReleaseUrl(value: string, tagName: string, kind: 'asset' | 'page') {
  try {
    const url = new URL(value)
    const prefix = kind === 'asset'
      ? `/QortiumDev/qortium-home/releases/download/${encodeURIComponent(tagName)}/`
      : `/QortiumDev/qortium-home/releases/tag/${encodeURIComponent(tagName)}`
    return url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      (kind === 'asset'
        ? url.pathname.startsWith(prefix) && url.pathname.length > prefix.length
        : url.pathname === prefix)
  } catch {
    return false
  }
}

function issueMessage(issue: HomeV2AppUpdateIssue | null) {
  switch (issue) {
    case 'no-compatible-asset': return t('updates.noCompatibleAsset', { platform: '', tag: '' })
    case 'release-not-found': return t('updates.releaseNotFound', { channel: '' })
    case 'unsupported-platform': return t('updates.unsupportedPlatform', { platform: '' })
    case 'operation-in-progress': return t('home2.core.action.inProgress')
    case 'download-not-found': return t('updates.checkFailed')
    default: return t('updates.checkReleasesFailed')
  }
}

export function formatUpdateBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`
}

function nativeCheckResult(result: QortiumAppUpdateCheckResult): HomeV2AppUpdateCheck {
  const trustedRelease = result.release &&
    isTrustedGithubReleaseUrl(result.release.htmlUrl, result.release.tagName, 'page')
    ? result.release
    : null
  const trustedAsset = trustedRelease &&
    result.asset &&
    SHA256_PATTERN.test(result.asset.digest ?? '') &&
    Number.isSafeInteger(result.asset.size) &&
    result.asset.size > 0 &&
    result.asset.size <= MAX_UPDATE_ASSET_BYTES &&
    isTrustedGithubReleaseUrl(result.asset.downloadUrl, trustedRelease.tagName, 'asset')
    ? { digestAvailable: true as const, name: result.asset.name, size: result.asset.size }
    : null
  const state = result.status === 'error'
    ? 'unavailable'
    : result.status === 'available' && !trustedAsset
      ? 'no-compatible-asset'
      : result.status
  return {
    asset: trustedAsset,
    channel: result.channel,
    checkedAt: result.checkedAt,
    currentVersion: result.currentVersion,
    issue: state === 'no-compatible-asset'
      ? 'no-compatible-asset'
      : state === 'not-found'
        ? 'release-not-found'
        : state === 'unsupported'
          ? 'unsupported-platform'
          : state === 'unavailable'
            ? 'release-unavailable'
            : null,
    platform: result.platform,
    release: trustedRelease
      ? {
          name: trustedRelease.name,
          publishedAt: trustedRelease.publishedAt || null,
          tagName: trustedRelease.tagName,
        }
      : null,
    revision: 1,
    schema: 'home-v2-app-update-check',
    state,
  }
}

export function useHomeV2AppUpdates(nativeHostOverride: AndroidHomeV2UpdateHost | null = null) {
  const desktopClient = window.homeV2AppUpdates ?? null
  const [nativeHost, setNativeHost] = useState<AndroidHomeV2UpdateHost | null>(nativeHostOverride)
  const nativeClient = nativeHost?.client ?? null
  const available = !!desktopClient || !!nativeHost
  const isAndroid = !desktopClient && !!nativeHost
  const [preferences, setPreferences] = useState(getDefaultHomeV2AppUpdatePreferences)
  const preferencesRef = useRef(preferences)
  const hostPreferencesRef = useRef(preferences)
  const [confirmedPreferences, setConfirmedPreferences] = useState(preferences)
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)
  const [channel, setChannel] = useState<HomeV2AppUpdateChannel>('stable')
  const [result, setResult] = useState<HomeV2AppUpdateCheck | null>(null)
  const [download, setDownload] = useState<HomeV2AppUpdateDownload | null>(null)
  const [busy, setBusy] = useState<'check' | 'download' | 'open' | 'reveal' | null>(null)
  // Live download progress. Null when nothing is downloading.
  const [progress, setProgress] = useState<HomeV2AppUpdateProgress | null>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const requestSequence = useRef(0)
  const automaticCheckKey = useRef('')
  const preferenceWrites = useRef<Promise<void>>(Promise.resolve())
  const preferenceRevision = useRef(0)
  const settingsGeneration = useRef(0)
  const [confirmedGeneration, setConfirmedGeneration] = useState(0)
  const nativeResult = useRef<QortiumAppUpdateCheckResult | null>(null)
  const nativeDownload = useRef<NativeDownload | null>(null)

  // Desktop download progress. Android reports its own way (nativeDownload),
  // so this subscribes only when the Electron client is present.
  useEffect(() => {
    if (!desktopClient?.onDownloadProgress) return undefined
    return desktopClient.onDownloadProgress((event) => {
      const parsed = parseHomeV2AppUpdateProgress(event)
      // Dropped, not rendered: a wrong percentage is worse than none.
      if (parsed) setProgress(parsed)
    })
  }, [desktopClient])

  // A finished or failed run must not leave a bar behind.
  useEffect(() => {
    if (busy !== 'download') setProgress(null)
  }, [busy])

  useEffect(() => {
    if (nativeHostOverride) {
      setNativeHost(nativeHostOverride)
      return
    }
    let disposed = false
    if (!desktopClient) {
      void import('../home-v2-android-app-updates').then((module) => {
        if (!disposed) setNativeHost(module.createAndroidHomeV2UpdateHost())
      })
    }
    return () => { disposed = true }
  }, [desktopClient, nativeHostOverride])

  useEffect(() => {
    if (!available) return
    let disposed = false
    const load = async () => {
      try {
        let next: HomeV2AppUpdatePreferences
        if (desktopClient) {
          const host = parseHomeV2AppUpdateSettings(await desktopClient.getSettings())
          settingsGeneration.current = host.generation
          setConfirmedGeneration(host.generation)
          next = {
            homeUpdatePolicy: host.homeUpdatePolicy,
            releaseChannel: host.releaseChannel,
          }
        } else {
          const raw = await nativeHost!.loadPreferences()
          const parsed = parseHomeV2AppUpdatePreferences(raw)
          // Android automatic downloads stay disabled until discovery,
          // download receipts, and installer handoff are native and opaque.
          next = parsed.homeUpdatePolicy === 'auto-download'
            ? { ...parsed, homeUpdatePolicy: 'notify' }
            : parsed
          if (next !== parsed) {
            await nativeHost!.savePreferences(serializeHomeV2AppUpdatePreferences(next))
          }
        }
        if (disposed) return
        preferencesRef.current = next
        hostPreferencesRef.current = next
        setPreferences(next)
        setConfirmedPreferences(next)
        setChannel(next.releaseChannel)
      } catch {
        if (!disposed) {
          // A missing settings file has an explicit host default. Any error
          // reaching this boundary is unreadable/corrupt state and must not
          // create automatic network or disk activity.
          const next: HomeV2AppUpdatePreferences = {
            homeUpdatePolicy: 'off',
            releaseChannel: 'stable',
          }
          preferencesRef.current = next
          hostPreferencesRef.current = next
          setPreferences(next)
          setConfirmedPreferences(next)
          setChannel(next.releaseChannel)
          setMessage({ tone: 'error', text: t('updates.checkFailed') })
        }
      } finally {
        if (!disposed) setPreferencesLoaded(true)
      }
    }
    void load()
    return () => { disposed = true }
  }, [available, desktopClient, nativeHost])

  const persistPreferences = useCallback((patch: Partial<HomeV2AppUpdatePreferences>) => {
    const next = { ...preferencesRef.current, ...patch }
    preferencesRef.current = next
    setPreferences(next)
    const revision = ++preferenceRevision.current
    const write = async () => {
      try {
        let confirmed: HomeV2AppUpdatePreferences
        if (desktopClient) {
          const intended = { ...hostPreferencesRef.current, ...patch }
          const state = parseHomeV2AppUpdateSettings(
            await desktopClient.setSettings(settingsGeneration.current, intended),
          )
          settingsGeneration.current = state.generation
          confirmed = {
            homeUpdatePolicy: state.homeUpdatePolicy,
            releaseChannel: state.releaseChannel,
          }
          hostPreferencesRef.current = confirmed
        } else {
          await nativeHost!.savePreferences(serializeHomeV2AppUpdatePreferences(next))
          confirmed = next
        }
        if (revision === preferenceRevision.current) {
          if (desktopClient) setConfirmedGeneration(settingsGeneration.current)
          preferencesRef.current = confirmed
          setPreferences(confirmed)
          setConfirmedPreferences(confirmed)
          setChannel(confirmed.releaseChannel)
        }
      } catch (error) {
        if (desktopClient) {
          const current = parseHomeV2AppUpdateSettings(await desktopClient.getSettings())
          settingsGeneration.current = current.generation
          hostPreferencesRef.current = {
            homeUpdatePolicy: current.homeUpdatePolicy,
            releaseChannel: current.releaseChannel,
          }
          if (revision === preferenceRevision.current) {
            const recovered = {
              homeUpdatePolicy: current.homeUpdatePolicy,
              releaseChannel: current.releaseChannel,
            }
            preferencesRef.current = recovered
            setConfirmedGeneration(current.generation)
            setPreferences(recovered)
            setConfirmedPreferences(recovered)
            setChannel(recovered.releaseChannel)
            setResult(null)
            setDownload(null)
            nativeResult.current = null
            nativeDownload.current = null
          }
        }
        throw error
      }
    }
    preferenceWrites.current = preferenceWrites.current.catch(() => undefined).then(write)
    void preferenceWrites.current.catch(() => {
      if (revision === preferenceRevision.current) {
        setMessage({ tone: 'error', text: t('updates.checkFailed') })
      }
    })
  }, [desktopClient, nativeHost])

  const downloadCheckedUpdate = useCallback(async (
    checkedResult: HomeV2AppUpdateCheck,
    checkedChannel: HomeV2AppUpdateChannel,
    sequence?: number,
    automaticSettingsGeneration: number | null = null,
  ) => {
    if (
      !checkedResult.release ||
      checkedResult.channel !== checkedChannel ||
      checkedResult.state !== 'available' ||
      !checkedResult.asset?.digestAvailable
    ) return
    setBusy('download')
    setMessage(null)
    try {
      if (desktopClient) {
        const action = parseHomeV2AppUpdateAction(
          await desktopClient.download(
            checkedChannel,
            checkedResult.release.tagName,
            automaticSettingsGeneration,
          ),
        )
        if (sequence !== undefined && sequence !== requestSequence.current) return
        if (action.outcome !== 'completed' || !action.download) {
          setMessage({ tone: 'error', text: issueMessage(action.code) })
          return
        }
        setDownload(action.download)
        setMessage({
          tone: 'success',
          text: t('updates.downloadedVerified', { fileName: action.download.fileName }),
        })
        return
      }
      if (automaticSettingsGeneration !== null) {
        throw new Error('android-automatic-download-disabled')
      }
      const raw = nativeResult.current
      if (
        !raw?.asset ||
        !raw.release ||
        raw.channel !== checkedChannel ||
        raw.release.tagName !== checkedResult.release.tagName ||
        !SHA256_PATTERN.test(raw.asset.digest ?? '') ||
        !isTrustedGithubReleaseUrl(raw.release.htmlUrl, raw.release.tagName, 'page') ||
        !isTrustedGithubReleaseUrl(raw.asset.downloadUrl, raw.release.tagName, 'asset') ||
        raw.asset.size !== checkedResult.asset.size
      ) throw new Error('unverified-update')
      const downloaded = await nativeClient!.downloadAsset({
        asset: raw.asset,
        platform: raw.platform,
        releaseTag: raw.release.tagName,
      })
      if (sequence !== undefined && sequence !== requestSequence.current) return
      if (
        downloaded.digestVerified !== true ||
        downloaded.digest !== raw.asset.digest ||
        downloaded.releaseTag !== raw.release.tagName ||
        !downloaded.fileName.toLowerCase().endsWith('.apk')
      ) throw new Error('unverified-download')
      nativeDownload.current = downloaded as NativeDownload
      const redacted: HomeV2AppUpdateDownload = {
        canOpen: downloaded.canOpen,
        canReveal: downloaded.canReveal,
        digestVerified: true,
        downloadId: 'android-native-download',
        fileName: downloaded.fileName,
        releaseTag: downloaded.releaseTag,
        size: downloaded.size,
      }
      setDownload(redacted)
      setMessage({
        tone: 'success',
        text: t('updates.downloadedVerifiedAndroid', {
          fileName: downloaded.fileName,
          installButton: t('updates.installApk'),
        }),
      })
    } catch {
      if (sequence === undefined || sequence === requestSequence.current) {
        setMessage({ tone: 'error', text: t('updates.checkFailed') })
      }
    } finally {
      if (sequence === undefined || sequence === requestSequence.current) setBusy(null)
    }
  }, [desktopClient, nativeClient])

  const check = useCallback(async (
    nextChannel: HomeV2AppUpdateChannel = channel,
    options: {
      readonly autoDownload?: boolean
      readonly automaticSettingsGeneration?: number | null
    } = {},
  ) => {
    if (!available) return
    const sequence = ++requestSequence.current
    setBusy('check')
    setMessage(null)
    setDownload(null)
    nativeDownload.current = null
    try {
      let next: HomeV2AppUpdateCheck
      let nextNativeResult: QortiumAppUpdateCheckResult | null = null
      const automaticGeneration = options.automaticSettingsGeneration ?? null
      if (desktopClient) {
        next = parseHomeV2AppUpdateCheck(
          await desktopClient.check(nextChannel, automaticGeneration),
        )
      } else {
        const environment = await nativeClient!.getEnvironment()
        const raw = await nativeHost!.check(environment, nextChannel)
        nextNativeResult = raw
        next = nativeCheckResult(raw)
      }
      if (sequence !== requestSequence.current) return
      nativeResult.current = nextNativeResult
      setChannel(nextChannel)
      setResult(next)
      setMessage({
        tone: next.state === 'available' || next.state === 'up-to-date' ? 'success' : 'error',
        text: next.state === 'available'
          ? t('updates.available', { platform: next.platform.label, tag: next.release?.tagName ?? '' })
          : next.state === 'up-to-date'
            ? t('updates.upToDateOnChannel', { channel: nextChannel })
            : next.state === 'no-compatible-asset'
              ? t('updates.noCompatibleAsset', {
                  platform: next.platform.label,
                  tag: next.release?.tagName ?? '',
                })
              : issueMessage(next.issue),
      })
      if (
        options.autoDownload &&
        !!desktopClient &&
        automaticGeneration !== null &&
        next.state === 'available' &&
        next.asset?.digestAvailable
      ) {
        await downloadCheckedUpdate(next, nextChannel, sequence, automaticGeneration)
      }
    } catch {
      if (sequence === requestSequence.current) {
        setMessage({ tone: 'error', text: t('updates.checkReleasesFailed') })
      }
    } finally {
      if (sequence === requestSequence.current) setBusy(null)
    }
  }, [available, channel, desktopClient, downloadCheckedUpdate, nativeClient, nativeHost])

  useEffect(() => {
    if (!available || !preferencesLoaded) return
    let disposed = false

    if (desktopClient) {
      const claimRevision = preferenceRevision.current
      void (async () => {
        try {
          const claim = parseHomeV2AppUpdateAutomaticClaim(
            await desktopClient.claimAutomatic(),
          )
          if (disposed || claimRevision !== preferenceRevision.current) return
          const claimedPreferences: HomeV2AppUpdatePreferences = {
            homeUpdatePolicy: claim.homeUpdatePolicy,
            releaseChannel: claim.releaseChannel,
          }
          settingsGeneration.current = claim.generation
          setConfirmedGeneration(claim.generation)
          setConfirmedPreferences(claimedPreferences)
          hostPreferencesRef.current = claimedPreferences
          preferencesRef.current = claimedPreferences
          setPreferences(claimedPreferences)
          setChannel(claimedPreferences.releaseChannel)
          if (!claim.claimed) return
          await check(claim.releaseChannel, {
            autoDownload: claim.homeUpdatePolicy === 'auto-download',
            automaticSettingsGeneration: claim.generation,
          })
        } catch {
          if (!disposed) setMessage({ tone: 'error', text: t('updates.checkFailed') })
        }
      })()
      return () => { disposed = true }
    }

    const action = getHomeV2AutomaticUpdateAction(confirmedPreferences.homeUpdatePolicy)
    if (action === 'none') return () => { disposed = true }
    const key = `${confirmedPreferences.releaseChannel}:${confirmedPreferences.homeUpdatePolicy}`
    if (automaticCheckKey.current === key) return () => { disposed = true }
    automaticCheckKey.current = key
    void check(confirmedPreferences.releaseChannel, { autoDownload: false })
    return () => { disposed = true }
  }, [
    available,
    check,
    confirmedGeneration,
    confirmedPreferences.homeUpdatePolicy,
    confirmedPreferences.releaseChannel,
    desktopClient,
    preferencesLoaded,
  ])

  useEffect(() => () => { requestSequence.current += 1 }, [])

  const downloadUpdate = useCallback(async () => {
    if (result) await downloadCheckedUpdate(result, channel)
  }, [channel, downloadCheckedUpdate, result])

  const openDownloaded = useCallback(async () => {
    if (!download?.digestVerified) return
    setBusy('open')
    try {
      if (desktopClient) {
        const action = parseHomeV2AppUpdateAction(await desktopClient.open(download.downloadId))
        if (action.outcome !== 'completed') throw new Error('open-failed')
      } else {
        const native = nativeDownload.current
        if (!native || !SHA256_PATTERN.test(native.digest)) throw new Error('unverified-download')
        await nativeClient!.openDownloadedFile(native.filePath, native.digest)
      }
    } catch {
      setMessage({ tone: 'error', text: t('updates.checkFailed') })
    } finally {
      setBusy(null)
    }
  }, [desktopClient, download, nativeClient])

  const revealDownloaded = useCallback(async () => {
    if (!desktopClient || !download?.digestVerified || !download.canReveal) return
    setBusy('reveal')
    try {
      const action = parseHomeV2AppUpdateAction(await desktopClient.reveal(download.downloadId))
      if (action.outcome !== 'completed') throw new Error('reveal-failed')
    } catch {
      setMessage({ tone: 'error', text: t('updates.checkFailed') })
    } finally {
      setBusy(null)
    }
  }, [desktopClient, download])

  const openReleasePage = useCallback(async () => {
    if (!result?.release) return
    try {
      if (desktopClient) {
        const action = parseHomeV2AppUpdateAction(
          await desktopClient.openReleasePage(channel, result.release.tagName),
        )
        if (action.outcome !== 'completed') throw new Error('open-release-failed')
      } else {
        const release = nativeResult.current?.release
        const url = release?.htmlUrl
        if (!release || !url || !isTrustedGithubReleaseUrl(url, release.tagName, 'page')) {
          throw new Error('release-url-unavailable')
        }
        await nativeClient!.openReleasePage(url)
      }
    } catch {
      setMessage({ tone: 'error', text: t('updates.checkFailed') })
    }
  }, [channel, desktopClient, nativeClient, result])

  return {
    available,
    busy,
    progress,
    channel,
    check,
    download,
    downloadUpdate,
    formattedSize: result?.asset ? formatUpdateBytes(result.asset.size) : null,
    homeUpdatePolicy: preferences.homeUpdatePolicy,
    isAndroid,
    message,
    openDownloaded,
    openReleasePage,
    revealDownloaded,
    preferencesLoaded,
    result,
    setChannel: (nextChannel: HomeV2AppUpdateChannel) => {
      setChannel(nextChannel)
      setResult(null)
      setDownload(null)
      nativeResult.current = null
      nativeDownload.current = null
      setMessage(null)
      persistPreferences({ releaseChannel: nextChannel })
    },
    setHomeUpdatePolicy: (nextPolicy: HomeV2AppUpdatePolicy) => {
      if (isAndroid && nextPolicy === 'auto-download') return
      if (nextPolicy !== preferencesRef.current.homeUpdatePolicy) automaticCheckKey.current = ''
      persistPreferences({ homeUpdatePolicy: nextPolicy })
    },
  }
}

export type HomeV2AppUpdates = ReturnType<typeof useHomeV2AppUpdates>
