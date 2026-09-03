import assert from 'node:assert/strict'

import { homeV2AdminTrustRevision, type HomeV2AdminTrust } from './home-v2-admin-trust.js'
import {
  enableHomeV2CoreApiDocs,
  type HomeV2CoreDocsAdminDependencies,
  type HomeV2CoreDocsAdminNode,
} from './home-v2-core-docs-admin.js'

type Call = { apiKey: string; body?: string; method: string; nodeApiUrl: string; path: string }

function trustedNode(origin: string, apiKey: string): HomeV2CoreDocsAdminNode {
  const trust: HomeV2AdminTrust = {
    trusted: true,
    apiKey,
    origin,
    revision: homeV2AdminTrustRevision(origin, apiKey),
    source: 'attached',
  }
  return { apiKey, nodeApiUrl: origin, trust }
}

function harness(nodes: HomeV2CoreDocsAdminNode[], answers: { ok: boolean; status: number; text: string }[]) {
  const calls: Call[] = []
  let resolved = 0
  let answered = 0
  const dependencies: HomeV2CoreDocsAdminDependencies = {
    async resolveAdminNode() {
      const node = nodes[Math.min(resolved, nodes.length - 1)]
      resolved += 1
      return node
    },
    async request(input) {
      calls.push(input)
      const answer = answers[Math.min(answered, answers.length - 1)]
      answered += 1
      return answer
    },
  }
  return { calls, dependencies }
}

const ok = { ok: true, status: 200, text: '{"saved":true}' }

// --- The happy path: a REMOTE node the user administers -------------------
// The point of the change. Before 2026-09-02 this refused with "Only the
// configured local Core can be changed from Home" for a user who holds that
// node's API key and is plainly entitled to enable its docs.
{
  const node = trustedNode('https://core.example', 'user-key')
  const { calls, dependencies } = harness([node, node], [ok, { ok: true, status: 200, text: '' }])
  assert.deepEqual(await enableHomeV2CoreApiDocs('qortium', dependencies), { accepted: true })
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], {
    apiKey: 'user-key',
    body: JSON.stringify({ apiDocumentationEnabled: true }),
    method: 'PATCH',
    nodeApiUrl: 'https://core.example',
    path: '/admin/settings',
  })
  assert.deepEqual(calls[1], {
    apiKey: 'user-key',
    method: 'GET',
    nodeApiUrl: 'https://core.example',
    path: '/admin/restart',
  })
}

// --- Untrusted nodes refuse, and nothing is written -----------------------
for (const [reason, pattern] of [
  ['public-node', /your own Qortium Core/],
  ['key-missing', /needs your node's API key/],
  ['transport-unsafe', /secure route to the node/],
  ['unsupported-network', /not available for Qortal/],
] as const) {
  const { calls, dependencies } = harness(
    [{ apiKey: '', nodeApiUrl: 'https://core.example', trust: { trusted: false, reason } }],
    [ok],
  )
  await assert.rejects(() => enableHomeV2CoreApiDocs('qortium', dependencies), pattern)
  assert.equal(calls.length, 0, `${reason} must not reach the node`)
}

// A "trusted" answer with no key is refused too, rather than sending an
// unauthenticated PATCH that Core would reject with a confusing 403.
{
  const node = trustedNode('https://core.example', 'user-key')
  const { calls, dependencies } = harness([{ ...node, apiKey: '' }], [ok])
  await assert.rejects(() => enableHomeV2CoreApiDocs('qortium', dependencies), /needs your node's API key/)
  assert.equal(calls.length, 0)
}

// --- The node declining the settings write stops before the restart -------
{
  const node = trustedNode('https://core.example', 'user-key')
  const { calls, dependencies } = harness([node, node], [{ ok: true, status: 200, text: '{"saved":false}' }])
  await assert.rejects(() => enableHomeV2CoreApiDocs('qortium', dependencies), /declined the settings update/)
  assert.equal(calls.length, 1, 'a declined settings write must not restart the node')
}
{
  const node = trustedNode('https://core.example', 'user-key')
  const { calls, dependencies } = harness([node, node], [{ ok: false, status: 403, text: 'no' }])
  await assert.rejects(() => enableHomeV2CoreApiDocs('qortium', dependencies), /no/)
  assert.equal(calls.length, 1)
}

// --- REVISION RECHECK immediately before /admin/restart -------------------
// The restart is the destructive half. A node switched, or a key re-attached,
// between the settings write and the restart must not inherit the decision
// that was made about the first node.
{
  const before = trustedNode('https://core.example', 'user-key')
  const rotated = trustedNode('https://core.example', 'rotated-key')
  const { calls, dependencies } = harness([before, rotated], [ok, { ok: true, status: 200, text: '' }])
  await assert.rejects(
    () => enableHomeV2CoreApiDocs('qortium', dependencies),
    /changed before the restart/,
  )
  assert.equal(calls.length, 1, 'only the settings write may have happened')
  assert.equal(calls[0].path, '/admin/settings')
}
{
  const before = trustedNode('https://core.example', 'user-key')
  const moved = trustedNode('https://other.example', 'user-key')
  const { calls, dependencies } = harness([before, moved], [ok, { ok: true, status: 200, text: '' }])
  await assert.rejects(
    () => enableHomeV2CoreApiDocs('qortium', dependencies),
    /changed before the restart/,
  )
  assert.equal(calls.length, 1)
}
// Trust lost outright between the two halves refuses with the trust wording.
{
  const before = trustedNode('https://core.example', 'user-key')
  const { calls, dependencies } = harness(
    [before, { apiKey: '', nodeApiUrl: '', trust: { trusted: false, reason: 'key-missing' } }],
    [ok, { ok: true, status: 200, text: '' }],
  )
  await assert.rejects(() => enableHomeV2CoreApiDocs('qortium', dependencies), /Restarting the node/)
  assert.equal(calls.length, 1)
}

console.log('Home v2 Core API docs admin tests passed.')
