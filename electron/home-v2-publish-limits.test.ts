import assert from 'node:assert/strict'

import { getHomeV2PublishSizeCeiling, resetHomeV2PublishSizeCeilingCache } from './home-v2-publish-limits.js'
import { HOME_V2_PUBLISH_SOURCE_MAX_BYTES } from './home-v2-publish-source-tokens.js'
import { PUBLIC_QDN_ATTESTATION_MAX_BYTES } from './qdn-content-attestation.js'

function jsonResponse(body: unknown, status = 200) {
  return async () => new Response(JSON.stringify(body), { status })
}

// Node advertises a small limit: that limit wins.
resetHomeV2PublishSizeCeilingCache()
{
  const ceiling = await getHomeV2PublishSizeCeiling(
    'qortium',
    'https://node-a.example',
    jsonResponse({ publicPublishMaxSize: 500 * 1024 * 1024 }),
  )
  assert.equal(ceiling, 500 * 1024 * 1024)
}

// Node advertises an absurd limit: Home's own hard ceiling wins instead.
resetHomeV2PublishSizeCeilingCache()
{
  const ceiling = await getHomeV2PublishSizeCeiling(
    'qortium',
    'https://node-b.example',
    jsonResponse({ publicPublishMaxSize: 999 * 1024 * 1024 * 1024 }),
  )
  assert.equal(ceiling, PUBLIC_QDN_ATTESTATION_MAX_BYTES)
}

// Endpoint missing / node too old: fall back to the conservative default.
resetHomeV2PublishSizeCeilingCache()
{
  const ceiling = await getHomeV2PublishSizeCeiling(
    'qortium',
    'https://node-c.example',
    async () => new Response('not found', { status: 404 }),
  )
  assert.equal(ceiling, HOME_V2_PUBLISH_SOURCE_MAX_BYTES)
}

// Malformed JSON body: also falls back rather than throwing.
resetHomeV2PublishSizeCeilingCache()
{
  const ceiling = await getHomeV2PublishSizeCeiling(
    'qortium',
    'https://node-d.example',
    async () => new Response('not json', { status: 200 }),
  )
  assert.equal(ceiling, HOME_V2_PUBLISH_SOURCE_MAX_BYTES)
}

// Response claims a body bigger than the 64 KiB limit: bounded fetch aborts
// and this also falls back rather than buffering an unbounded body.
resetHomeV2PublishSizeCeilingCache()
{
  const ceiling = await getHomeV2PublishSizeCeiling(
    'qortium',
    'https://node-f.example',
    async () =>
      new Response(JSON.stringify({ publicPublishMaxSize: 200 * 1024 * 1024 }), {
        status: 200,
        headers: { 'content-length': String(65 * 1024) },
      }),
  )
  assert.equal(ceiling, HOME_V2_PUBLISH_SOURCE_MAX_BYTES)
}

// Result is cached per (network, nodeApiUrl): a second call does not refetch.
resetHomeV2PublishSizeCeilingCache()
{
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return new Response(JSON.stringify({ publicPublishMaxSize: 200 * 1024 * 1024 }), { status: 200 })
  }
  await getHomeV2PublishSizeCeiling('qortium', 'https://node-e.example', fetchImpl)
  await getHomeV2PublishSizeCeiling('qortium', 'https://node-e.example', fetchImpl)
  assert.equal(calls, 1)
  // A different network on the SAME node URL is a different cache entry.
  await getHomeV2PublishSizeCeiling('qortal', 'https://node-e.example', fetchImpl)
  assert.equal(calls, 2)
}

console.log('Home v2 publish limits tests passed.')
