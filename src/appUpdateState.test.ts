import assert from 'node:assert/strict';
import {
  getMatchingDownloadedUpdate,
  getPreferredResultChannel,
  isDownloadedUpdatePending,
} from './appUpdateState';

const DIGEST = 'sha256:11ff';

function downloaded(overrides: Partial<QortiumAppUpdateDownloadResult> = {}): QortiumAppUpdateDownloadResult {
  return {
    canOpen: true,
    canReveal: true,
    digest: DIGEST,
    digestVerified: true,
    downloadedAt: '2026-07-21T00:00:00.000Z',
    fileName: 'Qortium-Home-1.5.2-x86_64.AppImage',
    filePath: '/home/user/Downloads/Qortium-Home-1.5.2-x86_64.AppImage',
    releaseTag: 'v1.5.2',
    size: 1024,
    ...overrides,
  };
}

const platform: QortiumAppUpdatePlatform = {
  arch: 'x64',
  label: 'Linux x64',
  os: 'linux',
  supported: true,
};

function result(status: QortiumAppUpdateStatus, tagName = 'v1.5.2'): QortiumAppUpdateCheckResult {
  return {
    asset: {
      digest: DIGEST,
      downloadUrl: 'https://example.invalid/Qortium-Home-1.5.2-x86_64.AppImage',
      name: 'Qortium-Home-1.5.2-x86_64.AppImage',
      size: 1024,
    },
    channel: 'prerelease',
    checkedAt: '2026-07-21T00:00:00.000Z',
    currentVersion: '1.5.2',
    message: '',
    platform,
    release: {
      channel: 'prerelease',
      htmlUrl: 'https://example.invalid/releases/v1.5.2',
      name: tagName,
      prerelease: true,
      publishedAt: '2026-07-20T00:00:00.000Z',
      tagName,
    },
    status,
  };
}

// The regression: after installing the downloaded release, the check reports
// 'up-to-date' but still carries that release's asset, so tag and digest both
// still match the stored download. It must not be treated as pending, or the
// panel shows "Downloaded" with Show file / Install APK instead of "Up to date".
assert.equal(getMatchingDownloadedUpdate(downloaded(), result('up-to-date')), null);

// A download for a release that is genuinely still available stays pending.
assert.deepEqual(getMatchingDownloadedUpdate(downloaded(), result('available')), downloaded());

// Unrelated releases and unverified downloads never match.
assert.equal(getMatchingDownloadedUpdate(downloaded(), result('available', 'v1.6.0')), null);
assert.equal(getMatchingDownloadedUpdate(downloaded({ digest: 'sha256:0000' }), result('available')), null);
assert.equal(getMatchingDownloadedUpdate(downloaded({ digestVerified: false }), result('available')), null);
assert.equal(getMatchingDownloadedUpdate(null, result('available')), null);

// Clearing is driven by every channel, not just the selected one: a download
// that is still offered on the other channel must survive the sweep.
assert.equal(
  isDownloadedUpdatePending(downloaded(), { stable: result('up-to-date'), prerelease: result('available') }),
  true,
);
assert.equal(
  isDownloadedUpdatePending(downloaded(), { stable: result('up-to-date'), prerelease: result('up-to-date') }),
  false,
);

// --- Release channel selection ---------------------------------------------

const stableEnvironment: QortiumAppUpdateEnvironment = { currentVersion: '1.8.0', platform };
const prereleaseEnvironment: QortiumAppUpdateEnvironment = { currentVersion: '2.1.0-rc.1', platform };

// A channel the user picked survives a check that cannot resolve it. This is
// the whole point of the picker on the 1.x line: every Qortium Home release was
// flagged as a prerelease, so /releases/latest 404s and the stable channel
// reports 'not-found' with no release attached. Falling back would move someone
// who chose to stay on 1.x onto prerelease, and the next check would offer them
// the 2.x line they had just declined.
assert.equal(
  getPreferredResultChannel({
    currentChannel: 'stable',
    environment: stableEnvironment,
    hasExplicitChannel: true,
    results: { prerelease: result('available', 'v2.1.0-rc.1') },
  }),
  'stable',
);

// The same holds in the other direction: someone who opted into prereleases is
// not pulled back to stable just because stable is the only channel resolving.
assert.equal(
  getPreferredResultChannel({
    currentChannel: 'prerelease',
    environment: stableEnvironment,
    hasExplicitChannel: true,
    results: { stable: result('available', 'v1.8.0') },
  }),
  'prerelease',
);

// Without an explicit choice the existing fallbacks still apply: prefer a
// channel that resolved, then the one implied by the running version, then
// whichever channel has anything at all.
assert.equal(
  getPreferredResultChannel({
    currentChannel: 'stable',
    environment: prereleaseEnvironment,
    hasExplicitChannel: false,
    results: { prerelease: result('available', 'v2.1.0-rc.1') },
  }),
  'prerelease',
);

assert.equal(
  getPreferredResultChannel({
    currentChannel: 'prerelease',
    environment: stableEnvironment,
    hasExplicitChannel: false,
    results: { stable: result('available', 'v1.8.0') },
  }),
  'stable',
);

// Nothing resolved and nothing chosen: stay put rather than invent a channel.
assert.equal(
  getPreferredResultChannel({
    currentChannel: 'stable',
    environment: stableEnvironment,
    hasExplicitChannel: false,
    results: {},
  }),
  'stable',
);

console.log('appUpdateState tests passed.');
