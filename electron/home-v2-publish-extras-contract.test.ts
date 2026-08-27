import assert from 'node:assert/strict'

import {
  HOME_V2_PUBLISH_MULTIPLE_MAX_ITEMS,
  normalizeHomeV2PublishMultipleRequest,
  normalizeHomeV2QdnDeleteRequest,
} from './home-v2-publish-extras-contract.js'

const token = (last: string) => `12345678-1234-4123-8123-1234567890a${last}`

const item = (index: number, extra: Record<string, unknown> = {}) => ({
  name: 'Alice',
  service: 'DOCUMENT',
  identifier: `doc-${index}`,
  sourceToken: token(String(index)),
  ...extra,
})

// --- PUBLISH_MULTIPLE_QDN_RESOURCES ---

// Valid two-item batch round-trips with normalized coordinates and tokens.
{
  const request = normalizeHomeV2PublishMultipleRequest('qortium', {
    resources: [item(0), item(1, { identifier: undefined })],
  })
  assert.equal(request.items.length, 2)
  assert.equal(request.items[0].resource.service, 'DOCUMENT')
  assert.equal(request.items[0].resource.identifier, 'doc-0')
  assert.equal(request.items[0].sourceToken, token('0'))
  assert.equal(request.items[1].resource.identifier, undefined)
}

// payload.resources takes precedence over a top-level decoy.
{
  const request = normalizeHomeV2PublishMultipleRequest('qortium', {
    payload: { resources: [item(0)] },
    resources: [item(1, { name: 'Decoy' })],
  })
  assert.equal(request.items.length, 1)
  assert.equal(request.items[0].resource.identifier, 'doc-0')
}

// Batch bounds: empty and over-cap are refused.
assert.throws(() => normalizeHomeV2PublishMultipleRequest('qortium', { resources: [] }), /non-empty/)
assert.throws(
  () => normalizeHomeV2PublishMultipleRequest('qortium', {
    resources: Array.from({ length: HOME_V2_PUBLISH_MULTIPLE_MAX_ITEMS + 1 }, (_, index) => item(index)),
  }),
  /at most 10/,
)

// Ten distinct items are accepted at the cap.
assert.equal(
  normalizeHomeV2PublishMultipleRequest('qortium', {
    resources: Array.from({ length: 10 }, (_, index) => item(index)),
  }).items.length,
  10,
)

// Inline bytes are refused per item — the Home 2 token contract, exactly as
// the single publish action refuses them.
assert.throws(
  () => normalizeHomeV2PublishMultipleRequest('qortium', { resources: [item(0, { data64: 'aGk=' })] }),
  /resource 1: .*sourceToken/,
)
assert.throws(
  () => normalizeHomeV2PublishMultipleRequest('qortium', { resources: [item(0), item(1, { path: '/etc/passwd' })] }),
  /resource 2: .*sourceToken/,
)

// Inline bytes nested inside payload get the same named refusal (review
// round 1, finding 5 — the resource parser reads payload-first).
assert.throws(
  () => normalizeHomeV2PublishMultipleRequest('qortium', {
    resources: [item(0, { payload: { data64: 'aGk=' } })],
  }),
  /resource 1: .*sourceToken/,
)

// One approved file selection cannot back two transactions.
assert.throws(
  () => normalizeHomeV2PublishMultipleRequest('qortium', {
    resources: [item(0), item(1, { sourceToken: token('0') })],
  }),
  /distinct sourceToken/,
)

// Network pinning at the request and item level.
assert.throws(
  () => normalizeHomeV2PublishMultipleRequest('qortium', { network: 'qortal', resources: [item(0)] }),
  /network must match/,
)
assert.throws(
  () => normalizeHomeV2PublishMultipleRequest('qortium', { resources: [item(0, { network: 'qortal' })] }),
  /resource 1: .*network must match/,
)

