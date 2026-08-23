# Qortium App Versioning Standard (QAVS)

Status: draft v1 (updated 2026-08-21). Adoption is voluntary — nothing here is enforced.
Apps that do not follow this standard keep working exactly as before.

## The problem this solves

Qortium Core and Qortium Home evolve together and regularly add new
app-facing features (new `qdnRequest` actions, new bridged Core API
behavior). Users currently have no easy way to tell whether a QDN app was
built for the platform they are running. This standard gives every version
field a fixed meaning so that compatibility can be read — by people and by
Qortium Home itself — from app manifests and host metadata.

## Version format: X.Y.Z

Every component (Core, Home, and each QDN app) uses a three-part version.

### For platform compatibility

- **X.Y is the platform level advertised to apps.** A new Y means the
  app-facing surface gained features that apps may need to require.
- Core and Home release versions may share that X.Y by convention, but the
  host's explicit `platformVersion` is authoritative. Do not infer the
  compatibility level from Home's release version.
- Home uses normal release semantics for its own version: a minor release may
  add substantial shell or managed-service features while retaining the same
  app-facing platform level.
- **Z** is for smaller releases when a component's X.Y does track the platform
  level and the app-facing surface is unchanged.
- **X** is reserved for era-level changes (e.g. Previewnet → mainnet).

The *app-facing surface* means everything an app can observe through the
host: the `qdnRequest` action set, the parameters and signals Home injects
into app views (e.g. `uiStyle`), and the Core API behavior reachable through
the bridge.

### For QDN apps

- **X.Y declares the minimum platform level the app is built against** — the
  newest platform features the app actually uses. It is *not* the app's own
  feature counter.
- **Z is the app's own free-running counter.** Any app change — large or
  small — bumps Z. `chat 1.4.15` and `chat 1.4.348` are both "built against
  platform 1.4"; the Z says nothing about the platform.
- When an app starts using features introduced in a newer platform level, it
  moves to that X.Y and resets Z to 0 (e.g. `1.4.348` → `1.5.0`).
- An app that never needs newer platform features keeps its X.Y forever.
  That is healthy, not stale.

## The compatibility rule: ≤, not =

> An app is compatible with a host when the app's **X.Y is less than or
> equal to** the host's advertised `platformVersion`.

- `chat 1.4.x` with host `platformVersion: "1.6"` → **compatible** (the host
  keeps old features working).
- `chat 1.5.x` with host `platformVersion: "1.4"` → **may not work** (the app
  uses features the host lacks).

Do not teach users "the versions should match" — a working app on an old
level would look broken.

## The platform's obligation: additive-only within X

The ≤ rule is only trustworthy if the platform keeps its side of the deal:

- Within the same X, a platform Y bump **adds** to the app-facing surface;
  it never removes or breaks the behavior of existing actions, injected
  parameters, or bridged endpoints.
- A breaking change to the app-facing surface requires an X bump (or, at
  absolute minimum, a loudly documented exception in the release notes).
- Consensus/chain-level compatibility (feature-trigger heights, chain-config
  flag days) is node-to-node and **out of scope** — the platform level only
  ever describes the app-facing surface.

## Declaring a version: `qortium-app.json`

An app declares its version in a small manifest published at the root of its
QDN resource:

```json
{
  "name": "Qortium Chat",
  "version": "1.4.0"
}
```

- `version` (required): the app's X.Y.Z as defined above.
- `name` (optional): display name.
- Unknown fields are ignored, so the manifest can grow later.

Recommended build wiring: keep the version in `package.json` and copy it
into both the UI (the existing `__APP_VERSION__` define pattern) and
`qortium-app.json` at build time, so there is exactly one number to bump.

Apps without a manifest are simply shown as unversioned — no warnings, no
enforcement.

## Discovering the host: `GET_HOST_INFO`

Hosts that support this standard answer the `qdnRequest` action
`GET_HOST_INFO` with:

Home 2.1.0 advances the platform level because it restores the app-facing
bookmark manager action family:

```json
{
  "hostName": "qortium-home",
  "hostVersion": "2.1.0",
  "platformVersion": "2.1"
}
```

- `platformVersion` is the host's authoritative compatibility level. It can
  differ from `hostVersion` when Home adds substantial non-app-facing features.
- Apps can use this to gate optional features ("hide this button on hosts
  below 1.5") instead of failing mysteriously. `GET_NODE_INFO` continues to
  report the Core version.
- On hosts that predate this standard the action throws like any unknown
  action — treat that as "level unknown, assume old".

## What Qortium Home shows users

When Home opens (or lists) an APP resource it tries to read
`qortium-app.json` and compares the app's X.Y to its own platform level:

- app X.Y ≤ advertised platform X.Y → **Compatible** badge.
- app X.Y > advertised platform X.Y → **Needs platform X.Y+** badge (the app
  may still partly work).
- no manifest / unparseable → no badge (unversioned).

## Adopting the standard in an existing app

1. Pick the current platform level (as of this writing: **2.0**).
2. Set the app's version to `<level>.0` (e.g. chat `1.0.3` → `1.4.0`) at its
   next republish, wire the single-source version into `qortium-app.json`,
   and bump Z freely from then on.
3. Declaring the current level asserts "built and tested against this
   platform level". If you want the app to advertise compatibility with
   older hosts, declare the oldest level the app actually works on instead.

## Trade-off accepted knowingly

Apps give up semver's minor/patch distinction for their own changes — a big
feature and a typo fix are both Z bumps. The X.Y is spent on platform
compatibility because that is what users need to see at a glance.
