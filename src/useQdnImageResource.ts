import { useEffect, useMemo, useState } from 'react';
import { handleQdnAppRequest } from './platform';
import { isTerminalQdnStatus } from './qdn';
import type { QdnResourceListItem, QdnResourceStatus } from './qdn';
import { QdnImageMissingRevisionCache } from './qdnImageMissingRevisionCache';

export type QdnImageResolutionState = 'pending' | 'ready' | 'unavailable';

export type QdnImageResource = {
  cacheKey: string;
  identifier?: string;
  maxBytes: number;
  name: string;
  optional?: boolean;
  path?: string;
  service: string;
};

export type QdnImageResolution = {
  state: QdnImageResolutionState;
  url: string | null;
};

type Subscriber = (resolution: QdnImageResolution) => void;

type ImageEntry = {
  attempts: number;
  cooldownUntil: number;
  hasTriggeredDownload: boolean;
  isPolling: boolean;
  resolution: QdnImageResolution;
  resource: QdnImageResource;
  subscribers: Set<Subscriber>;
  timer: number | null;
};

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 12;
const SOFT_RETRY_COOLDOWN_MS = 5 * 60_000;
const MAX_CACHED_IMAGES = 200;
const MAX_CACHED_MISSING_REVISIONS = 500;
const PENDING: QdnImageResolution = { state: 'pending', url: null };
const UNAVAILABLE: QdnImageResolution = { state: 'unavailable', url: null };

const entries = new Map<string, ImageEntry>();
const readyImageCache = new Map<string, string>();
const missingRevisionCache = new QdnImageMissingRevisionCache(MAX_CACHED_MISSING_REVISIONS);

function getEntryKey(resource: QdnImageResource, nodeApiUrl: string, nodeEpoch: number) {
  return `${nodeEpoch}:${nodeApiUrl}:${resource.cacheKey}`;
}

function getBridgeResource(resource: QdnImageResource) {
  return {
    identifier: resource.identifier,
    name: resource.name,
    path: resource.path,
    service: resource.service,
  };
}

function getCachedResolution(resource: QdnImageResource): QdnImageResolution {
  const cachedUrl = readyImageCache.get(resource.cacheKey);

  return cachedUrl ? { state: 'ready', url: cachedUrl } : PENDING;
}

