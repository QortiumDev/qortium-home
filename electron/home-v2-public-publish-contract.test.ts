import assert from 'node:assert/strict'

import {
  createHomeV2PublicPublishDescriptor,
  normalizeHomeV2PublicPublishRequest,
  sha256Hex,
} from './home-v2-public-publish-contract.js'

const token = '11111111-1111-4111-8111-111111111111'
const request = normalizeHomeV2PublicPublishRequest('qortium', {
  action: 'PUBLISH_QDN_RESOURCE',
  identifier: 'chat-attachment-1',
  name: 'Alice',
  service: 'ATTACHMENT',
  sourceToken: token,
})
assert.equal(request.sourceToken, token)
assert.equal(request.resource.service, 'ATTACHMENT')
assert.throws(
  () => normalizeHomeV2PublicPublishRequest('qortium', { ...request.resource, data64: 'AA==', sourceToken: token }),
  /only a Home-issued sourceToken/,
)
assert.throws(
  () => normalizeHomeV2PublicPublishRequest('qortium', { ...request.resource, network: 'qortal', sourceToken: token }),
  /must match/,
)
assert.throws(
  () => normalizeHomeV2PublicPublishRequest('qortium', { ...request.resource, name: '..', sourceToken: token }),
  /dot segment/,
)
assert.throws(
  () => normalizeHomeV2PublicPublishRequest('qortal', { ...request.resource, title: 'mutable', sourceToken: token }),
  /does not yet accept mutable resource metadata/,
)
assert.throws(
  () => normalizeHomeV2PublicPublishRequest('qortium', { ...request.resource, description: 'x'.repeat(501), sourceToken: token }),
  /description exceeds/,
)
assert.equal(await sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
assert.equal(createHomeV2PublicPublishDescriptor({
  contentHash: '00'.repeat(32),
  fileName: 'hello.txt',
  network: 'qortium',
  resource: request.resource,
  size: 5,
  transactionSignature: 'signature',
}).immutable.contentHash, '00'.repeat(32))

console.log('Home v2 public publish contract tests passed.')
