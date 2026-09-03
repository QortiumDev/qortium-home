import {
  homeV2AdminTrustMessage,
  type HomeV2AdminTrust,
} from './home-v2-admin-trust.js'

/**
 * Turning Core's API documentation on, and restarting Core so it takes effect.
 *
 * This used to require `mode === 'local'` and read the managed Core's
 * apikey.txt directly, which meant a user running their own Core on a VPS —
 * with its API key attached in Home — was told "Only the configured local Core
 * can be changed from Home", for a settings PATCH and a restart they are
 * plainly entitled to make. Since the 2026-09-02 owner decision the gate is
 * ADMIN TRUST: whichever node the user holds the key for, local or not. A
 * public/discovered node still refuses, because it is somebody else's Core.
 *
 * The logic lives here rather than in the IPC module so it can be tested
 * without Electron: the caller injects trust resolution and the HTTP call, and
 * this owns the ORDER — trust, then the settings write, then a fresh trust
 * check whose revision must still match before anything is restarted — and the
 * UNDO, because the write and the restart are two calls and the second can
 * fail after the first has landed.
 */
export interface HomeV2CoreDocsAdminResponse {
  readonly ok: boolean
  readonly status: number
  readonly text: string
}

export interface HomeV2CoreDocsAdminNode {
  readonly apiKey: string
  readonly nodeApiUrl: string
  readonly trust: HomeV2AdminTrust
}

export interface HomeV2CoreDocsAdminDependencies {
  readonly resolveAdminNode: (network: 'qortal' | 'qortium') => Promise<HomeV2CoreDocsAdminNode>
  readonly request: (input: {
    readonly apiKey: string
    readonly body?: string
    readonly method: 'GET' | 'PATCH'
    readonly nodeApiUrl: string
    readonly path: string
  }) => Promise<HomeV2CoreDocsAdminResponse>
}

function requireTrustedNode(node: HomeV2CoreDocsAdminNode, operation: string) {
  if (!node.trust.trusted) {
    throw new Error(homeV2AdminTrustMessage(node.trust.reason, operation))
  }
  if (!node.apiKey) {
    throw new Error(homeV2AdminTrustMessage('key-missing', operation))
  }
  return node.trust
}

const ENABLE_OPERATION = 'Enabling the Core API documentation'

/**
 * A node's answer, as a fixed sentence.
 *
 * Core's body is echoed to nobody: it is written by the node, it can be an
 * HTML error page or a stack trace, and it reaches a renderer. The STATUS is
 * the only part of it Home repeats (security review, 2026-09-02).
 */
function nodeFailure(what: string, status: number) {
  if (status === 401 || status === 403) {
    return new Error(`${what} was refused by the node. Check the API key attached to it in Settings.`)
  }
  if (status === 404) {
    return new Error(`${what} is not supported by this node. Update Qortium Core and try again.`)
  }
  return new Error(`${what} failed: the node answered HTTP ${status}.`)
}

/** Whether Core reports the documentation as already enabled. */
function readsAsEnabled(text: string) {
  try {
    const parsed: unknown = JSON.parse(text)
    return !!parsed && typeof parsed === 'object' &&
      (parsed as Record<string, unknown>).apiDocumentationEnabled === true
  } catch {
    return false
  }
}

async function patchDocumentationEnabled(
  dependencies: HomeV2CoreDocsAdminDependencies,
  node: HomeV2CoreDocsAdminNode,
  enabled: boolean,
) {
  return dependencies.request({
    apiKey: node.apiKey,
    body: JSON.stringify({ apiDocumentationEnabled: enabled }),
    method: 'PATCH',
    nodeApiUrl: node.nodeApiUrl,
    path: '/admin/settings',
  })
}

export async function enableHomeV2CoreApiDocs(
  network: 'qortal' | 'qortium',
  dependencies: HomeV2CoreDocsAdminDependencies,
) {
  const node = await dependencies.resolveAdminNode(network)
  const trust = requireTrustedNode(node, ENABLE_OPERATION)
  // What to put back if the restart never happens. Read rather than assumed:
  // the caller reaches this because the DOCS PROBE 404'd, which is not proof
  // the setting is false — a node can have it enabled and still not be serving
  // the page. An unreadable answer means "leave it alone", which is the
  // conservative half.
  const before = await dependencies.request({
    apiKey: node.apiKey,
    method: 'GET',
    nodeApiUrl: node.nodeApiUrl,
    path: '/admin/settings',
  }).catch(() => null)
  const previouslyEnabled = !!before?.ok && readsAsEnabled(before.text)

  const settings = await patchDocumentationEnabled(dependencies, node, true)
  if (!settings.ok) throw nodeFailure('Enabling the Core API documentation', settings.status)
  if (settings.text) {
    try {
      const parsed = JSON.parse(settings.text) as { saved?: unknown }
      if (parsed.saved === false) throw new Error('The node declined the settings update.')
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }

  // Everything from here has ALREADY changed the node's settings, so a failure
  // is not simply an error: it leaves the documentation enabled and Core not
  // restarted. Undo it where we can, and say which of the two happened —
  // "it failed" alone would leave the user with a node in a state Home chose
  // and did not mention (security review, 2026-09-02).
  const undo = async (reason: string) => {
    if (previouslyEnabled) throw new Error(`${reason} The setting was already enabled, so nothing was changed back.`)
    const rolledBack = await patchDocumentationEnabled(dependencies, node, false)
      .then((result) => result.ok)
      .catch(() => false)
    throw new Error(rolledBack
      ? `${reason} The setting was changed back, so the node is as it was.`
      : `${reason} The setting is still enabled and Home could not change it back — turn it off in the node's settings, or restart the node to apply it.`)
  }

  // The restart is the destructive half, and the settings write above may have
  // taken a while. Re-resolve trust and require the SAME revision: a node
  // switched, or a key re-attached, in between must not inherit the decision
  // that was made about the first one.
  const after = await dependencies.resolveAdminNode(network).catch(() => null)
  if (!after || !after.trust.trusted || !after.apiKey) {
    await undo('The Qortium node stopped being one Home can administer before the restart.')
  }
  const trustAfter = after && after.trust.trusted ? after.trust : null
  if (!trustAfter || trustAfter.revision !== trust.revision) {
    await undo('The selected Qortium node or its API key changed before the restart.')
  }
  const restart = await dependencies.request({
    apiKey: after!.apiKey,
    method: 'GET',
    nodeApiUrl: after!.nodeApiUrl,
    path: '/admin/restart',
  }).catch(() => null)
  if (!restart || !restart.ok) {
    await undo(restart
      ? `Restarting the node failed: it answered HTTP ${restart.status}.`
      : 'Restarting the node failed: it could not be reached.')
  }
  return { accepted: true as const }
}