function base64ToObjectUrl(data: string, contentType: string) {
  const binary = window.atob(data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return URL.createObjectURL(new Blob([bytes], { type: contentType || 'application/octet-stream' }));
}

function cacheReadyImage(resource: QdnImageResource, objectUrl: string) {
  const previousUrl = readyImageCache.get(resource.cacheKey);

  readyImageCache.delete(resource.cacheKey);
  readyImageCache.set(resource.cacheKey, objectUrl);

  if (previousUrl && previousUrl !== objectUrl) {
    URL.revokeObjectURL(previousUrl);
  }

  while (readyImageCache.size > MAX_CACHED_IMAGES) {
    const oldest = readyImageCache.entries().next().value as [string, string] | undefined;

    if (!oldest) {
      break;
    }

    readyImageCache.delete(oldest[0]);
    URL.revokeObjectURL(oldest[1]);
  }
}

function clearReadyImage(resource: QdnImageResource) {
  const previousUrl = readyImageCache.get(resource.cacheKey);

  if (previousUrl) {
    readyImageCache.delete(resource.cacheKey);
    URL.revokeObjectURL(previousUrl);
  }
}

async function fetchResourceStatus(resource: QdnImageResource, build: boolean) {
  return handleQdnAppRequest({
    action: 'GET_QDN_RESOURCE_STATUS',
    ...getBridgeResource(resource),
    build,
  }) as Promise<QdnResourceStatus>;
}

async function fetchResourceObjectUrl(resource: QdnImageResource) {
  const result = await window.qortiumHome.qdn.fetchResourceData({
    ...getBridgeResource(resource),
    allowMissing: resource.optional === true,
    maxBytes: resource.maxBytes,
  });

  if (result.missing) {
    return { kind: 'missing' as const };
  }

  if (result.tooLarge || !result.data) {
    throw new Error('QDN image is unavailable.');
  }

  return {
    kind: 'ready' as const,
    url: base64ToObjectUrl(result.data, result.contentType),
  };
}

async function fetchResourceRevision(resource: QdnImageResource): Promise<string | null> {
  const result = await handleQdnAppRequest({
    action: 'SEARCH_QDN_RESOURCES',
    exactMatchNames: true,
    identifier: resource.identifier ?? 'default',
    includeMetadata: false,
    includeStatus: false,
    limit: 1,
    name: resource.name,
    service: resource.service,
  });

  if (!Array.isArray(result)) {
    return null;
  }

  const expectedIdentifier = resource.identifier ?? 'default';
  const match = (result as QdnResourceListItem[]).find(
    (item) =>
      item.name === resource.name &&
      item.service === resource.service &&
      (item.identifier ?? 'default') === expectedIdentifier,
  );

  return match?.latestSignature?.trim() || null;
}

function emit(entry: ImageEntry, resolution: QdnImageResolution) {
  entry.resolution = resolution;

  for (const subscriber of entry.subscribers) {
    subscriber(resolution);
  }
}

function stopPolling(entry: ImageEntry) {
  if (entry.timer !== null) {
    window.clearTimeout(entry.timer);
    entry.timer = null;
  }
}

function triggerDownload(entry: ImageEntry) {
  if (entry.hasTriggeredDownload) {
    return;
  }

  entry.hasTriggeredDownload = true;

  void handleQdnAppRequest({
    action: 'FETCH_QDN_RESOURCE',
    ...getBridgeResource(entry.resource),
  }).catch(() => {});
}

async function poll(entry: ImageEntry, key: string, build: boolean) {
  entry.timer = null;

  if (entry.subscribers.size === 0) {
    entry.isPolling = false;
    return;
  }

  entry.isPolling = true;

  let status: QdnResourceStatus | undefined;

  try {
    status = await fetchResourceStatus(entry.resource, build);
  } catch {
    // A status miss usually means the node or network is still warming up.
  }

  if (entries.get(key) !== entry || entry.subscribers.size === 0) {
    entry.isPolling = false;
    return;
  }

  if (status?.status === 'READY') {
    let objectUrl: string | null = null;
    let revision: string | null = null;

    try {
      if (entry.resource.optional) {
        try {
          revision = await fetchResourceRevision(entry.resource);
        } catch {
          // Revision lookup is an optimization; the raw fetch remains authoritative.
        }

        if (entries.get(key) !== entry || entry.subscribers.size === 0) {
          entry.isPolling = false;
          return;
        }

        if (revision && missingRevisionCache.has(entry.resource.cacheKey, revision)) {
          entry.isPolling = false;
          clearReadyImage(entry.resource);
          emit(entry, UNAVAILABLE);
          return;
        }
      }

      const result = await fetchResourceObjectUrl(entry.resource);

      if (entries.get(key) !== entry || entry.subscribers.size === 0) {
        entry.isPolling = false;

        if (result.kind === 'ready') {
          URL.revokeObjectURL(result.url);
        }

        return;
      }

      if (result.kind === 'missing') {
        entry.isPolling = false;
        clearReadyImage(entry.resource);

        if (revision) {
          missingRevisionCache.remember(entry.resource.cacheKey, revision);
        }

        emit(entry, UNAVAILABLE);
        return;
      }

      objectUrl = result.url;

      entry.isPolling = false;
      missingRevisionCache.forget(entry.resource.cacheKey);
      cacheReadyImage(entry.resource, objectUrl);
      emit(entry, { state: 'ready', url: objectUrl });
      return;
    } catch {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      // A READY parent archive can still lack a requested filepath such as favicon.ico.
      // Let higher-priority candidates fall back, but keep any old ready image visible.
    }
  }

  if (isTerminalQdnStatus(status?.status)) {
    entry.isPolling = false;
    entry.cooldownUntil = 0;
    clearReadyImage(entry.resource);
    emit(entry, UNAVAILABLE);
    return;
  }

  triggerDownload(entry);
  entry.attempts += 1;

  if (entry.attempts >= MAX_POLL_ATTEMPTS) {
    entry.isPolling = false;
    entry.cooldownUntil = Date.now() + SOFT_RETRY_COOLDOWN_MS;
    if (entry.resolution.state !== 'ready') {
      emit(entry, UNAVAILABLE);
    }
    return;
  }

  if (entry.resolution.state !== 'ready' && entry.resolution.state !== 'pending') {
    emit(entry, PENDING);
  }

  entry.timer = window.setTimeout(() => {
    void poll(entry, key, status?.status === 'DOWNLOADED');
  }, POLL_INTERVAL_MS);
}

function ensureRunning(entry: ImageEntry, key: string) {
  if (entry.timer !== null || entry.isPolling) {
    return;
  }

  if (entry.cooldownUntil > 0 && Date.now() < entry.cooldownUntil) {
    return;
  }

  if (entry.cooldownUntil > 0) {
    entry.attempts = 0;
    entry.cooldownUntil = 0;
    entry.hasTriggeredDownload = false;
    if (entry.resolution.state !== 'ready') {
      emit(entry, PENDING);
    }
  }

  void poll(entry, key, false);
}

function subscribe(
  resource: QdnImageResource,
  nodeApiUrl: string,
  nodeEpoch: number,
  subscriber: Subscriber,
) {
  const key = getEntryKey(resource, nodeApiUrl, nodeEpoch);
  let entry = entries.get(key);

  if (!entry) {
    entry = {
      attempts: 0,
      cooldownUntil: 0,
      hasTriggeredDownload: false,
      isPolling: false,
      resolution: getCachedResolution(resource),
      resource,
      subscribers: new Set(),
      timer: null,
    };
    entries.set(key, entry);
  }

  entry.subscribers.add(subscriber);
  subscriber(entry.resolution);
  ensureRunning(entry, key);

  const activeEntry = entry;

  return () => {
    activeEntry.subscribers.delete(subscriber);

    if (activeEntry.subscribers.size === 0) {
      stopPolling(activeEntry);
      entries.delete(key);
    }
  };
}

export function useQdnImageResource(
  resource: QdnImageResource | null,
  nodeApiUrl: string,
  nodeEpoch: number,
): QdnImageResolution {
  const [snapshot, setSnapshot] = useState<{ cacheKey: string | null; resolution: QdnImageResolution }>(() => ({
    cacheKey: resource?.cacheKey ?? null,
    resolution: resource ? getCachedResolution(resource) : UNAVAILABLE,
  }));

  useEffect(() => {
    if (!resource || !nodeApiUrl) {
      setSnapshot({ cacheKey: null, resolution: UNAVAILABLE });
      return undefined;
    }

    return subscribe(resource, nodeApiUrl, nodeEpoch, (resolution) => {
      setSnapshot({ cacheKey: resource.cacheKey, resolution });
    });
  }, [nodeApiUrl, nodeEpoch, resource]);

  if (!resource) {
    return UNAVAILABLE;
  }

  return snapshot.cacheKey === resource.cacheKey ? snapshot.resolution : getCachedResolution(resource);
}

export function useQdnImageCandidates(
  resources: QdnImageResource[],
  nodeApiUrl: string,
  nodeEpoch: number,
): QdnImageResolution {
  const resourceSignature = useMemo(
    () => resources.map((resource) => resource.cacheKey).join('\u001f'),
    [resources],
  );
  const [snapshot, setSnapshot] = useState<{
    resolutions: Map<string, QdnImageResolution>;
    signature: string;
  }>(() => {
    const initial = new Map<string, QdnImageResolution>();

    for (const resource of resources) {
      initial.set(resource.cacheKey, getCachedResolution(resource));
    }

    return { resolutions: initial, signature: resourceSignature };
  });

  useEffect(() => {
    if (!nodeApiUrl || resources.length === 0) {
      setSnapshot({ resolutions: new Map(), signature: resourceSignature });
      return undefined;
    }

    const nextInitial = new Map<string, QdnImageResolution>();

    for (const resource of resources) {
      nextInitial.set(resource.cacheKey, getCachedResolution(resource));
    }

    setSnapshot({ resolutions: nextInitial, signature: resourceSignature });

    const unsubscribers = resources.map((resource) =>
      subscribe(resource, nodeApiUrl, nodeEpoch, (resolution) => {
        setSnapshot((current) => {
          const next = current.signature === resourceSignature
            ? new Map(current.resolutions)
            : new Map<string, QdnImageResolution>();
          next.set(resource.cacheKey, resolution);
          return { resolutions: next, signature: resourceSignature };
        });
      }),
    );

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [nodeApiUrl, nodeEpoch, resourceSignature, resources]);

  const resolutions = snapshot.signature === resourceSignature ? snapshot.resolutions : new Map<string, QdnImageResolution>();

  for (const resource of resources) {
    const resolution = resolutions.get(resource.cacheKey) ?? getCachedResolution(resource);

    if (resolution.state === 'ready') {
      return resolution;
    }
  }

  if (
    resources.length > 0 &&
    resources.every((resource) => resolutions.get(resource.cacheKey)?.state === 'unavailable')
  ) {
    return UNAVAILABLE;
  }

  return PENDING;
}
