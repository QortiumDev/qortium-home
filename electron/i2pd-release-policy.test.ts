import assert from 'node:assert/strict'
import {
  classifyI2pdRelease,
  getPinnedI2pdRelease,
  getTrustedI2pdRelease,
  getTrustedI2pdReleases,
  I2PD_ACKNOWLEDGED_UPSTREAM_VERSION,
  I2PD_LEGACY_VERSION,
  I2PD_PINNED_RELEASES,
  I2PD_PINNED_VERSION,
  I2PD_TRUSTED_RELEASES,
  resolveI2pdReleaseTarget,
} from './i2pd-release-policy.js'

const EXPECTED = {
  '2.60.0-q2': [
    ['linux-aarch64', 5_077_584, '78b68022ce8d7d106f397a3d907f8c98c25468b4fd667f20153fdc854043383f'],
    ['linux-x86_64', 4_800_688, '327b862c8b453fca7955b59cb4943fd8ad06c01f4fb30f597a3f253b77f02fd4'],
    ['macos-arm64', 5_269_766, '28cf1ec157eb77f559801860dcaa1bc816e2c64bfa9794781ebc522df38b5ba1'],
    ['macos-x86_64', 5_068_995, '740403378ffa577a576ef1fad9856c482316e623b9a4c222cbeaa94b50973270'],
    ['windows-x86_64', 5_041_541, 'b153952fd7c7f964e37ee4233ec8f805b20a20d6754e646e17d15e103323731e'],
  ],
  '2.61.0-q1': [
    ['linux-aarch64', 5_046_144, '07d4f028294962236afa28fe55d1a72015c6ceda305b8e8f806b34b5b17a8d7c'],
    ['linux-x86_64', 4_778_320, '9ccec667d0665d553320aa34be7d9a81d9b778dba6c7c21bc1531d7686ebf933'],
    ['macos-arm64', 5_273_318, '324b66452f2fca0bfb429bcb2f5a3a8e6359447290bfe02bb26b22be041e99fe'],
    ['macos-x86_64', 5_233_957, 'd8bf137e3a2d8528a3bc33c7b6dda95bd525305e897ae9e83261763321968a62'],
    ['windows-x86_64', 5_009_607, '47442d844d7efa7a660cfcab70fabdea459a721d531c0280269bc43d2a8a5ca0'],
  ],
} as const

assert.equal(I2PD_ACKNOWLEDGED_UPSTREAM_VERSION, '2.61.0')
assert.equal(I2PD_LEGACY_VERSION, '2.60.0-q2')
assert.equal(I2PD_PINNED_VERSION, '2.61.0-q1')
assert.equal(Object.isFrozen(I2PD_TRUSTED_RELEASES), true)
assert.equal(Object.isFrozen(I2PD_PINNED_RELEASES), true)
assert.equal(I2PD_TRUSTED_RELEASES.length, 10)
assert.equal(I2PD_PINNED_RELEASES.length, 5)

for (const [version, entries] of Object.entries(EXPECTED)) {
  for (const [target, size, sha256] of entries) {
    const platform = target.startsWith('linux-')
      ? 'linux'
      : target.startsWith('macos-') ? 'darwin' : 'win32'
    const arch = target.endsWith('aarch64') || target.endsWith('arm64') ? 'arm64' : 'x64'
    const actual = getTrustedI2pdRelease(version, platform, arch)
    assert(actual)
    const extension = target.startsWith('windows-') ? 'zip' : 'tar.gz'
    const assetName = `i2pd-${version}-${target}.${extension}`
    assert.deepEqual(actual, {
      archiveType: extension,
      assetName,
      binaryName: target.startsWith('windows-') ? 'i2pd.exe' : 'i2pd',
      downloadUrl: `https://github.com/QortiumDev/qortium-i2pd/releases/download/${version}/${assetName}`,
      logPolicy: version === I2PD_PINNED_VERSION ? 'bounded-v1' : 'legacy-unbounded',
      sha256,
      size,
      target,
      version,
    })
    assert.equal(Object.isFrozen(actual), true)
    assert.match(actual.assetName, /^[a-zA-Z0-9][a-zA-Z0-9._-]+\.(?:tar\.gz|zip)$/)
    assert.equal(actual.assetName.includes('/'), false)
    assert.equal(actual.assetName.includes('\\'), false)
    assert.equal(new URL(actual.downloadUrl).pathname.split('/').at(-1), actual.assetName)
    assert.match(actual.sha256, /^[a-f0-9]{64}$/)
    assert.equal(Number.isSafeInteger(actual.size) && actual.size > 0, true)
  }
}

