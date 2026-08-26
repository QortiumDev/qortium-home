# QDN widgets in Qortium Home

Qortium Home 2 can open a small, transparent, always-on-top face published
inside a QDN `APP` resource. Widgets are desktop-only in version 1; Android
floating windows are not part of this contract.

## Publish a widget face

Add `widget.json` at the root of the same `APP` resource as the main app. The
manifest is limited to 64 KiB and uses this shape:

```json
{
  "manifestVersion": 1,
  "entry": "widget.html",
  "defaultSize": { "width": 280, "height": 120 },
  "minSize": { "width": 200, "height": 60 },
  "maxSize": { "width": 560, "height": 240 },
  "resizable": "both",
  "shape": {
    "polygons": [
      [[0, 0], [1, 0], [1, 0.8], [0.5, 1], [0, 0.8]]
    ]
  }
}
```

- `manifestVersion` must be `1`.
- `entry` defaults to `widget.html` and must be a relative path inside the
  resource. Absolute URLs, traversal, backslashes, and URL schemes are
  rejected.
- `defaultSize`, `minSize`, and `maxSize` use whole CSS pixels from 8 through
  4096. `minSize` and `maxSize` default to `defaultSize`.
- `resizable` is `none`, `horizontal`, `vertical`, or `both`; it defaults to
  `none`.
- `shape` is optional. Each point is a normalized `[x, y]` pair from `0` to
  `1`. A point inside any polygon is clickable; transparent space outside all
  polygons passes clicks through to the window underneath. A manifest may have
  at most 32 polygons and 256 points per polygon.

The widget page should paint its own controls and keep unused space
transparent. Home supplies the current `accent`, `lang`, `textSize`, `theme`,
and `uiStyle` query parameters when it opens the page and sends later display
and bridge-route changes through the normal Home app events.

## Open the widget

The main app can request its own widget:

```js
const { widgetId } = await qdnRequest({ action: 'OPEN_AS_WIDGET' })
```

Home first confirms that the calling resource publishes a valid manifest, then
asks the user whether that exact tab may create an always-on-top window. Home
also offers an Open as widget control in the app toolbar, but only for a tab
whose app actually publishes `widget.json`: Home asks the node for the manifest
when the tab becomes active and hides the control when there is none. An app
that publishes a manifest Home cannot parse keeps the control, so the manifest
error is reported on click rather than hidden as "this app has no widget."
Version 1 permits one live widget per published resource; closing it allows the
same resource to be opened again. Saved placement, size, and opacity are keyed
to that resource.

## Widget controls

The widget page receives the regular `qdnRequest` and `qortalRequest` bridges.
Call `SHOW_ACTIONS` at runtime for the authoritative action list. Version 1
exposes public, read-only node/resource actions and these widget-local actions:

- `WIDGET_GET_STATE` returns the widget's id, bounds, opacity, region, and snap
  state.
- `WIDGET_CLOSE` closes the calling widget.
- `WIDGET_START_DRAG` starts moving the calling widget from the current cursor
  position.
- `WIDGET_END_DRAG` ends that drag.
- `WIDGET_RESIZE` accepts `width` and `height`, constrained by the manifest.
- `WIDGET_SET_REGIONS` accepts a replacement `shape` using the manifest polygon
  format. Home validates it and coalesces rapid updates to one per frame.

For a custom title strip, start and end a native drag from pointer events:

```js
const title = document.querySelector('.widget-title')

title.addEventListener('pointerdown', async () => {
  await qdnRequest({ action: 'WIDGET_START_DRAG' })
})

window.addEventListener('pointerup', async () => {
  await qdnRequest({ action: 'WIDGET_END_DRAG' })
})
```

Widgets do not receive account identity, private chat data, signing, publishing,
group-administration, notification, file-picker, viewer, or other actions that
need trusted Home chrome. A widget also cannot open another widget. Put those
flows in the normal app tab.

## User controls and lifecycle

Widgets snap to display and neighboring-widget edges. They can stay open after
the main Home window closes. Home's tray menu lists every live widget and lets
the user change opacity where the desktop compositor supports it, close one
widget, close all widgets, reopen Home, or
quit. Quitting Home closes the widget processes; reopening a widget restores a
valid saved placement on a currently connected display.
