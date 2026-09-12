import assert from 'node:assert/strict'
import { createAndroidGithubJsonFetcher } from './home-v2-android-app-updates'
import { checkAppUpdates } from './appUpdates'

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

// An absurdly large listing is refused rather than parsed.
status = 200
data = 'x'.repeat(3 * 1024 * 1024)
await assert.rejects(fetchJson('https://api.github.com/repos/QortiumDev/qortium-home/releases'), /too large|JSON/)

console.log('Android Home 2 app update native fetch tests passed.')
