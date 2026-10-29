// Applies only to the Home-managed Qortium installation template. Core still
// preserves an operator's customized runtime peer arrays through MergeSettings.
const RETIRED_BOOTSTRAP_HOSTS = new Set([
  '146.103.42.59',
  '3u25ana5e5hvriqqiuh6fcetxezsqm7la276ljtjxaoxt767n4hq.b32.i2p',
  'hg3seiuul4pcz6a2svatdahzudphbm464vwqcmiejc77kumglwaq.b32.i2p',
]);

function isRetiredPeer(peer: string) {
  return RETIRED_BOOTSTRAP_HOSTS.has(peer.trim().toLowerCase().replace(/:\d+$/, ''));
}

export function mergeBootstrapPeerList(value: unknown, canonicalPeers: readonly string[]) {
  const existingPeers = Array.isArray(value) ? value : [];
  const peers: unknown[] = [];
  const seen = new Set<string>();
  let changed = !Array.isArray(value);
  for (const peer of existingPeers) {
    if (typeof peer === 'string') {
      if (isRetiredPeer(peer) || seen.has(peer)) {
        changed = true;
        continue;
      }
      seen.add(peer);
    }
    peers.push(peer);
  }
  for (const peer of canonicalPeers) {
    if (!isRetiredPeer(peer) && !seen.has(peer)) {
      peers.push(peer);
      seen.add(peer);
      changed = true;
    }
  }
  return { changed, peers };
}
