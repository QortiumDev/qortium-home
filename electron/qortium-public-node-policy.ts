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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function numberField(value: unknown, key: string) {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : null;
}

function stringField(value: unknown, key: string) {
  if (!isRecord(value)) return '';
  const field = value[key];
  return typeof field === 'string' ? field.trim().toUpperCase() : '';
}

export function isFullySyncedQortiumStatus(status: unknown) {
  return (
    (numberField(status, 'height') ?? 0) > 0 &&
    stringField(status, 'syncPhase') === 'SYNCED' &&
    numberField(status, 'syncPercent') === 100 &&
    numberField(status, 'syncBlocksRemaining') === 0 &&
    isRecord(status) &&
    status.isSynchronizing === false
  );
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
