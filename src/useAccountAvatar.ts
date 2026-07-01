import { useEffect, useState } from 'react';
import { handleQdnAppRequest } from './platform';
import { isTerminalQdnStatus } from './qdn';
import type { QdnResource, QdnResourceStatus } from './qdn';

// Shared resolver for account avatars (the QDN `THUMBNAIL/{name}/avatar` resource).
//
// The node serves the avatar with `?async=true`, which returns 404 while it fetches
// the resource in the background and 200 once it is cached. A plain `<img>` cannot
// tell "not published" apart from "downloading right now" — both are just a 404 — so
// the old code latched a sticky error on the first miss and never recovered, even
// after the resource finished downloading.
//
// Instead we drive the avatar from the resource STATUS endpoint and only hand the
// `<img>` a URL once the status is READY, so there is never a broken-image flash:
//   - READY            -> resolve to the async download URL.
//   - terminal status  -> unavailable for this node epoch (no retry) — e.g. the very
//                         common NOT_PUBLISHED (the account simply has no avatar).
//   - anything else    -> nudge the download and keep polling until ready/terminal.
//
// Resolutions are shared and de-duplicated per `nodeEpoch:nodeApiUrl:name`, so the
// chip, the tab avatar, and the accounts panel share a single poll loop instead of
// each hammering the node. Reconnecting (a new nodeEpoch) starts from a fresh key.
export type AccountAvatarState = 'pending' | 'ready' | 'unavailable';

export type AccountAvatarResolution = {
  state: AccountAvatarState;
  url: string | null;
};

type Subscriber = (resolution: AccountAvatarResolution) => void;

type AvatarEntry = {
  resource: QdnResource;
  nodeApiUrl: string;
  resolution: AccountAvatarResolution;
  subscribers: Set<Subscriber>;
  timer: number | null;
  isPolling: boolean;
  hasTriggeredDownload: boolean;
  attempts: number;
  objectUrl: string | null;
  // 0 = hard terminal (never retry this epoch); >0 = soft give-up timestamp after
  // which a fresh mount is allowed to try again (the "min cooldown" guard).
  cooldownUntil: number;
};

const POLL_INTERVAL_MS = 5_000;
const AVATAR_MAX_BYTES = 1024 * 1024;
// Avatars are decorative; stop actively polling a slow/missing resource after ~1
// minute so a flaky resource never polls forever...
const MAX_POLL_ATTEMPTS = 12;
// ...then refuse to restart the loop for a new mount until this cooldown elapses.
const SOFT_RETRY_COOLDOWN_MS = 5 * 60_000;

const PENDING: AccountAvatarResolution = { state: 'pending', url: null };
const UNAVAILABLE: AccountAvatarResolution = { state: 'unavailable', url: null };

const entries = new Map<string, AvatarEntry>();

function getCacheKey(name: string, nodeApiUrl: string, nodeEpoch: number) {
  return `${nodeEpoch}:${nodeApiUrl}:${name}`;
}

function buildAvatarResource(name: string): QdnResource {
  return {
    service: 'THUMBNAIL',
    name,
    identifier: 'avatar',
    path: '',
    displayUrl: '',
  };
}

function getAvatarBridgeResource(entry: AvatarEntry) {
  return {
    service: entry.resource.service,
    name: entry.resource.name,
    identifier: entry.resource.identifier,
    path: entry.resource.path,
  };
}

