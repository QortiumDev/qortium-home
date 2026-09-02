# Home 2 public QDN publishing

Home 2 exposes the same source-token publication contract through
`qdnRequest` and `qortalRequest`. The invoked global is the authoritative
network. An app cannot select another chain in its payload, and Home never
changes node routes or falls back between Qortium and Qortal.

## Select a source

Feature-detect both actions through `SHOW_ACTIONS`, then ask Home to open its
native file picker:

```js
const selected = await qdnRequest({ action: 'SELECT_QDN_PUBLISH_SOURCE' });

if (!selected.canceled) {
  // selected.sourceToken is opaque. No native path is returned.
  console.log(selected.fileName, selected.size, selected.sourceToken);
}
```

The selected file must be at least 1 byte. Its maximum size is not a fixed
figure: for Qortium, Home discovers the connected node's advertised publish
ceiling (`GET /arbitrary/limits`) and uses it, backstopped by Home's own hard
safety ceiling of 1 GiB, so a node can only ever shrink the effective limit,
never grow it past what Home is willing to attempt - if the node does not
support that endpoint or answers something unusable, Home falls back to a
conservative 100 MiB default instead. For Qortal, and on Android for either
network, the ceiling remains a fixed 100 MiB, unchanged. The token is bound to
the requesting app, tab, selected account, invoked network, exact node route,
and route revision. It expires after 30 minutes. Android retains only one
pending selection at a time; choosing another file invalidates the earlier
token.

Apps cannot provide native paths, URIs, inline bytes, Base64, filenames, or
MIME claims to the publish action. Home reopens and verifies the desktop file
at use time; Android uses only the bytes returned by its native picker.

On desktop only, and only for the Qortium global, an app can request
`kind: 'directory'` in place of the default `'file'`:

```js
const selected = await qdnRequest({
  action: 'SELECT_QDN_PUBLISH_SOURCE',
  kind: 'directory',
});

if (!selected.canceled) {
  // selected.kind reports which kind was actually used.
  console.log(selected.fileName, selected.kind, selected.size, selected.sourceToken);
}
```

Home opens a native folder picker instead of a file picker, zips the selected
folder's contents in memory against the same discovered ceiling, and returns a
source token the same way. `PUBLISH_QDN_RESOURCE` then unpacks a
directory-derived token into a multi-file resource server-side; the app does
not do anything differently for it - it still just passes the same
`sourceToken` it would for a file. `kind: 'directory'` is not available on
Qortal or on Android: Qortal's separate, non-streamable base64-body upload
path cannot support directory bundling and keeps its own much lower practical
ceiling (a V8 string-length limit around 384 MiB), so a Qortal request
silently keeps `kind: 'file'` regardless of what was asked for; Android's
native picker remains single-file-only.

## Publish the selected source

```js
const result = await qdnRequest({
  action: 'PUBLISH_QDN_RESOURCE',
  sourceToken: selected.sourceToken,
  service: 'ATTACHMENT',
  name: 'Alice',
  identifier: 'chat-file-20260818',
  title: 'Example attachment',       // Qortium only
  description: 'Shared in Chat',     // Qortium only
  tags: ['chat', 'attachment'],      // Qortium only
});
```

`service` and `name` are required; `identifier` is optional. Home obtains the
fee and proof rules from the selected chain and rejects any app-provided fee.
Qortium currently supports the approved public metadata fields shown above.
Qortal public publishing intentionally rejects mutable metadata until its
metadata-hash staging and attestation contract is implemented.

Home verifies that the selected account currently owns `name` on the invoked
chain, then opens a one-request permission prompt showing:

- account and chain;
- exact configured node route;
- service, name, and identifier;
- native-selected filename and byte size;
- SHA-256 content hash;
- every mutable-metadata value being published (title, description,
  category, tags) — a row appears exactly when that field is set;
- on Qortal, the chain's ARBITRARY unit fee this publish pays, read before
  the prompt and PINNED: signing refuses if the chain answers a different
  fee after approval. (Qortium publishes are fee-free with on-device
  proof-of-work, and their prompts carry no fee row.)

The desktop bridge and the Android host both apply this disclosure and the
fee pin.

After approval, Home rechecks the app, tab, account, unlock state, route, and
name ownership. It stages the source only on that route, decodes and attests
the returned ARBITRARY transaction fields, verifies the approved content hash
or Qortium artifact contract, applies proof of work where required, signs
locally, and broadcasts the signed transaction. Neither a private key nor
unsigned node-selected fields are exposed to the app.

A successful result is network-qualified and includes both a mutable resource
coordinate and an immutable pin:

```json
{
  "accepted": true,
  "network": "qortium",
  "resource": {
    "service": "ATTACHMENT",
    "name": "Alice",
    "identifier": "chat-file-20260818"
  },
  "transactionSignature": "...",
  "immutable": {
    "algorithm": "SHA-256",
    "contentHash": "...",
    "transactionSignature": "..."
  },
  "source": {
    "fileName": "example.bin",
    "size": 1234
  }
}
```

If Home has already signed but cannot prove whether broadcast succeeded, it
returns the same descriptor with `accepted: false`, `outcome: "unknown"`, and
`retryable: false`. Apps must reconcile by transaction signature and must not
silently publish again. A route that denies or lacks compatible public staging
returns `NODE_CAPABILITY_MISSING`; Home does not try another node.

The immutable hash/signature pin is the attachment identity. The QDN
coordinate can later resolve to a newer PUT and must remain visibly distinct
from that pin in app UI.
