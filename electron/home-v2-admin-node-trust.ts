import { evaluateHomeV2AdminTrust, homeV2NodeOrigin } from './home-v2-admin-trust.js'
import {
  getHomeV2ManagedAdminBindingId,
  getHomeV2NodeAdminKey,
} from './home-v2-node-admin-key.js'

/**
 * Admin trust for the shell SNAPSHOT, reduced to what may cross to a renderer.
 *
 * The shell needs the same answer the action bridge computes and cannot ask
 * for it: `resolveHomeV2AdminNode` lives in the app bridge, which imports the
 * node bridge. The settings resolver supplies its effective local credential,
 * including explicit overrides; independent process discovery could bind a
 * different running Core's key and invalidate the active custody session.
 *
 * It lives in its OWN module because the node bridge must not so much as name
 * a credential: `home-v2-foundation.test.tsx` pins that it contains no
 * `apiKey`, and that pin is worth keeping. Nothing but the boolean and the
 * random binding id leaves this function.
 *
 * Without it the desktop snapshot carried no `adminTrusted` at all, so every
 * renderer surface gating on it (the Core API documentation controls) saw
 * `undefined` and stayed hidden even on the user's own node.
 */
export function summarizeHomeV2AdminNodeTrust(input: {
  readonly managedApiKey: string
  readonly mode: 'custom' | 'disabled' | 'local' | 'network' | 'public'
  readonly network: string
  readonly nodeApiUrl: string | null
}): { adminBindingId: string | null; adminTrusted: boolean } {
  const untrusted = { adminBindingId: null, adminTrusted: false }
  if (input.network !== 'qortium' || !input.nodeApiUrl) return untrusted
  const managedKey = input.mode === 'local' ? input.managedApiKey : ''
  const trust = evaluateHomeV2AdminTrust({
    attached: getHomeV2NodeAdminKey(input.network),
    managedApiKey: managedKey,
    managedBindingId: managedKey
      ? getHomeV2ManagedAdminBindingId(
          input.network,
          homeV2NodeOrigin(input.nodeApiUrl),
          managedKey,
        )
      : '',
    // The snapshot calls the discovered-node mode 'public'; the predicate
    // calls it 'network'.
    mode: input.mode === 'public' ? 'network' : input.mode,
    network: input.network,
    nodeApiUrl: input.nodeApiUrl,
  })
  return trust.trusted
    ? { adminBindingId: trust.bindingId, adminTrusted: true }
    : untrusted
}
