# Home 2.0 Fixture AppImage

This is the first interactive visual checkpoint for Qortium Home 2.0. It is a
disconnected fixture, not a production Home replacement yet.

## Build

From the repository root:

```bash
npm run dist:linux:x64:v2-fixture
```

The output is:

```text
dist-release-v2-fixture/Qortium-Home-2-Preview-1.6.3-x86_64.AppImage
```

The build command does not launch the application. The generated AppImage has a
different application ID, name, output directory, and profile path from current
Home. It uses a minimal Electron entry with no production preload, IPC handlers,
or dependencies. Packaging explicitly disables publication.

## What to test

- Dashboard clarity at normal desktop width.
- The phone-layout toggle at a narrow or normal window size.
- Qortal and Qortium names, addresses, nodes, and app contexts remaining clearly
  labelled while representing one person.
- Opening the same Chat fixture on both networks and returning to Dashboard
  without losing tabs.
- Closing tabs and using Dashboard, Apps, Activity, and Settings navigation.
- `qdnRequest` publish consent allowing only one request.
- `qortalRequest` account consent offering once, tab-session, and durable app
  scopes without hidden permissions.
- Locking the fixture clearing pending requests and saved fixture grants.

Apps, Activity, and Settings are navigation-state placeholders in this visual
checkpoint. App content is also deliberately disconnected.

## Safety boundary

The artifact contains synthetic names and invalid demo addresses only. It
cannot load a wallet, read a profile, call a node, access a file, sign, publish,
start Core or Reticulum, reach QDN, or make external network requests. The
Electron and Android selectors choose throwing host fakes; they do not emulate
or start those platforms.

The preview uses Electron's packaged `file://` asset support for its own bundled
JavaScript and CSS. External connections remain disabled independently through
the renderer CSP, offline in-memory session, request cancellation, and absence
of network primitives in the packaged bundle.
