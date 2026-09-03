import assert from 'node:assert/strict'

import { homeV2AdminTrustRevision, type HomeV2AdminTrust } from './home-v2-admin-trust.js'
import {
  enableHomeV2CoreApiDocs,
  type HomeV2CoreDocsAdminDependencies,
  type HomeV2CoreDocsAdminNode,
} from './home-v2-core-docs-admin.js'

type Call = { apiKey: string; body?: string; method: string; nodeApiUrl: string; path: string }

function trustedNode(origin: string, apiKey: string, bindingId = 'f'.repeat(32)): HomeV2CoreDocsAdminNode {
  const trust: HomeV2AdminTrust = {
    trusted: true,
    apiKey,
    bindingId,
    origin,
    revision: homeV2AdminTrustRevision(origin, apiKey),
    source: 'attached',
  }
  return { apiKey, nodeApiUrl: origin, trust }
}

type Answer = { ok: boolean; status: number; text: string }

/**
 * `answers` is keyed by "METHOD path" so a test states what each call returns
 * without depending on how many calls the implementation makes -- the GET that
 * captures the previous value, the PATCH, the restart and any rollback PATCH
 * are all separate. `patchAnswers` is consumed in order, so the enable PATCH
 * and the rollback PATCH can differ.
 */
function harness(
  nodes: HomeV2CoreDocsAdminNode[],
  answers: Partial<Record<string, Answer>> = {},
  patchAnswers: Answer[] = [],
) {
  const calls: Call[] = []
  let resolved = 0
  let patched = 0
  const dependencies: HomeV2CoreDocsAdminDependencies = {
    async resolveAdminNode() {
      const node = nodes[Math.min(resolved, nodes.length - 1)]
      resolved += 1
      if (!node) throw new Error('no node')
      return node
    },
    async request(input) {
      calls.push(input)
      if (input.method === 'PATCH' && patchAnswers.length > 0) {
        const answer = patchAnswers[Math.min(patched, patchAnswers.length - 1)]
        patched += 1
        return answer
      }
      return answers[`${input.method} ${input.path}`] ?? ok
    },
  }
  return { calls, dependencies }
}

const ok: Answer = { ok: true, status: 200, text: '{"saved":true}' }
const disabledBefore: Answer = { ok: true, status: 200, text: '{"apiDocumentationEnabled":false}' }
const enabledBefore: Answer = { ok: true, status: 200, text: '{"apiDocumentationEnabled":true}' }

/** The PATCHes only, in order, so rollback assertions read plainly. */
const patches = (calls: Call[]) => calls.filter((call) => call.method === 'PATCH').map((call) => call.body)
const restarts = (calls: Call[]) => calls.filter((call) => call.path === '/admin/restart')

// --- The happy path: a REMOTE node the user administers -------------------
// The point of the change. Before 2026-09-02 this refused with "Only the
// configured local Core can be changed from Home" for a user who holds that
// node's API key and is plainly entitled to enable its docs.
{
  const node = trustedNode('https://core.example', 'user-key')
  const { calls, dependencies } = harness([node, node], {
    'GET /admin/settings': disabledBefore,
    'GET /admin/restart': { ok: true, status: 200, text: '' },
  })
  assert.deepEqual(await enableHomeV2CoreApiDocs('qortium', dependencies), { accepted: true })
  assert.deepEqual(patches(calls), [JSON.stringify({ apiDocumentationEnabled: true })])
  assert.equal(restarts(calls).length, 1)
  assert.equal(calls.every((call) => call.apiKey === 'user-key'), true)
  assert.equal(calls.every((call) => call.nodeApiUrl === 'https://core.example'), true)
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
  )
  await assert.rejects(() => enableHomeV2CoreApiDocs('qortium', dependencies), pattern)
  assert.equal(calls.length, 0, `${reason} must not reach the node`)
}

