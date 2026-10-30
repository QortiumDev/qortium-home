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
```

## Behavior

`scripts/build-remote-mac.mjs` builds the committed `HEAD` tree only. It refuses
to run if tracked local files are dirty, because uncommitted changes would not
be present in the packaged source archive.

The script does not require the commits to be pushed. It streams `git archive
HEAD` to the Mac, extracts it under `~/build/qortium-home`, runs `npm ci`, runs
the selected macOS dist script, and copies `dist-release/*.dmg` back to the
local checkout.

## Supported macOS versions

Beta.14 and newer use patched Electron 43 and require macOS 12 or later. The
legacy macOS 10.15/11 build targets are retired. Existing
[beta.13 downloads](https://github.com/QortiumDev/qortium-home/releases/tag/v2.1.0-beta.13)
remain available with their original runtimes; they do not receive this security
upgrade. Do not rebuild new Home releases with Electron 32 or 36.

Packages use ad-hoc code signing with hardened runtime and the Electron JIT /
ad-hoc library-loading entitlements. This does not provide an Apple publisher
identity or notarization. Native CI checks signatures, actual Mach-O minimum OS,
Core observer resources, sandboxed preload and packaged launch. Actual user
notification delivery still requires a macOS permission/desktop acceptance check.
