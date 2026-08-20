# QDN resource viewing and streaming

Home 2 exposes read-only, app-neutral resource actions through both
`qdnRequest` and `qortalRequest`. Q-Apps should feature-detect them through
`SHOW_ACTIONS`; the invoked global is the authoritative network and Home never
falls back to the other chain.

## Open a resource in Home's viewer

`OPEN_QDN_RESOURCE_VIEWER` opens Home's tab-scoped public-resource viewer over
the Q-App that requested it:

```js
await qdnRequest({
  action: 'OPEN_QDN_RESOURCE_VIEWER',
  service: 'JSON',
  name: 'Alice',
  identifier: 'profile',
  path: '',
  filename: 'profile.json',
  mimeType: 'application/json',
});
```

`service` and `name` are required. `identifier`, `path` (or `filepath`),
`filename`, and `mimeType` are optional. Filename and MIME hints help Home choose
the correct viewer when a generic service such as `FILE` or `ATTACHMENT` was
used. Home still verifies the resource and its resolved properties.

The Home 2 viewer renders raster images, audio, video, and PDF documents in its
native overlay. Other public file services receive an explicit open-or-save
surface rather than being interpreted as active content. `APP`, `WEBSITE`, and
`GAME` are deliberately excluded: use `OPEN_NEW_TAB` rather than nesting
browser content inside another Q-App. The viewer always labels the resource as
public, including when the link came from a direct message or private group.

The older `OPEN_QDN_MEDIA_PLAYER` and `OPEN_QDN_DOCUMENT_VIEWER` actions remain
available for compatibility.

## Obtain a ranged media URL

`GET_QDN_RESOURCE_STREAM_URL` returns an opaque URL suitable for a native
`<img>`, `<audio>`, or `<video>` source:

```js
const src = await qdnRequest({
  action: 'GET_QDN_RESOURCE_STREAM_URL',
  service: 'VIDEO',
  name: 'Alice',
  identifier: 'demo',
});

video.src = src;
video.controls = true;
video.preload = 'metadata';
video.playsInline = true;
```

The action accepts `IMAGE`, `THUMBNAIL`, `QCHAT_IMAGE`, `AUDIO`, `VOICE`,
`PODCAST`, `VIDEO`, `DOCUMENT`, `FILE`, `FILES`, and `ATTACHMENT`. The generic
file services are included because publishers sometimes place media under
them. The app remains responsible for deciding whether the resolved MIME type
is appropriate for its element.

The returned URL is a ten-minute, exact-resource capability bound to the
requesting app, tab, account, network, and selected route. Desktop uses Home's
private secure stream scheme in the requesting app session. Android uses an
opaque token on Home's authorized HTTPS QDN proxy, avoiding mixed-content
failures without replacing or broadening the app document's separate bridge
authorization. Both preserve `Range`, `206 Partial Content`, `Accept-Ranges`,
`Content-Range`, content type, and content length; reject redirects; cap one
response at 512 MiB and the declared resource at 4 GiB; and expose no API key.
Capabilities are revoked when their app/account/route context changes and must
be reacquired after expiry. Apps must treat the URL as opaque and must not
rewrite its origin, path, or query.

Use this action for large media. `FETCH_QDN_RESOURCE` remains appropriate for
bounded whole-resource reads, but its 5 MiB maximum intentionally makes it
unsuitable for general audio/video playback.

Media should be loaded lazily. In long feeds or result lists, prefer
`preload="metadata"` and assign the returned URL only when the item becomes
visible or the user asks to preview it.

## Save a resource

`SAVE_QDN_RESOURCE` uses the same network-qualified coordinate fields and an
optional `filename`. Desktop opens a native save dialog. Android uses the
system document picker. Home sanitizes the suggested filename, fetches only
from the selected route, and enforces a 100 MiB limit. Apps never provide a
native filesystem path.
