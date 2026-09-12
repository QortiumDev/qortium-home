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
    if (favicon.status === 'ready') return favicon

    // No usable favicon RIGHT NOW: absent (404), still being fetched from
    // QDN (202), or unreadable. All three used to stop here unless the answer
    // was a definitive 404, so an app the node had not finished downloading --
    // the common case for a fresh pin -- sat as a monogram through two
    // minutes of favicon retries although its publisher's avatar was a
    // single read away. Now the publisher's avatar is tried for every
    // non-ready outcome; only when there is no avatar either does the
    // original outcome go back, so a pending favicon keeps its retry loop.
    const fallback = await readPublisherAvatar(nodeClient, network, request.name)
    return fallback ?? favicon
  }
}

async function readPublisherAvatar(
  nodeClient: HomeV2NodeClient,
  network: NetworkId,
  name: string,
): Promise<VisibleAvatarReadResult | null> {
  const identity = await resolveIdentityOnNetwork(
    name,
    network,
    (targetNetwork, identityRequest) =>
      nodeClient.readIdentity(targetNetwork, identityRequest),
  ).catch(() => null)
  if (!identity?.address) return null

  // Prefer the avatar of the name the app is PUBLISHED under (Home 1
  // behaviour: "the avatar for the owned name"). resolveIdentityOnNetwork
  // reports the avatar of the owner's PRIMARY name, which for a publisher
  // with several names is a different picture — or none at all, which is why
  // apps published under their own named identity showed a monogram.
  const ownName = await nodeClient
    .readIdentity(network, { kind: 'legacyAvatarResource', value: name })
    .catch(() => null)
  const hasOwnAvatar = Array.isArray(ownName?.data) && ownName.data.some((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const candidate = entry as Record<string, unknown>
    return (
      String(candidate.service ?? '').toUpperCase() === 'THUMBNAIL' &&
      String(candidate.name ?? '').toLowerCase() === name.toLowerCase()
    )
  })
  if (hasOwnAvatar) {
    const own = await nodeClient
      .readAvatar(network, {
        address: identity.address,
        pointer: {
          identifier: network === 'qortal' ? 'qortal_avatar' : 'avatar',
          name,
          service: 'THUMBNAIL',
          source: 'legacy-name',
        },
      })
      .catch(() => null)
    if (own?.status === 'ready') return own
  }

  if (!identity.avatar) return null
  const primary = await nodeClient
    .readAvatar(network, { address: identity.address, pointer: identity.avatar })
    .catch(() => null)
  return primary?.status === 'ready' ? primary : null
}
