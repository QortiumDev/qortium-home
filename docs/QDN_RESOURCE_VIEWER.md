# QDN resource viewing and streaming

Home 1.6.2 adds two read-only, app-neutral bridge actions. Q-Apps should
feature-detect both through `SHOW_ACTIONS`; older Home versions do not advertise
them.

## Open a resource in Home's viewer

`OPEN_QDN_RESOURCE_VIEWER` opens Home's existing tab-scoped `QdnViewer` over
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

The action supports public QDN resource services handled by `QdnViewer`,
including images, audio/video, documents, text, Markdown/HTML, code, CSV, JSON,
galleries, archives, and repositories. `APP`, `WEBSITE`, and `GAME` are
deliberately excluded: use `OPEN_NEW_TAB` or `OPEN_CURRENT_TAB` rather than
nesting browser content inside another Q-App.

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

On desktop the URL points at the selected node's public QDN render route. On
Android it uses Home's authorized HTTPS QDN proxy, avoiding mixed-content
failures while preserving `Range`, `206 Partial Content`, `Accept-Ranges`,
`Content-Range`, content type, and content length. Apps must treat the returned
URL as opaque and must not rewrite its origin or path. No API key is included.

Use this action for large media. `FETCH_QDN_RESOURCE` remains appropriate for
bounded whole-resource reads, but its 5 MiB maximum intentionally makes it
unsuitable for general audio/video playback.

Media should be loaded lazily. In long feeds or result lists, prefer
`preload="metadata"` and assign the returned URL only when the item becomes
visible or the user asks to preview it.
