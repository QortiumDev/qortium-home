import type {
  AppResourceIdentity,
  AppResourceLocation,
  NetworkId,
} from './contracts'

export type AppResourceScheme = 'qdn' | 'qortal'

export interface ParsedAppResourceLocation {
  readonly identity: AppResourceIdentity
  readonly location: AppResourceLocation
  readonly sourceNetwork: NetworkId
}

function schemeForNetwork(network: NetworkId): AppResourceScheme {
  return network === 'qortium' ? 'qdn' : 'qortal'
}

function networkForScheme(scheme: AppResourceScheme): NetworkId {
  return scheme === 'qdn' ? 'qortium' : 'qortal'
}

function encodeSegment(value: string) {
  return encodeURIComponent(value.trim())
}

function decodeSegment(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error('App resource address contains invalid encoding.')
  }
}

export function buildAppResourceLocation(
  sourceNetwork: NetworkId,
  identity: AppResourceIdentity,
): AppResourceLocation {
  const name = identity.name.trim()
  const identifier = identity.identifier?.trim() || 'default'
  if (!name) throw new Error('App resource name is required.')

  return `${schemeForNetwork(sourceNetwork)}://${identity.service}/${encodeSegment(name)}/${encodeSegment(identifier)}` as AppResourceLocation
}

export function parseAppResourceLocation(
  value: string,
): ParsedAppResourceLocation {
  const match = /^(qdn|qortal):\/\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)$/.exec(
    value.trim(),
  )
  if (!match) {
    throw new Error('Use a complete qdn:// or qortal:// app resource address.')
  }

  const [, rawScheme, rawService, rawName, rawIdentifier] = match
  const scheme = rawScheme as AppResourceScheme
  const service = decodeSegment(rawService).toUpperCase()
  if (service !== 'APP') {
    throw new Error('The resource address does not identify an app.')
  }

  const name = decodeSegment(rawName).trim()
  const identifier = decodeSegment(rawIdentifier).trim()
  if (!name || !identifier) {
    throw new Error('App resource name and identifier are required.')
  }

  const location = buildAppResourceLocation(networkForScheme(scheme), {
    service: 'APP',
    name,
    identifier: identifier === 'default' ? null : identifier,
  })

  return Object.freeze({
    identity: Object.freeze({
      service: 'APP' as const,
      name,
      identifier: identifier === 'default' ? null : identifier,
    }),
    location,
    sourceNetwork: networkForScheme(scheme),
  })
}
