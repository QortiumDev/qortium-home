import {
  compareHomeAppVersions,
  type HomeAppUpdateChannel,
  type TrustedHomeRelease,
  type TrustedHomeReleaseAsset,
} from './app-update-policy.js'
import {
  HOME_RELEASE_MANIFEST_SERVICE,
  HOME_RELEASE_PUBLISHER,
  homeReleaseChannelIdentifier,
  homeReleaseManifestIdentifier,
  parseHomeReleaseChannelPointer,
  parseHomeReleaseManifest,
  qdnResourceUrl,
} from './home-v2-release-manifest.js'

const GITHUB_API_BASE_URL =
  'https://api.github.com/repos/QortiumDev/qortium-home'
const GITHUB_RELEASE_BASE_URL =
  'https://github.com/QortiumDev/qortium-home/releases'
const GITHUB_ACCEPT_HEADER = 'application/vnd.github+json'
const GITHUB_USER_AGENT = 'QortiumHome/2.1'
const MAX_RELEASE_BODY_BYTES = 2 * 1024 * 1024
const RELEASE_TIMEOUT_MS = 4_000
const MAX_ASSET_BYTES = 512 * 1024 * 1024

type FetchLike = typeof fetch

export function isTrustedHomeAssetResponseUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    if (
      url.hostname === 'objects.githubusercontent.com' ||
      url.hostname === 'release-assets.githubusercontent.com'
    ) return true
    return url.hostname === 'github.com' &&
      url.pathname.startsWith('/QortiumDev/qortium-home/releases/download/')
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeDigest(value: unknown): `sha256:${string}` | null {
  const digest = getString(value).toLowerCase()
  return /^sha256:[a-f0-9]{64}$/.test(digest)
    ? (digest as `sha256:${string}`)
    : null
}

function trustedReleasePageUrl(value: unknown, tagName: string) {
  const raw = getString(value)
  try {
    const url = new URL(raw)
    const expectedPath = `/QortiumDev/qortium-home/releases/tag/${encodeURIComponent(tagName)}`
    return url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.pathname === expectedPath
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function trustedAssetDownloadUrl(value: unknown, tagName: string) {
  const raw = getString(value)
  try {
    const url = new URL(raw)
    const prefix = `/QortiumDev/qortium-home/releases/download/${encodeURIComponent(tagName)}/`
    return url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.pathname.startsWith(prefix) &&
      url.pathname.length > prefix.length
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function normalizeAsset(value: unknown, tagName: string): TrustedHomeReleaseAsset | null {
  if (!isRecord(value)) return null
  const name = getString(value.name)
  const digest = normalizeDigest(value.digest)
  const downloadUrl = trustedAssetDownloadUrl(value.browser_download_url, tagName)
  const size = value.size
  if (
    !name ||
    name.length > 200 ||
    !digest ||
    !downloadUrl ||
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > MAX_ASSET_BYTES
  ) {
    return null
  }
  return { digest, downloadUrl, name, size, source: 'github' }
}

function normalizeRelease(
  value: unknown,
  channel: HomeAppUpdateChannel,
): TrustedHomeRelease | null {
  if (!isRecord(value) || value.draft === true) return null
  const prerelease = value.prerelease === true
  if ((channel === 'stable' && prerelease) || (channel === 'prerelease' && !prerelease)) {
    return null
  }
  const tagName = getString(value.tag_name)
  if (!tagName || tagName.length > 100) return null
  const htmlUrl = trustedReleasePageUrl(value.html_url, tagName)
  if (!htmlUrl) return null
  const assets = Array.isArray(value.assets)
    ? value.assets
        .map((asset) => normalizeAsset(asset, tagName))
        .filter((asset): asset is TrustedHomeReleaseAsset => asset !== null)
    : []
  return {
    assets,
    channel,
    htmlUrl,
    name: (getString(value.name) || tagName).slice(0, 200),
    publishedAt: (getString(value.published_at) || '').slice(0, 100) || null,
    tagName,
  }
}

async function readBoundedJson(response: Response) {
  const contentLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(contentLength) && contentLength > MAX_RELEASE_BODY_BYTES) {
    throw new Error('release-response-too-large')
  }
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RELEASE_BODY_BYTES) {
      await reader.cancel('release-response-too-large')
      throw new Error('release-response-too-large')
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder().decode(body)
  return text ? (JSON.parse(text) as unknown) : null
}

export async function fetchTrustedHomeRelease(
  channel: HomeAppUpdateChannel,
  fetchImpl: FetchLike = fetch,
) {
  const url = channel === 'stable'
    ? `${GITHUB_API_BASE_URL}/releases/latest`
    : `${GITHUB_API_BASE_URL}/releases?per_page=30`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RELEASE_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: GITHUB_ACCEPT_HEADER,
        'User-Agent': GITHUB_USER_AGENT,
      },
      redirect: 'error',
      signal: controller.signal,
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`release-http-${response.status}`)
    const body = await readBoundedJson(response)
    if (channel === 'stable') return normalizeRelease(body, channel)
    if (!Array.isArray(body)) return null
    return selectHighestPrerelease(
      body.slice(0, 30).map((value) => normalizeRelease(value, channel)),
    )
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * GitHub's release listing is not ordered by version or by date: releases
 * cut on the same UTC day come back ordered by tag STRING, descending, so
 * `v2.1.0-beta.9` precedes `v2.1.0-beta.8` precedes `v2.1.0-beta.10`
 * (observed 2026-09-15; the same rule shows in vitejs/vite's listing).
 * Taking the first prerelease therefore reported beta.9 the day beta.10
 * shipped. Pick the highest version instead; a tag that does not parse as a
 * version can never be "highest" and is only used when nothing parses.
 */
export function selectHighestPrerelease(
  candidates: readonly (TrustedHomeRelease | null)[],
): TrustedHomeRelease | null {
  let best: TrustedHomeRelease | null = null
  let fallback: TrustedHomeRelease | null = null
  for (const release of candidates) {
    if (!release) continue
    if (compareHomeAppVersions(release.tagName, release.tagName) === null) {
      fallback ??= release
      continue
    }
    if (!best || (compareHomeAppVersions(release.tagName, best.tagName) ?? 0) > 0) {
      best = release
    }
  }
  return best ?? fallback
}

/**
 * The QDN source: the channel pointer names the newest tag, the tag names
 * the manifest, the manifest names the FILE assets on the node Home is
 * connected to. Both reads are small JSON resources. A node that has not
 * fetched the resource yet answers 404, which is "not on QDN (as far as this
 * node knows)" -- the caller falls through to its next source, and the GET
 * itself has asked the node to fetch it for next time.
 */
export async function fetchTrustedHomeReleaseFromQdn(
  channel: HomeAppUpdateChannel,
  options: { readonly nodeApiUrl: string; readonly fetchImpl?: FetchLike },
): Promise<TrustedHomeRelease | null> {
  const fetchImpl = options.fetchImpl ?? fetch
  const readJson = async (identifier: string) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), RELEASE_TIMEOUT_MS)
    try {
      const response = await fetchImpl(
        qdnResourceUrl(options.nodeApiUrl, HOME_RELEASE_MANIFEST_SERVICE, HOME_RELEASE_PUBLISHER, identifier),
        { headers: { Accept: 'application/json, */*' }, redirect: 'error', signal: controller.signal },
      )
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`release-http-${response.status}`)
      return readBoundedJson(response)
    } finally {
      clearTimeout(timeout)
    }
  }
  const tagName = parseHomeReleaseChannelPointer(await readJson(homeReleaseChannelIdentifier(channel)))
  if (!tagName) return null
  const manifest = await readJson(homeReleaseManifestIdentifier(tagName))
  if (manifest === null) return null
  return parseHomeReleaseManifest(manifest, { channel, nodeApiUrl: options.nodeApiUrl, tagName })
}

