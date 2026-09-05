// Runs the packaged desktop smokes in one go, and is the manifest of which ones
// exist.
//
// These smokes drive the REAL packaged AppImage over CDP, so they are the only
// checks that exercise what actually ships. Until 2026-08-30 nothing ran them:
// they were absent from `npm test` and from CI, and eight of sixteen had rotted
// so far that each failure was hiding the next one behind it. See
// scripts/check-smoke-wiring.mjs for the guard that keeps this list honest.
//
//   node scripts/smoke-desktop-suite.mjs                  # everything
//   node scripts/smoke-desktop-suite.mjs --no-node        # only the ones that
//                                                        # need no network
//   node scripts/smoke-desktop-suite.mjs --ci             # node-free AND not flaky
//   node scripts/smoke-desktop-suite.mjs --only settings,tabs
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// `needs` records what a smoke requires to pass, and every value below was
// ESTABLISHED by running the smoke with all networking removed (a user+network
// namespace, with the AppImage extracted because FUSE cannot mount inside one),
// not by reading the script. Reading does not work: home-v2-settings mentions no
// node URL anywhere and still needs a running Core, because it asserts the admin
// key is re-issued after the connection is toggled off and on.
//
//   'none'      passed with no network at all
//   'core'      needs a local Qortium Core reachable
//   'internet'  needs the outside world (release notes fetch api.github.com)
//   'network'   needs SOMETHING; which was not separated
//   'unknown'   not established -- say so rather than guessing
//
// `flaky` marks smokes seen to fail and pass on identical input. They are kept
// out of the CI selection deliberately: a check that cries wolf gets ignored,
// and these are meant to be believed.
//
// `ci` is a SEPARATE axis from `needs`, and the distinction was learned the hard
// way. `needs: 'none'` means "does not require the network"; it says nothing
// about whether a GitHub runner can run it. A runner also lacks a window
// manager, and its node_modules chrome-sandbox is not setuid-root. Selecting on
// `needs` alone put four smokes into CI that cannot pass there and turned main
// red.
//
// So `ci: true` means ONE thing: this smoke has been OBSERVED passing on a
// GitHub runner. Not inferred, not expected to -- observed. Anything unproven is
// simply absent, and a smoke gets promoted only after a green run shows it.
const SMOKES = [
  // Verified node-free: passed with all networking removed.
  { script: 'smoke:desktop:home-v2-onboarding', needs: 'none', ci: true },
  { script: 'smoke:desktop:home-v2-tabs', needs: 'none', ci: true },
  { script: 'smoke:desktop:home-v2-bookmarks', needs: 'none', ci: true },
  { script: 'smoke:desktop:home-v2-default-account-grants', needs: 'none',
    note: 'Default account changes preserve immutable app-tab grants; local disposable vault and node fixture.' },
  { script: 'smoke:desktop:home-v2-account-launch', needs: 'none',
    note: 'Explicit account-menu new tab, same-account duplicate and guest; disposable vault/loopback fixture, locally verified, not yet hosted CI.' },
  { script: 'smoke:desktop:home-v2-guest-saved-links', needs: 'none',
    note: 'Guest saved-link reopen acceptance; disposable vault and loopback fixture, locally verified, not yet hosted CI.' },
  { script: 'smoke:desktop:home-v2-inline-unlock', needs: 'none',
    note: 'disposable vault and local fixture; not yet observed on a hosted runner' },
  // Promoted after run 33342738430 showed both passing on a GitHub runner --
  // dispatched on a branch so the observation cost nothing if it had failed.
  // They needed the setuid chrome-sandbox step; local runs could never have
  // shown this, because this machine allows unprivileged user namespaces and
  // Chromium uses the namespace sandbox instead of the SUID helper there.
  { script: 'smoke:desktop:home-v2-app-zoom', needs: 'none', ci: true },
  { script: 'smoke:desktop:home-v2-window-geometry', needs: 'none',
    note: 'not in CI: starts a window manager, ENOENT on a runner' },
  { script: 'smoke:desktop:home-v2-collections-migration', needs: 'none',
    note: 'not in CI: the app exits non-zero on a runner, cause not yet established' },
  { script: 'smoke:desktop:widgets', needs: 'none', ci: true,
    note: 'also runs in build-and-test' },
  // Seeds both networks to public, so it asserts the Dashboard's LAYOUT without
  // needing either node to answer. Not yet observed on a runner.
  { script: 'smoke:desktop:home-v2-dashboard-networks', needs: 'none' },
  // Seeds three profiles and launches three times, one per startup choice.
  { script: 'smoke:desktop:home-v2-startup-pages', needs: 'none' },

  { script: 'smoke:desktop:home-v2-chrome-menus', needs: 'none', flaky: true,
    note: 'navigates immediately after launch; a late profile restore can undo it (~1 in 6)' },
  { script: 'smoke:desktop:home-v2-bookmark-toolbar', needs: 'network', flaky: true,
    note: 'fails 3/3 with no network, surfacing as the 10s narrow-layout wait; also flaky with network' },
  { script: 'smoke:desktop:home-v2-release-notes', needs: 'internet', flaky: true,
    note: 'fetches api.github.com' },

  // Need a local Core. settings and core-manager were the negative control:
  // both failed with networking removed, exactly as predicted.
  { script: 'smoke:desktop:home-v2-settings', needs: 'core' },
  { script: 'smoke:desktop:app-update-state', needs: 'core',
    note: 'drives smoke-desktop-home-v2-settings.mjs' },
  { script: 'smoke:desktop:home-v2-core-manager', needs: 'core' },
  { script: 'smoke:desktop:core-runtime', needs: 'core' },
  { script: 'smoke:desktop:home-v2-nodes', needs: 'core',
    note: 'FAILING: bridge rejects its own window as unauthorized, unexplained' },
  { script: 'smoke:desktop:home-v2-tab-detach', needs: 'unknown',
    note: 'FAILING: opens home://apps, not a real address; drag-out is nondeterministic' },
  { script: 'smoke:desktop:home-v2-prompt', needs: 'core',
    note: 'also needs QDN fixtures READY, not merely DOWNLOADED' },
  { script: 'smoke:desktop:qdn-permissions', needs: 'core', note: 'needs QDN fixtures' },
  { script: 'smoke:desktop:qdn-api', needs: 'core' },
  { script: 'smoke:desktop:qdn-api:packaged', needs: 'core' },
  // Unpackaged on purpose: the picker's smoke hook is development-only, so a
  // packaged run would sit on a native dialog nobody can answer.
  { script: 'smoke:desktop:qdn-publish-preview', needs: 'core' },
  { script: 'smoke:desktop:qdn-wallet-read:packaged', needs: 'network',
    note: 'needs a local Qortium Core and a reachable public Qortal node' },
  { script: 'smoke:desktop:qdn-foreign-send-dry-run:packaged', needs: 'core',
    note: 'never signs or funds anything; skips itself when the Core is untrusted, and reports when the Core predates the spend-context route' },
  { script: 'smoke:desktop:qdn-game', needs: 'core' },
  { script: 'smoke:desktop:qdn-write', needs: 'core' },
  { script: 'smoke:desktop:qdn-media-seek', needs: 'core' },
];

