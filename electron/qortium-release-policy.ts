import {
  QORTIUM_CORE_DESCRIPTOR,
  matchesCoreName,
} from './core-network-descriptor.js'

const CANONICAL_SHA256 = /^sha256:[a-f0-9]{64}$/
const SAFE_RELEASE_TAG = /^v?[a-z0-9][a-z0-9._-]*$/i

export type QortiumCoreChannel = 'prerelease' | 'stable'

export type QortiumCoreReleaseAsset = Readonly<{
  digest: string
  downloadUrl: string
  name: string
  size: number
}>

export type QortiumCoreRelease = Readonly<{
  asset: QortiumCoreReleaseAsset
  channel: QortiumCoreChannel
  commit: string
  htmlUrl: string
  name: string
  publishedAt: string
  tagName: string
}>

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function string(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function selectAsset(assets: unknown[], tagName: string): QortiumCoreReleaseAsset | null {
  const records = assets.filter(isObject)
  const preferred = records.filter(
    (asset) => string(asset.name) === QORTIUM_CORE_DESCRIPTOR.package.preferredAssetName,
  )
  const fallback = records.filter((asset) =>
    matchesCoreName(
      QORTIUM_CORE_DESCRIPTOR.package.kind === 'zip-with-preview-helpers'
        ? QORTIUM_CORE_DESCRIPTOR.package.fallbackAssetNameMatcher
        : { caseInsensitive: false, kind: 'exact', value: '' },
      string(asset.name),
    ),
  )
  const matches = preferred.length > 0 ? preferred : fallback

  if (matches.length !== 1) return null

  const asset = matches[0]
  const name = string(asset.name)
  const digest = string(asset.digest)
  const downloadUrl = string(asset.browser_download_url)
  const size = asset.size
  const expectedUrl =
    `https://github.com/${QORTIUM_CORE_DESCRIPTOR.github.repository}/releases/download/${tagName}/${name}`

  if (
    !name ||
    !CANONICAL_SHA256.test(digest) ||
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    downloadUrl !== expectedUrl
  ) {
    return null
  }

  return { digest, downloadUrl, name, size }
}

/** Selects only one exact, publisher-verifiable Qortium release asset. */
export function selectQortiumCoreRelease(
  value: unknown,
  channel: QortiumCoreChannel,
): QortiumCoreRelease | null {
  if (
    !isObject(value) ||
    value.draft !== false ||
    value.prerelease !== (channel === 'prerelease') ||
    !Array.isArray(value.assets)
  ) {
    return null
  }

  const tagName = string(value.tag_name)
  const expectedHtmlUrl =
    `https://github.com/${QORTIUM_CORE_DESCRIPTOR.github.repository}/releases/tag/${tagName}`

  if (!SAFE_RELEASE_TAG.test(tagName) || string(value.html_url) !== expectedHtmlUrl) {
    return null
  }

  const asset = selectAsset(value.assets, tagName)
  if (!asset) return null

  return {
    asset,
    channel,
    commit: string(value.target_commitish),
    htmlUrl: expectedHtmlUrl,
    name: string(value.name) || tagName,
    publishedAt: string(value.published_at),
    tagName,
  }
}

export function selectFirstQortiumCoreRelease(
  values: unknown,
  channel: QortiumCoreChannel,
) {
  if (!Array.isArray(values)) return null
  for (const value of values) {
    const release = selectQortiumCoreRelease(value, channel)
    if (release) return release
  }
  return null
}

export function sameQortiumCoreRelease(
  left: QortiumCoreRelease,
  right: QortiumCoreRelease,
) {
  return left.channel === right.channel && left.tagName === right.tagName &&
    left.asset.name === right.asset.name && left.asset.downloadUrl === right.asset.downloadUrl &&
    left.asset.digest === right.asset.digest && left.asset.size === right.asset.size
}
