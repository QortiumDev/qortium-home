import type {
  NetworkId,
  VisibleAppIconLoader,
  VisibleAppIconReadRequest,
  VisibleAvatarReadResult,
} from '../v2/contracts'
import { resolveIdentityOnNetwork } from './identity-resolver'
import type { HomeV2NodeClient } from './node-client'

export function createHomeV2AppIconLoader(
  nodeClient: HomeV2NodeClient,
): VisibleAppIconLoader {
  return async (
    network: NetworkId,
    request: VisibleAppIconReadRequest,
  ): Promise<VisibleAvatarReadResult> => {
    const favicon = await nodeClient.readAppIcon(network, request)
    if (favicon.status !== 'missing') return favicon

    const identity = await resolveIdentityOnNetwork(
      request.name,
      network,
      (targetNetwork, identityRequest) =>
        nodeClient.readIdentity(targetNetwork, identityRequest),
    )
    if (!identity.address) return { status: 'missing' }

    // Prefer the avatar of the name the app is PUBLISHED under (Home 1
    // behaviour: "the avatar for the owned name"). resolveIdentityOnNetwork
    // reports the avatar of the owner's PRIMARY name, which for a publisher
    // with several names is a different picture — or none at all, which is why
    // apps published under their own named identity showed a monogram.
    const ownName = await nodeClient
      .readIdentity(network, { kind: 'legacyAvatarResource', value: request.name })
      .catch(() => null)
    const hasOwnAvatar = Array.isArray(ownName?.data) && ownName.data.some((entry) => {
      if (!entry || typeof entry !== 'object') return false
      const candidate = entry as Record<string, unknown>
      return (
        String(candidate.service ?? '').toUpperCase() === 'THUMBNAIL' &&
        String(candidate.name ?? '').toLowerCase() === request.name.toLowerCase()
      )
    })
    if (hasOwnAvatar) {
      const own = await nodeClient.readAvatar(network, {
        address: identity.address,
        pointer: {
          identifier: network === 'qortal' ? 'qortal_avatar' : 'avatar',
          name: request.name,
          service: 'THUMBNAIL',
          source: 'legacy-name',
        },
      })
      if (own.status !== 'missing') return own
    }

    if (!identity.avatar) return { status: 'missing' }
    return nodeClient.readAvatar(network, {
      address: identity.address,
      pointer: identity.avatar,
    })
  }
}
