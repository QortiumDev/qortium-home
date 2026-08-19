# Chat 2.0 plan

Last updated: 2026-08-19

Status: accepted and in progress. The implemented on-chain open/group work is
the foundation, not yet a complete Chat 2.0; Phases 2–3 below are the
remaining work for the Home 2.0 Chat app. Chat 2.0 is **not release-gated on
Qortal RCHAT/Reticulum**: the owner decided (2026-08-19) that the separate
Qortal RCHAT/Reticulum source described below is parked as a possible
post-2.0 addition, not a requirement for shipping Chat 2.0 under that name.

This plan consolidates the 2026-08-12 investigations into the Android
custom-node posting failure, Qortal legacy-CHAT status, and proven client-side
signing paths, plus the 2026-08-13 finding that the community's Reticulum chat
is a separate custom off-chain RCHAT protocol.

## Product goals

- One Chat app that works with **Qortium, Qortal, or both**, depending on
  which networks the user has connected.
- **Post-2.0, parked:** Qortal conversations may later add the current
  off-chain **RCHAT** source alongside legacy on-chain CHAT, staying visibly
  source-qualified rather than being folded into the on-chain transaction
  history. Not required for Chat 2.0 — see the Release gate note below.
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
  `POST /transactions/process?apiVersion=2`. The retired Home 1.x bridge proved
  this path in network mode (`src/platform.ts` ~6853–6912,
  `src/chatSign.ts`); Home 2 owns its continuing implementation.
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
| `SEND_CHAT_MESSAGE` | both | Initial/reply public-group send with no transaction `chatReference`. Qortium path: keyless public build + local PoW/sign. Qortal path: client-side bytes builder + PoW/sign. A signed uncertain submission retains its signature for confirmation polling. |
| `SEND_CHAT_EDIT` | both | Public-group edit with exact reference, group, sender-ownership, route, account, and network-specific payload validation before approval and signing. Qortal accepts only the frozen Hub-v3 edit envelope. |
| `SEND_CHAT_DELETE` | both | Referenced content-clearing revision with the same ownership checks. Qortium uses its empty-message revision envelope. Qortal uses Home's one canonical empty Hub-v3 edit (`messageText: "<p></p>"`, no images); Hub renders it as no message. Both immutable transactions remain available on-chain. |
| `SEND_CHAT_REACTION` | both | Public-group emoji reaction with exact reference/group binding. Unlike edits and deletes, the referenced original may belong to another sender. |
| `GET_CHAT_MESSAGE` | both | Single message by signature (read; supports confirm-polling). |

Real-time delivery starts as **polling** through these reads (the app polls
until its own signature appears → confirmed). A host subscription/websocket
contract is a later, separate tranche.

These actions cover only on-chain CHAT transactions. Qortal RCHAT is a custom
off-chain Hub protocol: it is not LXMF and not legacy CHAT transported over a
different network. `/chat/messages`, `SEARCH_CHAT_MESSAGES`, and
`SEND_CHAT_MESSAGE` therefore cannot expose or create RCHAT history. If Home
later provides RCHAT, it would need a distinct source and action family, with
Chat retaining that source identity when it normalizes messages for display —
but this is parked, post-2.0 work (Phase 6), not a Chat 2.0 requirement; Core
changes are outside this plan either way.

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

1. **Phase 1 — open/group on-chain foundation.** v2 bridge family
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
4. **Later** — host subscription contract to replace polling.

**Release gate (revised 2026-08-19):** Chat 2.0 is complete and releasable once
Phases 1–3 above land; it is **not gated** on Qortal RCHAT integration. Home's
Phase 6 Qortal RCHAT integration — a distinct trusted source/action family
that can recover current RCHAT history and exchange plain-text messages with
the current community client while leaving the legacy CHAT actions unchanged
— is parked as a possible post-2.0 addition, to be scheduled separately if
the owner decides to pursue it.

## Decisions (owner, 2026-08-12; release gate corrected 2026-08-13;
Home 2-only target corrected 2026-08-17; RCHAT release gate removed 2026-08-19)

1. **`SEARCH_CHAT_MESSAGES` is groups-only in Phase 1.** The advertised action
   accepts group selectors only; DM-involving searches are rejected with a
   clear error until the Phase 2 DM family lands. This is a documented
   deviation from full Hub compatibility and is recorded as such in the
   compatibility ledger.
2. **All new portable Chat bridge work targets Home 2.** Home 1.7.x was an
   emergency release for managed-Core compatibility, not a continuing product
   line. Historical bridge handlers remain useful reference implementations,
   but new actions and crypto are not backported. The exact Home 2 tracker is
   `docs/HOME_CHAT_PORTABILITY_ROADMAP.md`. Phase 1 is the on-chain
   foundation; Phases 2–3 complete the Chat 2.0 release scope (see the
   Release gate note above). The separate Home-managed Qortal RCHAT
   integration described above is parked as post-2.0 work, not a release
   requirement.
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
