# Chat 2.0 plan

Last updated: 2026-08-12

Status: proposed for owner review. Chat 2.0 is **release-gating for Home 2.0**:
the current production Home 1.x bridge is what makes chat work today, and the
Home 2.0 shell must not ship to users until an equivalent (better) chat path
exists through its own bridge.

This plan consolidates three verified investigations (2026-08-12): the Android
custom-node posting failure, the Qortal legacy-CHAT status, and the proven
client-side signing paths already in production.

## Product goals

- One Chat app that works with **Qortium, Qortal, or both**, depending on
  which networks the user has connected.
- Works in **every node mode** — Local, Custom, and Public — on both chains.
  No feature silently requires a local node when a client-side path exists.
- Explicit **pending → confirmed** message states (mempow latency currently
  reads as failure; testers double- and triple-post the same message).
- Upgraded **file sharing**: attach by publishing, and attach by **linking an
  existing publish** (browse own resources, embed `qdn://` / `qortal://`
  references) instead of forcing a republish.
- Private keys never leave Home. The v1 pattern of posting `senderPrivateKey`
  to `/chat/private/*` and `/transactions/sign` is retired, not ported.

## Verified foundations (already in production code)

- **Qortium open-group send, keyless**: `POST /chat/public/build` (no API key)
  → local worker MemoryPoW → local Ed25519 signature → 
  `POST /transactions/process?apiVersion=2`. Used today when Home 1.x is in
  network mode (`src/platform.ts` ~6853–6912, `src/chatSign.ts`).
- **Qortal group send, fully client-side**: Home builds the CHAT transaction
  bytes itself (`buildUnsignedQortalGroupChatTransactionBytes`), computes the
  nonce locally, signs with nacl, broadcasts to the Qortal node's
  `/transactions/process?apiVersion=2` (`src/platform.ts` ~9740–9760). Proven
  in production by ChibiHub's `SEND_QORTAL_GROUP_CHAT`.
- **Qortal legacy CHAT is alive** in upstream core (24h TTL, delegate store,
  relay intact) — but modern Qortal **rejects group-0 general chat at the
  API** ("general chat transactions are invalid"). Qortal mode is therefore
  **groups + DMs only**; the UI must not offer a Qortal general channel.
  Qortal PoW rules: difficulty 8 leading zero bits at >= 4 QORT confirmed
  balance, else 18; 8 MiB PoW buffer; payload 1–4000 bytes; timestamp <= 5
  minutes ahead; ~250 messages/hour/sender rate limit.
- **Why this fixes the reported Android failure**: the custom-node write
  refusal is a Home routing policy (keyless path only selected in network
  mode; everything else demands API key + loopback). Client-side
  build/sign/broadcast works against any node whose operator exposes the
  public build/process endpoints — local, custom VPS, or public.

## Architecture

### Layering

- **Home owns signing.** The v2 bridge implements the chat actions in Home's
  trusted layer (Electron main process / Android shell). The Chat app calls
  actions; it never sees key material. Same permission model as the account
  reads: per app + tab + account + network + node-route prompts, with
  session-scope grants, and an unlocked account required for sends.
- **Phase 5 carve-out**: chat send is transaction signing, so this is an
  explicit, bounded exception to the deferred-signing boundary — **CHAT
  transaction type only** (fee-less, cannot move funds, bounded payload),
  documented in the compatibility ledger. Payments/arbitrary signing remain
  behind Phase 5.

### New v2 bridge action family

| Action | Protocols | Semantics |
| --- | --- | --- |
| `SEARCH_CHAT_MESSAGES` | both | Bounded read of `/chat/messages` (group selector or involving pair). Encrypted-DM result handling follows the pending owner decision recorded in the ledger. |
| `SEND_CHAT_MESSAGE` | both | Open/group chat send. Qortium path: keyless public build + local PoW/sign. Qortal path: client-side bytes builder + PoW/sign. Returns the signature immediately after broadcast acceptance. Hub-compatible payload semantics on `qortalRequest` (group + DM once DM phase lands). |
| `GET_CHAT_MESSAGE` | both | Single message by signature (read; supports confirm-polling). |

Real-time delivery starts as **polling** through these reads (the app polls
until its own signature appears → confirmed). A host subscription/websocket
contract is a later, separate tranche.

### Message format compatibility

- Qortal messages use the Hub-compatible JSON schema (`messageText`, `images`,
  `repliedTo`, …) so Qortal users see Chat 2.0 messages correctly and vice
  versa.
- Qortium messages keep the current qortium-chat schema (Home's chat is the
  only Qortium chat client; the wire format can evolve with the app), extended
  with the linked-publish attachment fields.

### Node-mode matrix (target)

| Capability | Local | Custom (remote) | Public |
| --- | --- | --- | --- |
| Read groups/messages | yes | yes | yes |
| Open-group send (Qortium) | yes | yes¹ | yes¹ |
| Group send (Qortal, txGroupId != 0) | yes | yes¹ | yes¹ |
| Qortal general chat (group 0) | no — rejected by modern Qortal API | no | no |
| DMs / private groups | Phase 2 (client-side encryption) | Phase 2 | Phase 2 |

¹ Requires the node operator's public API policy to expose the build (Qortium)
and `/transactions/process` endpoints; the send surfaces a specific error
naming the missing endpoint when it does not.

## Phases

1. **Phase 1 — open/group chat parity (release gate).** v2 bridge family
   above; Chat app ported to the v2 bridge with dual-chain accounts/groups,
   pending states, and clear node-capability errors. Fixture matrix per
   action (payload/result/error/timeout/permission/node-mode/stale-context/
   malformed on desktop + Android), packaged smokes extended to a real send
   on Previewnet.
2. **Phase 2 — DMs and private groups.** Client-side encryption/key handling
   design (replaces v1's key-posting endpoints), both chains; includes the
   `SEARCH_CHAT_MESSAGES` encrypted-result decision.
3. **Phase 3 — file sharing upgrade.** Attach-by-link of existing publishes,
   attachment browsing, and the publish-attach flow reworked on the v2 write
   family (QDN publish actions are their own ledger tranche and gate this).
4. **Later** — host subscription contract (replace polling), Reticulum
   transport (Phase 6 of the product plan; Qortal's FreeChat interop lives
   there).

## Open decisions (owner)

1. `SEARCH_CHAT_MESSAGES` encrypted-DM boundary (defer / group-only / full
   passthrough) — previously raised, still open; needed by Phase 1 reads.
2. Whether a minimal Home 1.x patch ships in the meantime (route custom
   non-local open-group chat down the existing keyless path + clearer error)
   so current-production users with own nodes can post before 2.0 releases.
3. Qortal DM interop priority: Phase 2 as scheduled, or pulled earlier if
   Qortal-side users matter sooner.
