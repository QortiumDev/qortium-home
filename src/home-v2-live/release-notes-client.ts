import type {
  ReleaseNotesSource,
  ReleaseNotesSourceDocument,
} from '../ReleaseNotesPage'

type Product = 'core' | 'home'

type HomeV2ReleaseNotesBridge = {
  load(product: Product, tagName: string | null): Promise<unknown>
  openLink(documentId: string, url: string): Promise<unknown>
}

const MAX_RELEASES = 100
const MAX_BODY_CHARS = 512 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
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

function parseRelease(value: unknown, product: Product, withBody: boolean) {
  if (!isRecord(value)) return null
  const expected = withBody
    ? ['body', 'htmlUrl', 'name', 'publishedAt', 'tagName']
    : ['htmlUrl', 'name', 'publishedAt', 'tagName']
  if (!exactKeys(value, expected)) return null
  const tagName = string(value.tagName, 100)
  const name = string(value.name, 200)
  const publishedAt = string(value.publishedAt, 100, true)
  const htmlUrl = tagName ? releaseUrl(value.htmlUrl, product, tagName) : null
  const body = withBody ? string(value.body, MAX_BODY_CHARS, true) : ''
  if (!tagName || !name || publishedAt === null || !htmlUrl || body === null) return null
  return { body, htmlUrl, name, publishedAt, tagName }
}

export function parseHomeV2ReleaseNotesDocument(value: unknown): ReleaseNotesSourceDocument {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['documentId', 'product', 'releases', 'revision', 'schema', 'selected']) ||
    value.schema !== 'home-v2-release-notes-document' ||
    value.revision !== 1 ||
    (value.product !== 'home' && value.product !== 'core') ||
    !Array.isArray(value.releases) ||
    value.releases.length > MAX_RELEASES + 1 ||
    !string(value.documentId, 64)
  ) throw new Error('The release notes document was malformed.')
  const product = value.product
  const releases = value.releases.map((release) => parseRelease(release, product, false))
  const selected = parseRelease(value.selected, product, true)
  if (releases.some((release) => !release) || !selected) {
    throw new Error('The release notes document contained malformed releases.')
  }
  const validReleases = releases as NonNullable<(typeof releases)[number]>[]
  return {
    documentId: value.documentId as string,
    releases: validReleases.map(({ body: _body, ...release }) => release),
    selected,
  }
}

const source: ReleaseNotesSource = {
  async load(product, tagName) {
    const bridge = window.homeV2ReleaseNotes
    if (bridge) {
      return parseHomeV2ReleaseNotesDocument(await bridge.load(product, tagName))
    }
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      throw new Error('The release notes bridge is unavailable.')
    }
    const android = await import('../home-v2-android-release-notes')
    return android.getAndroidHomeV2ReleaseNotesSource().load(product, tagName)
  },
  async openLink(documentId, url) {
    const bridge = window.homeV2ReleaseNotes
    if (bridge) {
      const result = await bridge.openLink(documentId, url)
      if (!isRecord(result) || !exactKeys(result, ['revision', 'schema']) || result.revision !== 1 || result.schema !== 'home-v2-release-notes-link-opened') {
        throw new Error('The release notes link result was malformed.')
      }
      return
    }
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      throw new Error('The release notes bridge is unavailable.')
    }
    const android = await import('../home-v2-android-release-notes')
    await android.getAndroidHomeV2ReleaseNotesSource().openLink(documentId, url)
  },
}

export function getHomeV2ReleaseNotesSource() {
  return source
}

declare global {
  interface Window {
    homeV2ReleaseNotes?: HomeV2ReleaseNotesBridge
  }
}
