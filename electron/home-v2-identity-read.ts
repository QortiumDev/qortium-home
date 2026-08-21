export type HomeV2IdentityReadKind =
  | 'accountAvatarInfo'
  | 'legacyAvatarResource'
  | 'name'
  | 'namesByAddress'
  | 'primaryName'

export interface HomeV2IdentityReadRequest {
  readonly kind: HomeV2IdentityReadKind
  readonly value: string
}

export function buildHomeV2IdentityReadPath(
  network: 'qortal' | 'qortium',
  request: HomeV2IdentityReadRequest,
) {
  const value = request.value.trim()
  if (!value || value.length > 128) {
    throw new Error('Identity lookup values must contain 1 to 128 characters.')
  }
  const encoded = encodeURIComponent(value)
  switch (request.kind) {
    case 'name':
      return `/names/${encoded}`
    case 'namesByAddress':
      return `/names/address/${encoded}?limit=0`
    case 'primaryName':
      return `/names/primary/${encoded}`
    case 'accountAvatarInfo':
      return `/addresses/${encoded}/avatar/info`
    case 'legacyAvatarResource': {
      const query = new URLSearchParams({
        service: 'THUMBNAIL',
        name: value,
        identifier: network === 'qortal' ? 'qortal_avatar' : 'avatar',
        exactmatchnames: 'true',
        mode: 'ALL',
        includestatus: 'false',
        includemetadata: 'false',
        limit: '1',
      })
      return `/arbitrary/resources/search?${query.toString()}`
    }
  }
}
