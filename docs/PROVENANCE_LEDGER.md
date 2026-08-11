# Qortium Home Provenance Ledger

This ledger records what Home 2.0 learns from, imports, or adapts. It protects
the project's 0BSD-first policy by separating behavioral research from copied
implementation. It is an engineering record, not legal advice.

## Policy

- New Home and first-party QDN app code is 0BSD unless a component is clearly
  isolated and documented under another compatible license.
- GPL Qortal Hub and HubCE sources may inform behavior, interoperability tests,
  and independently implemented UX, but their implementation code is not copied
  into Home's 0BSD source.
- Repositories without a confirmed license are concept references only.
- Every imported dependency or adapted component must record an exact source,
  revision/version, license, usage form, and review status before distribution.
- Protocol compatibility claims require independent fixtures or live
  interoperability evidence; visual similarity or a successful handshake is
  not sufficient.

## Current ledger

| Component or reference | Exact source | License evidence | Use in Home 2.0 | Copied implementation | Status |
| --- | --- | --- | --- | --- | --- |
| Existing Qortium Home | This repository, base `930bbfd28b7831638fb8d5470c6333be189b7c2f` | Repository `LICENSE`: 0BSD | Retain platform, packaging, security, and repository history behind new typed adapters | Existing project code | Approved foundation |
| Home v2 product plan | This repository, `6f397d4146fc1452245cc172efe89bb5d9097a93` | 0BSD project documentation | Governing product and migration direction | Original work | Approved |
| Qortal Hub 1.0.1 | `2ec883d54165095cf055f9b58d6c4e43e0565c89` | GPL-3.0 repository license | Static UX and compatibility behavior reference | No | Reference only |
| Qortal Hub 2.0.1 | `3889cf38a6f50b5b6a601f3d4a4fae13feec2cde` | GPL-3.0 repository license | Static shell, tab, onboarding, and diagnostics behavior reference | No | Reference only |
| Qortal Hub 3.0.0 | `4f1d5127eebbb8747056ae8a4b8cb060b2559820` | GPL-3.0 repository license | Static `qortalRequest`, Q-Chat, and Reticulum protocol research | No | Reference only; Reticulum path unresolved |
| Qortal HubCE archive | `69d0b931c225edd8f79bdf340051f4fd5ed11dae` | GPL-3.0 repository license | Monolithic UX/community-edition behavior reference | No | Reference only |
| Archived Qortal Home | `2ab55b576f6afa0fb1dbbab9d3f98849d462b121` | No confirmed repo-level license in reviewed archive | Architecture and permission-model concept reference | No | Concept only |
| Qortal Unite archive | Unborn `main`; no implementation commit | No confirmed repo-level license | Planning concept reference | No | Concept only |
| QortDEX archive | `bb673a77479e28e252702c65726621f794ad6d67` | No confirmed repo-level license | Wallet/trading concept reference | No | Concept only |
| Reticulum/RCHAT engine | Hub v3 reference above; packaged dependency provenance not yet frozen | GPL Hub code plus dependency license review required | Optional cross-network native subsystem after protocol and licensing gates | No | Blocked from implementation |
| Fixture Home v2 foundation | This repository, dedicated `codex/home-v2` commits recorded in the changelog | 0BSD | Runtime-free types, policy, host fakes, Dashboard, launcher, and isolated AppImage preview | Original work | Approved Phase 1 foundation |
| Production Home 2.0 account shell | This repository, `feat/home-v2-production-account-shell` branch pending review | Repository `LICENSE`: 0BSD | Existing Home wallet format and cryptography behind new grouped account, secure-unlock, recovery, desktop, and Android adapters | Existing project code plus original work | Implemented for review; no GPL implementation copied |
| yauzl ZIP reader | npm `yauzl@2.10.0`, integrity `sha512-p4a9I6X6nu6IhoGmBqAcbJy1mlC4j27vEPZX9F4L4/vZT3Lyq1VkFHw/V/PUcB9Buo+DG3iHkT0x3Qya58zc3g==` | MIT in package metadata | Existing Core JAR identity reader; now declared as a direct runtime dependency so packaged Home includes it | Existing dependency/API use | Approved and pinned |

## Addition template

Add a row before importing or adapting code:

| Component or reference | Exact source | License evidence | Use in Home 2.0 | Copied implementation | Status |
| --- | --- | --- | --- | --- | --- |
| Name | Repository URL/path plus immutable commit, tag, or package integrity hash | License file/SPDX plus review note | Behavioral reference, protocol fixture, dependency, asset, or code | Yes/No and exact files | Proposed/approved/blocked/replaced |

If a source cannot be pinned or its license cannot be confirmed, stop at
behavioral research and record the unresolved question in the project plan.
