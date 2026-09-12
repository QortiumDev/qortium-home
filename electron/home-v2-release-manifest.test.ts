import assert from 'node:assert/strict'
import {
  HOME_RELEASE_PUBLISHER,
  homeReleaseChannelIdentifier,
  homeReleaseManifestIdentifier,
  parseHomeReleaseChannelPointer,
  parseHomeReleaseManifest,
  qdnResourceUrl,
} from './home-v2-release-manifest.js'
import { fetchHomeReleaseFromSources, fetchTrustedHomeReleaseFromQdn } from './app-update-discovery.js'
import type { TrustedHomeRelease } from './app-update-policy.js'

const node = 'http://127.0.0.1:24891'
const sha = 'e3a39eaa'.padEnd(64, '0')
const manifest = {
  schema: 'qortium-home-release',
  product: 'home',
  tag: 'v2.1.0-beta.4',
  name: 'Qortium Home v2.1.0-beta.4',
  prerelease: true,
  publishedAt: '2026-09-13T00:00:00Z',
  assets: [
    { name: 'Qortium-Home-2.1.0-beta.4-x86_64.AppImage', identifier: 'home-v2.1.0-beta.4-linux-x64', size: 140623650, sha256: sha },
    { name: 'Qortium-Home-2.1.0-beta.4-x64.exe', identifier: 'home-v2.1.0-beta.4-windows-x64', size: 95744657, sha256: sha },
  ],
}

// Identifiers: short, tag-shaped, under QDN's 64-byte cap.
assert.equal(homeReleaseChannelIdentifier('prerelease'), 'home-latest-prerelease')
assert.equal(homeReleaseManifestIdentifier('v2.1.0-beta.4'), 'home-release-v2.1.0-beta.4')
assert.throws(() => homeReleaseManifestIdentifier('2.1.0'), /cannot name/)
assert.throws(() => homeReleaseManifestIdentifier(`v1.0.0-${'x'.repeat(60)}`), /cannot name/)
assert.equal(qdnResourceUrl(`${node}/`, 'FILE', HOME_RELEASE_PUBLISHER, 'home-v2.1.0-beta.4-linux-x64'),
  `${node}/arbitrary/FILE/QortiumHomeTest/home-v2.1.0-beta.4-linux-x64`)

// Channel pointer.
assert.equal(parseHomeReleaseChannelPointer({ tag: 'v2.1.0-beta.4' }), 'v2.1.0-beta.4')
assert.equal(parseHomeReleaseChannelPointer({ tag: 'latest' }), null)
assert.equal(parseHomeReleaseChannelPointer('v2.1.0'), null)

// Manifest → the release shape the policy selects assets from.
const release = parseHomeReleaseManifest(manifest, { channel: 'prerelease', nodeApiUrl: node, tagName: 'v2.1.0-beta.4' })
assert.ok(release)
assert.equal(release.tagName, 'v2.1.0-beta.4')
assert.equal(release.htmlUrl, 'https://github.com/QortiumDev/qortium-home/releases/tag/v2.1.0-beta.4')
assert.equal(release.assets.length, 2)
assert.equal(release.assets[0].source, 'qdn')
assert.equal(release.assets[0].digest, `sha256:${sha}`)
assert.equal(release.assets[0].downloadUrl, `${node}/arbitrary/FILE/QortiumHomeTest/home-v2.1.0-beta.4-linux-x64`)
// Refusals: wrong channel, tag/identifier mismatch, bad digest, path in a name, duplicate, oversize, unknown schema.
assert.equal(parseHomeReleaseManifest(manifest, { channel: 'stable', nodeApiUrl: node, tagName: 'v2.1.0-beta.4' }), null)
assert.equal(parseHomeReleaseManifest(manifest, { channel: 'prerelease', nodeApiUrl: node, tagName: 'v2.1.0-beta.3' }), null)
const withAsset = (asset: Record<string, unknown>) => ({ ...manifest, assets: [{ ...manifest.assets[0], ...asset }] })
assert.equal(parseHomeReleaseManifest(withAsset({ sha256: 'abc' }), { channel: 'prerelease', nodeApiUrl: node, tagName: 'v2.1.0-beta.4' }), null)
assert.equal(parseHomeReleaseManifest(withAsset({ name: '../evil.AppImage' }), { channel: 'prerelease', nodeApiUrl: node, tagName: 'v2.1.0-beta.4' }), null)
assert.equal(parseHomeReleaseManifest(withAsset({ identifier: 'has space' }), { channel: 'prerelease', nodeApiUrl: node, tagName: 'v2.1.0-beta.4' }), null)
assert.equal(parseHomeReleaseManifest(withAsset({ size: 600 * 1024 * 1024 }), { channel: 'prerelease', nodeApiUrl: node, tagName: 'v2.1.0-beta.4' }), null)
assert.equal(parseHomeReleaseManifest({ ...manifest, assets: [manifest.assets[0], manifest.assets[0]] }, { channel: 'prerelease', nodeApiUrl: node, tagName: 'v2.1.0-beta.4' }), null)
assert.equal(parseHomeReleaseManifest({ ...manifest, schema: 'other' }, { channel: 'prerelease', nodeApiUrl: node, tagName: 'v2.1.0-beta.4' }), null)

