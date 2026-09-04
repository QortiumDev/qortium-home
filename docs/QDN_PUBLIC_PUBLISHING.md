# Home 2 QDN publishing

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

On desktop, Home reads `/arbitrary/limits` from the selected node before the
picker. An admin-trusted Qortium node uses its authenticated `publishMaxSize`;
an untrusted/public route uses the smaller of `publicPublishMaxSize` and the
existing 100 MiB Home public-attestation bound. Home applies a 2 GiB hard
ceiling to authenticated sources and falls back to 100 MiB if an older node
has no usable limits endpoint. Android remains capped by its separate 100 MiB selection and
retained-memory boundaries. The token is bound to the requesting app, tab,
selected account, invoked network, exact node route, and route revision. It
expires after 30 minutes.

Apps cannot provide native paths, URIs, inline bytes, Base64, filenames, or
MIME claims to the publish action. Home reopens and verifies the desktop file
at use time; Android uses only the bytes returned by its native picker.

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
name ownership. On desktop Qortium, the canonical administrative-trust result
selects the transport: a trusted managed or attached-key node receives a
streamed authenticated upload; every other node receives the unchanged
keyless public upload. The trusted route also pins and rechecks the exact
origin-and-key revision. Home decodes and attests the returned ARBITRARY
transaction fields, verifies the approved content hash and Qortium artifact
contract, applies proof of work where required, signs locally, and broadcasts
the signed transaction. Neither a private key nor the node API key is exposed
to the app.

For a large trusted-node file, desktop Home first streams the selection into a
private, Home-owned snapshot while computing the SHA-256 shown in the prompt.
It uploads that immutable snapshot as a stream, downloads Core's encrypted
pre-signature artifact to a bounded temporary file, verifies the signed hash
and chunk metadata, decrypts it as a stream, and compares the packaged file
against the snapshot before signing. No whole-file or whole-artifact heap copy
is made. The snapshot and attestation files are removed when the attempt ends.

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
silently publish again. A route that denies or lacks its selected staging
contract returns `NODE_CAPABILITY_MISSING`; Home does not try another node. Authenticated
streaming also requires a Core that exposes
`/arbitrary/authenticated/data/{hash}` for pre-signature readback. Home will
not fall back to the public builder after approval or trade away exact-byte
attestation to support an older trusted node.

The immutable hash/signature pin is the attachment identity. The QDN
coordinate can later resolve to a newer PUT and must remain visibly distinct
from that pin in app UI.
