# Home settings QDN bridge

Home 1.5.0 adds a deliberately narrow display-settings bridge for APP and WEBSITE resources. It never exposes node connections, wallets, bookmarks, start pages, dashboard pins, update policies, or notification storage. Generic QDN app assignments deliberately use their own consented bridge, documented in [Home app assignments](HOME_APP_ASSIGNMENTS.md), rather than this display-settings API. Bookmark and notification management use separately approved capabilities documented in [Home data manager QDN bridge](HOME_DATA_MANAGERS.md).

Use `SHOW_ACTIONS` to feature-detect these actions. They are available in local, custom, and public/network node modes.

## Read metadata and values

`GET_HOME_SETTINGS_METADATA` needs no approval and returns the writable schema:

```js
const schema = await qdnRequest({ action: 'GET_HOME_SETTINGS_METADATA' });
// [{ key, type, allowedValues?, min?, max?, default }, ...]
```

`GET_HOME_SETTINGS` also needs no approval and returns only the seven writable settings:

```js
const settings = await qdnRequest({ action: 'GET_HOME_SETTINGS' });
// { theme, accent, language, textSize, appZoom, ui, appNotifications }
```

## Change settings

`UPDATE_HOME_SETTINGS` accepts a `patch` (or `settings`) object containing one or more writable keys. Every value is validated against the metadata. Home shows a one-request approval dialog with current and proposed values; a denial leaves settings unchanged. Approved changes apply and persist immediately.

```js
await qdnRequest({
  action: 'UPDATE_HOME_SETTINGS',
  patch: { theme: 'dark', appZoom: 110 },
});
```

The writable keys are `theme` (`system`, `light`, `dark`), `accent`, `language`, `textSize`, integer `appZoom` (50–200), `ui` (`classic`, `modern`, `fun`), and boolean `appNotifications`.

## Live changes

Existing query parameters (`theme`, `lang`, `textSize`, `accent`, `uiStyle`) remain available for newly loaded apps. Open apps additionally receive:

```js
window.addEventListener('qortiumHomeSettingsChanged', (event) => {
  // event.detail = { theme, lang, textSize, accent, uiStyle, ui,
  //                  language, appZoom, appNotifications }
});
```

`theme` and `lang` are the final effective values after Home resolves system settings.

## Home 2

Home 2 restores the same three actions over the same seven-key contract. An app written against Home 1.x needs no change: `patch`, `settings` and a bare request body are all still accepted, the reads still need no approval, and `UPDATE_HOME_SETTINGS` still shows a one-request dialog listing current and proposed values per key. Two things differ, both deliberately.

### The two-store split

The seven keys do not live together in Home 2. Six of them — `theme`, `accent`, `language`, `textSize`, `appZoom`, `ui` — are shell appearance state. The seventh, `appNotifications`, is the notification **policy**, which has its own generation-based compare-and-set.

A write is therefore split by key: appearance keys go through the shell's own setters, and `appNotifications` goes through the notification-policy client. The policy write is performed **first**, because it is the half that can fail — so a patch that loses its compare-and-set leaves your appearance untouched rather than half-applied. If the policy moved on between approval and apply, Home re-reads and retries once; a second conflict is reported to the app.

An app never reaches the policy directly. It supplies a validated patch, Home raises the prompt, and Home's own renderer performs the write — the same indirection Home 1.x used, and the same one the bookmark actions use.

A corrupt or unreadable notification policy reads as `appNotifications: false` (nothing would be shown in that state anyway), and a write touching `appNotifications` then fails with `HOME_NOTIFICATION_POLICY_CORRUPT` or `HOME_NOTIFICATION_POLICY_UNAVAILABLE` rather than writing over a damaged record. An appearance-only write is unaffected: the two stores fail independently.

### `clay` is readable but not writable

Home 2 has a tenth accent, `clay`, which is also its default. Home 1.x's schema does not list it.

- `GET_HOME_SETTINGS` **returns** `clay` when it is the current accent. It has to: otherwise the read would fail on a fresh Home 2 profile.
- `GET_HOME_SETTINGS_METADATA` **advertises** it, so an app can render the accent the user is actually on.
- `UPDATE_HOME_SETTINGS` **rejects** it. The write surface stays 1.x-compatible: an app written against Home 1.x's accent list behaves identically on Home 2, and an app that learns a tenth accent exists should not be the thing that moves a user onto it.

The metadata makes the asymmetry explicit rather than leaving it to be discovered by a rejected write. Every enumerated key now carries both fields:

```js
// accent
{ key: 'accent', type: 'string',
  allowedValues: ['clay', 'green', 'blue', ...],   // what a READ may return
  writableValues: ['green', 'blue', ...],          // what a WRITE accepts
  default: 'green' }
```

For the other six keys the two lists are identical, so the rule is uniform: **write only what is in `writableValues`**. `default` names the 1.x schema default, which is always writable — for `accent` that is `green`, not Home 2's `clay` display default, because a default an app cannot write would be useless as a reset value.

`appZoom` outside 50–200, or non-integral, is **rejected** rather than clamped: clamping would make the approval dialog show a proposed value the app never asked for.

### Scope, routes and widgets

- The update approval is **single-request only** — never "session", never "always". No durable grant is stored, so there is no entry for it in Settings > QDN Apps; the next patch asks again. This is the opposite decision from the bookmark and notification managers, which are durable and revocable, and it is deliberate: a standing permission to change theme, language, zoom and the notification toggle would produce effects the user sees with no way to attribute them to any app.
- All three actions are advertised on `qdnRequest` only. They touch no node, and Home has one appearance rather than one per chain, so a `qortalRequest` copy would have nothing distinct to mean.
- All three are **route-independent**: they work while every node route is disabled or unreachable.
- All three are **excluded from widgets**, the two reads included. A widget has no trusted Home chrome to raise the update prompt on, and shipping the read half of a read/write pair without the write half is an incoherent surface. The display subset a widget needs already reaches it as render-URL parameters (`theme`, `lang`, `textSize`, `accent`, `uiStyle`).
- A read returns the seven keys and nothing else — never node URLs, account data, or API keys. The reply is built from the schema projection and validated against it at both ends of the desktop round-trip.

### Where the work happens

Home 1.x answered these in the renderer, because the renderer owns display settings. Home 2 keeps that shape. On desktop the main process holds the app request but asks the shell window over an internal round-trip and validates the reply; on Android the renderer is the host, so it composes the answer directly with no IPC. Both platforms run the same contract module (`electron/home-v2-home-settings-contract.ts`) and the same composition and write-split code (`src/home-v2-live/home-settings-client.ts`), so they cannot disagree about what a read reports or what a write does.

Node connection settings are **not** part of this bridge and remain unavailable to apps in Home 2.
