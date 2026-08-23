const GITHUB_ACCEPT_HEADER = 'application/vnd.github+json'
const GITHUB_USER_AGENT = 'QortiumHome/2.1'
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const RELEASE_TIMEOUT_MS = 4_000
const MAX_RELEASES = 100
const MAX_RELEASE_BODY_CHARS = 512 * 1024

export type HomeV2ReleaseNotesProduct = 'core' | 'home'

export type HomeV2ReleaseNotesEntry = {
  readonly body: string
  readonly htmlUrl: string
  readonly name: string
  readonly publishedAt: string
  readonly tagName: string
}

type FetchLike = typeof fetch

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function string(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  return normalized.length <= maxLength ? normalized : ''
}

function repository(product: HomeV2ReleaseNotesProduct) {
  return product === 'home' ? 'qortium-home' : 'qortium-core'
}

function apiBase(product: HomeV2ReleaseNotesProduct) {
  return `https://api.github.com/repos/QortiumDev/${repository(product)}`
}

function trustedReleaseUrl(
  value: unknown,
  product: HomeV2ReleaseNotesProduct,
  tagName: string,
) {
  const raw = string(value, 500)
  try {
    const parsed = new URL(raw)
    const expectedPath = `/QortiumDev/${repository(product)}/releases/tag/${encodeURIComponent(tagName)}`
    return parsed.protocol === 'https:' &&
      parsed.hostname === 'github.com' &&
      parsed.pathname === expectedPath &&
      !parsed.search &&
      !parsed.hash
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

export function normalizeHomeV2ReleaseNotesEntry(
  value: unknown,
  product: HomeV2ReleaseNotesProduct,
): HomeV2ReleaseNotesEntry | null {
  if (!isRecord(value) || value.draft === true) return null
  const tagName = string(value.tag_name, 100)
  if (!tagName) return null
  const htmlUrl = trustedReleaseUrl(value.html_url, product, tagName)
  if (!htmlUrl) return null
  if (typeof value.body === 'string' && value.body.length > MAX_RELEASE_BODY_CHARS) {
    return null
  }
  const body = string(value.body, MAX_RELEASE_BODY_CHARS)
  return {
    body,
    htmlUrl,
    name: string(value.name, 200) || tagName,
    publishedAt: string(value.published_at, 100),
    tagName,
  }
}

async function readBoundedJson(response: Response) {
  const contentLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error('release-notes-response-too-large')
  }
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel('release-notes-response-too-large')
      throw new Error('release-notes-response-too-large')
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

async function requestGithubJson(url: string, fetchImpl: FetchLike) {
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
    if (!response.ok) throw new Error(`release-notes-http-${response.status}`)
    return readBoundedJson(response)
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchHomeV2ReleaseNotes(
  product: HomeV2ReleaseNotesProduct,
  requestedTag: string | null,
  fetchImpl: FetchLike = fetch,
) {
  const listUrl = `${apiBase(product)}/releases?per_page=${MAX_RELEASES}`
  const listed = await requestGithubJson(listUrl, fetchImpl)
  const releases = Array.isArray(listed)
    ? listed
        .slice(0, MAX_RELEASES)
        .map((value) => normalizeHomeV2ReleaseNotesEntry(value, product))
        .filter((value): value is HomeV2ReleaseNotesEntry => value !== null)
    : []
  let selected = requestedTag
    ? releases.find((release) => release.tagName === requestedTag) ?? null
    : releases[0] ?? null
  if (!selected && requestedTag) {
    const taggedUrl = `${apiBase(product)}/releases/tags/${encodeURIComponent(requestedTag)}`
    selected = normalizeHomeV2ReleaseNotesEntry(
      await requestGithubJson(taggedUrl, fetchImpl),
      product,
    )
  }
  return { releases, selected }
}
