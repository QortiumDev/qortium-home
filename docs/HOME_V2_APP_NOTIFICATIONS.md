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

## Global delivery policy

General Settings has one device/profile-wide **App notifications** switch.
Turning it off suppresses direct app notifications. It is also the global gate
for Home-managed background notifications when that watcher is activated in a
later Home 2 tranche; it does not change notification grants, per-app mute
state, saved rules, Core subscriptions, or operating-system notification permission.
`NOTIFICATION_HAS_PERMISSION` therefore continues to report the app grant while
global delivery is off, and a delivery request returns `shown: false` with
`reason: "disabled"`. Home rechecks the policy immediately before scheduling
so a switch change during notification preparation still wins.

Desktop owns the exact versioned policy in
`home-v2-notification-policy.json` under private Home data. Its narrow preload
bridge authenticates the exact top-level Home document and uses an optimistic
generation for multi-window changes. Android owns the same schema in Capacitor
Preferences. When the new Android policy is absent, Home reads the old display
settings once to preserve an explicit `appNotifications: false`, writes the new
record, and does not consult the old store again. A missing policy defaults on;
corrupt or unavailable state fails closed to off without overwriting the bad
record.

The policy is profile data. Android operating-system backup restore may restore
an older saved value along with the rest of the app profile, so users should
review the switch after restoring a device backup. This trusted setting is not
a public QDN action and does not change QAVS `platformVersion: "2.0"`.

## Background boundary

The boundary here is between MANAGING notification rules and CREATING them.
Home 2 implements the first and deliberately not the second.

**Managing is app-facing.** The five `NOTIFICATION_MANAGER_*` actions —
summarize, mute an app, delete an app's rules, revoke an app's notification
permission — are available to any embedded QDN app the user grants the durable
`notifications.manage` capability. They are `qdnRequest`-only and
route-independent, because the data is Home's profile rather than a chain's.
The summary an app receives is the same redaction the trusted Settings page
uses: no account bindings, no watch-only keys, no signature filters, and
address-like filters exposed only when they validate as real Qortal addresses.
Every mutation carries the store revision it was computed against, and a
corrupt or unreadable store fails the request closed instead of reading as an
empty profile. The grant is listed and revocable in Settings > QDN Apps,
separately from each app's own permission to show a notification.

**Creating is still deferred.** `NOTIFICATION_ADD`, `NOTIFICATION_GET` and
`NOTIFICATION_REMOVE` — the legacy subscription-rule system an app uses to
register its OWN rules — are not implemented in Home 2, and the manager surface
deliberately cannot stand in for them: it can delete a rule but never add one.
Two reasons, both about the rules being inert rather than about risk:

- **No consumer.** Home 2 has no rule watcher. Nothing in the v2 host polls
  Qortium or Qortal for the events a stored rule describes, so a rule created
  today would sit in the profile and never fire. Shipping a creation API whose
  output does nothing is a worse contract than not shipping it.
- **The watcher is the real work.** A useful implementation needs a
  network-qualified rule shape — a rule has to say which chain it watches — and
  a Home-proxied dual-chain background subscription with its own scheduling,
  backoff, and battery behavior. That is a separate contract, not a bridge
  action.

Rules created by Home 1.x are preserved, summarizable, and deletable through
the manager surface, so a user is never stuck with a rule they cannot see or
remove. Chat owns its bounded foreground polling for now. A Home-proxied
dual-chain background subscription will be added only if measured delivery
behavior shows that it is needed.

Desktop sends none of a rule's account bindings, filters, watch-only data,
titles, text, or links across the Settings IPC boundary. Android reads its
renderer-owned Preferences store and projects the same redacted state before
the Settings component receives it.
