import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import type { AndroidHomeV2UpdateHost } from '../home-v2-android-app-updates'
import {
  parseHomeV2AppUpdateAction,
  parseHomeV2AppUpdateCheck,
  type HomeV2AppUpdateChannel,
  type HomeV2AppUpdateCheck,
  type HomeV2AppUpdateDownload,
  type HomeV2AppUpdateIssue,
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

function formatUpdateBytes(bytes: number) {
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

export function useHomeV2AppUpdates() {
  const desktopClient = window.homeV2AppUpdates ?? null
  const [nativeHost, setNativeHost] = useState<AndroidHomeV2UpdateHost | null>(null)
  const nativeClient = nativeHost?.client ?? null
  const available = !!desktopClient || !!nativeHost
  const [channel, setChannel] = useState<HomeV2AppUpdateChannel>('stable')
  const [result, setResult] = useState<HomeV2AppUpdateCheck | null>(null)
  const [download, setDownload] = useState<HomeV2AppUpdateDownload | null>(null)
  const [busy, setBusy] = useState<'check' | 'download' | 'open' | null>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const requestSequence = useRef(0)
  const nativeResult = useRef<QortiumAppUpdateCheckResult | null>(null)
  const nativeDownload = useRef<NativeDownload | null>(null)

  useEffect(() => {
    let disposed = false
    if (!desktopClient) {
      void import('../home-v2-android-app-updates').then((module) => {
        if (!disposed) setNativeHost(module.createAndroidHomeV2UpdateHost())
      })
    }
    return () => { disposed = true }
  }, [desktopClient])

  const check = useCallback(async (nextChannel: HomeV2AppUpdateChannel = channel) => {
    if (!available) return
    const sequence = ++requestSequence.current
    setBusy('check')
    setMessage(null)
    setDownload(null)
    nativeDownload.current = null
    try {
      let next: HomeV2AppUpdateCheck
      if (desktopClient) {
        next = parseHomeV2AppUpdateCheck(await desktopClient.check(nextChannel))
      } else {
        const environment = await nativeClient!.getEnvironment()
        const raw = await nativeHost!.check(environment, nextChannel)
        nativeResult.current = raw
        next = nativeCheckResult(raw)
      }
      if (sequence !== requestSequence.current) return
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
    } catch {
      if (sequence === requestSequence.current) {
        setMessage({ tone: 'error', text: t('updates.checkReleasesFailed') })
      }
    } finally {
      if (sequence === requestSequence.current) setBusy(null)
    }
  }, [available, channel, desktopClient, nativeClient, nativeHost])

  useEffect(() => {
    if (available) void check(channel)
    return () => { requestSequence.current += 1 }
  }, [available])

  const downloadUpdate = useCallback(async () => {
    if (!result?.release || result.state !== 'available' || !result.asset?.digestAvailable) return
    setBusy('download')
    setMessage(null)
    try {
      if (desktopClient) {
        const action = parseHomeV2AppUpdateAction(
          await desktopClient.download(channel, result.release.tagName),
        )
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
      const raw = nativeResult.current
      if (
        !raw?.asset ||
        !raw.release ||
        raw.release.tagName !== result.release.tagName ||
        !SHA256_PATTERN.test(raw.asset.digest ?? '') ||
        !isTrustedGithubReleaseUrl(raw.release.htmlUrl, raw.release.tagName, 'page') ||
        !isTrustedGithubReleaseUrl(raw.asset.downloadUrl, raw.release.tagName, 'asset') ||
        raw.asset.size !== result.asset.size
      ) throw new Error('unverified-update')
      const downloaded = await nativeClient!.downloadAsset({
        asset: raw.asset,
        platform: raw.platform,
        releaseTag: raw.release.tagName,
      })
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
      setMessage({ tone: 'error', text: t('updates.checkFailed') })
    } finally {
      setBusy(null)
    }
  }, [channel, desktopClient, nativeClient, result])

  const openDownloaded = useCallback(async () => {
    if (!download?.digestVerified) return
    setBusy('open')
    try {
      if (desktopClient) {
        const action = parseHomeV2AppUpdateAction(await desktopClient.reveal(download.downloadId))
        if (action.outcome !== 'completed') throw new Error('reveal-failed')
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
    channel,
    check,
    download,
    downloadUpdate,
    formattedSize: result?.asset ? formatUpdateBytes(result.asset.size) : null,
    message,
    openDownloaded,
    openReleasePage,
    result,
    setChannel: (nextChannel: HomeV2AppUpdateChannel) => {
      setChannel(nextChannel)
      void check(nextChannel)
    },
  }
}

export type HomeV2AppUpdates = ReturnType<typeof useHomeV2AppUpdates>
