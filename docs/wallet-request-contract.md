# Versioned wallet requests

Apps may use `qdnRequest({ action: 'WALLET_REQUEST', coin, operation, parameters? })`
when fresh `GET_CROSSCHAIN_BLOCKCHAINS` metadata advertises
`homeWallet.requestContract: 'qortium-home-wallet-request-v1'` for that coin.
Cached discovery data is display-only. Existing read/send/receive capabilities,
platform restrictions, unlock requirements and operation-specific contracts
still determine availability. The envelope itself grants no authority.

```js
qdnRequest({ action: 'WALLET_REQUEST', coin: 'BTC', operation: 'balance',
  parameters: { verified: true } })
qdnRequest({ action: 'WALLET_REQUEST', coin: 'XMR', operation: 'status',
  parameters: { passive: true } })
qdnRequest({ action: 'WALLET_REQUEST', coin: 'ARRR', operation: 'stop' })
```

Coins and operations are exact identifiers. `electron/wallet-request-contract.ts`
is the authoritative registry. Unknown coins, operations, outer fields and
parameter fields are rejected. Apps cannot supply wallet seeds, node routes,
Core session IDs, replacement actions or replacement coins. Canonicalization
runs before the existing desktop/Android route, permission, widget and send
checks; consent remains operation-specific. ARRR Stop is node-scoped; XMR Stop
is owner-scoped. A generic operation name does not imply interchangeable custody.

| Coins | Operations |
| --- | --- |
| BTC, LTC, DOGE, DGB, RVN, DASH, NMC, FIRO | address, balance, transactions, send, servers, set-server |
| ARRR | address, balance, transactions, status, session, activate, start, stop, send-readiness, send-status, send |
| XMR | status, activate, stop, send-prepare, send-commit, send-cancel, send-status |

Parameters are restricted per operation; native validators retain their type,
amount, address and approval rules. Return values/errors are the existing typed
coin contracts, not a newly coerced union. QORT keeps its dual-network native
bridge. Supporting a new coin requires a registry entry plus a tested adapter;
never add an arbitrary URL or dispatch escape hatch.

## Core transport

`electron/core-wallet-api.ts` selects supported operations from authenticated,
bounded, redirect-free GET `/crosschain/wallets/{coin}/protocol` metadata on the
pinned numeric-loopback Core. Contract `qortium-core-wallet-api-v1` supplies
registered reads/writes and `X-WALLET-SESSION`. A route-bound cache reduces probes;
route identity is rechecked after discovery. Mapping at final dispatch is
synchronous and changes only the URL/header, preserving native bodies and parsers.
Existing Bitcoiny public reads/Home signing retain their shared coin API.

Old Core versions, missing metadata and unregistered operations select the
existing native endpoint **before dispatch**. A failed mutation is never retried
on another endpoint. Apps likewise select the legacy Home action before one
request when the bridge contract is absent; errors never trigger send replay.

## Shared scan start

Fresh compatible Core discovery adds `homeWallet.scanStartContract:
"qortium-home-wallet-scan-start-v1"` and all three `scanModes`. ARRR and XMR
`activate` parameters accept the same `scanMode`, plus integer `restoreHeight`
only for `RESTORE_FROM_HEIGHT`. Default `RESUME` preserves saved progress.

Home rejects malformed choices before consent/seed access and approves the chosen
height or the explicit never-funded-address assertion in the native host prompt.
Historical restore must start before the first receipt; current-tip mode cannot
find older receipts. Compatible trusted numeric-loopback Core is required for
explicit choices, while older Core retains its conservative resume behavior.
Home maps the policy to the existing serialized coin custody operations; authority
never reaches the QDN app. A lost activation acknowledgement is reconciled or left
uncertain without replaying the seed/entropy request. Every awaited step fences
account, route, grant and ownership changes, including ARRR's second passive status
inspection. Saved heights and chain preparation are public display metadata only.
