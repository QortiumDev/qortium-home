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
  settingsGeneration: null,
} as const
const releaseRequest = {
  ...checkRequest,
  releaseTag: 'v2.1.0',
  schema: 'home-v2-app-update-download-request',
  settingsGeneration: null,
}
let fetchCount = 0
let revealPath = ''
let openPath = ''
let installed: { filePath: string; digest: string } | null = null
const service = createHomeV2AppUpdateService({
  downloadAsset: async ({ asset, releaseTag }) => {
    return {
      canOpen: true,
      canReveal: true,
      digest: asset.digest,
      digestVerified: true,
      fileName: asset.name,
      filePath: '/private/update.AppImage',
      installKind: 'relaunch',
      releaseTag,
      size: asset.size,
    }
  },
  installDownloadedFile: async (filePath, digest) => { installed = { filePath, digest } },
  fetchRelease: async () => {
    fetchCount += 1
    return release
  },
  getEnvironment: () => ({
    currentVersion: '2.0.0',
    platform: { arch: 'x64', label: 'Linux x64', os: 'linux', supported: true },
  }),
  now: () => new Date('2026-08-22T12:00:00Z'),
  openDownloadedFile: async (filePath) => { openPath = filePath },
  openReleasePage: async () => undefined,
  readSettings: async () => ({
    generation: 2,
    homeUpdatePolicy: 'auto-download',
    releaseChannel: 'stable',
  }),
  revealDownloadedFile: async (filePath) => { revealPath = filePath },
  uuid: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
})

const [first, second] = await Promise.all([service.check(checkRequest), service.check(checkRequest)])
assert.deepEqual(first, second)
assert.equal(fetchCount, 1, 'same-channel checks must be single-flight')
assert.equal(first.state, 'available')
assert.equal(JSON.stringify(first).includes('downloadUrl'), false)
assert.equal(JSON.stringify(first).includes('/private/'), false)

await assert.rejects(service.check({ ...checkRequest, extra: true }), /exact/)
await assert.rejects(service.check({ ...checkRequest, revision: 2 }), /schema/)
const automaticCheck = await service.check({ ...checkRequest, settingsGeneration: 2 })
assert.equal(automaticCheck.state, 'available')
const rejectedAutomaticCheck = await service.check({ ...checkRequest, settingsGeneration: 3 })
assert.equal(rejectedAutomaticCheck.issue, 'settings-changed')

const downloaded = await service.download(releaseRequest)
assert.equal(downloaded.outcome, 'completed')
assert.equal(downloaded.download?.digestVerified, true)
const automatic = await service.download({ ...releaseRequest, settingsGeneration: 2 })
assert.equal(automatic.outcome, 'completed')
const rejectedAutomatic = await service.download({ ...releaseRequest, settingsGeneration: 3 })
assert.equal(rejectedAutomatic.code, 'settings-changed')

let revocationReads = 0
let revokedDownloadCalls = 0
const revocationService = createHomeV2AppUpdateService({
  downloadAsset: async () => {
    revokedDownloadCalls += 1
    throw new Error('A revoked automatic update reached the download boundary.')
  },
  fetchRelease: async () => release,
  getEnvironment: () => ({
    currentVersion: '2.0.0',
    platform: { arch: 'x64', label: 'Linux x64', os: 'linux', supported: true },
  }),
  installDownloadedFile: async () => undefined,
  openDownloadedFile: async () => undefined,
  openReleasePage: async () => undefined,
  readSettings: async () => {
    revocationReads += 1
    return revocationReads === 1
      ? { generation: 2, homeUpdatePolicy: 'auto-download' as const, releaseChannel: 'stable' as const }
      : { generation: 3, homeUpdatePolicy: 'off' as const, releaseChannel: 'stable' as const }
  },
  revealDownloadedFile: async () => undefined,
})
const revoked = await revocationService.download({ ...releaseRequest, settingsGeneration: 2 })
assert.equal(revoked.code, 'settings-changed')
assert.equal(revocationReads, 2)
assert.equal(revokedDownloadCalls, 0)
assert.equal(JSON.stringify(downloaded).includes('/private/'), false)
const revealed = await service.reveal({
  downloadId: downloaded.download!.downloadId,
  revision: 1,
  schema: 'home-v2-app-update-reveal-request',
})
assert.equal(revealed.outcome, 'completed')
assert.equal(revealPath, '/private/update.AppImage')
const opened = await service.open({
  downloadId: downloaded.download!.downloadId,
  revision: 1,
  schema: 'home-v2-app-update-open-request',
})
assert.equal(opened.outcome, 'completed')
assert.equal(openPath, '/private/update.AppImage')
// Install re-hands the path AND the digest verified at download time, so the
// installer can re-check the file before it runs it; the digest never
// reaches the renderer.
assert.equal(downloaded.download!.installKind, 'relaunch')
assert.equal(JSON.stringify(downloaded).includes(release.assets[0].digest), false)
const installedResult = await service.install({
  downloadId: downloaded.download!.downloadId,
  revision: 1,
  schema: 'home-v2-app-update-install-request',
})
assert.equal(installedResult.outcome, 'completed')
assert.deepEqual(installed, { filePath: '/private/update.AppImage', digest: release.assets[0].digest })
assert.equal(JSON.stringify(installedResult).includes('/private/'), false)

let unsupportedHandoffCalls = 0
const unsupportedHandoffService = createHomeV2AppUpdateService({
  downloadAsset: async ({ asset, releaseTag }) => ({
    canOpen: false,
    canReveal: false,
    digest: asset.digest,
    digestVerified: true,
    fileName: asset.name,
    filePath: '/private/update.AppImage',
    installKind: null,
    releaseTag,
    size: asset.size,
  }),
  fetchRelease: async () => release,
  getEnvironment: () => ({
    currentVersion: '2.0.0',
    platform: { arch: 'x64', label: 'Linux x64', os: 'linux', supported: true },
  }),
  installDownloadedFile: async () => { unsupportedHandoffCalls += 1 },
  openDownloadedFile: async () => { unsupportedHandoffCalls += 1 },
  openReleasePage: async () => undefined,
  readSettings: async () => ({
    generation: 2,
    homeUpdatePolicy: 'notify',
    releaseChannel: 'stable',
  }),
  revealDownloadedFile: async () => { unsupportedHandoffCalls += 1 },
  uuid: () => 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
})
const unsupportedDownload = await unsupportedHandoffService.download(releaseRequest)
for (const operation of ['install', 'open', 'reveal'] as const) {
  const result = await unsupportedHandoffService[operation]({
    downloadId: unsupportedDownload.download!.downloadId,
    revision: 1,
    schema: `home-v2-app-update-${operation}-request`,
  })
  assert.equal(result.code, 'unsupported-platform')
}
assert.equal(unsupportedHandoffCalls, 0)

let authorized = false
const handlers = createAuthorizedHomeV2AppUpdateHandlers(
  () => { authorized = true; throw new Error('unauthorized') },
  service,
)
for (const handler of [handlers.check, handlers.download, handlers.install, handlers.open, handlers.reveal, handlers.openReleasePage]) {
  authorized = false
  assert.throws(() => handler({} as never, { bad: true }), /unauthorized/)
  assert.equal(authorized, true, 'authorization must happen before parsing')
}
assert.equal(authorized, true, 'authorization must happen before parsing')

console.log('Home 2 app update contract tests passed.')
