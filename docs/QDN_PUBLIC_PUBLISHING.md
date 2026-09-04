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
figure: for Qortium, Home asks the connected node what it accepts
(`GET /arbitrary/limits`) and then clamps that answer by two ceilings of its
own, so a node can only ever shrink the effective limit and never grow it:

| Ceiling | Value | Why |
| --- | --- | --- |
| Attestation | 1 GiB | The largest approved source Home will attest at all. |
| Resident memory | 256 MiB | The publish pipeline still hands attestation a byte array and holds several derivatives of it, so this - not what Core accepts - is what Home is willing to keep in the main process. It is the binding one today. |

If the node does not support that endpoint or answers something unusable, Home
falls back to a conservative 100 MiB instead. For Qortal, and on Android for
either network, the ceiling stays a fixed 100 MiB, unchanged.

The token is bound to the requesting app, tab, selected account, invoked
network, exact node route, and route revision. It expires after 30 minutes.
Android retains SEVERAL pending selections - a batch publish needs them - but
under a total budget of 64 MiB of Base64 (roughly 48 MiB of raw bytes), because
Capacitor's picker returns Base64 through the JS bridge and every retained
selection is a copy in WebView memory. A new selection evicts the
least-recently-used ones until it fits, and one larger than the whole budget is
refused outright.

Apps cannot provide native paths, URIs, inline bytes, Base64, filenames, or
MIME claims to the publish action. Home reopens and verifies the desktop file
at use time; Android uses only the bytes returned by its native picker.

## Folder sources (desktop, Qortium only)

On desktop, and only for the Qortium global, an app can request
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

Home opens a native folder picker, walks the folder to measure it, and returns
a token bound exactly like a file token. It does NOT hold the folder's bytes:
what is retained is a descriptor (path plus device/inode), and the folder is
materialised fresh for whichever operation redeems the token -
`PREVIEW_QDN_PUBLISH_SOURCE` stages a copy for the local node, and
`PUBLISH_QDN_RESOURCE` packages a zip.

Home does not freeze the folder, and it does not re-verify everything. These
are the checks it actually makes, and the gaps they leave:

- **Directories.** Each one - the folder itself and every subdirectory - is
  opened `O_RDONLY|O_DIRECTORY|O_NOFOLLOW` and its device and inode compared
  against what the walk recorded, immediately before its contents are listed.
  The listing itself then re-resolves the same path, because Node cannot
  enumerate a directory from a file descriptor. **A swap landing in the
  interval between that check and that listing is not detected.**
- **Files.** Each one is opened `O_NOFOLLOW` and must still be the entry the
  walk classified - regular file, same device, same inode, same size - before
  a byte is read. This is what does not depend on the path, so it holds even
  for a directory swapped above the file: a different file is a different
  inode.
- **Bytes.** Counted as they are read, bounded by the size the SELECTION
  measured for that folder. Growth is therefore refused. The bound is on the
  TOTAL, so bytes the selection counted for entries that are later excluded
  (the never-packaged names) leave that much slack in it.
- **Links.** Refused outright, so nothing in the archive was reached through a
  path resolved at read time.
- **A batch.** The aggregate of the selection-time sizes is refused before
  anything is opened, and the total of the packaged archives is checked again
  after packaging.

What is NOT guaranteed: that the folder is what it was when you picked it. A
change made before Home's walk sees it is simply what Home packages - the walk
and the read agree with each other - and the approval prompt then shows the
hash of exactly those bytes. The one race above is an accepted residual: only a
local process already running as your user can reach it, and what it could
substitute is still bounded by the per-file identity check and the
selection-time byte budget.

Whether the folder needs a top-level index file (`index.html`, `index.htm`,
`default.html`, `default.htm`, `home.html` or `home.htm`) depends on what it is
being published AS, so the check happens at publish time and not in the picker:

