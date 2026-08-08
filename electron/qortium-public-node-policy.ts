export const QORTIUM_PUBLIC_NODE_API_URLS = [
  'https://node1.qortium.app',
  'https://node2.qortium.app',
] as const;

export interface QortiumPublicNodeCandidate {
  height: number;
  isSynced: boolean;
  latencyMs: number;
  nodeApiUrl: string;
  peerCount: number;
  supportsPublicReads: boolean;
}

export function isUsableQortiumPublicNode(
  candidate: QortiumPublicNodeCandidate,
) {
  return candidate.supportsPublicReads && candidate.isSynced;
}

export function rankQortiumPublicNodes<
  Candidate extends QortiumPublicNodeCandidate,
>(candidates: readonly Candidate[]) {
  return [...candidates].sort((first, second) => {
    if (first.supportsPublicReads !== second.supportsPublicReads) {
      return first.supportsPublicReads ? -1 : 1;
    }

    if (first.isSynced !== second.isSynced) {
      return first.isSynced ? -1 : 1;
    }

    if (first.latencyMs !== second.latencyMs) {
      return first.latencyMs - second.latencyMs;
    }

    if (first.height !== second.height) {
      return second.height - first.height;
    }

    if (first.peerCount !== second.peerCount) {
      return second.peerCount - first.peerCount;
    }

    return first.nodeApiUrl.localeCompare(second.nodeApiUrl);
  });
}
