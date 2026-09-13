import assert from 'node:assert/strict'
import { createAndroidGithubJsonFetcher } from './home-v2-android-app-updates'
import { checkAppUpdates, checkAppUpdatesFromSources } from './appUpdates'

// The Android shell's page fetch never reaches GitHub (CSP), so the check
// goes through the native HTTP plugin. Nothing here touches the network.
const calls: { url: string; headers: Record<string, string> }[] = []
const release = {
  tag_name: 'v2.1.0-beta.4', name: 'Home 2.1.0-beta.4', draft: false, prerelease: true,
  html_url: 'https://github.com/QortiumDev/qortium-home/releases/tag/v2.1.0-beta.4',
  published_at: '2026-09-13T00:00:00Z', body: '',
  assets: [{
    name: 'Qortium-Home-2.1.0-beta.4-android-release.apk', size: 120_000_000,
    browser_download_url: 'https://github.com/QortiumDev/qortium-home/releases/download/v2.1.0-beta.4/Qortium-Home-2.1.0-beta.4-android-release.apk',
    digest: `sha256:${'a'.repeat(64)}`, content_type: 'application/vnd.android.package-archive',
  }],
}
let status = 200
let data: unknown = [release]
const fetchJson = createAndroidGithubJsonFetcher(async (request) => {
  calls.push({ url: request.url, headers: request.headers })
  return { status, data }
})

const environment = {
  currentVersion: '2.1.0-beta.3',
  platform: { arch: 'arm64', label: 'Android', os: 'android' as const, supported: true },
}
let result = await checkAppUpdates(environment, 'prerelease', { fetchJson })
assert.equal(calls.length, 1)
assert.match(calls[0].url, /^https:\/\/api\.github\.com\/repos\/QortiumDev\/qortium-home\/releases\?per_page=/)
assert.equal(calls[0].headers.Accept, 'application/vnd.github+json')
assert.equal(result.status, 'available', 'the native listing drives the check')
assert.equal(result.release?.tagName, 'v2.1.0-beta.4')
assert.equal(result.asset?.name, 'Qortium-Home-2.1.0-beta.4-android-release.apk')

// A body the plugin handed over as text is parsed; an object passes through.
data = JSON.stringify([release])
result = await checkAppUpdates(environment, 'prerelease', { fetchJson })
assert.equal(result.status, 'available')

// 404 is "no release", not an error; any other failure status is an error.
status = 404
data = ''
result = await checkAppUpdates(environment, 'stable', { fetchJson })
assert.equal(result.status, 'not-found')
status = 503
data = { message: 'down' }
result = await checkAppUpdates(environment, 'stable', { fetchJson })
assert.equal(result.status, 'error')
assert.match(result.message, /HTTP 503/)
status = 403
result = await checkAppUpdates(environment, 'stable', { fetchJson })
assert.equal(result.status, 'error')
assert.match(result.message, /HTTP 403/, 'the controller maps HTTP 403/429 to the rate-limited notice')

// An absurdly large listing is refused rather than parsed.
status = 200
data = 'x'.repeat(3 * 1024 * 1024)
await assert.rejects(fetchJson('https://api.github.com/repos/QortiumDev/qortium-home/releases'), /too large|JSON/)

