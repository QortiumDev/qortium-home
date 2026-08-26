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
