import type {
  HomeAppUpdateChannel,
  TrustedHomeRelease,
  TrustedHomeReleaseAsset,
} from './app-update-policy.js'

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
  return { digest, downloadUrl, name, size }
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
    for (const value of body.slice(0, 30)) {
      const release = normalizeRelease(value, channel)
      if (release) return release
    }
    return null
  } finally {
    clearTimeout(timeout)
  }
}
