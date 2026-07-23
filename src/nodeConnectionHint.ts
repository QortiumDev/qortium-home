import { resolveQdnWriteRoute } from '../electron/qdn-write-route';
import type { TranslationKey } from './i18n';

// Which hint to show under the custom-node URL field.
//
// The node a user types decides how Home publishes for them, and until now
// nothing said so: a node on this machine publishes with no extra limits, an
// encrypted remote node with an API key publishes at the node's own size limit,
// and anything else falls back to the keyless public path — checked
// independently, but capped at a much smaller size. Typing a plaintext URL is
// the easy way to land on that smaller cap by accident, so it is called out.

type CustomNodeConnection = {
  apiKey: string;
  nodeApiUrl: string;
};

// Deliberately stricter than the URL normalisation that runs on save: a value
// with no scheme yet is treated as still being typed rather than as plaintext,
// so the field never accuses a half-written https URL of being unencrypted.
function parseCustomNodeUrl(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  try {
    const url = new URL(trimmedValue);

    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * The hint key for a custom node, or null when there is nothing useful to say.
 *
 * Null covers an empty or not-yet-valid URL — a blank field is not a problem
 * worth warning about.
 */
export function resolveCustomNodeHintKey(connection: CustomNodeConnection): TranslationKey | null {
  const url = parseCustomNodeUrl(connection.nodeApiUrl);

  if (!url) {
    return null;
  }

  const route = resolveQdnWriteRoute({
    apiKey: connection.apiKey,
    mode: 'custom',
    nodeApiUrl: url.origin,
  });

  if (route === 'local') {
    return 'node.customUrlHintLocal';
  }

  // Plaintext is what keeps a remote node off the authenticated route, so it is
  // reported before the API key is: the thing to change is the URL.
  if (url.protocol !== 'https:') {
    return 'node.customUrlHintRemotePlaintext';
  }

  return route === 'remote-authenticated'
    ? 'node.customUrlHintRemoteHttps'
    : 'node.customUrlHintRemoteHttpsNoKey';
}
