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
It is not tied to a wallet or node route. The stable QDN APP/WEBSITE resource
identity owns one grant across the Qortium and Qortal bridge protocols; a route,
query, fragment, selected account, or network switch does not create a second
permission. Home checks the app's live resource identity again after approval
before storing the grant.

Home 2.1's trusted QDN Apps Settings page can mute or revoke that grant on
desktop and Android. Muting hides alerts but retains the permission, rules, and
Core subscriptions. Revoking deletes the grant and all of that app's rules. If
a foreign-payment rule disclosed a watch-only wallet view to a Core, revocation
stops future Home-managed use but cannot recall data that Core already received.
The Settings host bridge exposes only redacted summaries and is denied to
widgets; it is not a new QDN app action.

Every displayed title ends with the registered app name and authoritative
chain, for example `New mention — Chat · Qortium`. Home suppresses a
notification while that app tab is already visible and focused and limits an
app to one shown notification every three seconds. A desktop click restores
Home and activates the originating tab. Android stores the same tab, network,
and conversation source in the local notification and activates the tab when
it still exists.

## Background boundary

These actions let a running app show a notification. They do not migrate the
legacy `NOTIFICATION_ADD` subscription-rule system into Home 2. The trusted
Settings page may still summarize, mute, and revoke rules already stored in the
Home profile. Desktop sends none of their account bindings, filters, watch-only
data, titles, text, or links across IPC. Android reads its renderer-owned
Preferences store and projects the same redacted state before the Settings
component receives it. Chat owns its bounded foreground polling for now. A
Home-proxied dual-chain background subscription will be added only if measured
delivery behavior shows that it is needed; it will require a separate
network-qualified rule and watcher contract.
