import assert from 'node:assert/strict';
import { getMatchingDownloadedUpdate, isDownloadedUpdatePending } from './appUpdateState';

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

console.log('appUpdateState tests passed.');
