import {
  QDN_BROWSER_ARCHIVE_SERVICES,
  isQdnBrowserArchiveService,
  type QdnBrowserArchiveService,
} from './qdn-browser-archive-services.js'

export interface HomeV2AppResourceCandidate {
  identifier: string | null
  name: string
  // R4-4: the candidate's REAL service. The caller rebuilds the qdn:// address
  // from this, so a WEBSITE or GAME match can never be relabelled as an APP.
  service: QdnBrowserArchiveService
}

const APP_RESOURCE_LIMIT = 50
// Core implements the search's `identifier=` as a case-insensitive
// LIKE '%value%', so a substring identifier can occupy a limit=1 result and the
// exact resource is never seen. Pull several candidates and select the exact,
// case-correct identity client-side instead.
const SIGNATURE_SEARCH_LIMIT = 20

export function normalizeHomeV2AppResourceService(value: unknown): QdnBrowserArchiveService {
  // Defaults to APP: the search predates WEBSITE/GAME support, and the IPC
  // argument is optional so an older renderer keeps its historical behaviour.
  if (value === undefined || value === null) return 'APP'
  const service = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!isQdnBrowserArchiveService(service)) {
    throw new Error('App resource searches must use APP, WEBSITE, or GAME.')
  }
  return service
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringField(value: unknown, key: string) {
  if (!isRecord(value)) return null
  const field = value[key]
  return typeof field === 'string' && field.trim() ? field.trim() : null
}

export function normalizeHomeV2AppResourceName(value: unknown) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('App resource names must contain 1 to 128 visible characters.')
  }
  return name
}

// One request per service: Core's /arbitrary/resources/search takes a single
// `service`, and dropping it to search every service at once would let an
// unrelated service with many same-named resources (BLOG_POST, MAIL, ...)
// fill the result limit and crowd the archive match out. The caller passes
// the service its address named, so no fan-out is needed.
export function buildHomeV2AppResourceSearchPath(value: unknown, serviceValue?: unknown) {
  const query = new URLSearchParams({
    service: normalizeHomeV2AppResourceService(serviceValue),
    name: normalizeHomeV2AppResourceName(value),
    exactmatchnames: 'true',
    mode: 'ALL',
    includestatus: 'false',
    includemetadata: 'false',
    limit: String(APP_RESOURCE_LIMIT),
  })
  return `/arbitrary/resources/search?${query.toString()}`
}

// A resource identity the image cache content-addresses. `identifier` null (or
// 'default') selects the default resource, matching the renderer's revision
// lookup in useQdnImageResource.ts.
export interface HomeV2ResourceSignatureQuery {
  service: string
  name: string
  identifier: string | null
}

function normalizeSignatureService(value: unknown): string {
  const service = typeof value === 'string' ? value.trim().toUpperCase() : ''
  // Avatars use THUMBNAIL, app icons use APP/WEBSITE/GAME. The signature search
  // is not restricted to the browser-archive set, but the token is still
  // validated before it is interpolated into the node query.
  if (!/^[A-Z0-9_]{1,64}$/.test(service)) {
    throw new Error('Resource service must be a short uppercase token.')
  }
  return service
}

// Builds the cheap `/arbitrary/resources/search` used only to read a resource's
// current `latestSignature`. Metadata and status are excluded — the signature
// comes back regardless — and the identifier is pinned so a name with several
// identifiers resolves to exactly the one requested.
export function buildHomeV2ResourceSignatureSearchPath(resource: HomeV2ResourceSignatureQuery): string {
  const query = new URLSearchParams({
    service: normalizeSignatureService(resource.service),
    name: normalizeHomeV2AppResourceName(resource.name),
    identifier: resource.identifier ?? 'default',
    exactmatchnames: 'true',
    mode: 'ALL',
    includestatus: 'false',
    includemetadata: 'false',
    limit: String(SIGNATURE_SEARCH_LIMIT),
  })
  return `/arbitrary/resources/search?${query.toString()}`
}

// Extracts the latestSignature for exactly the requested resource from a search
// response. Returns null when nothing matches or the node omitted the field, so
// the caller degrades to an uncached fetch rather than caching wrong bytes.
export function parseHomeV2ResourceLatestSignature(
  value: unknown,
  resource: HomeV2ResourceSignatureQuery,
): string | null {
  if (!Array.isArray(value)) return null
  // Names match case-insensitively (Core's exactmatchnames is case-insensitive),
  // but identifiers are compared EXACTLY, case included: Core retrieves a
  // resource by case-sensitive `identifier = ?`, so `Logo` and `logo` are two
  // different resources and must not be conflated — folding case here could
  // accept the wrong resource's signature and defeat later republish
  // invalidation.
  const expectedName = normalizeHomeV2AppResourceName(resource.name).toLowerCase()
  const expectedService = normalizeSignatureService(resource.service)
  const expectedIdentifier = resource.identifier ?? 'default'
  for (const item of value) {
    const name = stringField(item, 'name')?.toLowerCase()
    const service = stringField(item, 'service')?.toUpperCase()
    const identifier = stringField(item, 'identifier') ?? 'default'
    if (
      name !== expectedName ||
      service !== expectedService ||
      identifier !== expectedIdentifier
    ) {
      continue
    }
    const signature = stringField(item, 'latestSignature')
    if (signature) return signature
  }
  return null
}

export function parseHomeV2AppResourceCandidates(
  value: unknown,
  requestedName: unknown,
): readonly HomeV2AppResourceCandidate[] {
  const name = normalizeHomeV2AppResourceName(requestedName)
  if (!Array.isArray(value)) {
    throw new Error('The node returned an invalid app resource list.')
  }
  const candidates = new Map<string, HomeV2AppResourceCandidate>()
  for (const entry of value) {
    const candidateName = stringField(entry, 'name')
    const service = stringField(entry, 'service')?.toUpperCase()
    if (
      !candidateName ||
      candidateName.toLowerCase() !== name.toLowerCase() ||
      !service ||
      // R4-4: accept the whole browser-archive set, not just APP. A
      // service-scoped search should only ever return one of them, but the
      // node is not trusted to honour that, so the filter is kept.
      !isQdnBrowserArchiveService(service)
    ) {
      continue
    }
    const rawIdentifier = stringField(entry, 'identifier')
    const identifier =
      !rawIdentifier || rawIdentifier.toLowerCase() === 'default'
        ? null
        : rawIdentifier
    // The dedupe key includes the service: an APP and a WEBSITE published
    // under the same name with the same identifier are two DIFFERENT
    // resources, and keying on the identifier alone silently dropped one.
    const key = `${service}:${identifier?.toLowerCase() ?? 'default'}`
    if (!candidates.has(key)) {
      candidates.set(key, { identifier, name: candidateName, service })
    }
  }
  // Deterministic order: browser-archive service order first (APP, then
  // WEBSITE, then GAME — so an exact-name APP match always wins a tie), then
  // the default identifier, then identifiers alphabetically.
  return Object.freeze(
    [...candidates.values()].sort((left, right) => {
      if (left.service !== right.service) {
        return (
          QDN_BROWSER_ARCHIVE_SERVICES.indexOf(left.service) -
          QDN_BROWSER_ARCHIVE_SERVICES.indexOf(right.service)
        )
      }
      if (left.identifier === null) return -1
      if (right.identifier === null) return 1
      return left.identifier.localeCompare(right.identifier)
    }),
  )
}
