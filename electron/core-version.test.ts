// Guards the shared Core version parser: core-manager.ts uses it for
// Qortium's own build.version, and electron/qortal-release-policy.ts reuses
// the exact same exported function against Qortal jar/release data. The jar's
// bundled build.properties is unprefixed at rest (core-jar-identity.ts reads
// it directly), so today's callers happen to pass either a bare semver or a
// "vX.Y.Z" GitHub tag. But Core's *live* /admin/info buildVersion carries a
// network prefix at runtime - "qortium-" or "qortal-" - and this parser is
// documented and reused as a general "Core version string" parser, not a
// Qortium-only one, so it must strip both prefixes rather than mis-parsing
// (returning null for) a genuinely "qortal-"-prefixed value. Nothing in
// electron/qortal-release-policy.test.ts previously exercised that prefix -
// its fixtures start from an already-bare semver - so this gap had no test
// coverage before.
//
// Both prefixes come straight from each network's own Controller.java:
//   qortium-core: public static final String VERSION_PREFIX = "qortium-";
//   Qortal/qortal: public static final String VERSION_PREFIX = "qortal-";
//   (confirmed live: electron/qortal-core-runtime.ts compares a running
//   Qortal node's info.buildVersion to `qortal-${identity.buildVersion}`.)
import assert from 'node:assert/strict';
import {
  compareCoreVersions,
  coreCommitsMatch,
  getCoreReleaseTag,
  getCoreSemver,
  getCoreTimestampMs,
} from './core-version.js';

// 1. The live shapes: Qortium's /admin/info buildVersion and Qortal's.
assert.equal(getCoreSemver('qortium-1.8.0-05cbc08'), '1.8.0', 'Qortium buildVersion should parse.');
assert.equal(getCoreSemver('qortal-6.1.9-a1b2c3d'), '6.1.9', 'Qortal buildVersion should parse.');
assert.equal(getCoreSemver('QORTIUM-1.8.0-05CBC08'), '1.8.0', 'the prefix strip should be case-insensitive.');
assert.equal(getCoreSemver('QORTAL-6.1.9-A1B2C3D'), '6.1.9', 'the Qortal prefix strip should be case-insensitive.');
assert.equal(getCoreSemver('qortium-1.8.0'), '1.8.0', 'a buildVersion without a commit suffix should still parse.');
assert.equal(getCoreSemver('v1.8.0'), '1.8.0', 'a bare release tag should still parse.');
assert.equal(getCoreSemver('1.8.0'), '1.8.0', 'a bare semver should still parse.');
assert.equal(getCoreSemver('qortium-2.0.0-rc.1-05cbc08'), '2.0.0-rc.1', 'a prerelease suffix should survive the commit strip.');
assert.equal(getCoreSemver(''), null, 'an empty string should not parse.');
assert.equal(getCoreSemver(null), null, 'null should not parse.');
assert.equal(getCoreSemver(undefined), null, 'undefined should not parse.');
assert.equal(getCoreSemver('not-a-version'), null, 'garbage should not parse.');

// 2. getCoreReleaseTag builds the same "vX.Y.Z" tag Home compares against
// GitHub release tag names for both networks.
assert.equal(getCoreReleaseTag('qortium-1.8.0-05cbc08'), 'v1.8.0');
assert.equal(getCoreReleaseTag('qortal-6.1.9-a1b2c3d'), 'v6.1.9');
assert.equal(getCoreReleaseTag(''), '');

// 3. compareCoreVersions must work across the same prefixed shapes.
assert.equal(compareCoreVersions('qortium-1.8.0-05cbc08', 'qortium-1.8.1-abc1234'), -1);
assert.equal(compareCoreVersions('qortal-6.1.9-a1b2c3d', 'qortal-6.1.9-cccccccccc'), 0);
assert.equal(compareCoreVersions('qortal-6.1.9-a1b2c3d', 'qortium-1.8.0-05cbc08'), 1);
assert.equal(compareCoreVersions('garbage', 'qortium-1.8.0-05cbc08'), null);

// 4. coreCommitsMatch and getCoreTimestampMs are prefix-agnostic (they never
// see the "qortium-"/"qortal-" text), covered lightly so a future refactor
// that merges these helpers doesn't drop the check unnoticed.
assert.equal(coreCommitsMatch('05cbc08', '05cbc08abc123'), true);
assert.equal(coreCommitsMatch('05cbc08', 'a1b2c3d'), false);
assert.equal(getCoreTimestampMs('20260918120000'), Date.UTC(2026, 8, 18, 12, 0, 0));
assert.equal(getCoreTimestampMs(''), null);

console.log('Core version parser tests passed (Qortium and Qortal buildVersion shapes).');
