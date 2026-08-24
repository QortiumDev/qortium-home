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
    if (!identity.address || !identity.avatar) return { status: 'missing' }
    return nodeClient.readAvatar(network, {
      address: identity.address,
      pointer: identity.avatar,
    })
  }
}
