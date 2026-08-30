// Fails when a smoke:desktop:* npm script exists that the packaged smoke suite
// does not know about.
//
// check-test-wiring.mjs catches a *.test.ts file that no script runs. This is
// the same failure one level up: a smoke script that EXISTS, that reviewers
// count as coverage, and that nothing ever executes.
//
// It is not hypothetical. On 2026-08-30 eight of sixteen packaged smokes were
// red, one of them untouched since 2026-08-22, because nothing ran them --
// they are not in `npm test` and only one is in CI. They fail in a chain, so
// each stale check hides the next, and two of them were still describing an app
// that had moved on weeks earlier.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SMOKES } from './smoke-desktop-suite.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts ?? {};

const declared = new Set(SMOKES.map((smoke) => smoke.script));
const defined = Object.keys(scripts).filter((name) => name.startsWith('smoke:desktop:'));

const unregistered = defined.filter((name) => !declared.has(name));
const missing = [...declared].filter((name) => !(name in scripts));

if (unregistered.length > 0) {
  console.error(
    'These smoke scripts are not in the suite manifest, so nothing runs them:\n' +
      unregistered.map((name) => `  ${name}`).join('\n') +
      '\n\nAdd them to SMOKES in scripts/smoke-desktop-suite.mjs, with needsNode set\n' +
      "(or 'unknown' if it has not been established -- do not guess).",
  );
}

if (missing.length > 0) {
  console.error(
    'The suite manifest lists scripts that no longer exist:\n' +
      missing.map((name) => `  ${name}`).join('\n'),
  );
}

if (unregistered.length > 0 || missing.length > 0) process.exit(1);

console.log(`Packaged smoke wiring: ${defined.length} scripts, all registered.`);
