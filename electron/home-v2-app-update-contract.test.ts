import assert from 'node:assert/strict'
import {
  createAuthorizedHomeV2AppUpdateHandlers,
  createHomeV2AppUpdateService,
} from './home-v2-app-update-contract.js'
import type { TrustedHomeRelease } from './app-update-policy.js'

const digest = `sha256:${'c'.repeat(64)}` as const
const release: TrustedHomeRelease = {
  assets: [{
    digest,
    downloadUrl: 'https://github.com/QortiumDev/qortium-home/releases/download/v2.1.0/Qortium-Home-2.1.0-x86_64.AppImage',
    name: 'Qortium-Home-2.1.0-x86_64.AppImage',
    size: 123,
  }],
  channel: 'stable',
  htmlUrl: 'https://github.com/QortiumDev/qortium-home/releases/tag/v2.1.0',
  name: 'Home 2.1.0',
  publishedAt: '2026-08-22T00:00:00Z',
  tagName: 'v2.1.0',
}
const checkRequest = {
  channel: 'stable',
  revision: 1,
  schema: 'home-v2-app-update-check-request',
} as const
const releaseRequest = {
  ...checkRequest,
  releaseTag: 'v2.1.0',
  schema: 'home-v2-app-update-download-request',
}
let fetchCount = 0
let revealPath = ''
const service = createHomeV2AppUpdateService({
  downloadAsset: async ({ asset, releaseTag }) => ({
    canOpen: true,
    canReveal: true,
    digestVerified: true,
    fileName: asset.name,
    filePath: '/private/update.AppImage',
    releaseTag,
    size: asset.size,
  }),
  fetchRelease: async () => {
    fetchCount += 1
    return release
  },
  getEnvironment: () => ({
    currentVersion: '2.0.0',
    platform: { arch: 'x64', label: 'Linux x64', os: 'linux', supported: true },
  }),
  now: () => new Date('2026-08-22T12:00:00Z'),
  openReleasePage: async () => undefined,
  revealDownloadedFile: async (filePath) => { revealPath = filePath },
  uuid: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
})

const [first, second] = await Promise.all([service.check(checkRequest), service.check(checkRequest)])
assert.deepEqual(first, second)
assert.equal(fetchCount, 1, 'same-channel checks must be single-flight')
assert.equal(first.state, 'available')
assert.equal(JSON.stringify(first).includes('downloadUrl'), false)
assert.equal(JSON.stringify(first).includes('/private/'), false)

assert.throws(() => service.check({ ...checkRequest, extra: true }), /exact/)
assert.throws(() => service.check({ ...checkRequest, revision: 2 }), /schema/)

const downloaded = await service.download(releaseRequest)
assert.equal(downloaded.outcome, 'completed')
assert.equal(downloaded.download?.digestVerified, true)
assert.equal(JSON.stringify(downloaded).includes('/private/'), false)
const revealed = await service.reveal({
  downloadId: downloaded.download!.downloadId,
  revision: 1,
  schema: 'home-v2-app-update-reveal-request',
})
assert.equal(revealed.outcome, 'completed')
assert.equal(revealPath, '/private/update.AppImage')

let authorized = false
const handlers = createAuthorizedHomeV2AppUpdateHandlers(
  () => { authorized = true; throw new Error('unauthorized') },
  service,
)
for (const handler of [handlers.check, handlers.download, handlers.reveal, handlers.openReleasePage]) {
  authorized = false
  assert.throws(() => handler({} as never, { bad: true }), /unauthorized/)
  assert.equal(authorized, true, 'authorization must happen before parsing')
}
assert.equal(authorized, true, 'authorization must happen before parsing')

console.log('Home 2 app update contract tests passed.')
