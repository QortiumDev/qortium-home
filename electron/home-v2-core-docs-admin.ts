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
 * check whose revision must still match before anything is restarted.
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

export async function enableHomeV2CoreApiDocs(
  network: 'qortal' | 'qortium',
  dependencies: HomeV2CoreDocsAdminDependencies,
) {
  const node = await dependencies.resolveAdminNode(network)
  const trust = requireTrustedNode(node, ENABLE_OPERATION)
  const settings = await dependencies.request({
    apiKey: node.apiKey,
    body: JSON.stringify({ apiDocumentationEnabled: true }),
    method: 'PATCH',
    nodeApiUrl: node.nodeApiUrl,
    path: '/admin/settings',
  })
  if (!settings.ok) {
    throw new Error(settings.text || `The node returned HTTP ${settings.status}.`)
  }
  if (settings.text) {
    try {
      const parsed = JSON.parse(settings.text) as { saved?: unknown }
      if (parsed.saved === false) throw new Error('The node declined the settings update.')
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  // The restart is the destructive half, and the settings write above may have
  // taken a while. Re-resolve trust and require the SAME revision: a node
  // switched, or a key re-attached, in between must not inherit the decision
  // that was made about the first one.
  const after = await dependencies.resolveAdminNode(network)
  const trustAfter = requireTrustedNode(after, 'Restarting the node')
  if (trustAfter.revision !== trust.revision) {
    throw new Error('The selected Qortium node or its API key changed before the restart.')
  }
  const restart = await dependencies.request({
    apiKey: after.apiKey,
    method: 'GET',
    nodeApiUrl: after.nodeApiUrl,
    path: '/admin/restart',
  })
  if (!restart.ok) {
    throw new Error(restart.text || `The node returned HTTP ${restart.status}.`)
  }
  return { accepted: true as const }
}