// The two-read QDN fetch against a fake node.
const served = new Map<string, unknown>([
  [`${node}/arbitrary/JSON/QortiumHomeTest/home-latest-prerelease`, { tag: 'v2.1.0-beta.4' }],
  [`${node}/arbitrary/JSON/QortiumHomeTest/home-release-v2.1.0-beta.4`, manifest],
])
const requested: string[] = []
const fakeFetch = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  requested.push(url)
  const body = served.get(url)
  return new Response(body === undefined ? 'not found' : JSON.stringify(body), { status: body === undefined ? 404 : 200 })
}) as typeof fetch
const fromQdn = await fetchTrustedHomeReleaseFromQdn('prerelease', { nodeApiUrl: node, fetchImpl: fakeFetch })
assert.equal(fromQdn?.tagName, 'v2.1.0-beta.4')
assert.deepEqual(requested, [
  `${node}/arbitrary/JSON/QortiumHomeTest/home-latest-prerelease`,
  `${node}/arbitrary/JSON/QortiumHomeTest/home-release-v2.1.0-beta.4`,
])
assert.equal(await fetchTrustedHomeReleaseFromQdn('stable', { nodeApiUrl: node, fetchImpl: fakeFetch }), null, 'no stable pointer on this node')
const failing = (async () => new Response('busy', { status: 503 })) as typeof fetch
await assert.rejects(fetchTrustedHomeReleaseFromQdn('prerelease', { nodeApiUrl: node, fetchImpl: failing }), /release-http-503/)

// Source order: QDN answers first when it can; "no release" hands over; a
// failure is reported only when nothing else answered.
const githubRelease: TrustedHomeRelease = { ...fromQdn!, assets: [{ ...fromQdn!.assets[0], source: 'github' }] }
const order = async (
  orderName: 'github' | 'qdn' | 'qdn-then-github',
  qdn: 'release' | 'none' | 'fail',
  github: 'release' | 'none' | 'fail',
  nodeUp = true,
) => fetchHomeReleaseFromSources('prerelease', {
  order: orderName,
  nodeApiUrl: async () => (nodeUp ? node : null),
  fromQdn: async () => { if (qdn === 'fail') throw new Error('qdn-down'); return qdn === 'release' ? fromQdn : null },
  fromGithub: async () => { if (github === 'fail') throw new Error('release-http-403'); return github === 'release' ? githubRelease : null },
})
assert.equal((await order('qdn-then-github', 'release', 'release'))?.assets[0].source, 'qdn')
assert.equal((await order('qdn-then-github', 'none', 'release'))?.assets[0].source, 'github')
assert.equal((await order('qdn-then-github', 'fail', 'release'))?.assets[0].source, 'github', 'a broken node does not hide GitHub')
assert.equal((await order('qdn-then-github', 'release', 'release', false))?.assets[0].source, 'github', 'network off: QDN skipped')
await assert.rejects(order('qdn-then-github', 'none', 'fail'), /release-http-403/, 'the only failure is reported')
await assert.rejects(order('qdn-then-github', 'fail', 'none'), /qdn-down/)
assert.equal(await order('qdn', 'none', 'release'), null, 'QDN only: GitHub is never consulted')
assert.equal(await order('qdn', 'release', 'fail', false), null)
assert.equal((await order('github', 'release', 'release'))?.assets[0].source, 'github')

console.log('Home 2 QDN release manifest, fetch and source-order tests passed.')
