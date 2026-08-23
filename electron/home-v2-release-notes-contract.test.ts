import assert from 'node:assert/strict'
import {
  createAuthorizedHomeV2ReleaseNotesHandlers,
  createHomeV2ReleaseNotesService,
} from './home-v2-release-notes-contract.js'
import type { HomeV2ReleaseNotesEntry } from './home-v2-release-notes-discovery.js'

const release: HomeV2ReleaseNotesEntry = {
  body: '# Changes\n- Read https://docs.qortium.org and https://docs.qortium.org/home.',
  htmlUrl: 'https://github.com/QortiumDev/qortium-home/releases/tag/v2.1.0',
  name: 'Home 2.1.0',
  publishedAt: '2026-08-23T00:00:00Z',
  tagName: 'v2.1.0',
}
const opened: string[] = []
const service = createHomeV2ReleaseNotesService({
  fetchNotes: async () => ({ releases: [release], selected: release }),
  openExternal: async (url) => { opened.push(url) },
  uuid: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
})
const request = {
  product: 'home',
  revision: 1,
  schema: 'home-v2-release-notes-load-request',
  tagName: 'v2.1.0',
}
const document = await service.load(request)
assert.equal(document.selected.body, release.body)
assert.equal(document.releases[0].tagName, release.tagName)
assert.equal(JSON.stringify(document.releases).includes('body'), false)

await service.openLink({
  documentId: document.documentId,
  revision: 1,
  schema: 'home-v2-release-notes-open-link-request',
  url: 'https://docs.qortium.org/home',
})
await service.openLink({
  documentId: document.documentId,
  revision: 1,
  schema: 'home-v2-release-notes-open-link-request',
  url: 'https://docs.qortium.org/',
})
assert.deepEqual(opened, ['https://docs.qortium.org/home', 'https://docs.qortium.org/'])
await assert.rejects(service.openLink({
  documentId: document.documentId,
  revision: 1,
  schema: 'home-v2-release-notes-open-link-request',
  url: 'https://example.invalid/not-in-notes',
}), /authorized/)
await assert.rejects(service.load({ ...request, extra: true }), /exact/)

let authorizationCalls = 0
const handlers = createAuthorizedHomeV2ReleaseNotesHandlers(() => {
  authorizationCalls += 1
  throw new Error('unauthorized')
}, service)
for (const handler of [handlers.load, handlers.openLink]) {
  assert.throws(() => handler({} as never, { invalid: true }), /unauthorized/)
}
assert.equal(authorizationCalls, 2)

console.log('Home 2 release notes contract tests passed.')
