# Qortium Core Management

Qortium Home should be able to manage a local desktop Qortium Core install without
requiring users to manually download release files. This feature is desktop-only;
Android should continue to use existing nodes and Previewnet network discovery.

## First Implementation

- Discover Qortium Core releases from `QuickMythril/qortium` on GitHub.
- Show the latest stable release when one exists.
- Show the latest prerelease when one exists.
- Install the selected release only after an explicit user action.
- Support the current release asset shape: `qortium-preview.zip`.
- Extract the release into a Qortium Home managed folder under Electron
  `app.getPath('userData')`.
- Record installed release metadata in the managed folder.
- Detect Java 17 or newer from Qortium Home's managed Java runtime first, then
  from the user's system Java.
- Offer an explicit Java install action when Java 17 or newer is missing.
- Install Java into Qortium Home app data, not system folders.
- Start the managed Core by running the release's bundled preview start script.
- Stop the managed Core by running the release's bundled preview stop script.
- When the managed Core starts and `http://127.0.0.1:24891/admin/status` is
  reachable, switch Qortium Home's node mode to the local node.
- Show the expected preview log paths in the UI and include them in launch
  errors when start or stop commands fail.

## Managed Folder

The managed Core folder should stay isolated from source checkouts and manually
installed Qortium Core folders. The intended layout is:

```text
Qortium Home app data/
  managed-core/
    downloads/
    java/
      current-java.json
      versions/
        temurin-17-<version>-<platform>-<arch>/
    versions/
      v1.0.0-preview.1/
        qortium-preview/
          qortium.jar
          preview/
    current.json
```

`current.json` should identify the selected installed release, install path,
asset name, download URL, digest when available, and install time.

`java/current-java.json` should identify the selected managed Java runtime,
including distribution, version, platform, architecture, download URL, install
path, executable path, and install time.

## Runtime Behavior

The first pass should run Previewnet participant mode and let the bundled
preview launcher auto-detect whether the local environment supports the normal
GUI/tray path or needs Java headless mode. For the current release zip, Qortium
Home should use:

- Linux/macOS: `preview/start.sh --participant`
- Windows: `preview/start.bat --participant`
- Linux/macOS stop: `preview/stop.sh`
- Windows stop: `preview/stop.bat`

The UI should report Java availability and source, installed Core status,
running status, current local API URL, preview log paths, and
install/start/stop progress.

The current preview launcher writes:

- Core app log: `preview/qortium.log`
- Launcher/stdout log: `preview/run.log`
- Windows stderr log: `preview/run-error.log`

Qortium Home should use Eclipse Temurin / Adoptium Java 17 GA JRE archives for
the managed runtime. Linux and macOS archives are `.tar.gz`; Windows archives
are `.zip`. The first supported desktop targets are Linux x64, Linux arm64,
macOS x64, macOS arm64, and Windows x64.

When starting or stopping managed Core, Qortium Home should prepend the managed
Java runtime's `bin` directory to `PATH` when available. This lets the bundled
preview scripts keep calling `java` normally while still preferring the managed
runtime over system Java.

## Deferred Work

- Stable/mainnet Core profile selection.
- Multiple installed Core versions with rollback UI.
- Core bootstrap, database deletion, API key reset, and log viewer controls.
- Release signatures beyond GitHub-provided asset digest verification.
