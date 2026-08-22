import assert from 'node:assert/strict'
import {
  compareHomeAppVersions,
  selectTrustedHomeReleaseAsset,
  type HomeAppUpdatePlatform,
  type TrustedHomeRelease,
} from './app-update-policy.js'

const digest = `sha256:${'a'.repeat(64)}` as const
const release: TrustedHomeRelease = {
  assets: [
    { digest, downloadUrl: 'https://github.com/QortiumDev/qortium-home/releases/download/v2.1.0/Qortium-Home-2.1.0-x64.exe', name: 'Qortium-Home-2.1.0-x64.exe', size: 10 },
    { digest, downloadUrl: 'https://github.com/QortiumDev/qortium-home/releases/download/v2.1.0/Qortium-Home-2.1.0-x86_64.AppImage', name: 'Qortium-Home-2.1.0-x86_64.AppImage', size: 10 },
    { digest, downloadUrl: 'https://github.com/QortiumDev/qortium-home/releases/download/v2.1.0/Qortium-Home-2.1.0-universal.dmg', name: 'Qortium-Home-2.1.0-universal.dmg', size: 10 },
    { digest, downloadUrl: 'https://github.com/QortiumDev/qortium-home/releases/download/v2.1.0/Qortium-Home-2.1.0-macos11-universal.dmg', name: 'Qortium-Home-2.1.0-macos11-universal.dmg', size: 10 },
  ],
  channel: 'stable',
  htmlUrl: 'https://github.com/QortiumDev/qortium-home/releases/tag/v2.1.0',
  name: 'v2.1.0',
  publishedAt: null,
  tagName: 'v2.1.0',
}

const platform = (os: HomeAppUpdatePlatform['os'], arch = 'x64', osVersion?: string): HomeAppUpdatePlatform => ({
  arch,
  label: `${os} ${arch}`,
  os,
  ...(osVersion ? { osVersion } : {}),
  supported: os !== 'unsupported',
})

assert.equal(compareHomeAppVersions('v2.1.0', '2.0.1'), 1)
assert.equal(compareHomeAppVersions('2.1.0-beta.2', '2.1.0-beta.10'), -1)
assert.equal(compareHomeAppVersions('2.1.0', '2.1.0-rc.1'), 1)
assert.equal(compareHomeAppVersions('bad', '2.1.0'), null)
assert.equal(selectTrustedHomeReleaseAsset(release, platform('windows'))?.name.endsWith('.exe'), true)
assert.equal(selectTrustedHomeReleaseAsset(release, platform('linux'))?.name.endsWith('.AppImage'), true)
assert.equal(selectTrustedHomeReleaseAsset(release, platform('macos', 'arm64', '13.0'))?.name.includes('universal.dmg'), true)
assert.equal(selectTrustedHomeReleaseAsset(release, platform('macos', 'x64', '11.7'))?.name.includes('macos11'), true)
assert.equal(selectTrustedHomeReleaseAsset(release, platform('unsupported')), null)

console.log('Home 2 app update policy tests passed.')
