#!/usr/bin/env bash
#
# Qortium Home — iOS (Capacitor) one-shot setup. macOS only.
#
# Run AFTER a full Xcode (15+, ideally 16) and Node are installed, from the repo
# root. Idempotent: safe to re-run. Does NOT need CocoaPods — Capacitor 8 uses
# Swift Package Manager for this project.
#
#   bash scripts/setup-ios-macos.sh
#
# Steps:
#   1. Verify macOS, repo root, full Xcode >= 15, Node.
#   2. npm install (if node_modules is missing).
#   3. npx cap add ios            (skipped if ios/ already exists)
#   4. Copy staged Swift plugins  -> ios/App/App/
#   5. Patch ios/App/App/Info.plist (ATS exceptions + Local Network usage string)
#   6. npm run ios:sync
#
# What it deliberately does NOT do (needs Xcode GUI / on-device verification):
#   - Open Xcode, set signing team, or archive.
#   - Verify the QDN bridge user script (QdnBridgePlugin) in a live QDN app frame.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PLIST="ios/App/App/Info.plist"
PB=/usr/libexec/PlistBuddy
STAGED_PLUGINS="ios-staging/plugins"
APP_TARGET_DIR="ios/App/App"
LOCAL_NET_DESC="Qortium Home connects to Qortium Core nodes on your local network."

info()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33mwarn:\033[0m %s\n' "$*" >&2; }
die()   { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# --- 1. preflight ----------------------------------------------------------
[ "$(uname -s)" = "Darwin" ] || die "iOS setup must run on macOS."
[ -d "$STAGED_PLUGINS" ] || die "Run from the repo root (no $STAGED_PLUGINS)."
command -v node >/dev/null || die "Node is not installed."
command -v npx  >/dev/null || die "npx is not available."

DEV_DIR="$(xcode-select -p 2>/dev/null || true)"
case "$DEV_DIR" in
  *CommandLineTools*|"")
    die "Full Xcode required (found '$DEV_DIR'). Install Xcode, then:
       sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
       sudo xcodebuild -license accept" ;;
esac

command -v xcodebuild >/dev/null || die "xcodebuild not found under $DEV_DIR."
XCODE_VER="$(xcodebuild -version 2>/dev/null | awk 'NR==1{print $2}')"
XCODE_MAJOR="${XCODE_VER%%.*}"
if [ -z "$XCODE_MAJOR" ] || [ "$XCODE_MAJOR" -lt 15 ]; then
  die "Xcode $XCODE_VER detected. Capacitor 8 iOS needs Xcode 15+ (its SPM
       manifest is swift-tools 5.9). A 2014 Mac mini / macOS Monterey caps at
       Xcode 14.2 and cannot build this — use a Mac on Ventura+ (ideally Xcode
       16) or GitHub Actions macOS runners. See docs/IOS_SETUP.md."
fi
info "Xcode $XCODE_VER OK."

# --- 2. deps ---------------------------------------------------------------
if [ ! -d node_modules ]; then
  info "Installing npm dependencies…"
  npm install
fi
[ -d node_modules/@capacitor/ios ] || die "@capacitor/ios missing — run 'npm install'."

# --- 3. cap add ios --------------------------------------------------------
if [ -d ios ]; then
  info "ios/ already exists — skipping 'cap add ios'."
else
  info "Adding iOS platform (npx cap add ios)…"
  npm run build:renderer
  npx cap add ios
fi
[ -d "$APP_TARGET_DIR" ] || die "Expected $APP_TARGET_DIR after cap add ios — layout changed?"

# --- 4. copy staged Swift plugins ------------------------------------------
info "Copying staged Swift plugins into $APP_TARGET_DIR…"
cp "$STAGED_PLUGINS"/*.swift "$APP_TARGET_DIR"/
# Cap 8's template uses Xcode synchronized file groups, so files dropped into the
# App folder are picked up by the target automatically. If a plugin is missing at
# runtime, add it to the App target manually in Xcode.

# --- 5. patch Info.plist ---------------------------------------------------
[ -f "$PLIST" ] || die "Missing $PLIST."
info "Patching $PLIST (App Transport Security + Local Network)…"

# Idempotent set-or-add helpers.
pb_dict() { "$PB" -c "Print :$1" "$PLIST" >/dev/null 2>&1 || "$PB" -c "Add :$1 dict" "$PLIST"; }
pb_bool() { "$PB" -c "Set :$1 $2" "$PLIST" 2>/dev/null || "$PB" -c "Add :$1 bool $2" "$PLIST"; }
pb_str()  { "$PB" -c "Set :$1 $2" "$PLIST" 2>/dev/null || "$PB" -c "Add :$1 string $2" "$PLIST"; }

# Nodes are user-entered cleartext http endpoints (localhost + Previewnet IPs);
# iOS URLSession enforces ATS, so arbitrary loads must be allowed. This is an App
# Store review risk — justify it (decentralized, user-entered node endpoints).
pb_dict "NSAppTransportSecurity"
pb_bool "NSAppTransportSecurity:NSAllowsArbitraryLoads" true
pb_bool "NSAppTransportSecurity:NSAllowsLocalNetworking" true
pb_str  "NSLocalNetworkUsageDescription" "$LOCAL_NET_DESC"

# --- 6. sync ---------------------------------------------------------------
info "Syncing web assets + native deps (npm run ios:sync)…"
npm run ios:sync

cat <<EOF

$(info "iOS setup complete.")
Next (manual, in Xcode):
  npm run ios:open
  - Select a signing team (Apple Developer account) for the App target.
  - Build & run on the iOS Simulator.
  - VERIFY the QDN bridge: open a QDN APP/WEBSITE view and confirm window.qdnRequest
    works (QdnBridgePlugin injects it as an all-frames WKUserScript — unverified).
  - Smoke-test a node read + a wallet flow against a Previewnet node.

Note: ATS NSAllowsArbitraryLoads is enabled (cleartext http nodes). Review-risk;
see docs/IOS_SETUP.md.
EOF
