# Home settings QDN bridge

Home 1.5.0 adds a deliberately narrow display-settings bridge for APP and WEBSITE resources. It never exposes node connections, wallets, bookmarks, start pages, dashboard pins, update policies, notification storage, or Home's QDN app role assignments (which app is the Bookmarks or Notifications Manager). Bookmark and notification management use separate, elevated, revision-checked role capabilities documented in [Home data manager QDN bridge](HOME_DATA_MANAGERS.md); the only app-facing way to gain or change a role is that document's approval dialog, never this settings bridge.

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
