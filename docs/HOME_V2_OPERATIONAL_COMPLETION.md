# Home 2 Chat Operational Completion

Home 2 keeps Chat's trusted state bound to the current app, tab, account,
chain, and node route. This contract applies equally to `qdnRequest` and
`qortalRequest` on desktop and Android.

## Lifecycle invalidation

Home revokes transient authority on every relevant boundary:

| Event | State revoked |
| --- | --- |
| Account selection or unlock state changes | Session approvals, chat send-rate state, pending permission prompts, publish source tokens, and resource-stream capabilities |
| Account lock | The same transient state plus all pending account/crypto prompts |
| Node mode, custom URL, or effective route changes | Route-bound approvals, pending work, publish tokens, and streams |
| App navigation | The originating tab's pending prompts plus all transient bridge grants, tokens, streams, and send-rate state |
| Tab close | The closed tab's pending prompts plus all transient bridge grants, tokens, streams, and send-rate state |
| Home restart | All in-memory authority starts empty; only the encrypted wallet stores, durable notification grants, and the opaque pending-transaction journal survive by design |

Long-running crypto, proof-of-work, publish, and broadcast paths still recheck
their app/account/route/target predicates before privileged side effects.
Invalidation is an additional proactive boundary, not a substitute for those
checks.

## Unknown signed transaction journal

A transaction can be signed and submitted while its HTTP result is lost. Home
must not convert that unknown outcome into an apparently safe retry. When a
write returns `outcome: "unknown"`, Home records an opaque local entry before
returning the result with `journalStored: true`.

The journal contains only:

- selected account identifier;
- stable QDN app identity;
- bridge protocol and authoritative chain;
- exact mutation action;
- signed transaction signature and timestamp;
- the optional `key-announcement` stage when an automatic QPGC bootstrap is
  uncertain and the user message is known not to have been submitted;
- creation time; and
- a normalized group, direct-address, public-resource, or operation target.

It never stores the message, payload, private key, shared/group key, source
bytes, native path, filename, MIME type, or plaintext/ciphertext hash. Entries
expire after 30 days; at most 256 entries and 512 KiB are retained. Desktop
uses an atomic mode-0600 file in Home's user-data directory. Android uses the
app-private Preferences store. Both surfaces validate every stored entry when
reading it.

Two route-independent actions expose only the invoking app's entries for the
selected account and invoked chain:

```js
const pending = await qdnRequest({ action: 'GET_PENDING_TRANSACTIONS' })

await qdnRequest({
  action: 'FORGET_PENDING_TRANSACTION',
  signature: pending.entries[0].signature,
})
```

`GET_PENDING_TRANSACTIONS` uses a scoped
`transactions.pending.read` approval. `FORGET_PENDING_TRANSACTION` is always a
single-request `transactions.pending.forget` approval. A payload `network`, if
present, must match the invoked bridge.

Until the app reconciles and forgets an entry, Home blocks another mutation
with the same app, account, chain, action, and normalized target using
`PENDING_TRANSACTION_RECONCILIATION_REQUIRED`. This deliberately prefers a
temporary coarse block over a duplicate transaction. The error includes the
retained signature in its message; the app should query the journal, search the
selected chain for that signature, update its delivery state, and then forget
the entry. Forgetting is explicit because absence from one node's retained
window is not proof that a signed transaction was never accepted.

An automatic Qortium private-group bootstrap is a bounded exception to the
same-target retry block. Home broadcasts the key announcement before building
the user mutation. If that control outcome is unknown, the retained entry is
marked `stage: "key-announcement"` and the bridge result proves
`messageSubmitted: false`. Retrying the original mutation is therefore safe:
it either discovers the retained key or announces another key, and QPGC
messages bind their exact key ID. The app forgets the setup entry once a usable
current-epoch key is observed.

## Route and platform matrix

Automated contract tests require every public-group, private-group, direct,
membership/admin, public/private attachment, resource, notification, and
pending-transaction action on both protocols for these reachable routes:

| Platform | Local | Authenticated custom | Unauthenticated custom | Public |
| --- | --- | --- | --- | --- |
| Desktop | Required | Required | Required | Required |
| Android | Not a platform route | Required | Required | Required |

Android cannot run a Core process on the phone, so `local` is correctly
reported unavailable there; it is not advertised as a reduced chat mode.
Operator-disabled or unreachable routes produce explicit availability errors.
They do not cause cross-chain or alternate-node fallback.

Home keeps background health polling bounded and already pauses it while the
document is hidden. Chat owns read watermarks and bounded conversation polling;
a Home subscription action remains unnecessary unless real use shows polling
cannot meet delivery needs.

## Chat integration

Chat must consume the two journal actions before enabling same-target writes
after startup, account change, or route change. It must reconcile by signature,
show an outcome-unknown state rather than a generic failure, and never offer a
blind retry. This is app work after Home's H7B completion; no additional Home
authority or message content is required.