export type HomeReleaseSourceOrder = 'github' | 'qdn' | 'qdn-then-github'

/**
 * Reads a release from the configured sources in order. `qdn` needs a
 * Qortium node: `nodeApiUrl()` resolves null when the network is off, which
 * skips the source (or, alone, reads as "not found"). A source that answers
 * "no release" hands over to the next; a source that FAILS is remembered and
 * reported only if no later source produced an answer, so a stale or absent
 * QDN manifest never masks a working GitHub listing and vice versa.
 */
export async function fetchHomeReleaseFromSources(
  channel: HomeAppUpdateChannel,
  options: {
    readonly order: HomeReleaseSourceOrder
    readonly nodeApiUrl: () => Promise<string | null>
    readonly fromGithub?: (channel: HomeAppUpdateChannel) => Promise<TrustedHomeRelease | null>
    readonly fromQdn?: (channel: HomeAppUpdateChannel, nodeApiUrl: string) => Promise<TrustedHomeRelease | null>
  },
): Promise<TrustedHomeRelease | null> {
  const sources: readonly ('github' | 'qdn')[] =
    options.order === 'github' ? ['github'] : options.order === 'qdn' ? ['qdn'] : ['qdn', 'github']
  const fromGithub = options.fromGithub ?? ((next) => fetchTrustedHomeRelease(next))
  const fromQdn = options.fromQdn ?? ((next, nodeApiUrl) => fetchTrustedHomeReleaseFromQdn(next, { nodeApiUrl }))
  let failure: unknown = null
  for (const source of sources) {
    try {
      if (source === 'qdn') {
        const nodeApiUrl = await options.nodeApiUrl()
        if (!nodeApiUrl) continue
        const release = await fromQdn(channel, nodeApiUrl)
        if (release) return release
        continue
      }
      const release = await fromGithub(channel)
      if (release) return release
    } catch (error) {
      failure = error
    }
  }
  if (failure) throw failure
  return null
}
