import assert from 'node:assert/strict'
import {
  getHomeV2ReleaseNotesSource,
  parseHomeV2ReleaseNotesDocument,
} from './release-notes-client'

const summary = {
  htmlUrl: 'https://github.com/QortiumDev/qortium-home/releases/tag/v2.1.0',
  name: 'Home 2.1.0',
  publishedAt: '2026-08-23T00:00:00Z',
  tagName: 'v2.1.0',
}
const document = {
  documentId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  product: 'home',
  releases: [summary],
  revision: 1,
  schema: 'home-v2-release-notes-document',
  selected: { ...summary, body: '# Changes' },
}
assert.equal(parseHomeV2ReleaseNotesDocument(document).selected.body, '# Changes')
assert.throws(() => parseHomeV2ReleaseNotesDocument({ ...document, filePath: '/tmp/private' }), /malformed/)
assert.throws(() => parseHomeV2ReleaseNotesDocument({
  ...document,
  selected: { ...document.selected, htmlUrl: 'https://example.invalid/release' },
}), /malformed/)

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {},
  writable: true,
})
await assert.rejects(
  getHomeV2ReleaseNotesSource().load('home', 'v2.1.0'),
  /bridge is unavailable/,
)
assert.throws(() => parseHomeV2ReleaseNotesDocument({
  ...document,
  selected: { ...document.selected, body: 'x'.repeat(512 * 1024 + 1) },
}), /malformed/)

console.log('Home 2 release notes client tests passed.')