// A non-object entry is refused with its position named.
assert.throws(
  () => normalizeHomeV2PublishMultipleRequest('qortium', { resources: [item(0), 'evil'] }),
  /resource 2: /,
)

// An app-provided fee is refused (Home derives fees from the chain).
assert.throws(
  () => normalizeHomeV2PublishMultipleRequest('qortium', { resources: [item(0, { fee: 1 })] }),
  /resource 1: .*fee/i,
)

// Private services are refused by the shared service gate.
assert.throws(
  () => normalizeHomeV2PublishMultipleRequest('qortium', {
    resources: [item(0, { service: 'QCHAT_ATTACHMENT_PRIVATE' })],
  }),
  /resource 1: /,
)

// --- DELETE_QDN_RESOURCE ---

// Valid delete round-trips; a 'default' identifier normalizes to null.
{
  const request = normalizeHomeV2QdnDeleteRequest({ name: 'Alice', service: 'document', identifier: 'doc-1' })
  assert.deepEqual(request, { identifier: 'doc-1', name: 'Alice', service: 'DOCUMENT' })
  assert.equal(normalizeHomeV2QdnDeleteRequest({ name: 'Alice', service: 'DOCUMENT', identifier: 'default' }).identifier, null)
  assert.equal(normalizeHomeV2QdnDeleteRequest({ name: 'Alice', service: 'DOCUMENT' }).identifier, null)
}

// Qortium only.
assert.throws(() => normalizeHomeV2QdnDeleteRequest({ name: 'Alice', service: 'DOCUMENT', network: 'qortal' }), /Qortium chain only/)

// A deletion signs no bytes or metadata: every content and metadata field is
// refused rather than ignored — at the top level and inside payload.
for (const field of ['data64', 'base64', 'path', 'sourceToken', 'title', 'description', 'category', 'tags', 'tag1']) {
  assert.throws(
    () => normalizeHomeV2QdnDeleteRequest({ name: 'Alice', service: 'DOCUMENT', [field]: field === 'tags' ? ['x'] : 'x' }),
    new RegExp(`does not accept ${field}`),
    `field ${field}`,
  )
  assert.throws(
    () => normalizeHomeV2QdnDeleteRequest({ name: 'Alice', service: 'DOCUMENT', payload: { [field]: 'x' } }),
    new RegExp(`does not accept ${field}`),
    `payload field ${field}`,
  )
}
// An EMPTY tags array is not a smuggled value and does not refuse.
assert.equal(normalizeHomeV2QdnDeleteRequest({ name: 'Alice', service: 'DOCUMENT', tags: [] }).name, 'Alice')

// Fee, byte limits and dot segments.
assert.throws(() => normalizeHomeV2QdnDeleteRequest({ name: 'Alice', service: 'DOCUMENT', fee: 1 }), /does not accept an app-provided fee/)
assert.throws(() => normalizeHomeV2QdnDeleteRequest({ name: 'A'.repeat(41), service: 'DOCUMENT' }), /40 byte/)
assert.throws(() => normalizeHomeV2QdnDeleteRequest({ name: 'Alice', service: 'DOCUMENT', identifier: 'i'.repeat(65) }), /64 byte/)
assert.throws(() => normalizeHomeV2QdnDeleteRequest({ name: '..', service: 'DOCUMENT' }), /dot segment/)
assert.throws(() => normalizeHomeV2QdnDeleteRequest({ name: 'Alice', service: 'DOCUMENT', identifier: '.' }), /dot segment/)

// Private and unknown services are refused by the shared gate.
assert.throws(() => normalizeHomeV2QdnDeleteRequest({ name: 'Alice', service: 'QCHAT_ATTACHMENT_PRIVATE' }), /Private/)
assert.throws(() => normalizeHomeV2QdnDeleteRequest({ name: 'Alice', service: 'NOT_A_SERVICE' }), /public QDN services/)

console.log('Home v2 publish extras contract tests passed.')
