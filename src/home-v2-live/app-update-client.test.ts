import assert from 'node:assert/strict'
import {
  parseHomeV2AppUpdateAction,
  parseHomeV2AppUpdateAutomaticClaim,
  parseHomeV2AppUpdateCheck,
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

console.log('Home 2 app update client tests passed.')
