import assert from 'node:assert/strict'
import {
  classifyI2pdRelease,
  getPinnedI2pdRelease,
  I2PD_PINNED_RELEASES,
  I2PD_PINNED_VERSION,
  resolveI2pdReleaseTarget,
} from './i2pd-release-policy.js'

const EXPECTED_RELEASES = [
  {
    size: 5_077_584,
    target: 'linux-aarch64',
    sha256: '78b68022ce8d7d106f397a3d907f8c98c25468b4fd667f20153fdc854043383f',
  },
  {
    size: 4_800_688,
    target: 'linux-x86_64',
    sha256: '327b862c8b453fca7955b59cb4943fd8ad06c01f4fb30f597a3f253b77f02fd4',
  },
  {
    size: 5_269_766,
    target: 'macos-arm64',
    sha256: '28cf1ec157eb77f559801860dcaa1bc816e2c64bfa9794781ebc522df38b5ba1',
  },
  {
    size: 5_068_995,
    target: 'macos-x86_64',
    sha256: '740403378ffa577a576ef1fad9856c482316e623b9a4c222cbeaa94b50973270',
  },
  {
    size: 5_041_541,
    target: 'windows-x86_64',
    sha256: 'b153952fd7c7f964e37ee4233ec8f805b20a20d6754e646e17d15e103323731e',
  },
] as const

assert.equal(I2PD_PINNED_VERSION, '2.60.0-q2')
assert.equal(Object.isFrozen(I2PD_PINNED_RELEASES), true)
assert.equal(I2PD_PINNED_RELEASES.length, EXPECTED_RELEASES.length)

for (const [index, expected] of EXPECTED_RELEASES.entries()) {
  const actual = I2PD_PINNED_RELEASES[index]
  const extension = expected.target.startsWith('windows-') ? 'zip' : 'tar.gz'
  const assetName = `i2pd-2.60.0-q2-${expected.target}.${extension}`

  assert.deepEqual(actual, {
    archiveType: extension,
    assetName,
    binaryName: expected.target.startsWith('windows-') ? 'i2pd.exe' : 'i2pd',
    downloadUrl:
      `https://github.com/QortiumDev/qortium-i2pd/releases/download/2.60.0-q2/${assetName}`,
    sha256: expected.sha256,
    size: expected.size,
    target: expected.target,
    version: '2.60.0-q2',
  })
  assert.equal(Object.isFrozen(actual), true)
  assert.match(actual.assetName, /^[a-zA-Z0-9][a-zA-Z0-9._-]+\.(?:tar\.gz|zip)$/)
  assert.equal(actual.assetName.includes('/'), false)
  assert.equal(actual.assetName.includes('\\'), false)
  assert.equal(new URL(actual.downloadUrl).pathname.split('/').at(-1), actual.assetName)
  assert.match(actual.sha256, /^[a-f0-9]{64}$/)
  assert.equal(Number.isSafeInteger(actual.size) && actual.size > 0, true)
}

assert.deepEqual([
  resolveI2pdReleaseTarget('linux', 'arm64'),
  resolveI2pdReleaseTarget('linux', 'x64'),
  resolveI2pdReleaseTarget('darwin', 'arm64'),
  resolveI2pdReleaseTarget('darwin', 'x64'),
  resolveI2pdReleaseTarget('win32', 'x64'),
], EXPECTED_RELEASES.map(({ target }) => target))

for (const [platform, arch] of [
  ['linux', 'ia32'],
  ['darwin', 'ia32'],
  ['win32', 'arm64'],
  ['freebsd', 'x64'],
  ['', ''],
] as const) {
  assert.equal(resolveI2pdReleaseTarget(platform, arch), null)
  assert.equal(getPinnedI2pdRelease(platform, arch), null)
  assert.deepEqual(classifyI2pdRelease(null, platform, arch), {
    action: 'unavailable',
    reason: 'unsupported-target',
  })
}

const pinnedLinux = getPinnedI2pdRelease('linux', 'x64')
assert(pinnedLinux)

for (const missing of [null, undefined] as const) {
  assert.deepEqual(classifyI2pdRelease(missing, 'linux', 'x64'), {
    action: 'install',
    reason: 'not-installed',
    release: pinnedLinux,
  })
}

for (const older of ['0.0.0-q1', '2.59.99-q99', '2.60.0-q1'] as const) {
  assert.deepEqual(classifyI2pdRelease(older, 'linux', 'x64'), {
    action: 'update',
    reason: 'installed-older',
    release: pinnedLinux,
  })
}

assert.deepEqual(classifyI2pdRelease('2.60.0-q2', 'linux', 'x64'), {
  action: 'none',
  reason: 'installed-current',
  release: pinnedLinux,
})

for (const newer of ['2.60.0-q3', '2.60.1-q1', '3.0.0-q1'] as const) {
  assert.deepEqual(classifyI2pdRelease(newer, 'linux', 'x64'), {
    action: 'none',
    reason: 'installed-newer',
    release: pinnedLinux,
  })
}

for (const invalid of [
  '',
  ' 2.60.0-q1',
  '2.60.0-q1 ',
  'v2.60.0-q1',
  '2.60.0',
  '02.60.0-q1',
  '2.60.0-q0',
  '2.60.0-q01',
  '9007199254740992.0.0-q1',
  '../2.60.0-q1',
] as const) {
  assert.deepEqual(classifyI2pdRelease(invalid, 'linux', 'x64'), {
    action: 'unavailable',
    reason: 'invalid-installed-version',
  })
}

console.log('i2pd release policy tests passed.')
