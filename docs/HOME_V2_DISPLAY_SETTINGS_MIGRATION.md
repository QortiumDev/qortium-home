# Home 2.0 Display Settings Migration

Status: accepted fixture contract; production profile migration is not connected.

Qortium Home 2.0 retains the useful display preferences from Home 1.x while
using one standard, professional interface instead of the legacy
`classic`/`modern`/`fun` presentation modes.

## Source state

Home 1.x stores the combined display record under
`qortium-home-display-settings` in desktop local storage or Capacitor
Preferences. Older profiles may also have the fallback
`qortium-home-text-size` key.

The v2 migration must read these values only through the reviewed profile
migration layer. The offline fixture does not read either store.

## Field mapping

| Home 1.x field | Home 2.0 behavior |
| --- | --- |
| `theme` | Preserve `system`, `light`, or `dark`. System follows platform changes. |
| `accent` | Preserve green, blue, orange, purple, red, teal, cyan, pink, or yellow. Add clay as the neutral default only when no valid saved value exists. |
| `textSize` | Preserve extra-small, small, medium, large, extra-large, or huge. Continue using the old standalone text-size key only as a migration fallback. |
| `appZoom` | Preserve the rounded percentage and clamp it to the existing 50–200% range. |
| `language` | Preserve System or any currently supported language code. System continues to follow the device language, including RTL direction. |
| `appNotifications` | Preserve under Notifications settings; it is not an Appearance control. |
| `ui` | Do not expose a v2 UI-style selector. `classic`, `modern`, and `fun` all migrate to the single standard v2 presentation. |

## QDN app compatibility

Home continues passing resolved theme, language, text size, and accent to
compatible QDN apps. During the compatibility period, an app that still
expects `uiStyle` receives `classic` at the bridge boundary regardless of the
old saved Home mode. This preserves a known public value without maintaining
three Home renderer systems. Removing that compatibility value requires a
separate bridge-version decision.

Page zoom remains a host/browser setting and scales the app surface rather than
becoming an application preference payload.

## Safety and rollback

- Validate each field independently; one malformed value must not discard the
  rest of the record.
- Keep the pre-migration profile backup required by the main project plan.
- Do not overwrite the v1 record until the complete in-place migration has
  passed validation.
- Appearance migration never reads wallet or account secrets.
- Desktop and Android must use the same normalization vectors before the live
  migration is enabled.

The pure v2 fixture migration function currently proves the field mapping with
synthetic input only. It is not wired to a real profile or storage API.