// A "trusted" answer with no key is refused too, rather than sending an
// unauthenticated PATCH that Core would reject with a confusing 403.
{
  const node = trustedNode('https://core.example', 'user-key')
  const { calls, dependencies } = harness([{ ...node, apiKey: '' }])
  await assert.rejects(() => enableHomeV2CoreApiDocs('qortium', dependencies), /needs your node's API key/)
  assert.equal(calls.length, 0)
}

// --- The node's own words never reach the caller --------------------------
// Failures are reported by STATUS. The body is written by the node, can be an
// HTML page or a stack trace, and reaches a renderer (security review).
{
  const node = trustedNode('https://core.example', 'user-key')
  const hostile = '<script>alert(1)</script> /home/user/.config/qortium-core'
  const { calls, dependencies } = harness([node, node], {
    'GET /admin/settings': disabledBefore,
  }, [{ ok: false, status: 403, text: hostile }])
  await assert.rejects(
    () => enableHomeV2CoreApiDocs('qortium', dependencies),
    (error: Error) =>
      /refused by the node/.test(error.message) &&
      !error.message.includes('<script>') &&
      !error.message.includes('/home/user'),
  )
  assert.equal(restarts(calls).length, 0, 'a failed settings write must not restart the node')
}
{
  const node = trustedNode('https://core.example', 'user-key')
  const { calls, dependencies } = harness([node, node], {
    'GET /admin/settings': disabledBefore,
  }, [{ ok: false, status: 404, text: '' }])
  await assert.rejects(() => enableHomeV2CoreApiDocs('qortium', dependencies), /not supported by this node/)
  assert.equal(restarts(calls).length, 0)
}

// --- The node declining the settings write stops before the restart -------
{
  const node = trustedNode('https://core.example', 'user-key')
  const { calls, dependencies } = harness([node, node], {
    'GET /admin/settings': disabledBefore,
  }, [{ ok: true, status: 200, text: '{"saved":false}' }])
  await assert.rejects(() => enableHomeV2CoreApiDocs('qortium', dependencies), /declined the settings update/)
  assert.equal(restarts(calls).length, 0)
}

// --- REVISION RECHECK immediately before /admin/restart, and the UNDO -----
// The restart is the destructive half. A node switched, or a key re-attached,
// between the settings write and the restart must not inherit the decision
// made about the first one -- and the write has already landed by then, so
// the setting is put back rather than left on behind the user's back.
{
  const before = trustedNode('https://core.example', 'user-key')
  const rotated = trustedNode('https://core.example', 'rotated-key')
  const { calls, dependencies } = harness([before, rotated], {
    'GET /admin/settings': disabledBefore,
  })
  await assert.rejects(
    () => enableHomeV2CoreApiDocs('qortium', dependencies),
    (error: Error) =>
      /changed before the restart/.test(error.message) &&
      /changed back, so the node is as it was/.test(error.message),
  )
  assert.deepEqual(patches(calls), [
    JSON.stringify({ apiDocumentationEnabled: true }),
    JSON.stringify({ apiDocumentationEnabled: false }),
  ], 'the enable must be rolled back')
  assert.equal(restarts(calls).length, 0)
}
{
  const before = trustedNode('https://core.example', 'user-key')
  const moved = trustedNode('https://other.example', 'user-key')
  const { calls, dependencies } = harness([before, moved], {
    'GET /admin/settings': disabledBefore,
  })
  await assert.rejects(() => enableHomeV2CoreApiDocs('qortium', dependencies), /changed before the restart/)
  assert.equal(patches(calls).length, 2)
}
// Trust lost outright between the two halves: same undo, its own wording.
{
  const before = trustedNode('https://core.example', 'user-key')
  const { calls, dependencies } = harness(
    [before, { apiKey: '', nodeApiUrl: '', trust: { trusted: false, reason: 'key-missing' } }],
    { 'GET /admin/settings': disabledBefore },
  )
  await assert.rejects(
    () => enableHomeV2CoreApiDocs('qortium', dependencies),
    /stopped being one Home can administer/,
  )
  assert.equal(patches(calls).length, 2)
  assert.equal(restarts(calls).length, 0)
}

// --- A failing RESTART also undoes the write ------------------------------
{
  const node = trustedNode('https://core.example', 'user-key')
  const { calls, dependencies } = harness([node, node], {
    'GET /admin/settings': disabledBefore,
    'GET /admin/restart': { ok: false, status: 500, text: 'boom' },
  })
  await assert.rejects(
    () => enableHomeV2CoreApiDocs('qortium', dependencies),
    (error: Error) =>
      /Restarting the node failed: it answered HTTP 500/.test(error.message) &&
      /changed back, so the node is as it was/.test(error.message) &&
      !error.message.includes('boom'),
  )
  assert.deepEqual(patches(calls), [
    JSON.stringify({ apiDocumentationEnabled: true }),
    JSON.stringify({ apiDocumentationEnabled: false }),
  ])
}

// --- When the undo ITSELF fails, say so plainly ---------------------------
// Distinct from "rolled back": the node is left with the documentation on and
// not restarted, which is a state the user has to know about.
{
  const node = trustedNode('https://core.example', 'user-key')
  const { calls, dependencies } = harness([node, node], {
    'GET /admin/settings': disabledBefore,
    'GET /admin/restart': { ok: false, status: 500, text: '' },
  }, [ok, { ok: false, status: 500, text: '' }])
  await assert.rejects(
    () => enableHomeV2CoreApiDocs('qortium', dependencies),
    /still enabled and Home could not change it back/,
  )
  assert.equal(patches(calls).length, 2)
}

// --- An UNCONFIRMABLE pre-state is never guessed at ------------------------
// Three states, not two. The GET can fail, answer non-2xx, come back empty
// because the bridge's 4 KiB bound cut it off, or simply not carry the field.
// None of those is evidence the setting was off, and writing `false` on the
// strength of one could switch off a setting the user had deliberately
// enabled -- the exact state the undo exists to avoid (review round 3).
for (const before of [
  null,
  { ok: false, status: 500, text: '' } as Answer,
  { ok: true, status: 200, text: '' } as Answer,
  { ok: true, status: 200, text: 'not json at all' } as Answer,
  { ok: true, status: 200, text: '{"someOtherSetting":true}' } as Answer,
  { ok: true, status: 200, text: '{"apiDocumentationEnabled":"yes"}' } as Answer,
]) {
  const node = trustedNode('https://core.example', 'user-key')
  const answers: Partial<Record<string, Answer>> = {
    'GET /admin/restart': { ok: false, status: 500, text: '' },
  }
  if (before) answers['GET /admin/settings'] = before
  const calls: Call[] = []
  let resolved = 0
  const dependencies: HomeV2CoreDocsAdminDependencies = {
    async resolveAdminNode() {
      resolved += 1
      return node
    },
    async request(input) {
      // `null` models the GET itself throwing, which the caller catches.
      if (!before && input.method === 'GET' && input.path === '/admin/settings') {
        throw new Error('unreachable')
      }
      calls.push(input)
      return answers[`${input.method} ${input.path}`] ?? ok
    },
  }
  await assert.rejects(
    () => enableHomeV2CoreApiDocs('qortium', dependencies),
    (error: Error) =>
      /could not confirm what the setting was before/.test(error.message) &&
      /left as it is/.test(error.message),
    `an unconfirmable pre-state (${before ? before.text || `HTTP ${before.status}` : 'throw'}) must not be guessed`,
  )
  assert.equal(resolved > 0, true)
  assert.deepEqual(
    patches(calls),
    [JSON.stringify({ apiDocumentationEnabled: true })],
    'an unconfirmable pre-state must never be written back as false',
  )
}

// A pre-state that IS readable and false still rolls back, so the tri-state has
// not simply disabled the undo.
{
  const node = trustedNode('https://core.example', 'user-key')
  const { calls, dependencies } = harness([node, node], {
    'GET /admin/settings': disabledBefore,
    'GET /admin/restart': { ok: false, status: 500, text: '' },
  })
  await assert.rejects(
    () => enableHomeV2CoreApiDocs('qortium', dependencies),
    /changed back, so the node is as it was/,
  )
  assert.equal(patches(calls).length, 2)
}

// --- Already enabled before Home touched it: nothing to change back -------
// The docs probe 404ing is not proof the setting was off, so the previous
// value is READ. When it was already on, a failure must not turn it off.
{
  const node = trustedNode('https://core.example', 'user-key')
  const { calls, dependencies } = harness([node, node], {
    'GET /admin/settings': enabledBefore,
    'GET /admin/restart': { ok: false, status: 500, text: '' },
  })
  await assert.rejects(
    () => enableHomeV2CoreApiDocs('qortium', dependencies),
    /already enabled, so nothing was changed back/,
  )
  assert.deepEqual(patches(calls), [JSON.stringify({ apiDocumentationEnabled: true })])
}

console.log('Home v2 Core API docs admin tests passed.')
