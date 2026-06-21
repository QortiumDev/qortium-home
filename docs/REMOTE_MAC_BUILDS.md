# Remote Mac Builds

Qortium Home can drive macOS DMG builds from Linux through the `qortium-macmini`
SSH host. This keeps the release workflow on one workstation while still using
a real Mac for native macOS packaging.

## Requirements

Linux SSH config must provide this host:

```sshconfig
Host qortium-macmini
  HostName 10.238.243.143
  User macmini
  IdentityFile ~/.ssh/qortium_macmini_build_ed25519
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  VisualHostKey no
  ServerAliveInterval 30
```

Expected fingerprints:

- Linux build key: `SHA256:9IpAPY4LLQVl8vMayYlcf78ojzpGBRGl1qARbfAjHuM`
- Mac SSH host ED25519 key: `SHA256:kviKojSotaQOxY94eVLQ8K+ootwbhH3cEu7C0ZaVPaY`

The Mac must have:

- Remote Login enabled for `macmini`.
- The matching public key in `/Users/macmini/.ssh/authorized_keys`.
- Node and npm available at `/usr/local/bin`.
- Qortium Home build dependencies installable with `npm ci`.

The remote build script sets non-interactive SSH PATH to:

```text
/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
```

## Commands

Build macOS x64 on the Mac and copy the DMG back to local `dist-release/`:

```bash
npm run dist:mac:x64:remote
```

Other supported targets:

```bash
npm run dist:mac:arm64:remote
npm run dist:mac:universal:remote
npm run dist:mac:macos11:universal:remote
```

## Behavior

`scripts/build-remote-mac.mjs` builds the committed `HEAD` tree only. It refuses
to run if tracked local files are dirty, because uncommitted changes would not
be present in the packaged source archive.

The script does not require the commits to be pushed. It streams `git archive
HEAD` to the Mac, extracts it under `~/build/qortium-home`, runs `npm ci`, runs
the selected macOS dist script, and copies `dist-release/*.dmg` back to the
local checkout.

The `dist:mac:macos11:universal:remote` target is the legacy macOS 11 build. It
packages the app with Electron 38, sets the app minimum system version to
`11.0.0`, and checks the generated `.app` bundle's Mach-O load commands before
renaming the DMG to `Qortium-Home-<version>-macos11-universal.dmg`. If any
bundled binary still requires a newer macOS release, the build fails before the
artifact is copied back.

Use the existing local scripts for other platforms:

```bash
npm run dist:linux:x64
npm run dist:win:x64
npm run dist:android:debug
```
