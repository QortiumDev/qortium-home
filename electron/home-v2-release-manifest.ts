/**
 * Home releases on QDN.
 *
 * A release is described by one small JSON resource (the manifest) published
 * under the release publisher's name, plus one FILE resource per package. Two
 * tiny JSON pointers name the newest release on each channel so that a check
 * is two reads, not a listing scan:
 *
 *   JSON  <publisher>/home-latest-stable        -> { "tag": "v2.1.0" }
 *   JSON  <publisher>/home-latest-prerelease    -> { "tag": "v2.1.0-beta.4" }
 *   JSON  <publisher>/home-release-<tag>        -> the manifest below
 *   FILE  <publisher>/<asset identifier>        -> the package bytes
 *
 * The manifest carries each asset's SHA-256 and size; the download path
 * re-hashes what it received against exactly that digest (the same rule the
 * GitHub source lives by), so a manifest can only ever point at bytes it
 * vouched for. The publisher name is pinned here: QDN guarantees only that
 * name's owner can publish under it, and Home trusts nothing else.
 *
 * Pure: no I/O, shared by the main process and (later) the Android shell.
 */
import type {
  HomeAppUpdateChannel,
  TrustedHomeRelease,
  TrustedHomeReleaseAsset,
} from './app-update-policy.js'

/** The QDN name that publishes Home releases (owner decision 2026-09-12). */
export const HOME_RELEASE_PUBLISHER = 'QortiumHomeTest'
export const HOME_RELEASE_MANIFEST_SERVICE = 'JSON'
export const HOME_RELEASE_ASSET_SERVICE = 'FILE'
export const HOME_RELEASE_MANIFEST_SCHEMA = 'qortium-home-release'
/** QDN identifiers are capped at 64 bytes; ours are ASCII so bytes = chars. */
const MAX_IDENTIFIER_LENGTH = 64
const MAX_ASSET_BYTES = 512 * 1024 * 1024
const MAX_ASSETS = 16
const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/

export function homeReleaseChannelIdentifier(channel: HomeAppUpdateChannel) {
  return `home-latest-${channel}`
}

export function homeReleaseManifestIdentifier(tagName: string) {
  const identifier = `home-release-${tagName}`
  if (!TAG_PATTERN.test(tagName) || identifier.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`Release tag ${tagName} cannot name a QDN manifest.`)
  }
  return identifier
}

/** The GitHub release page for a tag: still where the notes and the human-readable release live. */
export function homeReleasePageUrl(tagName: string) {
  return `https://github.com/QortiumDev/qortium-home/releases/tag/${encodeURIComponent(tagName)}`
}

/** The node's raw-bytes URL for a QDN resource, the shape Home already reads FILE resources by. */
export function qdnResourceUrl(nodeApiUrl: string, service: string, name: string, identifier: string) {
  const base = nodeApiUrl.replace(/\/+$/, '')
  return `${base}/arbitrary/${service}/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`
}

export function isQdnReleaseAssetUrl(value: string, nodeApiUrl: string) {
  const prefix = qdnResourceUrl(nodeApiUrl, HOME_RELEASE_ASSET_SERVICE, HOME_RELEASE_PUBLISHER, '')
  return value.startsWith(prefix) && value.length > prefix.length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function parseHomeReleaseChannelPointer(value: unknown): string | null {
  if (!isRecord(value)) return null
  const tag = getString(value.tag)
  return TAG_PATTERN.test(tag) && tag.length <= 100 ? tag : null
}

export type HomeReleaseManifestAsset = TrustedHomeReleaseAsset & {
  /** The FILE resource identifier the bytes live under. */
  readonly identifier: string
}

/**
 * Parses a manifest into the release shape the update policy works on.
 * Returns null for anything that is not a well-formed manifest for `tagName`
 * on `channel`; a manifest whose tag disagrees with the identifier it was
 * fetched under is refused outright.
 */
export function parseHomeReleaseManifest(
  value: unknown,
  options: { readonly channel: HomeAppUpdateChannel; readonly nodeApiUrl: string; readonly tagName: string },
): (TrustedHomeRelease & { readonly assets: readonly HomeReleaseManifestAsset[] }) | null {
  if (!isRecord(value)) return null
  if (value.schema !== HOME_RELEASE_MANIFEST_SCHEMA || value.product !== 'home') return null
  const tagName = getString(value.tag)
  if (tagName !== options.tagName || !TAG_PATTERN.test(tagName)) return null
  const prerelease = value.prerelease === true
  if ((options.channel === 'stable' && prerelease) || (options.channel === 'prerelease' && !prerelease)) return null
  if (!Array.isArray(value.assets) || value.assets.length === 0 || value.assets.length > MAX_ASSETS) return null
  const seen = new Set<string>()
  const assets: HomeReleaseManifestAsset[] = []
  for (const entry of value.assets) {
    if (!isRecord(entry)) return null
    const name = getString(entry.name)
    const identifier = getString(entry.identifier)
    const digest = getString(entry.sha256).toLowerCase()
    const size = entry.size
    if (
      !name || name.length > 200 || /[\\/]/.test(name) ||
      !IDENTIFIER_PATTERN.test(identifier) || identifier.length > MAX_IDENTIFIER_LENGTH ||
      !/^[a-f0-9]{64}$/.test(digest) ||
      typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > MAX_ASSET_BYTES ||
      seen.has(name) || seen.has(identifier)
    ) return null
    seen.add(name)
    seen.add(identifier)
    assets.push({
      digest: `sha256:${digest}`,
      downloadUrl: qdnResourceUrl(options.nodeApiUrl, HOME_RELEASE_ASSET_SERVICE, HOME_RELEASE_PUBLISHER, identifier),
      identifier,
      name,
      size,
      source: 'qdn',
    })
  }
  return {
    assets,
    channel: options.channel,
    htmlUrl: homeReleasePageUrl(tagName),
    name: (getString(value.name) || tagName).slice(0, 200),
    publishedAt: (getString(value.publishedAt) || '').slice(0, 100) || null,
    tagName,
  }
}
