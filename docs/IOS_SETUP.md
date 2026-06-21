# iOS (Capacitor) setup

Status: **scaffolding in progress on branch `qdn/ios-capacitor`** (worktree
`~/git/qortium-home-ios`). The renderer is shared verbatim with desktop/Android;
this doc covers only the iOS-specific platform layer.

What's already done in this branch (no Mac required):

- `@capacitor/ios@^8.4.0` added to `package.json` dependencies.
- `ios:sync` / `ios:open` npm scripts added (mirror the `android:*` ones).
- Swift ports of all four custom native plugins staged in
  `ios-staging/plugins/` (see the port table below).
- **iOS renderer gating implemented** in `src/platform.ts` (see "Renderer
  gating" below) — type-checks (`tsc --noEmit`) and builds clean.
- Renderer build verified in this worktree (`npm run build:renderer`).

What still needs a **Mac with Xcode + CocoaPods** (and is NOT done yet):

- `npx cap add ios` to generate the `ios/` Xcode project.
- Dropping the staged Swift plugins into the generated project.
- `Info.plist` edits (App Transport Security, Local Network usage string).
- The QDN app bridge (WKUserScript) — design below, not yet wired.
- Building/archiving and TestFlight upload.

---

## One-time setup (on the Mac)

**Requires Xcode 15+ (ideally 16).** Capacitor 8's iOS SPM manifest is
`swift-tools-version: 5.9`, which Xcode 14.2 cannot parse — see "Build
environment" below. Capacitor 8 uses **Swift Package Manager**, so CocoaPods is
**not** required for this project.

Run the helper from the repo root — it is idempotent and refuses on Xcode < 15:

```bash
bash scripts/setup-ios-macos.sh
```

It runs `npx cap add ios`, copies the staged Swift plugins into `ios/App/App/`,
patches `Info.plist` (ATS + Local Network), and `npm run ios:sync`. Then:

```bash
npm run ios:open         # opens Xcode; set a signing team, build & run
```

The plugins conform to `CAPBridgedPlugin`, so Capacitor 8 auto-registers them
(no `AppDelegate` wiring); Cap 8's template uses Xcode synchronized file groups,
so files dropped into `ios/App/App/` join the target automatically. Confirm at
runtime via the Capacitor "Loading app plugin: <jsName>" console lines.

---

## Native plugin port status

| JS name (`registerPlugin`) | Android source | iOS port | Notes |
|---|---|---|---|
| `UpdateInstaller` | `UpdateInstallerPlugin.java` | `ios-staging/plugins/UpdateInstallerPlugin.swift` | **Stub that rejects.** iOS has no sideload; updates ship via App Store/TestFlight. Renderer must gate the install UI off on iOS (see below). |
| `QdnFileOpener` | `QdnFileOpenerPlugin.java` | `ios-staging/plugins/QdnFileOpenerPlugin.swift` | Uses `UIDocumentInteractionController` "open in" sheet. Path-containment check targets the Documents dir — confirmed equal to Capacitor `Directory.Data` on iOS. |
| `WalletBackup` | `WalletBackupPlugin.java` | `ios-staging/plugins/WalletBackupPlugin.swift` | Writes a temp file, exports via `UIDocumentPickerViewController(forExporting:)` to the Files app. |
| `QdnPublishSource` | `QdnPublishSourcePlugin.java` | `ios-staging/plugins/QdnPublishSourcePlugin.swift` | `UIDocumentPickerViewController(forOpeningContentTypes:)`, reads bytes, enforces `maxBytes`, returns base64. |
| `QdnBridge` (new) | `QdnBridgeWebViewClient.java` | `ios-staging/plugins/QdnBridgePlugin.swift` | Not a JS-callable plugin. On `load()` registers an all-frames `WKUserScript` that injects the QDN bridge (see below). Auto-registers via `CAPBridgedPlugin`; no AppDelegate wiring. |

All four are line-for-line behavioural ports but have **not been compiled** (no
Xcode here). Treat first-build warnings as expected; verify each picker/sheet on
device.

---

## The QDN app bridge (the hard part)

On Android, `QdnBridgeWebViewClient.shouldInterceptRequest` intercepts the
`/render/APP|WEBSITE/...` iframe response and injects a `<script>` that defines
`window.qdnRequest`. That script then talks to the parent renderer purely via
DOM `postMessage` (`qortium:qdn-request` / `qortium:qdn-response`) — **no native
round-trip for the messages themselves**. The native layer's only job is getting
the bridge script into the QDN app frame.

This is **staged** as `ios-staging/plugins/QdnBridgePlugin.swift` (copied in by
the setup script) but is **unverified on device** — it's the biggest open item.

iOS WKWebView **cannot** intercept `http(s)` responses for injection
(`WKURLSchemeHandler` only handles custom schemes). The equivalent — and
arguably cleaner — approach (what `QdnBridgePlugin` implements):

- Inject the bridge as a **`WKUserScript`** with
  `injectionTime: .atDocumentStart` and `forMainFrameOnly: false`, added to the
  Capacitor WKWebView's `WKUserContentController`.
- App-injected user scripts run **regardless of the page's CSP**, so unlike
  Android we do **not** need to strip `Content-Security-Policy` headers.
- The script must **self-gate** (replicating Android's URL/token check): only
  define `qdnRequest` when `location.pathname` matches `/render/(APP|WEBSITE)/…`
  and the frame URL carries a valid `qdnHomeBridge` token. Read the token from
  `new URLSearchParams(location.search).get('qdnHomeBridge')` rather than baking
  it in.
- Reuse the **exact** message protocol from
  `QdnBridgeWebViewClient.getQdnBridgeTag()` so the existing renderer-side
  handler in `QdnViewer.tsx` works unchanged.

This is the single biggest item needing on-device verification. Open questions to
settle on the Mac:

1. Does the QDN APP frame load as an `http` iframe inside the
   `capacitor://localhost` app, and does cross-origin `postMessage('*')` reach
   the parent? (Should, but verify.)
2. Confirm the user script is injected into the http subframe (not just the main
   capacitor frame).

Where the Capacitor iOS bridge exposes the `WKWebView`, the cleanest hook is a
small `CAPBridgeViewController` subclass (or a `capacitorDidLoad`-time plugin)
that appends the `WKUserScript`. Stage that once `ios/` exists.

---

## App Transport Security & Local Network (the cleartext-HTTP problem)

This is an iOS-specific blocker that does **not** exist on Android. On iOS,
`CapacitorHttp` uses `URLSession`, which **is subject to App Transport
Security**. The default nodes are cleartext `http://` (`127.0.0.1:24891`, the
Previewnet seed IPs in `platform.ts`). Without ATS exceptions, every node request
fails.

`Info.plist` needs (pick the narrowest that works for Previewnet):

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <!-- broadest; App Store review will ask for justification -->
  <key>NSAllowsArbitraryLoads</key><true/>
  <!-- localhost / link-local without the loopback prompt -->
  <key>NSAllowsLocalNetworking</key><true/>
</dict>
```

Because users can enter an arbitrary node URL/IP, per-domain exceptions aren't
enough — `NSAllowsArbitraryLoads` is likely required. **This is an App Store
review risk** and must be justified (decentralized node connections, user-entered
endpoints). TestFlight is more lenient; lead with that.

Also: connecting to LAN nodes (not loopback) triggers the iOS **Local Network**
permission prompt. Add:

```xml
<key>NSLocalNetworkUsageDescription</key>
<string>Qortium Home connects to Qortium Core nodes on your local network.</string>
```

---

## Renderer gating for iOS — DONE

Implemented in `src/platform.ts` on this branch (additive; Android/desktop/web
behaviour is unchanged because `isNativePlatform()` only differs from
`isAndroid()` on iOS):

- Added exported **`isIos()`** (`Capacitor.getPlatform() === 'ios'`).
- **App updates gated off:** `getFallbackUpdatePlatformOs()` returns
  `'unsupported'` for iOS (placed before UA sniffing, because the iOS WebView UA
  contains "like Mac OS X" and would misdetect as macOS). The `UpdateInstaller`
  Swift plugin is a rejecting stub.
- **Default node mode → `network` on iOS:** the three node-mode defaults now use
  `isNativePlatform() ? 'network' : 'local'` (iOS has no managed local Core).
- **Accounts/wallets enabled on iOS:** `createFallbackApi().accounts` now gates
  on `isNativePlatform()` (was `isAndroid()`), so iOS gets `createStoredAccountsApi()`
  instead of the unsupported stub — wallets would otherwise be dead on iOS.
- **QDN downloads enabled on iOS:** `downloadResource` now guards on
  `!isNativePlatform()` (was `!isAndroid()`), routing through the `QdnFileOpener`
  Swift plugin.

Minor follow-up (cosmetic, deferred): the App-Update panel shows a generic
"Unsupported" label on iOS. A nicer "iOS — updates via App Store" message would
need `'ios'` added to the `QortiumAppUpdatePlatformOs` type (`src/vite-env.d.ts`
+ electron), which is more invasive than the no-ship scope warrants right now.

## Build environment — IMPORTANT

The `qortium-macmini` (`Macmini7,1`, **Mac mini Late 2014**, macOS 12.7.6
Monterey, Intel) is the desktop DMG builder (Command Line Tools + Node only).
That model's max OS is Monterey, which caps Xcode at **14.2**.

Two independent walls make this Mac unusable for iOS — **even for local
simulator dev**, not just distribution:

1. **Build tool:** Capacitor 8's iOS SPM manifest is `swift-tools-version: 5.9`,
   which needs **Xcode 15+** (Xcode 14.2 ships Swift 5.7 and can't parse it).
   Xcode 15 requires macOS Ventura 13+, which this 2014 model can't install.
2. **Distribution:** Apple requires **Xcode 15+ / iOS 17 SDK** for all App Store
   / TestFlight uploads since April 2024 anyway.

Decision (2026-06-21): the iOS build needs a **different machine** — a Mac on
Ventura+ (ideally Xcode 16), a cloud Mac, or **GitHub Actions macOS runners**
(Xcode 16, no hardware). The original "local dev on the 2014 Mac" idea is not
viable. Note also: Cap 8 defaults to **SPM**, so CocoaPods is not needed.

On a capable Mac: get this branch there (it is pushed — `git fetch` +
`git worktree add`), then run `bash scripts/setup-ios-macos.sh` (see One-time
setup). The script verifies Xcode >= 15 and refuses otherwise.

---

## Distribution

- Needs an **Apple Developer account** ($99/yr) and the **remote Mac** (the same
  box used for `dist:mac:*:remote`) for archiving.
- **No sideload / no direct APK-style download** — TestFlight or App Store only.
  This breaks the self-update model used on desktop/Android; on iOS, updates are
  store-delivered.
- **Target TestFlight first** (90-day builds, lighter review) before attempting
  full App Store submission — a preview-stage crypto wallet with
  `NSAllowsArbitraryLoads` will draw review scrutiny.

### CI: `.github/workflows/ios.yml`

Since no local Mac can build this, CI on GitHub's `macos-15` runners (Xcode 16)
is the practical path:

- **`simulator-build`** — runs on PRs / manual dispatch, **no secrets**. Runs
  `scripts/setup-ios-macos.sh` then `xcodebuild … -sdk iphonesimulator
  CODE_SIGNING_ALLOWED=NO`. This is the "does it compile on a real toolchain"
  gate and the first thing to get green.
- **`testflight`** — signed archive + upload, gated on `workflow_dispatch`
  (`upload_testflight=true`) or an `ios-v*` tag. Skips/fails clearly until the
  Apple secrets are set (listed in the workflow header):
  `APPLE_TEAM_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_ID`,
  `APP_STORE_CONNECT_PRIVATE_KEY`, `IOS_DIST_CERT_P12_BASE64`,
  `IOS_DIST_CERT_PASSWORD`. Needs the Apple Developer account + an App Store
  Connect record for `org.qortium.home`.

Unverified until first run: the `App` scheme must be shared for `xcodebuild
-scheme App` (a `-list` diagnostic step surfaces it if not); the TestFlight job's
signing/export chain needs real credentials to exercise.

---

## Remaining work checklist

- [x] Add `isIos()` + renderer gating (app updates, default node mode, accounts, QDN downloads).
- [x] Stage QDN bridge as a self-registering `WKUserScript` plugin (`QdnBridgePlugin.swift`).
- [x] Write `scripts/setup-ios-macos.sh` (cap add ios + plugins + Info.plist + sync; refuses on Xcode < 15).
- [x] Draft GitHub Actions iOS workflow (`.github/workflows/ios.yml`) — simulator build + gated TestFlight.
- [ ] Get the `simulator-build` CI job green (first real compile on Xcode 16; fix any scheme/SPM issues).
- [ ] (Optional) Run `scripts/setup-ios-macos.sh` on a capable Mac for interactive Xcode debugging.
- [ ] **Verify the QDN bridge on device** (window.qdnRequest in a live QDN APP frame).
- [ ] Confirm `Info.plist` ATS patch applied (script does it; sanity-check).
- [ ] iOS app icons / launch screen (reuse `build/` art via `cap` or `icons:*`).
- [ ] Verify each plugin (file open, wallet export, publish-file pick) in the simulator.
- [ ] Smoke-test QDN read + a wallet flow against a Previewnet node over the ATS exception.
- [ ] (Deferred) Distribution path for iOS — modern Mac or GitHub Actions + TestFlight.
- [ ] (Deferred, cosmetic) Nicer iOS App-Update panel copy (`'ios'` in the platform-OS type).
