import assert from 'node:assert/strict'
import { homeV2Fixture } from './test-kit/fixtures.js'
import { deriveI2pCoreHealth } from './i2p-health.js'

const fixture = homeV2Fixture.nodes.qortium

{
  const health = deriveI2pCoreHealth({
    ...fixture,
    i2pChainSessionUp: true,
    i2pDataSessionUp: false,
    i2pChainLeaseSetLookupStatus: 'RESOLVED',
    i2pDataLeaseSetLookupStatus: 'NOT_RESOLVED',
    i2pPeerCount: 0,
    i2pDataPeerCount: 2,
  })
  assert.deepEqual(health.chain, {
    conflict: false,
    lastInboundHandshakeTimestamp: fixture.i2pChainLastInboundHandshakeTimestamp,
    leaseSet: 'resolved',
    leaseSetLookupTimestamp: fixture.i2pChainLeaseSetLookupTimestamp,
    peerCount: 0,
    session: 'up',
  })
  assert.equal(health.data.conflict, true,
    'positive peers with a down session must be reported as conflicting observations')
}

{
  const health = deriveI2pCoreHealth({
    ...fixture,
    i2pChainSessionUp: null,
    i2pDataSessionUp: null,
    i2pChainLeaseSetLookupStatus: null,
    i2pDataLeaseSetLookupStatus: null,
    i2pChainLeaseSetLookupTimestamp: null,
    i2pDataLeaseSetLookupTimestamp: null,
    i2pPeerCount: null,
    i2pDataPeerCount: null,
    i2pChainLastInboundHandshakeTimestamp: null,
    i2pDataLastInboundHandshakeTimestamp: null,
  })
  assert.equal(health.reported, false)
  assert.equal(health.chain.peerCount, null, 'unknown must never be coerced to zero')
}

console.log('Home v2 I2P health tests passed.')
