import { CapacitorHttp } from '@capacitor/core'
import type { ReleaseNotesSource } from './ReleaseNotesPage'

type Product = 'core' | 'home'

const MAX_RELEASES = 100
const MAX_RESPONSE_CHARS = 2 * 1024 * 1024
const MAX_BODY_CHARS = 512 * 1024
const documents = new Map<string, ReadonlySet<string>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function string(value: unknown, maxLength: number, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maxLength) return null
  const normalized = value.trim()
  return normalized || allowEmpty ? normalized : null
}

function repository(product: Product) {
  return product === 'home' ? 'qortium-home' : 'qortium-core'
}

function releaseUrl(value: unknown, product: Product, tagName: string) {
  const raw = string(value, 500)
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    const path = `/QortiumDev/${repository(product)}/releases/tag/${encodeURIComponent(tagName)}`
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com' && parsed.pathname === path && !parsed.search && !parsed.hash
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

function normalizeRelease(value: unknown, product: Product) {
  if (!isRecord(value) || value.draft === true) return null
  const tagName = string(value.tag_name, 100)
  const name = string(value.name, 200) ?? tagName
  const publishedAt = string(value.published_at, 100, true)
  const body = string(value.body, MAX_BODY_CHARS, true)
  const htmlUrl = tagName ? releaseUrl(value.html_url, product, tagName) : null
  return tagName && name && publishedAt !== null && body !== null && htmlUrl
    ? { body, htmlUrl, name, publishedAt, tagName }
    : null
}

export function extractAndroidHomeV2ReleaseNotesLinks(body: string, htmlUrl: string) {
  const links = new Set<string>([htmlUrl])
  for (const match of body.matchAll(/https:\/\/[^\s<>()]+/gi)) {
    for (const candidate of new Set([match[0], match[0].replace(/[.,;:!?]+$/, '')])) {
      try {
        const parsed = new URL(candidate)
        if (parsed.protocol === 'https:') links.add(parsed.toString())
      } catch {
        // Invalid release-body links remain inert.
      }
    }
  }
  return links
}

const source: ReleaseNotesSource = {
  async load(product, requestedTag) {
    const repo = repository(product)
    const response = await CapacitorHttp.get({
      connectTimeout: 4_000,
      headers: { Accept: 'application/vnd.github+json' },
      readTimeout: 4_000,
      url: `https://api.github.com/repos/QortiumDev/${repo}/releases?per_page=${MAX_RELEASES}`,
    })
    if (response.status < 200 || response.status >= 300 || !Array.isArray(response.data)) {
      throw new Error(`GitHub returned HTTP ${response.status}.`)
    }
    if (JSON.stringify(response.data).length > MAX_RESPONSE_CHARS) {
      throw new Error('The release notes response was too large.')
    }
    const entries = response.data
      .slice(0, MAX_RELEASES)
      .map((value: unknown) => normalizeRelease(value, product))
      .filter((value): value is NonNullable<typeof value> => value !== null)
    const selected = requestedTag
      ? entries.find((release) => release.tagName === requestedTag) ?? null
      : entries[0] ?? null
    if (!selected) throw new Error('The requested release notes were not found.')
    const documentId = `android-${globalThis.crypto.randomUUID()}`
    documents.set(documentId, extractAndroidHomeV2ReleaseNotesLinks(selected.body, selected.htmlUrl))
    while (documents.size > 8) documents.delete(documents.keys().next().value as string)
    return {
      documentId,
      releases: entries.map(({ body: _body, ...release }) => release),
      selected,
    }
  },
  async openLink(documentId, url) {
    if (!documents.get(documentId)?.has(url)) {
      throw new Error('The release notes link is no longer authorized.')
    }
    await window.qortiumHome.updates.openReleasePage(url)
  },
}

export function getAndroidHomeV2ReleaseNotesSource() {
  return source
}