export { SMOKES };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const onlyArg = args.find((value) => value.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',') : null;
  const nodeless = args.includes('--no-node');
  const ciOnly = args.includes('--ci');

  const appImage = path.join(repoRoot, 'dist-release', 'Qortium-Home-2.1.0-x86_64.AppImage');
  if (!existsSync(appImage)) {
    console.error(`No packaged AppImage at ${appImage}. Run "npm run dist:linux:x64" first.`);
    process.exit(1);
  }

  const selected = SMOKES.filter((smoke) => {
    if (nodeless && smoke.needs !== 'none') return false;
    if (ciOnly && smoke.ci !== true) return false;
    if (!only) return true;
    return only.some((value) => smoke.script.includes(value.trim()));
  });

  const results = [];
  for (const smoke of selected) {
    process.stdout.write(`\n=== ${smoke.script}\n`);
    const started = Date.now();
    const run = spawnSync('npm', ['run', '-s', smoke.script], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 7 * 60 * 1000,
    });
    const seconds = Math.round((Date.now() - started) / 1000);
    const passed = run.status === 0;
    results.push({ passed, script: smoke.script, seconds });
    if (!passed) {
      // Print the tail on failure only -- a full log per smoke buries the table.
      const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trimEnd().split('\n');
      console.log(output.slice(-12).join('\n'));
    }
    console.log(`${passed ? 'PASS' : 'FAIL'} ${smoke.script} (${seconds}s)`);
  }

  console.log('\n--- packaged desktop smokes');
  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.script}  ${result.seconds}s`);
  }
  const failed = results.filter((result) => !result.passed);
  console.log(`${results.length - failed.length}/${results.length} passed.`);
  process.exit(failed.length === 0 ? 0 : 1);
}
