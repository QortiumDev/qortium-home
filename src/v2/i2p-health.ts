import type { NodeSummary } from './contracts'

export type I2pCorePlaneHealth = Readonly<{
  readonly conflict: boolean
  readonly lastInboundHandshakeTimestamp: number | null
  readonly leaseSet: 'not-reported' | 'not-resolved' | 'resolved' | 'unknown'
  readonly leaseSetLookupTimestamp: number | null
  readonly peerCount: number | null
  readonly session: 'down' | 'not-reported' | 'up'
}>

export type I2pCoreHealth = Readonly<{
  readonly chain: I2pCorePlaneHealth
  readonly data: I2pCorePlaneHealth
  readonly reported: boolean
}>

function planeHealth(input: {
  readonly lastInboundHandshakeTimestamp: number | null
  readonly leaseSet: NodeSummary['i2pChainLeaseSetLookupStatus']
  readonly leaseSetLookupTimestamp: number | null
  readonly peerCount: number | null
  readonly sessionUp: boolean | null
}): I2pCorePlaneHealth {
  const session = input.sessionUp === null
    ? 'not-reported' as const
    : input.sessionUp
      ? 'up' as const
      : 'down' as const
  const leaseSet = input.leaseSet === null
    ? 'not-reported' as const
    : input.leaseSet === 'RESOLVED'
      ? 'resolved' as const
      : input.leaseSet === 'NOT_RESOLVED'
        ? 'not-resolved' as const
        : 'unknown' as const
  return Object.freeze({
    conflict: session === 'down' && input.peerCount !== null && input.peerCount > 0,
    lastInboundHandshakeTimestamp: input.lastInboundHandshakeTimestamp,
    leaseSet,
    leaseSetLookupTimestamp: input.leaseSetLookupTimestamp,
    peerCount: input.peerCount,
    session,
  })
}

/**
 * Preserve Core's independent facts instead of manufacturing one green/red
 * health score. In particular, zero peers is known inactivity, while null is
 * an older Core or an omitted field; neither is converted into the other.
 */
export function deriveI2pCoreHealth(node: NodeSummary): I2pCoreHealth {
  const chain = planeHealth({
    lastInboundHandshakeTimestamp: node.i2pChainLastInboundHandshakeTimestamp,
    leaseSet: node.i2pChainLeaseSetLookupStatus,
    leaseSetLookupTimestamp: node.i2pChainLeaseSetLookupTimestamp,
    peerCount: node.i2pPeerCount,
    sessionUp: node.i2pChainSessionUp,
  })
  const data = planeHealth({
    lastInboundHandshakeTimestamp: node.i2pDataLastInboundHandshakeTimestamp,
    leaseSet: node.i2pDataLeaseSetLookupStatus,
    leaseSetLookupTimestamp: node.i2pDataLeaseSetLookupTimestamp,
    peerCount: node.i2pDataPeerCount,
    sessionUp: node.i2pDataSessionUp,
  })
  return Object.freeze({
    chain,
    data,
    reported: [chain, data].some((plane) =>
      plane.session !== 'not-reported' || plane.leaseSet !== 'not-reported' ||
      plane.leaseSetLookupTimestamp !== null || plane.peerCount !== null ||
      plane.lastInboundHandshakeTimestamp !== null),
  })
}
