# Qortium Core Management

Qortium Home should be able to manage a local desktop Qortium Core install without
requiring users to manually download release files. This feature is desktop-only;
Android should continue to use existing nodes and Previewnet network discovery.

## First Implementation

- Discover Qortium Core releases from `QortiumDev/qortium-core` on GitHub.
- Show the latest stable release when one exists.
- Show the latest prerelease when one exists.
- Install the selected release only after an explicit user action.
- Support the current release asset shape: `qortium-preview.zip`.
- Extract the release into a single Core install folder under Electron
  `app.getPath('appData')/qortium-core`.
- Record installed release metadata in the Core app-data folder.
- Detect Java 17 or newer from Qortium Home's managed Java runtime first, then
  from the user's system Java.
- Offer an explicit Java install action when Java 17 or newer is missing.
- Install Java into the `qortium-core` app-data folder, not system folders.
- Start the Home-created Core by running the release's bundled preview start
  script.
- Stop the Home-created Core by running the release's bundled preview stop
  script.
- Keep Core database, QDN data, logs, PID, and API-key files under a stable
  `qortium-core/runtime` folder outside extracted release folders.
- When the Home-created Core starts and its loopback status endpoint is
  reachable, switch Qortium Home's node mode to the verified local HTTPS
  endpoint at `https://127.0.0.1:24891`.
- Show the expected preview log paths in the UI and include them in launch
  errors when start or stop commands fail.

## Core Folder

The Home-created Core folder should stay isolated from source checkouts and
manually installed Qortium Core folders. The intended layout is:

```text
Electron app data root/
  qortium-core/
    current.json
    downloads/
    install/
      qortium.jar
      preview/
    java/
      current-java.json
      versions/
        temurin-17-<version>-<platform>-<arch>/
    runtime/
      runtime-chain.json
      apikey.txt
      run.pid
      run.log
      qortium.log
      db-preview/
      data-preview/
      lists/
```

`current.json` should identify the selected installed release, install path,
asset name, download URL, digest when available, install time, and runtime path.

`current.json` points at `qortium-core/install` and
`qortium-core/runtime`. Updating Core replaces the single install folder, not
the runtime folder. Before replacing an existing install, Home also copies any
old `install/preview/lists/` entries into `runtime/lists/` without overwriting
runtime files, so testers upgrading from older launcher builds keep block and
follow lists that were written into the replaceable install tree.

`runtime/runtime-chain.json` records the installed release's Previewnet
`networkId` and a Core-compatible `previewchain.json` SHA-256 identity. The
hashes are diagnostic metadata, not an additional consensus gate: Core owns
validation of its repository and chain configuration. On an idle Core status
refresh, Home re-reads the installed JAR and Previewnet files, rewrites stale
same-network metadata, and clears stale block markers automatically. This keeps
ordinary Core releases, direct-release replacements, and test JARs from forcing
a database reset merely because the configuration or fingerprint algorithm
changed.

Home only refuses automatic runtime reuse when the installed Core's `networkId`
is different from the recorded runtime network. It leaves all runtime data in
place for an explicit reset or manual migration decision, writes
`runtime/runtime-migration-blocked.json`, and reports the cross-network mismatch
instead of offering another install/start action.

Legacy Home-created installs under `qortium-home/managed-core` should migrate
into this layout. If a local Core process is already running from a source
checkout or another external folder, Home should use that local API and key as
they are. If a Core process is running from the old Home-created folder, Home
should stop that process before moving its install and runtime files, and should
only delete old duplicate version folders after the new metadata validates.

The Core runtime remains outside the extracted release files:

```text
Electron app data root/
  qortium-core/
    runtime/
      runtime-chain.json
      apikey.txt
      run.pid
      run.log
      qortium.log
      db-preview/
      data-preview/
      lists/
```

`java/current-java.json` should identify the selected managed Java runtime,
including distribution, version, platform, architecture, download URL, install
path, executable path, and install time.

## Runtime Behavior

The first pass should run Previewnet participant mode and let the bundled
preview launcher auto-detect whether the local environment supports the normal
GUI/tray path or needs Java headless mode. For the current release zip, Qortium
Home should pass the stable runtime directory to the bundled scripts:

- Linux/macOS: `preview/start.sh --participant --runtime-dir=<qortium-core/runtime>`
- Windows: `preview/start.bat --participant --runtime-dir=<qortium-core/runtime>`
- Linux/macOS stop: `preview/stop.sh --runtime-dir=<qortium-core/runtime>`
- Windows stop: `preview/stop.bat --runtime-dir=<qortium-core/runtime>`

The UI should report Java availability and source, installed Core status,
running status, current local API URL, runtime path, preview log paths, and
install/start/stop progress.

The Core runtime folder owns:

- Core app log: `qortium-core/runtime/qortium.log`
- Launcher/stdout log: `qortium-core/runtime/run.log`
- Windows stderr log: `qortium-core/runtime/run-error.log`
- API key: `qortium-core/runtime/apikey.txt`

Qortium Home should use Eclipse Temurin / Adoptium Java 17 GA JRE archives for
the managed runtime. Linux and macOS archives are `.tar.gz`; Windows archives
are `.zip`. The first supported desktop targets are Linux x64, Linux arm64,
macOS x64, macOS arm64, and Windows x64.

When starting or stopping Home-created Core, Qortium Home should prepend the managed
Java runtime's `bin` directory to `PATH` when available. This lets the bundled
preview scripts keep calling `java` normally while still preferring the managed
runtime over system Java.

Packaged Linux launches must not pass AppImage-only variables, temporary mount
paths, or inherited Electron resource descriptors into managed services that
outlive Home. Core and i2pd intentionally keep running after the Home window
closes, but they must run solely from their stable managed install/runtime paths.
The Linux launch wrapper uses Bash so it can close all inherited descriptors
above stderr, including Electron's high-numbered resource handles and the
AppImage runtime control pipe, so the mount can exit normally.

## Deferred Work

- Stable/mainnet Core profile selection.
- Core bootstrap, database deletion, API key reset, and log viewer controls.
- Release signatures beyond GitHub-provided asset digest verification.
