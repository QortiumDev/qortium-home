/**
 * Returns true only for the Core bridge client that a rendered Q-App would
 * otherwise load from its own node. Home v2 supplies the embedded bridge, so
 * this exact script is suppressed inside v2 app views to prevent Core's
 * page-global qdnRequest/qortalRequest bindings from shadowing Home's preload.
 */
export function isHomeV2CoreBridgeClientRequest(rawUrl: string, nodeOrigin: string) {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  return url.origin === nodeOrigin && url.pathname === '/apps/q-apps.js';
}
