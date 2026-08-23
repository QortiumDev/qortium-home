import assert from 'node:assert/strict'
import {
  fetchHomeV2ReleaseNotes,
  normalizeHomeV2ReleaseNotesEntry,
} from './home-v2-release-notes-discovery.js'

function githubRelease(tagName: string, body = '# Changes') {
  return {
    body,
    draft: false,
    html_url: `https://github.com/QortiumDev/qortium-home/releases/tag/${tagName}`,
    name: `Home ${tagName}`,
    published_at: '2026-08-23T00:00:00Z',
    tag_name: tagName,
  }
}

const normalized = normalizeHomeV2ReleaseNotesEntry(githubRelease('v2.1.0'), 'home')
assert.equal(normalized?.tagName, 'v2.1.0')
assert.equal(normalized?.body, '# Changes')
assert.equal(normalizeHomeV2ReleaseNotesEntry({
  ...githubRelease('v2.1.0'),
  html_url: 'https://github.com/Other/repo/releases/tag/v2.1.0',
}, 'home'), null)
assert.equal(normalizeHomeV2ReleaseNotesEntry({ ...githubRelease('v2.1.0'), draft: true }, 'home'), null)
assert.equal(normalizeHomeV2ReleaseNotesEntry(githubRelease('v2.1.0', 'x'.repeat(512 * 1024 + 1)), 'home'), null)

let requestedUrl = ''
const listed = await fetchHomeV2ReleaseNotes('home', 'v2.0.0', async (input, init) => {
  requestedUrl = String(input)
  assert.equal(init?.redirect, 'error')
  return new Response(JSON.stringify([
    githubRelease('v2.1.0'),
    githubRelease('v2.0.0'),
  ]), { status: 200 })
})
assert.equal(requestedUrl, 'https://api.github.com/repos/QortiumDev/qortium-home/releases?per_page=100')
assert.equal(listed.selected?.tagName, 'v2.0.0')
assert.deepEqual(listed.releases.map((release) => release.tagName), ['v2.1.0', 'v2.0.0'])

let requests = 0
const fallback = await fetchHomeV2ReleaseNotes('core', 'v1.2.3', async (input) => {
  requests += 1
  if (String(input).endsWith('releases?per_page=100')) {
    return new Response('[]', { status: 200 })
  }
  return new Response(JSON.stringify({
    ...githubRelease('v1.2.3'),
    html_url: 'https://github.com/QortiumDev/qortium-core/releases/tag/v1.2.3',
    name: 'Core 1.2.3',
  }), { status: 200 })
})
assert.equal(requests, 2)
assert.equal(fallback.selected?.name, 'Core 1.2.3')

await assert.rejects(
  fetchHomeV2ReleaseNotes('home', null, async () => new Response(
    'x'.repeat(2 * 1024 * 1024 + 1),
    { status: 200 },
  )),
  /too-large/,
)

console.log('Home 2 release notes discovery tests passed.')
