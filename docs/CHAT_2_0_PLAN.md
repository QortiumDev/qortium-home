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
   `SEARCH_CHAT_MESSAGES` encrypted-result decision. Plan text only below —
   nothing in this bullet is implemented yet:
   - **Home-side DM decryption, in the trusted layer, for both chains.** For
     a DM transaction the selected account sent or received, Home derives an
     ECDH shared secret from the selected account's private key and the
     counterparty's public key (the counterparty is read from the
     transaction: recipient's public key for a sent message, sender's public
     key for a received one), and uses that shared secret to AES-decrypt the
     transaction's ciphertext payload — entirely inside Home's trusted layer
     (Electron main process / Android shell), never inside the app frame.
     This mirrors Qortium Core's own local-account decryption path
     (`ChatResource` direct/private-group endpoints, `q-apps.js DECRYPT_DATA`)
     but runs in Home regardless of node mode, so it works identically
     against a local, custom, or public node — decision 3 below.
   - **`SEARCH_CHAT_MESSAGES` gains an opt-in "decrypt mine" mode.** A new
     request flag (name TBD at implementation time) that, when set, allows
     `involving`/`sender`/`recipient` selectors scoped to the *selected
     account only* and returns those DM results already decrypted using the
     mechanism above. This does not lift the general DM restriction —
     `SEARCH_CHAT_MESSAGES` still cannot be used to read DMs the selected
     account is not a party to (Home has no shared secret to decrypt them
     with, so there is nothing useful to return); it only replaces the
     current "reject with a specific error" behavior for the account's own
     DMs with real, decrypted results.
3. **Phase 3 — file sharing upgrade.** Attach-by-link of existing publishes,
   attachment browsing, and the publish-attach flow reworked on the v2 write
   family (QDN publish actions are their own ledger tranche and gate this).
4. **Later** — host subscription contract (replace polling), Reticulum
   transport (Phase 6 of the product plan; Qortal's FreeChat interop lives
   there).

## Decisions (owner, 2026-08-12)

1. **`SEARCH_CHAT_MESSAGES` is groups-only in Phase 1.** The advertised action
   accepts group selectors only; DM-involving searches are rejected with a
   clear error until the Phase 2 DM family lands. This is a documented
   deviation from full Hub compatibility and is recorded as such in the
   compatibility ledger.
2. **No interim Home 1.x chat patch.** Everyone moves in one update: the 2.0
   release, gated on Chat 2.0 Phase 1. The custom-node posting failure class
   is fixed by the client-side sign/broadcast architecture, not patched twice.
3. **Qortal DMs are in scope and required — with app-visible decryption on
   every node mode.** Qortal users matter, and Qortal never exposed DM
   decryption to apps (no qortalRequest for it; Hub decrypts only in its own
   UI). Qortium Core does decrypt DMs server-side for the local account
   (ChatResource direct/private-group endpoints, plus q-apps.js DECRYPT_DATA),
   but that inherently works only against a local node. Phase 2 therefore
   implements **Home-side DM/private-group decryption in the trusted layer**
   so DMs work identically on local, custom, and public nodes on both chains,
   exposed to apps through bridge actions; Qortium's Core-managed server-side
   path remains a local-node convenience, and the two must interoperate on the
   same wire format. Mechanism and the `SEARCH_CHAT_MESSAGES` "decrypt mine"
   mode are specified under Phase 2 above.