assert.deepEqual([
  resolveI2pdReleaseTarget('linux', 'arm64'),
  resolveI2pdReleaseTarget('linux', 'x64'),
  resolveI2pdReleaseTarget('darwin', 'arm64'),
  resolveI2pdReleaseTarget('darwin', 'x64'),
  resolveI2pdReleaseTarget('win32', 'x64'),
], EXPECTED[I2PD_PINNED_VERSION].map(([target]) => target))

for (const [platform, arch] of [
  ['linux', 'ia32'],
  ['darwin', 'ia32'],
  ['win32', 'arm64'],
  ['freebsd', 'x64'],
  ['', ''],
] as const) {
  assert.equal(resolveI2pdReleaseTarget(platform, arch), null)
  assert.equal(getPinnedI2pdRelease(platform, arch), null)
  assert.deepEqual(getTrustedI2pdReleases(platform, arch), [])
  assert.deepEqual(classifyI2pdRelease(null, platform, arch), {
    action: 'unavailable',
    reason: 'unsupported-target',
  })
}

const pinnedLinux = getPinnedI2pdRelease('linux', 'x64')
assert(pinnedLinux)
assert.equal(pinnedLinux.version, I2PD_PINNED_VERSION)
assert.deepEqual(
  getTrustedI2pdReleases('linux', 'x64').map(({ version }) => version),
  [I2PD_LEGACY_VERSION, I2PD_PINNED_VERSION],
)
assert.equal(getTrustedI2pdRelease('2.59.0-q9', 'linux', 'x64'), null)

for (const missing of [null, undefined] as const) {
  assert.deepEqual(classifyI2pdRelease(missing, 'linux', 'x64'), {
    action: 'install',
    reason: 'not-installed',
    release: pinnedLinux,
  })
}

for (const older of ['0.0.0-q1', '2.59.99-q99', '2.60.0-q1', I2PD_LEGACY_VERSION] as const) {
  assert.deepEqual(classifyI2pdRelease(older, 'linux', 'x64'), {
    action: 'update',
    reason: 'installed-older',
    release: pinnedLinux,
  })
}

assert.deepEqual(classifyI2pdRelease(I2PD_PINNED_VERSION, 'linux', 'x64'), {
  action: 'none',
  reason: 'installed-current',
  release: pinnedLinux,
})

for (const newer of ['2.61.0-q2', '2.61.1-q1', '3.0.0-q1'] as const) {
  assert.deepEqual(classifyI2pdRelease(newer, 'linux', 'x64'), {
    action: 'none',
    reason: 'installed-newer',
    release: pinnedLinux,
  })
}

for (const invalid of [
  '',
  ' 2.61.0-q1',
  '2.61.0-q1 ',
  'v2.61.0-q1',
  '2.61.0',
  '02.61.0-q1',
  '2.61.0-q0',
  '2.61.0-q01',
  '9007199254740992.0.0-q1',
  '../2.61.0-q1',
] as const) {
  assert.deepEqual(classifyI2pdRelease(invalid, 'linux', 'x64'), {
    action: 'unavailable',
    reason: 'invalid-installed-version',
  })
}

console.log('i2pd trusted release catalogue and update policy tests passed.')
