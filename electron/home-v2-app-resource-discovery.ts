export interface HomeV2AppResourceCandidate {
  identifier: string | null
  name: string
}

const APP_RESOURCE_LIMIT = 50

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

export function buildHomeV2AppResourceSearchPath(value: unknown) {
  const query = new URLSearchParams({
    service: 'APP',
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
      service !== 'APP'
    ) {
      continue
    }
    const rawIdentifier = stringField(entry, 'identifier')
    const identifier =
      !rawIdentifier || rawIdentifier.toLowerCase() === 'default'
        ? null
        : rawIdentifier
    const key = identifier?.toLowerCase() ?? 'default'
    if (!candidates.has(key)) {
      candidates.set(key, { identifier, name: candidateName })
    }
  }
  return Object.freeze(
    [...candidates.values()].sort((left, right) => {
      if (left.identifier === null) return -1
      if (right.identifier === null) return 1
      return left.identifier.localeCompare(right.identifier)
    }),
  )
}