function base64ToObjectUrl(data: string, contentType: string) {
  const binary = window.atob(data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return URL.createObjectURL(new Blob([bytes], { type: contentType || 'application/octet-stream' }));
}

async function fetchAvatarStatus(entry: AvatarEntry, build: boolean) {
  return handleQdnAppRequest({
    action: 'GET_QDN_RESOURCE_STATUS',
    ...getAvatarBridgeResource(entry),
    build,
  }) as Promise<QdnResourceStatus>;
}

async function fetchAvatarObjectUrl(entry: AvatarEntry) {
  const result = await window.qortiumHome.qdn.fetchResourceData({
    ...getAvatarBridgeResource(entry),
    maxBytes: AVATAR_MAX_BYTES,
  });

  if (result.tooLarge || !result.data) {
    throw new Error('QDN avatar is too large.');
  }

  return base64ToObjectUrl(result.data, result.contentType);
}

function emit(entry: AvatarEntry, resolution: AccountAvatarResolution) {
  entry.resolution = resolution;

  for (const subscriber of entry.subscribers) {
    subscriber(resolution);
  }
}

function stopPolling(entry: AvatarEntry) {
  if (entry.timer !== null) {
    window.clearTimeout(entry.timer);
    entry.timer = null;
  }
}

function revokeObjectUrl(entry: AvatarEntry) {
  if (entry.objectUrl) {
    URL.revokeObjectURL(entry.objectUrl);
    entry.objectUrl = null;
  }
}

function triggerDownload(entry: AvatarEntry) {
  if (entry.hasTriggeredDownload) {
    return;
  }

  entry.hasTriggeredDownload = true;

  // Fire-and-forget nudge so the node starts fetching; the status poll is the source
  // of truth for when it is actually ready.
  void handleQdnAppRequest({
    action: 'FETCH_QDN_RESOURCE',
    ...getAvatarBridgeResource(entry),
    maxBytes: 1,
  }).catch(() => {});
}

async function poll(entry: AvatarEntry, key: string, build: boolean) {
  entry.timer = null;

  if (entry.subscribers.size === 0) {
    entry.isPolling = false;
    return;
  }

  entry.isPolling = true;

  let status: QdnResourceStatus | undefined;

  try {
    status = await fetchAvatarStatus(entry, build);
  } catch {
    // A failed status request is treated as transient and retried below.
  }

  // The entry may have been abandoned (or replaced) while the request was in flight.
  if (entries.get(key) !== entry || entry.subscribers.size === 0) {
    entry.isPolling = false;
    return;
  }

  if (status?.status === 'READY') {
    let objectUrl: string | null = null;

    try {
      objectUrl = await fetchAvatarObjectUrl(entry);

      // The entry may have been abandoned (or replaced) while the native fetch was
      // in flight. Do not leak a blob URL that no UI will use.
      if (entries.get(key) !== entry || entry.subscribers.size === 0) {
        entry.isPolling = false;
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
        return;
      }

      entry.isPolling = false;
      revokeObjectUrl(entry);
      entry.objectUrl = objectUrl;
      emit(entry, { state: 'ready', url: objectUrl });
      return;
    } catch {
      // Treat a ready-but-unreadable avatar as transient. Android WebView can fail
      // direct QDN image loads, but the status endpoint may still be accurate.
    }
  }

  if (isTerminalQdnStatus(status?.status)) {
    entry.isPolling = false;
    entry.cooldownUntil = 0;
    emit(entry, UNAVAILABLE);
    return;
  }

  // Pending: downloading / building / waiting for data, or a transient status error.
  triggerDownload(entry);
  entry.attempts += 1;

  if (entry.attempts >= MAX_POLL_ATTEMPTS) {
    entry.isPolling = false;
    entry.cooldownUntil = Date.now() + SOFT_RETRY_COOLDOWN_MS;
    emit(entry, UNAVAILABLE);
    return;
  }

  if (entry.resolution.state !== 'pending') {
    emit(entry, PENDING);
  }

  // Escalate to a synchronous build once the chunks are downloaded, mirroring QdnViewer.
  entry.timer = window.setTimeout(() => {
    void poll(entry, key, status?.status === 'DOWNLOADED');
  }, POLL_INTERVAL_MS);
}

function ensureRunning(entry: AvatarEntry, key: string) {
  if (entry.resolution.state === 'ready') {
    return;
  }

  if (entry.resolution.state === 'unavailable') {
    // Hard terminal stays unavailable; a soft give-up waits out its cooldown.
    if (entry.cooldownUntil === 0 || Date.now() < entry.cooldownUntil) {
      return;
    }

    // Cooldown elapsed — let this fresh mount retry from scratch.
    entry.attempts = 0;
    entry.cooldownUntil = 0;
    entry.hasTriggeredDownload = false;
    emit(entry, PENDING);
  }

  if (entry.timer !== null || entry.isPolling) {
    return;
  }

  void poll(entry, key, false);
}

function subscribe(key: string, resource: QdnResource, nodeApiUrl: string, subscriber: Subscriber) {
  let entry = entries.get(key);

  if (!entry) {
    entry = {
      resource,
      nodeApiUrl,
      resolution: PENDING,
      subscribers: new Set(),
      timer: null,
      isPolling: false,
      hasTriggeredDownload: false,
      attempts: 0,
      objectUrl: null,
      cooldownUntil: 0,
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
      if (activeEntry.objectUrl) {
        revokeObjectUrl(activeEntry);
        entries.delete(key);
      }
    }
  };
}

export function useAccountAvatar(
  name: string | null | undefined,
  nodeApiUrl: string,
  nodeEpoch: number,
): AccountAvatarResolution {
  const [resolution, setResolution] = useState<AccountAvatarResolution>(PENDING);

  useEffect(() => {
    if (!name || !nodeApiUrl) {
      setResolution(UNAVAILABLE);
      return;
    }

    const key = getCacheKey(name, nodeApiUrl, nodeEpoch);

    return subscribe(key, buildAvatarResource(name), nodeApiUrl, setResolution);
  }, [name, nodeApiUrl, nodeEpoch]);

  return resolution;
}
