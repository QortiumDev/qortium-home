import assert from 'node:assert/strict'
import {
  parseHomeV2AppUpdateAction,
  parseHomeV2AppUpdateAutomaticClaim,
  parseHomeV2AppUpdateCheck,
  parseHomeV2AppUpdateProgress,
  parseHomeV2AppUpdateSettings,
} from './app-update-client'

const check = {
  asset: { digestAvailable: true, name: 'Home.AppImage', size: 123 },
  channel: 'stable',
  checkedAt: '2026-08-22T12:00:00.000Z',
  currentVersion: '2.0.0',
  issue: null,
  platform: { arch: 'x64', label: 'Linux x64', os: 'linux', supported: true },
  release: { name: 'Home 2.1', publishedAt: null, tagName: 'v2.1.0' },
  revision: 1,
  schema: 'home-v2-app-update-check',
  state: 'available',
}
assert.equal(parseHomeV2AppUpdateCheck(check).state, 'available')
assert.throws(() => parseHomeV2AppUpdateCheck({ ...check, extra: true }), /unexpected/)
assert.throws(() => parseHomeV2AppUpdateCheck({ ...check, state: 'not-found' }), /inconsistent/)
assert.throws(() => parseHomeV2AppUpdateCheck({ ...check, asset: { ...check.asset, path: '/tmp/x' } }), /malformed/)

const action = {
  code: null,
  download: {
    canOpen: true,
    canReveal: true,
    digestVerified: true,
    downloadId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    fileName: 'Home.AppImage',
    releaseTag: 'v2.1.0',
    size: 123,
  },
  outcome: 'completed',
  revision: 1,
  schema: 'home-v2-app-update-action',
}
assert.equal(parseHomeV2AppUpdateAction(action).download?.fileName, 'Home.AppImage')
assert.throws(() => parseHomeV2AppUpdateAction({ ...action, code: 'download-failed' }), /inconsistent/)
assert.throws(() => parseHomeV2AppUpdateAction({ ...action, download: { ...action.download, filePath: '/tmp/x' } }), /malformed/)

const settings = {
  generation: 2,
  homeUpdatePolicy: 'notify',
  releaseChannel: 'stable',
  revision: 1,
  schema: 'home-v2-app-update-settings',
}
assert.equal(parseHomeV2AppUpdateSettings(settings).generation, 2)
assert.throws(() => parseHomeV2AppUpdateSettings({ ...settings, filePath: '/tmp/x' }), /malformed/)
assert.throws(() => parseHomeV2AppUpdateSettings({ ...settings, homeUpdatePolicy: 'install' }), /malformed/)

const claim = {
  ...settings,
  claimed: true,
  schema: 'home-v2-app-update-automatic-claim',
}
assert.equal(parseHomeV2AppUpdateAutomaticClaim(claim).generation, 2)
assert.throws(() => parseHomeV2AppUpdateAutomaticClaim({ ...claim, claimed: 'yes' }), /malformed/)
assert.throws(() => parseHomeV2AppUpdateAutomaticClaim({
  ...claim,
  claimed: true,
  homeUpdatePolicy: 'off',
}), /malformed/)

// --- Download progress survives the parser ROUND TRIP --------------------
// Same guard as the Core progress parser, for the same reason: a parser that
// validates a field and then forgets to copy it into its result leaves the UI
// reading undefined, with every other test still green.
{
  const progress = {
    action: 'downloading',
    fileName: 'Qortium-Home.AppImage',
    message: 'Downloading Qortium Home.',
    percent: 37,
    receivedBytes: 3_700_000,
    releaseTag: 'v2.1.0',
    revision: 1,
    schema: 'home-v2-app-update-progress',
    totalBytes: 10_000_000,
  } as const
  assert.deepEqual(parseHomeV2AppUpdateProgress(progress), {
    action: 'downloading',
    fileName: 'Qortium-Home.AppImage',
    message: 'Downloading Qortium Home.',
    percent: 37,
    receivedBytes: 3_700_000,
    releaseTag: 'v2.1.0',
    totalBytes: 10_000_000,
  }, 'every field the UI reads must survive the parse')

  // No content-length: percent and total stay null, and the UI falls back to
  // showing bytes received. Zero would render a bar stuck at the left.
  const unknownTotal = parseHomeV2AppUpdateProgress({
    ...progress, percent: null, totalBytes: null,
  })
  assert.equal(unknownTotal?.percent, null)
  assert.equal(unknownTotal?.totalBytes, null)
  assert.equal(unknownTotal?.receivedBytes, 3_700_000)
}

for (const bad of [
  null,
  { action: 'downloading', fileName: 'a', message: 'b', percent: 1, receivedBytes: 1, releaseTag: 'v', revision: 2, schema: 'home-v2-app-update-progress', totalBytes: 2 },
  { action: 'downloading', fileName: 'a', message: 'b', percent: 1, receivedBytes: 1, releaseTag: 'v', revision: 1, schema: 'nope', totalBytes: 2 },
  { action: 'sprinting', fileName: 'a', message: 'b', percent: 1, receivedBytes: 1, releaseTag: 'v', revision: 1, schema: 'home-v2-app-update-progress', totalBytes: 2 },
  { action: 'downloading', fileName: 'a', message: 'b', percent: 101, receivedBytes: 1, releaseTag: 'v', revision: 1, schema: 'home-v2-app-update-progress', totalBytes: 2 },
  { action: 'downloading', fileName: 'a', message: 'b', percent: 1, receivedBytes: -1, releaseTag: 'v', revision: 1, schema: 'home-v2-app-update-progress', totalBytes: 2 },
  { action: 'downloading', extra: true, fileName: 'a', message: 'b', percent: 1, receivedBytes: 1, releaseTag: 'v', revision: 1, schema: 'home-v2-app-update-progress', totalBytes: 2 },
]) {
  assert.equal(parseHomeV2AppUpdateProgress(bad), null, `refuses ${JSON.stringify(bad)}`)
}

console.log('Home 2 app update client tests passed.')
