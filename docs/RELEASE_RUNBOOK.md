# Qortium Home release runbook

This runbook prepares and verifies a Qortium Home prerelease. Building local,
unsigned artifacts is routine release preparation. Signing artifacts, creating
or pushing a tag, uploading assets, and publishing a GitHub release each require
the maintainer's explicit approval.

## 1. Prepare the release branch

Start from a clean branch based on current `main`. Update all release metadata
together:

- `package.json` and the root entries in `package-lock.json`
- Android `versionCode` and `versionName` in `android/app/build.gradle`
- the two QAVS `platformVersion` sites when the app-facing contract changes
- `QORTIUM-HOME-CHANGELOG.md`, with a title matching the PR/squash title

Run the metadata guard before longer validation:

```sh
npm run test:release-metadata
```

## 2. Run source and local packaging gates

Run these gates from the repository root:

```sh
npm test
npx tsc --noEmit
npx tsc -p electron/tsconfig.json --noEmit
npm audit --omit=dev
npm run build
npm run dist:android:debug
npm run dist:linux:x64
```

Exercise the packaged desktop shell, settings, onboarding, browser, and widget
contracts relevant to the release. At minimum for Home 2.1:

```sh
npm run smoke:desktop:home-v2-onboarding
npm run smoke:desktop:home-v2-settings
npm run smoke:desktop:widgets
npm run smoke:desktop:home-v2-app-zoom
```

The app-zoom smoke is here rather than in the test suite because it drives the
real shell. It exists because the layout broke only AWAY from 100% zoom, so it
was invisible on the developer's machine and reached us as a user report from
someone else's. It measures what `100vh` inside the shell actually paints to at
several zoom levels, and self-checks that it can still detect a deliberately
zoomed shell — so it cannot go quietly green.

Build the unsigned Android release package for local packaging verification:

```sh
npm run dist:android:release:apk
npm run release:check -- --skip-github --android-only --allow-unsigned-android
```

An unsigned package is not a releasable Android artifact.

The production audit must report zero known vulnerabilities. Home's native
tooling may retain development-only transitive packages that are excluded from
the shipped application; assess those separately from the production result.

## 3. Complete the native platform matrix

Build and exercise the macOS universal, macOS 11 universal, and macOS 10.15 x64
DMGs on the Mac builder, and the Windows x64 portable package on Windows. Confirm the packaged
Qortal adoption selector on macOS, its deliberate rejection boundary on
Windows, desktop Core lifecycle behavior on native hosts, and Android's lack of
the desktop-only selector.

Record commands, artifact names, hashes, host/OS versions, and observed results
in the release PR or its linked acceptance issue. A source-only test is not a
substitute for an installed or packaged acceptance gate.

## 4. Signing checkpoint

Only after explicit maintainer approval, configure the existing Android release
signing values described in `README.md`, build the signed APK, and install it
over the public Home 2.0.0 package. Verify that application data and account
state remain intact, the installed version is 2.1.0 (code 39), the app starts,
and a rollback is not silently attempted. Keep signing values and keystore
material outside the repository and out of logs.

Desktop signing remains platform-specific. Record which artifacts are signed
and which are intentionally unsigned; never infer signing from a successful
package build.

## 5. Publication checkpoint

After all required checks are green and the maintainer explicitly approves
publication, verify the clean release commit and complete artifact matrix. The
publisher creates or pushes the tag and changes GitHub release state, so review
its dry run before the real command:

```sh
npm run release:publish -- --dry-run --notes-file /path/to/release-notes.md
```

Then run the approved publication command and verify the uploaded sizes and
SHA-256 digests:

```sh
npm run release:check
```

Do not reuse or replace an existing release, clobber assets, or publish a tag
without naming that action in the approval checkpoint.
