# Qortium Home coin and asset support matrix

_Current implementation snapshot: 2026-09-01. Scope: Qortium Core and Qortium
Home; the standalone Wallet app is intentionally excluded._

This matrix distinguishes code presence from live acceptance. Core enablement
is runtime configuration, not a permanent property. The values below record the
local synced Previewnet Core at the time of each check; apps must use
`GET_CROSSCHAIN_BLOCKCHAINS` for the connected Core's current values.

| Rail | Core implementation | Previewnet enabled | Home wallet | Balance | Receive | Send | Core trade engine | Live acceptance | Main restriction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| QORT | Qortal, not Qortium Core | n/a | yes | yes | yes | yes | no Home trade path | packaged balance pass; send source-tested | Home signs locally; public Qortal node receives signed bytes only |
| BTC, LTC | yes | yes | yes | yes | yes | yes (Home-signed, trusted Core) | local-asset and foreign/foreign | live reads pass; send source-tested; no funded send | Home derives receive/watch data locally and signs sends itself; Core sees an xpub for reads and finished bytes for a send, never a key |
| DOGE, RVN, DASH | yes | yes | yes | yes | yes | yes (Home-signed, trusted Core) | local-asset | live reads pass; send source-tested; no funded send | Home derives receive/watch data locally and signs sends itself; Core sees an xpub for reads and finished bytes for a send, never a key |
| DGB, NMC, FIRO | yes | yes | yes | yes | yes | yes (Home-signed, trusted Core) | local-asset | read backend blocked; send source-tested; no funded send | Current configured providers return Core error 1201 for reads AND for the send spend-context, so sending refuses as backend-unavailable until that is fixed |
| BCH, PPC, KMD, VRSC, ZEC, LBC, XVG | yes | no | no | no | no | no | local-asset | not started | Core adapter exists; Home derivation and wallet actions do not |
| ARRR | yes, separate JNI path | no | no | no | no | no | local-asset | not production-ready | Native runtime, ownership model, lifecycle, fees, and restore/send acceptance remain |
| Qortium asset `0` | generic asset support | absent by design | contract yes | yes when present | selected Qortium address | yes when present | arbitrary local asset | synthetic-chain only | Previewnet has no asset `0`; explicit reads correctly return invalid asset ID |
| Other Qortium assets | yes | extant IDs 1-3 | contract yes | yes | selected Qortium address | yes | arbitrary local asset | packaged balance pass; transfer source-tested | Live transfer acceptance remains pending |
| Qortal assets other than QORT | Qortal, not Qortium Core | n/a | yes | yes | selected Qortal address | yes | no | packaged balance pass; transfer source-tested | Uses `qortalRequest`; live transfer acceptance remains pending |
| ETH, tokens, L2s | no | no | no | no | no | no | no | planned | Threat model, RPC policy, fees, tokens, and local signing first |
| XMR | no production wallet path | no | no | no | no | no | no | planned | Separate wallet architecture and native acceptance required |

## Meaning of the columns

- **Core implementation** means relevant chain/asset code exists. It does not
  mean the configured Core enables a foreign wallet or that Home can use it.
- **Home wallet** means Home has the derivation and adapter exposed through its
  QDN bridge. For foreign chains, the authoritative discovery field is
  `homeWallet.implemented`.
- **Balance / Receive / Send** record Home bridge implementation, not a promise
  that a runtime node, server, fee estimate, or funded wallet is available.
- Foreign **Send** is Home-local signing: Home reads the wallet's confirmed
  spendable state from an administratively trusted Core, plans and signs the
  transaction in its own process, writes it ahead, and asks Core only to relay
  the finished bytes. It is advertised (`homeWallet.sendMode === 'HOME_LOCAL'`)
  only when that trusted Core is present AND an account is selected and
  unlocked; a public or untrusted route always answers `send: false`.
  No funded send has been performed on any of the eight chains: the evidence
  so far is deterministic vectors and source-level tests only.
  DGB, NMC and FIRO additionally return Core error 1201 on the send
  spend-context with the currently configured providers, the same blocker
  their reads hit; a Core-side fix (Electrum protocol cap 1.4 and refreshed
  server pins) is in flight separately.
- Foreign **Send** additionally requires a Core that actually implements
  `/crosschain/<coin>/wallet/public/spend-context`. Home probes that route
  once per node/API-key revision before advertising `send`, so an older
  trusted Core answers `send: false` rather than advertising a capability it
  would then 404 on. The probe only reports the route as present on an
  affirmative answer (it rejected a deliberately invalid body on its merits);
  404/405 means absent, and anything else — a 5xx, a timeout, an auth failure
  — is inconclusive, which also advertises `send: false` and is re-checked
  after thirty seconds so a blip recovers quickly.
