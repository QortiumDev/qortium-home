import assert from 'node:assert/strict'
import {
  sameQortiumCoreRelease,
  selectFirstQortiumCoreRelease,
  selectQortiumCoreRelease,
} from './qortium-release-policy.js'

const DIGEST = `sha256:${'a'.repeat(64)}`

function release(overrides: Record<string, unknown> = {}) {
  return {
    assets: [{
      browser_download_url:
        'https://github.com/QortiumDev/qortium-core/releases/download/v1.2.3/qortium-preview.zip',
      digest: DIGEST,
      name: 'qortium-preview.zip',
      size: 123,
    }],
    draft: false,
    html_url: 'https://github.com/QortiumDev/qortium-core/releases/tag/v1.2.3',
    name: 'Qortium 1.2.3',
    prerelease: true,
    published_at: '2026-08-22T00:00:00Z',
    tag_name: 'v1.2.3',
    target_commitish: 'a'.repeat(40),
    ...overrides,
  }
}

const selected = selectQortiumCoreRelease(release(), 'prerelease')
assert(selected)
assert.deepEqual(selected.asset, {
  digest: DIGEST,
  downloadUrl:
    'https://github.com/QortiumDev/qortium-core/releases/download/v1.2.3/qortium-preview.zip',
  name: 'qortium-preview.zip',
  size: 123,
})
assert.equal(sameQortiumCoreRelease(selected, selected), true)
assert.deepEqual(
  selectFirstQortiumCoreRelease(
    [release({ assets: [] }), release()],
    'prerelease',
  ),
  selected,
)

for (const invalid of [
  { draft: true },
  { draft: undefined },
  { prerelease: false },
  { tag_name: '../v1.2.3' },
  { html_url: 'https://example.test/releases/tag/v1.2.3' },
  { assets: [] },
  { assets: [release().assets[0], release().assets[0]] },
  { assets: [{ ...release().assets[0], digest: '' }] },
  { assets: [{ ...release().assets[0], digest: DIGEST.toUpperCase() }] },
  { assets: [{ ...release().assets[0], size: 0 }] },
  { assets: [{ ...release().assets[0], size: 1.5 }] },
  { assets: [{ ...release().assets[0], browser_download_url: 'https://example.test/core.zip' }] },
] as const) {
  assert.equal(selectQortiumCoreRelease(release(invalid), 'prerelease'), null)
}

const changed = selectQortiumCoreRelease(release({
  assets: [{ ...release().assets[0], digest: `sha256:${'b'.repeat(64)}` }],
}), 'prerelease')
assert(changed)
assert.equal(sameQortiumCoreRelease(selected, changed), false)

console.log('Qortium release policy tests passed.')
