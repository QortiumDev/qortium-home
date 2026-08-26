# Home v2 persistent image cache

Home fetches two kinds of small public image from a node: QDN **app icons**
(`favicon.ico` for APP/WEBSITE/GAME tabs) and account/group **avatars**. Both
are read in the main process (`electron/home-v2-node-bridge.ts`) and handed to
the renderer as base64 over IPC.

R4-7 pass 1 (#396) added the renderer's stale-while-revalidate. Pass 2 adds the
persistent store behind it, in `electron/home-v2-image-cache.ts`.

## Why

Before this, `readHomeV2AppIcon` and `readHomeV2Avatar` did a raw fetch on every
call. So every renderer, every detached window, and every restart re-fetched the
same bytes — a refetch storm on a screen full of same-owner icons, and a cold
start after every launch.

## What it is

A store under **`app.getPath('userData')/home-v2-image-cache/`** (userData, not
`getPath('cache')`, which the OS can clear underneath us). Bytes live on disk in
a file named `sha256(cacheKey)`; an `index.json` manifest holds one row per
entry: `{ cacheKey, contentType, byteLength, signature, storedAt, status }`.
Writes are atomic (write to `.next`, then `rename`), matching the shell-store
pattern.

The store is **bounded**: a total cap of **32 MiB** (and an entry-count cap),
with least-recently-stored (`storedAt`) eviction. Per-entry size reuses the
existing caps — 256 KiB for app icons, 500 KiB for avatars.

It includes a **negative cache**: a signature that resolved to no image is
remembered (status `missing`), so a missing-favicon app stops paying repeat
round-trips until its signature changes.

In front of the disk store sits a small in-memory memo per reader that absorbs
the within-process storm and caps how often the signature is re-checked.

## Invalidation — content-addressed, not wall-clock

Invalidation is by the resource's `latestSignature`, exactly like the 1.x
content-addressed image path — never by a TTL. On a request the reader does the
cheap `/arbitrary/resources/search` to read the current signature; if the cache
holds that signature it serves from disk with no image fetch, otherwise it
fetches, validates, stores, and serves. A republish is a new signature, so it is
picked up automatically on the next check.

The only wall-clock element is a **~6h floor on how often the signature search
re-runs** (via the in-memory memo). It never serves a genuinely stale image past
a known-newer signature; it only avoids re-running the search on every render.

If the signature cannot be resolved, the reader degrades to an uncached fetch —
today's behavior — rather than caching under a guessed key.

## Trust boundary

The cache files are **untrusted input on read-back**, even though the content is
public and the store is per-machine local:

- A stored `contentType` is **never trusted**. On every read the bytes are
  re-sniffed with the same magic-byte validator used on the network path
  (`getHomeV2AppIconContentType`); if the sniff fails or disagrees with the
  stored type, the entry is dropped and treated as a miss (re-fetch). A corrupt
  or tampered file therefore cannot inject a content-type into the renderer.
- The same sniff runs on **write**, so bytes whose magic bytes disagree with the
  declared type are never stored.
- A corrupt or unreadable `index.json`, and any unreadable entry file, degrade
  to a cache-miss — never a crash.
- Per-entry byte caps are enforced on write.

## Renderer contract

Unchanged. The renderer calls the same IPC (`home-v2-nodes:readAppIcon`,
`home-v2-nodes:readAvatar`) and gets the same base64 result shapes back. Only the
main process gained a cache; `useHomeV2Image` and the preload surface are
untouched.