| Target | Rule |
| --- | --- |
| `WEBSITE`, `APP`, `GAME` | A top-level index file is required. These are the services Home renders through an HTML entry point, and `WEBSITE` is the one Core validates an index for; without one the resource cannot be opened. |
| Everything else | Only that the folder holds at least one file. A `VIDEO`, `AUDIO` or `DOCUMENT` bundle - a media file with its poster and captions - has no index to offer and is not asked for one. |
| `PREVIEW_QDN_PUBLISH_SOURCE` | Always requires one, whatever the eventual service: a preview renders the folder as a `WEBSITE`, and one with no entry point would show you nothing. |

An index that the hidden-file policy drops, or one nested in a subfolder, does
not satisfy the rule - what counts is a top-level name that actually went into
the archive.

Home does not otherwise second-guess the service: a folder publish only makes
sense for a service that accepts multiple files, and Core's own service table
is what refuses the rest.

At publish time the archive is streamed to a Home-owned temporary file, never
built in memory, and it is bounded by:

| Bound | Value |
| --- | --- |
| Entries (files plus directories) | 10,000 |
| Directory depth | 32 |
| Bytes of any one entry path | 1,024 |
| Bytes read from the folder | 512 MiB |
| Bytes of the finished archive | the effective publish ceiling (see above) |

The entry and path bounds are the values Home's publish attestation refuses at,
enforced here so a folder is refused BEFORE it is uploaded rather than after.

Entry names are checked, not rewritten. Core's own unpacker sanitizes a name by
stripping `< > : " / \ | ? *` and trimming whitespace off each segment; Home
refuses those names instead, because a name Core rewrites after the upload is a
rename of content the user already approved a hash of, and two names that
sanitize to one is how an entry silently overwrites another. Empty, `.`, `..`,
absolute, control-character-bearing and drive-letter-prefixed segments are
refused for the same reason, and so are two entries that would unpack to the
same name once case and unicode compatibility forms are folded.

**Links are refused outright** - anywhere in the folder, pointing anywhere, to
a file or to a directory. A published folder is regular files and folders. This
is stricter than previewing (which materialises a contained link as an ordinary
file in its staged copy) for two reasons: a link is the one entry whose meaning
depends on a path resolved later, and a link named `config` pointing at `.env`
would otherwise carry an excluded file into the archive under a name the
hidden-file policy never sees. Devices, FIFOs and sockets are refused too.

`PUBLISH_QDN_RESOURCE` then uploads the archive with `isZip=true`, so Core
unpacks it into a multi-file resource. The app passes the same `sourceToken` it
would for a file and does nothing else differently.

### Hidden files

Version-control stores, `.env` files, credential directories and editor/OS
metadata (`.git`, `.hg`, `.svn`, `.env*`, `.DS_Store`, `Thumbs.db`, `.idea`,
`.vscode`, `.ssh`, `.gnupg`, `.aws`, `.npmrc`, `.netrc`, vim swap files, `~`
backups) are never packaged, whatever the request asks for, and the approval
prompt reports how many were left out. Nothing can reach the archive under a
different name either: links are refused outright, which is what closes the
`config -> .env` route into it.

Any OTHER dotfile stops the publish. Home cannot tell `.htaccess` (wanted) from
`.bash_history` (catastrophic), so the app must ask for them explicitly:

```js
await qdnRequest({
  action: 'PUBLISH_QDN_RESOURCE',
  sourceToken: selected.sourceToken,
  includeHidden: true,
  // ...the resource coordinate and metadata as usual
});
```

`includeHidden` must be a boolean; the string `'false'` is an error, not a
value. It applies to the whole request, including every item of a
`PUBLISH_MULTIPLE_QDN_RESOURCES` batch. The always-dropped names above stay
dropped whatever it says.

The approval prompt for a packaged folder shows three rows a single-file prompt
does not: how many entries the archive holds, how many were dropped, and how
many hidden files are being included.

### Where folder sources are not available

`kind: 'directory'` is refused on `qortalRequest`: Qortal's base64-body upload
path cannot carry a zip flag and keeps its own much lower practical ceiling (a
V8 string-length limit around 384 MiB). It is refused by name rather than
downgraded to a file picker, so an app never receives a token it cannot use.
Android has no folder picker and no local Core, so neither previewing nor
folder publishing exists there.

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
