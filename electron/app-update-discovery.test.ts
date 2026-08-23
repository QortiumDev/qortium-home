import assert from 'node:assert/strict'
import {
  fetchTrustedHomeRelease,
  isTrustedHomeAssetResponseUrl,
} from './app-update-discovery.js'

const digest = `sha256:${'b'.repeat(64)}`
function release(overrides: Record<string, unknown> = {}) {
  return {
    assets: [{
      browser_download_url: 'https://github.com/QortiumDev/qortium-home/releases/download/v2.1.0/Qortium-Home-2.1.0-x86_64.AppImage',
      digest,
      name: 'Qortium-Home-2.1.0-x86_64.AppImage',
      size: 123,
    }],
    draft: false,
    html_url: 'https://github.com/QortiumDev/qortium-home/releases/tag/v2.1.0',
    name: 'Home 2.1.0',
    prerelease: false,
    published_at: '2026-08-22T00:00:00Z',
    tag_name: 'v2.1.0',
    ...overrides,
  }
}

let requestedUrl = ''
const stable = await fetchTrustedHomeRelease('stable', async (input) => {
  requestedUrl = String(input)
  return new Response(JSON.stringify(release()), { status: 200 })
})
assert.equal(requestedUrl, 'https://api.github.com/repos/QortiumDev/qortium-home/releases/latest')
assert.equal(stable?.assets[0]?.digest, digest)
assert.equal(stable?.assets[0]?.size, 123)

const prerelease = await fetchTrustedHomeRelease('prerelease', async () =>
  new Response(JSON.stringify([
    release(),
    release({ prerelease: true, tag_name: 'v2.2.0-beta.1', html_url: 'https://github.com/QortiumDev/qortium-home/releases/tag/v2.2.0-beta.1', assets: [] }),
  ]), { status: 200 }),
)
assert.equal(prerelease?.tagName, 'v2.2.0-beta.1')

const untrusted = await fetchTrustedHomeRelease('stable', async () =>
  new Response(JSON.stringify(release({
    assets: [{
      browser_download_url: 'https://evil.invalid/update.AppImage',
      digest,
      name: 'update-x64.AppImage',
      size: 123,
    }],
  })), { status: 200 }),
)
assert.equal(untrusted?.assets.length, 0)

const missingDigest = await fetchTrustedHomeRelease('stable', async () =>
  new Response(JSON.stringify(release({
    assets: [{
      browser_download_url: 'https://github.com/QortiumDev/qortium-home/releases/download/v2.1.0/update-x64.AppImage',
      digest: null,
      name: 'update-x64.AppImage',
      size: 123,
    }],
  })), { status: 200 }),
)
assert.equal(missingDigest?.assets.length, 0)

assert.equal(isTrustedHomeAssetResponseUrl(
  'https://release-assets.githubusercontent.com/github-production-release-asset/example',
), true)
assert.equal(isTrustedHomeAssetResponseUrl(
  'https://objects.githubusercontent.com/github-production-release-asset/example',
), true)
assert.equal(isTrustedHomeAssetResponseUrl(
  'https://github.com/QortiumDev/qortium-home/releases/download/v2.1.0/Home.AppImage',
), true)
assert.equal(isTrustedHomeAssetResponseUrl('https://github.com/Other/repo/releases/download/v1/x'), false)
assert.equal(isTrustedHomeAssetResponseUrl('https://release-assets.githubusercontent.com.evil.invalid/x'), false)

assert.equal(await fetchTrustedHomeRelease('stable', async () => new Response('', { status: 404 })), null)
await assert.rejects(
  fetchTrustedHomeRelease('stable', async () => new Response('x'.repeat(2 * 1024 * 1024 + 1), { status: 200 })),
  /release-response-too-large/,
)

console.log('Home 2 app update discovery tests passed.')
