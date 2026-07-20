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
packages the app with Electron 36.9.5, sets the app minimum system version to
`11.0.0`, and checks the generated `.app` bundle's Mach-O load commands before
renaming the DMG to `Qortium-Home-<version>-macos11-universal.dmg`. If any
bundled binary still requires a newer macOS release, the build fails before the
artifact is copied back.

## macOS 10.15 compatibility builds

Electron 33 and newer require macOS 11 or later, so a Catalina build must use
the last suitable Electron 32 line. Build it as an x64-only DMG and label it
separately from the normal macOS 11 legacy artifact.

When rebuilding a Catalina tester DMG for a specific prerelease, archive that
exact tag or commit into a separate remote directory instead of using the
current branch:

```bash
release_ref=v1.1.2
remote_dir=build/qortium-home-macos1015-v1.1.2

ssh qortium-macmini "rm -rf \"\$HOME/$remote_dir\" && mkdir -p \"\$HOME/$remote_dir\""
git archive --format=tar "$release_ref" \
  | ssh qortium-macmini "tar -xf - -C \"\$HOME/$remote_dir\""
```

Then run the build on the Mac with Electron 32.3.3 and a Catalina minimum:

```bash
ssh qortium-macmini /bin/bash -s <<'REMOTE'
set -euo pipefail
export LANG=C
export LC_ALL=C
export PATH='/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'

cd "$HOME/build/qortium-home-macos1015-v1.1.2"
npm ci
rm -rf dist-release
npm run build
npm install --no-save --package-lock=false electron@32.3.3
QORTIUM_HOME_EXPECTED_ELECTRON_VERSION=32.3.3 node scripts/test-qdn-app-preload.mjs
./node_modules/.bin/electron-builder --mac dmg --x64 --publish never \
  -c.electronVersion=32.3.3 \
  -c.mac.minimumSystemVersion=10.15.0

app_path="dist-release/mac/Qortium Home.app"
node scripts/verify-macos-min-version.mjs "$app_path" 10.15.0

version="$(node -p "require('./package.json').version")"
mv "dist-release/Qortium-Home-$version-x64.dmg" \
  "dist-release/Qortium-Home-$version-macos1015-x64.dmg"
if [ -f "dist-release/Qortium-Home-$version-x64.dmg.blockmap" ]; then
  mv "dist-release/Qortium-Home-$version-x64.dmg.blockmap" \
    "dist-release/Qortium-Home-$version-macos1015-x64.dmg.blockmap"
fi
shasum -a 256 "dist-release/Qortium-Home-$version-macos1015-x64.dmg"
REMOTE
```

Copy the resulting `Qortium-Home-<version>-macos1015-x64.dmg` and optional
`.blockmap` back into local `dist-release/`, then verify the copied DMG by
extracting the app and rerunning `scripts/verify-macos-min-version.mjs` with
`10.15.0`. The exact Electron 32 preload test is a required release gate: it
proves the sandboxed QDN bridge is present before page scripts run and preserves
successful, empty, coded-error, and malformed-response behavior.

Use the existing local scripts for other platforms:

```bash
npm run dist:linux:x64
npm run dist:win:x64
npm run dist:android:debug
```