- The two numbers Home takes from Core on trust — `recommendedFeePerByte` and
  `minimumNonDustOutput` — are checked against per-coin absolute ceilings
  (`electron/foreign-wallet-policy-bounds.ts`) before any plan is built, and
  again on the post-approval re-read. A value above its ceiling is REFUSED,
  never clamped. The ceilings are derived from Core's own declared values in
  `src/main/java/org/qortium/crosschain/BitcoinyChainSpecs.java` — at least ten
  times each chain's `minNonDustOutput` and well above its `defaultFeePerKb` —
  so an honest Core is never refused. Dogecoin is the reason that derivation
  matters: its dust floor is `Coin.COIN`, a whole coin, and a ceiling guessed
  from Bitcoin's 546 would refuse every real Dogecoin send. The inflated-dust
  case is the dangerous one, because change below the dust floor is absorbed
  into the fee rather than returned. The finished plan is bounded too: its
  total fee must fit the per-coin ceiling for its size, and a fixed-amount
  send may never pay more in fee than it sends, at any size — the refusal
  points at send-max or a larger amount.
- **Acceptance gate.** Enabling foreign send for real use is gated on a
  packaged acceptance pass against a Core that carries the spend-context and
  chain-bound broadcast routes. Until that pass exists there is no end-to-end
  wired coverage: the evidence is deterministic vectors, dependency-injected
  orchestrator tests and source-level pins. The wired integration harness is
  PR 2's scope, and `smoke:desktop:qdn-foreign-send-dry-run:packaged` is the
  bridge-level check available in the meantime.
- A send whose outcome Home could not prove leaves a write-ahead entry that
  blocks further sends for that wallet and coin. The NEXT send for the same
  wallet reconciles it automatically, in two ways and no others:
  - An entry that reached `broadcast-attempted` had its bytes leave the
    process. Home reads the wallet's own transaction history from the trusted
    Core and clears the entry only if the exact transaction id it signed
    appears there. If it does not, the send is refused and names the
    transaction; nothing is ever retried or discarded on a guess.
  - An entry still at `signed` proves the opposite: the broadcast-attempt mark
    is written and fsynced BEFORE the single broadcast request, so a missing
    mark means the request was never made and the signed bytes were never
    persisted. Once such an entry is older than the send freshness window
    (ten minutes — the same constant that would have refused that send as
    stale), it is released as `signed-never-attempted` and logged. The age
    guard is what makes this safe: a younger entry may belong to a send in
    flight in another Home instance, so it still blocks.

  Home's own Settings surface can list the retained entries read-only; no QDN
  app can enumerate them, and no app- or shell-facing channel removes one.
  Reconciliation believes the administratively trusted Core's account of the
  wallet's history by design: that node already supplies the UTXO set, the fee
  rate and the broadcast relay, so it is named as foreign sending's integrity
  trust root rather than being checked by a verification Home cannot perform,
  and the read-only pending list stays the manual recovery surface.
- **Core trade engine** records Core/AT capability. Home currently exposes no
  mediated trade actions, so QDN apps cannot safely drive those trades yet.
- **Live acceptance** becomes complete only after deterministic vectors and the
  controlled live checks in the tracked roadmap pass.

## Recorded read-only evidence

The deterministic Phase 2A tranche pins the first receive address, root xpub,
and public synthetic xprv for all eight Home Bitcoiny wallets against a
separately preserved archived implementation. Independent Base58Check,
version-byte, and Node-secp256k1 key-correspondence checks pass, along with
legacy wallet-version and nonzero account-index vectors. This proves derivation
compatibility but is not live server or send acceptance.

On 2026-08-06 the merged Core returned HTTP 200 with balance `0` and empty
history for BTC, LTC, DOGE, RVN, DASH, NMC, and FIRO using the synthetic Home
wallet vectors. The shared Home contract also returned BTC balance, address
information, and history successfully against that running Core. DGB truthfully
returned Core error `1201` for balance, history, and height because none of its
two configured servers accepted wallet connections; the live Home contract
mapped the DGB balance failure to
`FOREIGN_WALLET_BACKEND_UNAVAILABLE`; it does not turn it into a false zero or
empty history. Receive material remains locally derivable. No prepare, send,
sign, or broadcast request was made.

On 2026-09-01 the packaged Home 2.1 AppImage passed a wallet-only dual-bridge
smoke against the local Qortium Core and a public Qortal node. It verified
matching balances for QORT, a nonzero Qortal asset, and a nonzero Qortium asset,
and verified the truthful foreign receive/read/server/send capability modes.
Separate authenticated synthetic-xpub probes returned HTTP 200 balance `0`,
empty history, and address information for BTC, LTC, DOGE, RVN, and DASH. DGB,
NMC, and FIRO returned Core error `1201` for all three read routes. No wallet
secret, prepare, sign, send, or broadcast operation was used.

On 2026-08-05 the local synced Previewnet Core reported 15 Bitcoiny rows plus
ARRR. BTC, LTC, DOGE, DGB, RVN, DASH, NMC, and FIRO had
`walletEnabled: true`; the other foreign rows had it false. Asset discovery
returned TIUM (`1`), CHIP (`2`), and SMPL (`3`). For the CHIP owner,
`/addresses/balance/{address}?assetId=2` returned
`1000000000.00000000`; explicit `assetId=0` returned Core error `601`,
`invalid asset ID`, consistent with Previewnet's no-native-asset design. No
funds were moved.

The long-term sequence and acceptance gates are maintained in the operator
roadmap at `/home/user/AGENTS/planning/qortium-coins-trades-at-roadmap.md`.
