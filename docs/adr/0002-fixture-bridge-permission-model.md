# ADR 0002: Fixture Bridge Permission Model

- Status: Accepted
- Date: 2026-08-08
- Applies to: Qortium Home 2.0 fixture foundation

## Context

Home 2.0 intends to run both Qortium apps and existing Qortal Q-Apps. Their
public bridges overlap in vocabulary, but they are not interchangeable:

- `qdnRequest` is Home's Qortium-oriented bridge and current approvals are
  bound to detailed app, account, tab, view, node, and operation context.
- `qortalRequest` is the Qortal Q-App contract. In Hub v3, accepting
  `GET_USER_ACCOUNT` also installs a group of session permissions, including
  capabilities whose risk is not equivalent to sharing an address.
- Identically named actions can target different chains or return different
  response shapes.

Aliasing one global bridge to the other would create both compatibility drift
and a cross-chain confused-deputy risk.

## Decision

Keep `qdnRequest` and `qortalRequest` as separate public protocols and adapters.
They may produce a shared internal `PermissionPrompt` only after the adapter has
validated its exact action, payload, app identity, and required target network.

Every permission prompt and reusable grant is bound to:

- public protocol and exact action;
- internal capability;
- stable QDN app identity;
- selected Home identity and wallet reference;
- explicit Qortal or Qortium target;
- selected node profile; and
- originating tab where the scope requires it.

The fixture implements two intentionally different requests:

1. `qdnRequest/PUBLISH_QDN_RESOURCE` targets Qortium, validates a synthetic QDN
   resource description, and permits only one-request approval.
2. `qortalRequest/GET_USER_ACCOUNT` targets Qortal and explains that it returns
   the selected Qortal address and public key. The user may approve once, for
   the current tab, or durably for that exact app/account/network/node context.

Accepting the Qortal account request does not auto-grant wallet reads,
fee-signing, cross-chain server control, or any other permission. Supporting
Hub-compatible session-permission requests later will require separate visible
consent for the exact requested capability list.

Session grants are removed when their tab closes or navigates. Durable grants
can be reused by the same stable app identity in another tab, but identity,
network-node, and lock invalidation clears affected grants. Pending prompts are
always cancelled when their bound tab, identity, or node context changes.

## Fixture boundary

The current adapters only prepare immutable prompts. Approval returns a
synthetic resolution; it cannot publish, reveal an account, call a node, unlock
a vault, sign data, or invoke either real bridge. The existing `MockHost`
continues to throw on every privileged capability.

## Consequences

- Compatibility work can preserve each public request/result/error contract
  without weakening the internal policy boundary.
- The UI can present consistent approvals while still naming the exact bridge,
  action, app, identity, and network.
- Durable grants remain useful without becoming global app-name permissions.
- Full `qortalRequest` compatibility still requires an action-by-action ledger,
  conformance fixtures, response envelopes, timeouts, and platform adapters.
- No GPL implementation was copied; pinned Hub v3 source was used only to
  verify observable request and permission behavior.
