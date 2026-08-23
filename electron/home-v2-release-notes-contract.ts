import { randomUUID } from 'node:crypto'
import type { IpcMainInvokeEvent } from 'electron'
import type {
  HomeV2ReleaseNotesEntry,
  HomeV2ReleaseNotesProduct,
} from './home-v2-release-notes-discovery.js'

type ReleaseNotesDocument = {
  readonly documentId: string
  readonly product: HomeV2ReleaseNotesProduct
  readonly releases: readonly Omit<HomeV2ReleaseNotesEntry, 'body'>[]
  readonly revision: 1
  readonly schema: 'home-v2-release-notes-document'
  readonly selected: HomeV2ReleaseNotesEntry
}

type Dependencies = {
  readonly fetchNotes: (
    product: HomeV2ReleaseNotesProduct,
    requestedTag: string | null,
  ) => Promise<{
    releases: readonly HomeV2ReleaseNotesEntry[]
    selected: HomeV2ReleaseNotesEntry | null
  }>
  readonly openExternal: (url: string) => void | Promise<void>
  readonly uuid?: () => string
}

type StoredDocument = {
  readonly allowedLinks: ReadonlySet<string>
  readonly document: ReleaseNotesDocument
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

function normalizeLoadRequest(value: unknown) {
  if (!exactRecord(value, ['product', 'revision', 'schema', 'tagName'])) {
    throw new Error('An exact release notes request is required.')
  }
  if (value.schema !== 'home-v2-release-notes-load-request' || value.revision !== 1) {
    throw new Error('The release notes request schema is unsupported.')
  }
  if (value.product !== 'home' && value.product !== 'core') {
    throw new Error('Choose a valid release notes product.')
  }
  const tagName = value.tagName === null
    ? null
    : typeof value.tagName === 'string'
      ? value.tagName.trim()
      : ''
  if (tagName !== null && (!tagName || tagName.length > 100)) {
    throw new Error('Choose a valid release tag.')
  }
  return { product: value.product, tagName } as const
}

function normalizeOpenRequest(value: unknown) {
  if (!exactRecord(value, ['documentId', 'revision', 'schema', 'url'])) {
    throw new Error('An exact release notes link request is required.')
  }
  if (value.schema !== 'home-v2-release-notes-open-link-request' || value.revision !== 1) {
    throw new Error('The release notes request schema is unsupported.')
  }
  const documentId = typeof value.documentId === 'string' ? value.documentId.trim() : ''
  const url = typeof value.url === 'string' ? value.url.trim() : ''
  if (!/^[a-f0-9-]{16,64}$/i.test(documentId) || !url || url.length > 2_000) {
    throw new Error('Choose a valid release notes link.')
  }
  return { documentId, url }
}

export function extractHomeV2ReleaseNotesLinks(body: string) {
  const links = new Set<string>()
  const pattern = /https:\/\/[^\s<>()]+/gi
  for (const match of body.matchAll(pattern)) {
    for (const candidate of new Set([match[0], match[0].replace(/[.,;:!?]+$/, '')])) {
      try {
        const parsed = new URL(candidate)
        if (parsed.protocol === 'https:') links.add(parsed.toString())
      } catch {
        // Malformed body links remain inert in the renderer.
      }
    }
  }
  return links
}

export function createHomeV2ReleaseNotesService(dependencies: Dependencies) {
  const uuid = dependencies.uuid ?? randomUUID
  const documents = new Map<string, StoredDocument>()
  return {
    async load(value: unknown): Promise<ReleaseNotesDocument> {
      const { product, tagName } = normalizeLoadRequest(value)
      const result = await dependencies.fetchNotes(product, tagName)
      if (!result.selected) throw new Error('The requested release notes were not found.')
      const documentId = uuid()
      const releases = result.releases.map(({ body: _body, ...release }) => release)
      if (!releases.some((release) => release.tagName === result.selected!.tagName)) {
        releases.unshift((({ body: _body, ...release }) => release)(result.selected))
      }
      const document: ReleaseNotesDocument = {
        documentId,
        product,
        releases,
        revision: 1,
        schema: 'home-v2-release-notes-document',
        selected: result.selected,
      }
      const allowedLinks = extractHomeV2ReleaseNotesLinks(result.selected.body)
      allowedLinks.add(result.selected.htmlUrl)
      documents.set(documentId, { allowedLinks, document })
      while (documents.size > 8) documents.delete(documents.keys().next().value as string)
      return document
    },
    async openLink(value: unknown) {
      const { documentId, url } = normalizeOpenRequest(value)
      const stored = documents.get(documentId)
      if (!stored || !stored.allowedLinks.has(url)) {
        throw new Error('The release notes link is no longer authorized.')
      }
      await dependencies.openExternal(url)
      return { revision: 1, schema: 'home-v2-release-notes-link-opened' } as const
    },
  }
}

export function createAuthorizedHomeV2ReleaseNotesHandlers(
  assertAuthorized: (event: IpcMainInvokeEvent) => void,
  service: ReturnType<typeof createHomeV2ReleaseNotesService>,
) {
  return {
    load(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.load(value)
    },
    openLink(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.openLink(value)
    },
  }
}
