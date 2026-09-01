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
| BTC, LTC | yes | yes | yes | yes | yes | no | local-asset and foreign/foreign | live reads pass; send deferred | Home derives receive/watch data locally; Core sees xpub only for reads |
| DOGE, RVN, DASH | yes | yes | yes | yes | yes | no | local-asset | live reads pass; send deferred | Home derives receive/watch data locally; Core sees xpub only for reads |
| DGB, NMC, FIRO | yes | yes | yes | yes | yes | no | local-asset | read backend blocked; send deferred | Current configured providers return Core error 1201; Home returns an explicit unavailable error |
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
