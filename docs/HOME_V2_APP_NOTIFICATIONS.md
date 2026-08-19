# Home 2 app notifications

Home 2 exposes the same small, app-scoped notification primitive through
`qdnRequest` and `qortalRequest` on desktop and Android. The invoked bridge is
the authoritative chain: an app cannot use a request field to redirect a
notification to the other network.

## Actions

`NOTIFICATION_HAS_PERMISSION` returns the durable app grant without prompting:

```json
{
  "granted": true,
  "network": "qortium"
}
```

`SHOW_NOTIFICATION` accepts:

```json
{
  "action": "SHOW_NOTIFICATION",
  "title": "New mention",
  "text": "Alice mentioned you in Builders",
  "source": {
    "kind": "chat",
    "conversation": { "kind": "group", "groupId": 12 }
  }
}
```

Direct-chat sources use
`{ "kind": "direct", "otherAddress": "..." }`. `source` is optional for
general app notifications. `network` is also optional; if supplied, it must
match the invoked bridge. Home strips control and bidirectional-override
characters, collapses whitespace, and caps titles at 80 characters, text at
240 characters, and direct addresses at 128 characters.

The result repeats Home's authoritative network and the normalized source:

```json
{
  "shown": true,
  "network": "qortal",
  "source": {
    "kind": "chat",
    "conversation": { "kind": "direct", "otherAddress": "..." }
  }
}
```

Suppressed notifications return `shown: false` and one of `focused`, `muted`,
`disabled`, `revoked`, `rate-limited`, or `unsupported`.

## Permission and provenance

The first notification asks for one durable, revocable app-scoped permission.
It is not tied to a wallet or node route and is shared by the app across both
bridge protocols. The user can mute or revoke it through Home's existing app
notification settings. Home checks the app's live resource identity again
after approval before storing the grant.

Every displayed title ends with the registered app name and authoritative
chain, for example `New mention — Chat · Qortium`. Home suppresses a
notification while that app tab is already visible and focused and limits an
app to one shown notification every three seconds. A desktop click restores
Home and activates the originating tab. Android stores the same tab, network,
and conversation source in the local notification and activates the tab when
it still exists.

## Background boundary

These actions let a running app show a notification. They do not migrate the
legacy `NOTIFICATION_ADD` subscription-rule system into Home 2. Chat owns its
bounded foreground polling for now. A Home-proxied dual-chain background
subscription will be added only if measured delivery behavior shows that it is
needed; it will require a separate network-qualified rule and watcher contract.