// The QDN source through the connected node: pointer -> manifest -> the
// same check, with the asset pointing at the node's FILE resource.
{
  const node = 'https://node1.qortium.example'
  const sha = 'e3a39eaa'.padEnd(64, '0')
  const manifest = {
    schema: 'qortium-home-release', product: 'home', tag: 'v2.1.0-beta.4', name: 'Qortium Home v2.1.0-beta.4',
    prerelease: true, publishedAt: '2026-09-13T00:00:00Z',
    assets: [
      { name: 'Qortium-Home-2.1.0-beta.4-android-release.apk', identifier: 'home-v2.1.0-beta.4-android', size: 5_500_000, sha256: sha },
      { name: 'Qortium-Home-2.1.0-beta.4-x86_64.AppImage', identifier: 'home-v2.1.0-beta.4-linux-x64', size: 140_000_000, sha256: sha },
    ],
  }
  const onNode = new Map<string, unknown>([
    ['home-latest-prerelease', { tag: 'v2.1.0-beta.4' }],
    ['home-release-v2.1.0-beta.4', manifest],
  ])
  const reads: string[] = []
  const readQdn = async (identifier: string) => {
    reads.push(identifier)
    return { nodeApiUrl: node, data: onNode.get(identifier) ?? null }
  }
  const githubCalls: string[] = []
  const stableRelease = { ...release, tag_name: 'v2.2.0', prerelease: false, html_url: 'https://github.com/QortiumDev/qortium-home/releases/tag/v2.2.0',
    assets: [{ ...release.assets[0], browser_download_url: 'https://github.com/QortiumDev/qortium-home/releases/download/v2.2.0/Qortium-Home-2.2.0-android-release.apk' }] }
  const githubOk = createAndroidGithubJsonFetcher(async (request) => {
    githubCalls.push(request.url)
    return { status: 200, data: request.url.endsWith('/releases/latest') ? stableRelease : [release] }
  })
  const githubDown = createAndroidGithubJsonFetcher(async () => ({ status: 403, data: '' }))

  // qdn-then-github: the node answers, GitHub is never asked.
  let result = await checkAppUpdatesFromSources(environment, 'prerelease', { order: 'qdn-then-github', fetchJson: githubOk, readQdn })
  assert.equal(result.status, 'available')
  assert.equal(result.release?.tagName, 'v2.1.0-beta.4')
  assert.equal(result.asset?.source, 'qdn')
  assert.equal(result.asset?.name, 'Qortium-Home-2.1.0-beta.4-android-release.apk', 'the platform selection still picks the APK')
  assert.equal(result.asset?.downloadUrl, `${node}/arbitrary/FILE/QortiumHomeTest/home-v2.1.0-beta.4-android`)
  assert.equal(result.asset?.digest, `sha256:${sha}`)
  assert.deepEqual(reads, ['home-latest-prerelease', 'home-release-v2.1.0-beta.4'])
  assert.equal(githubCalls.length, 0)

  // The node has no pointer for this channel: GitHub answers.
  result = await checkAppUpdatesFromSources(environment, 'stable', { order: 'qdn-then-github', fetchJson: githubOk, readQdn })
  assert.equal(result.asset?.source, 'github')
  assert.equal(githubCalls.length, 1)
  // QDN only and nothing on the node: not found, GitHub untouched.
  result = await checkAppUpdatesFromSources(environment, 'stable', { order: 'qdn', fetchJson: githubOk, readQdn })
  assert.equal(result.status, 'not-found')
  assert.equal(githubCalls.length, 1)
  // Network off (no reader): straight to GitHub under qdn-then-github; QDN-only is not found.
  result = await checkAppUpdatesFromSources(environment, 'prerelease', { order: 'qdn-then-github', fetchJson: githubOk, readQdn: null })
  assert.equal(result.asset?.source, 'github')
  result = await checkAppUpdatesFromSources(environment, 'prerelease', { order: 'qdn', fetchJson: githubOk, readQdn: null })
  assert.equal(result.status, 'not-found')
  // GitHub only ignores the node entirely.
  const before = reads.length
  result = await checkAppUpdatesFromSources(environment, 'prerelease', { order: 'github', fetchJson: githubOk, readQdn })
  assert.equal(result.asset?.source, 'github')
  assert.equal(reads.length, before)
  // A broken node does not hide GitHub; a failure is reported only when nothing answered.
  const nodeDown = async () => { throw new Error('release-http-503') }
  result = await checkAppUpdatesFromSources(environment, 'prerelease', { order: 'qdn-then-github', fetchJson: githubOk, readQdn: nodeDown })
  assert.equal(result.asset?.source, 'github')
  result = await checkAppUpdatesFromSources(environment, 'stable', { order: 'qdn-then-github', fetchJson: githubDown, readQdn })
  assert.equal(result.status, 'error')
  assert.match(result.message, /HTTP 403/)
  // A manifest for the other channel is refused, so a stable check never offers a prerelease.
  result = await checkAppUpdatesFromSources(environment, 'stable', { order: 'qdn', fetchJson: githubOk,
    readQdn: async (identifier) => ({ nodeApiUrl: node, data: identifier === 'home-latest-stable' ? { tag: 'v2.1.0-beta.4' } : manifest }) })
  assert.equal(result.status, 'not-found')
}

console.log('Android Home 2 app update native fetch tests passed.')
