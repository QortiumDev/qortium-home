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
Writes are atomic and symlink-safe: a fresh randomly named temp file opened with
`O_EXCL`, then `rename` over the target (see the Trust boundary section).

The store is **bounded**: a total cap of **32 MiB** (and an entry-count cap of
512), with least-recently-stored (`storedAt`) eviction. Per-entry size reuses the
existing caps — 256 KiB for app icons, 500 KiB for avatars. On load the manifest
is refused above 2 MiB before parsing, each field is length/format-bounded (the
signature must be plausible Base58), rows are capped, and the directory is
**reconciled** against the manifest: any orphaned blob (from a crash between the
blob write and the index write) and any stray temp file is deleted, and a `ready`
row whose blob is missing or not a regular file is dropped. So eviction's byte
total tracks the real directory rather than drifting as orphans accumulate.

It includes a **negative cache**: a signature that resolved to no image is
remembered (status `missing`), so a missing-favicon app stops paying repeat
round-trips. A negative entry is authoritative only for a **bounded ~6h window**
(a transient 404 must not suppress re-fetching for the resource's whole lifetime);
past that, or when its signature changes, it re-checks. Only an actual 404 is
recorded `missing` — a 200 with a non-image body is treated as transiently
unavailable, never as authoritative absence.

In front of the disk store sits a small in-memory memo per reader that absorbs
the within-process storm and caps how often the signature is re-checked.

## Invalidation — content-addressed, not wall-clock

Invalidation is by the resource's `latestSignature`, exactly like the 1.x
content-addressed image path — never by a TTL. On a request the reader does the
cheap `/arbitrary/resources/search` to read the current signature; if the cache
holds that signature it serves from disk with no image fetch, otherwise it
fetches, validates, stores, and serves. A republish is a new signature, so it is
picked up automatically on the next check.

The wall-clock elements are a **~6h floor on how often the signature search
re-runs** (via the in-memory memo) and the matching **~6h renderer ready-cache
TTL** (`useHomeV2Image`), which is the renderer's trigger to re-ask the main
process and is deliberately not longer than the main floor. It **never serves a
genuinely stale image past a known-newer signature**: once the current signature
is resolved and the disk store misses it, a failed fetch reports *unavailable*
(the renderer keeps its own last-good copy) rather than relabelling older on-disk
bytes as fresh.

Fetched bytes are **pinned to the signature** they belong to: after a fetch the
signature is re-resolved and the bytes are cached only if it still agrees, so a
republish landing mid-fetch cannot mislabel the new revision's bytes under the
old signature. The resolve→fetch→store path is also **serialized per key** so an
older operation can never commit after a newer one. The signature lookup pulls
several candidates (Core's `identifier=` is a case-insensitive substring match)
and selects the exact, **case-correct** identity client-side.

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
- Writes are **symlink-safe**: the cache root is verified to be a real directory
  (never a symlink) on every write, each write goes to a fresh randomly named
  temp file opened with `O_EXCL` (so a pre-planted symlink at the path is
  refused, never followed) and is fully written then renamed into place; both
  blob and manifest reads open with `O_NOFOLLOW` and `fstat` the open handle,
  requiring a regular file. A statically planted symlink (root, blob, manifest,
  or temp path) is refused, not followed.

## Threat model and accepted residuals

The store lives under the user's own `userData`. The only actor who can plant or
swap a symlink there is **a process running as the same user**, who already has
full read/write/delete access to everything the user owns — including this
directory. So the boundary this store defends is data integrity against
*accidental* corruption and *non-concurrent* tampering, not a privilege boundary.

- **Concurrent root-swap TOCTOU.** The symlink guards are path-based (`lstat`
  then operate). A same-user process that swaps the root to a symlink in the
  window between a guard and a following `readdir`/`rename`/`unlink` could still
  redirect that operation outside the store. Fully closing this needs
  descriptor-relative syscalls (`openat`/`unlinkat` on a dir fd) that Node's
  synchronous `fs` API does not expose. It is **accepted**: an attacker who can
  win this race already has same-user code execution and can delete or overwrite
  the user's files directly — routing through Home as a confused deputy grants
  no capability it does not already have.
- **`index.json` replaced by a directory.** Writes fail closed (the store
  returns "not cached" instead of throwing), but the manifest cannot be rewritten
  until the directory is removed out of band. A same-user actor is again already
  inside the boundary; the store simply stops persisting rather than crashing.

## Renderer contract

The IPC surface is unchanged: the renderer calls the same
(`home-v2-nodes:readAppIcon`, `home-v2-nodes:readAvatar`) and gets the same
base64 result shapes back, and the preload surface is untouched. The only
renderer change is `useHomeV2Image`'s ready-cache TTL, lowered from 24h to 6h to
match the main-process signature-revalidation floor (see Invalidation above).

## Known follow-up

Account-pointer avatars (Qortium) are content-addressed by the descriptor the
**renderer supplies**, while the bytes are fetched via the address, which
re-reads the account's *current* avatar pointer. If the account repoints its
avatar (A→B) in the window between normalize and fetch, the sequence is
resolve-A → fetch-B → re-resolve-A, so B's bytes are cached under A's signature
and signature equality does not detect it. This does **not** self-heal on the
next avatar request: the renderer keeps supplying the stale descriptor A (from
its retained `identity.avatar`), so A is resolved again and the mispaired entry
is re-served. It clears only when an **upstream identity refresh** supplies the
new pointer (descriptor B). Impact is bounded — an out-of-date avatar for that
one account until its identity data refreshes. Full address-pinning of this path
(or comparing the response's returned avatar descriptor before caching) is
tracked as a follow-up, not blocking.
