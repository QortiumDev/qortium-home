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

/**
 * How far behind the tip an already-selected public node may be before Home
 * abandons it for another candidate. Every node reports `BEHIND / 1 block /
 * 99%` for a few seconds after each new block; treating that instant as
 * "unusable" made the selection flip node1 <-> node2 on nearly every status
 * check, and each flip reloads every open app tab (observed live 2026-09-13:
 * a chat send never survived the public route). A retained node only has to
 * be reachable, readable, and close to the tip.
 */
export const QORTIUM_PUBLIC_NODE_RETAIN_MAX_BLOCKS_BEHIND = 3;

/** Whether Home may KEEP the currently selected public node (hysteresis). */
export function canRetainQortiumPublicNode(
  candidate: QortiumPublicNodeCandidate & { syncBlocksRemaining?: number | null },
) {
  if (!candidate.supportsPublicReads) return false;
  if (candidate.isSynced) return true;
  const remaining = candidate.syncBlocksRemaining;
  return (
    typeof remaining === 'number' &&
    Number.isFinite(remaining) &&
    remaining >= 0 &&
    remaining <= QORTIUM_PUBLIC_NODE_RETAIN_MAX_BLOCKS_BEHIND
  );
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
