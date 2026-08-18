# Home Chat Interoperability Vectors

## Purpose

Home's portable Chat work crosses two independent protocols. The vector harness
freezes the bytes and payload shapes before Home implements new signing or
encryption code, so desktop and Android can be checked against the same facts.

These are test contracts, not bridge actions. H0B does not add wallet access,
message crypto, transaction submission, or live network writes.

## Qortium source fixture

The H0B test reads Qortium Core's committed
`src/test/resources/chat/interop/chat-crypto-v1.json` directly from Git commit
`0ca1965a840d02d60941510d6cddac36d3718ac6`. Home does not keep a second copy
of those expected bytes. The source lock records the Core repository, commit,
path, and SHA-256, and CI checks out that exact commit before running the test.

The fixture covers QDM1, QPGC message/key-control envelopes, signed CHAT
transactions, positive canonicalization, and parser/authentication/size
negative cases. Later Home crypto code must reproduce those committed values
without changing the fixture.

## Qortal fixture

`scripts/fixtures/qortal-chat-interop-v1.json` was independently generated from
an isolated archive of the official Qortal Hub v3.0.0 release at commit
`4f1d5127eebbb8747056ae8a4b8cb060b2559820`. Its provenance block pins every
source file used to observe behavior by SHA-256.

The fixture freezes:

- Hub v3 public-group initial, edit, and reaction payloads and signed CHAT bytes;
- legacy version-2 direct-message plaintext, shared-secret hash, secretbox
  ciphertext, reference-derived nonce behavior, and signed CHAT bytes;
- private-group `qortalGroupEncryptedData` bundle framing;
- old and new `encryptSingle` layouts, including reaction type `102`;
- signed join and leave transactions; and
- user/group avatars plus public/private group-image descriptors and embed URIs.

All keys, references, nonces, and timestamps are deterministic test values.
They are not wallet material and must never be reused outside tests.

Qortal Hub is GPL-3.0. Home uses its released behavior only as interoperability
evidence. Production Home implementations must be written clean-room from this
document, the checked fixture, independently reviewed protocol notes, and
stock-client traces; Hub implementation code is not copied into Home.

## Running the harness

With the sibling Core checkout in its usual location:

```sh
npm run test:chat-interop-vectors
```

For another layout, set `QORTIUM_CORE_REPOSITORY` to a Core Git checkout that
contains the pinned commit. The loader uses `git show <commit>:<path>`, so it
does not depend on the checkout's active branch or working-tree contents.

To update either contract, change the pinned source deliberately, regenerate
the applicable vectors independently, update the source hashes, document the
protocol reason, and obtain the same security-sensitive review required for
the production crypto or transaction change.
