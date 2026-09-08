import assert from 'node:assert/strict'
import { withHomeV2LegacyPublishSources } from '../../electron/home-v2-legacy-publish-source'
import { HOME_V2_PUBLISH_BLOB_MAX_BYTES, homeV2PublishBlobByteLength, normalizeHomeV2PublishBlobRequest } from '../../electron/home-v2-publish-blob-source'
import { homeV2DesktopPublishSources, stageHomeV2DesktopPublishBlob } from '../../electron/home-v2-publish-source-selection'
import { createHomeV2PublicPublishDescriptor, normalizeHomeV2PublicPublishRequest } from '../../electron/home-v2-public-publish-contract'
import { normalizeHomeV2PublishMultipleRequest } from '../../electron/home-v2-publish-extras-contract'
import { type HomeV2PublishSourceBinding } from '../../electron/home-v2-publish-source-tokens'
import { homeV2AndroidPublishSources, stageHomeV2AndroidPublishBlob, decodeHomeV2AndroidPublishSource } from './public-publish-source'

const binding: HomeV2PublishSourceBinding = {
  accountId: 'synthetic-account', appIdentity: 'qdn://APP/Help/Help', network: 'qortium',
  nodeApiUrl: 'https://node.example', protocol: 'qdnRequest', routeRevision: 'route-1', tabId: 'tab-1',
}
const base64 = Buffer.from('{"test":"published request shape"}', 'utf8').toString('base64')
// Executable request-shape fixtures from the published callers (the dependency
// pass changed no call sites): Boards boardService.publishRecord, Help
// qdnFeedback.publishFeedbackPayload / attachmentUpload.prepareFeedbackBundle,
// Paint qdn/api.publish, and Recipes qdnRecipes.publishRecipe.
const common = { action: 'PUBLISH_QDN_RESOURCE', base64, name: 'SyntheticPublisher', identifier: 'compat-test', description: 'Test content', title: 'Test' }
const fixtures = [
  { ...common, service: 'JSON', filename: 'board.json', tags: ['qboards', 'topic'] },
  { ...common, service: 'JSON', filename: 'feedback.json', tags: ['qav', 'post', 'bug'] },
  { ...common, service: 'IMAGE', filename: 'drawing.png' },
  { ...common, service: 'JSON', filename: 'recipe.json', tags: ['qrecipes', 'recipe', 'v1'] },
]
const attachment = { base64, name: common.name, identifier: 'help-attachment-1', service: 'DOCUMENT', filename: 'evidence.txt', description: 'Attachment for Qortium Help post', tags: ['qortium-help', 'feedback', 'attachment', 'post'], title: 'evidence.txt' }
const helpBatch = { action: 'PUBLISH_MULTIPLE_QDN_RESOURCES', resources: [attachment, { ...attachment, identifier: 'help-attachment-2', filename: 'evidence-2.txt' }] }

const platforms = [
  {
    name: 'desktop', store: homeV2DesktopPublishSources,
    stage: (request: Record<string, unknown>) => stageHomeV2DesktopPublishBlob(binding, normalizeHomeV2PublishBlobRequest(request)),
    read: (token: string, scope = binding) => {
      const source = homeV2DesktopPublishSources.resolve(token, scope)
      assert.equal(source.kind, 'blob')
      if (source.kind !== 'blob') throw new Error('Expected staged bytes')
      return source.bytes
    },
  },
  {
    name: 'android', store: homeV2AndroidPublishSources,
    stage: (request: Record<string, unknown>) => stageHomeV2AndroidPublishBlob(binding, request),
    read: (token: string, scope = binding) => decodeHomeV2AndroidPublishSource(homeV2AndroidPublishSources.resolve(token, scope).dataBase64),
  },
]
for (const platform of platforms) {
  platform.store.clear()
  for (const fixture of fixtures) {
    let token = ''
    const { base64: _bytes, filename: _filename, ...metadata } = fixture
    const expectedResource = normalizeHomeV2PublicPublishRequest('qortium', { ...metadata, sourceToken: '00000000-0000-4000-8000-000000000001' }).resource
    const expected = createHomeV2PublicPublishDescriptor({ network: 'qortium', contentHash: '0'.repeat(64), fileName: fixture.filename, size: Buffer.from(base64, 'base64').length, transactionSignature: 'synthetic-signature', resource: expectedResource })
    const result = await withHomeV2LegacyPublishSources('qortium', fixture, false, platform.stage,
      (value) => platform.store.release(value), async (request) => {
        assert.ok(!Object.hasOwn(request, 'base64') && !Object.hasOwn(request, 'filename'))
        const normalized = normalizeHomeV2PublicPublishRequest('qortium', request)
        assert.deepEqual(normalized.resource, expectedResource)
        token = normalized.sourceToken
        assert.deepEqual(platform.read(token), Uint8Array.from(Buffer.from(base64, 'base64')))
        return expected
      })
    assert.equal(result, expected)
    assert.equal(result.transactionSignature, 'synthetic-signature')
    assert.throws(() => platform.read(token), /expired/)
    assert.equal(platform.store.size, 0)
  }
  let batchTokens: string[] = []
  const batchResult = { accepted: true, published: [{ transactionSignature: 'attachment-1' }, { transactionSignature: 'attachment-2' }], failures: [] }
  assert.equal(await withHomeV2LegacyPublishSources('qortium', helpBatch, true, platform.stage,
    (value) => platform.store.release(value), async (request) => {
      batchTokens = normalizeHomeV2PublishMultipleRequest('qortium', request).items.map((item) => item.sourceToken)
      assert.equal(new Set(batchTokens).size, 2)
      batchTokens.forEach((token) => assert.deepEqual(platform.read(token), Uint8Array.from(Buffer.from(base64, 'base64'))))
      return batchResult
    }), batchResult)
  batchTokens.forEach((token) => assert.throws(() => platform.read(token), /expired/))

  // A failed second stage and any downstream refusal release all leased bytes.
  let staged = 0
  await assert.rejects(withHomeV2LegacyPublishSources('qortium', helpBatch, true, (request) => {
    if (++staged === 2) throw new Error('stage failed')
    return platform.stage(request)
  }, (token) => platform.store.release(token), async () => assert.fail('must not publish')), /stage failed/)
  assert.equal(platform.store.size, 0)
  for (const reason of ['consent denied', 'consent cancelled', 'context invalidated']) {
    await assert.rejects(withHomeV2LegacyPublishSources('qortium', helpBatch, true, platform.stage,
      (token) => platform.store.release(token), async () => { throw new Error(reason) }), new RegExp(reason))
    assert.equal(platform.store.size, 0)
  }
  // The real source stores reject every binding change; the adapter grants no authority.
  for (const key of Object.keys(binding) as (keyof HomeV2PublishSourceBinding)[]) {
    await assert.rejects(withHomeV2LegacyPublishSources('qortium', fixtures[0], false, platform.stage,
      (token) => platform.store.release(token), async (request) => {
        platform.read(String(request.sourceToken), { ...binding, [key]: `${binding[key]}-changed` } as HomeV2PublishSourceBinding)
      }), /not available/)
    assert.equal(platform.store.size, 0)
  }
  let attempts = 0
  const unknown = { accepted: false, outcome: 'unknown', transactionSignature: 'ambiguous-signature' }
  assert.equal(await withHomeV2LegacyPublishSources('qortium', fixtures[0], false, platform.stage,
    (token) => platform.store.release(token), async () => { attempts++; return unknown }), unknown)
  assert.equal(attempts, 1)
  assert.equal(platform.store.size, 0)

  // Explicit STAGE -> token requests keep their existing lifetime, even on denial.
  const explicit = platform.stage({ bytesBase64: base64, fileName: 'explicit.txt' })
  const tokenRequest = { action: 'PUBLISH_QDN_RESOURCE', name: common.name, service: 'DOCUMENT', sourceToken: explicit.sourceToken }
  await assert.rejects(withHomeV2LegacyPublishSources('qortium', tokenRequest, false,
    () => assert.fail('token-only request must not stage'), () => assert.fail('not our token'), async (request) => {
      assert.equal(request, tokenRequest)
      assert.deepEqual(platform.read(normalizeHomeV2PublicPublishRequest('qortium', request).sourceToken), Uint8Array.from(Buffer.from(base64, 'base64')))
      throw new Error('denied')
    }), /denied/)
  assert.equal(platform.store.size, 1)
  platform.store.clear()
  console.log(`${platform.name}: legacy request/cleanup/binding/result cases passed`)
}

const token = '00000000-0000-4000-8000-000000000001'
const invalidSingles = [
  { ...fixtures[0], sourceToken: token }, { ...fixtures[0], sourceToken: null },
  { ...fixtures[0], filename: '../escape.json' }, { ...fixtures[0], filename: 'x\\escape.json' },
  { ...fixtures[0], filename: '..' }, { ...fixtures[0], filename: 'a\u0000.json' },
  { ...fixtures[0], filename: 'a'.repeat(181) }, { ...fixtures[0], filename: '' },
  { ...fixtures[0], base64: 'AB==' }, { ...fixtures[0], base64: 'AAB=' },
  { ...fixtures[0], base64: 'data:application/json;base64,e30=' },
  { ...fixtures[0], payload: { sourceToken: token } }, { ...fixtures[0], payload: {} },
  { ...fixtures[0], path: '' }, { ...fixtures[0], uri: 'file:///tmp/content' },
  { ...fixtures[0], mimeType: 'application/json' }, { ...fixtures[0], network: 'qortal' },
  { ...fixtures[0], fee: 100 }, { ...fixtures[0], name: '..' },
  { ...fixtures[0], tags: ['a'.repeat(21)] },
  { ...fixtures[0], dataBase64: base64 },
  { ...fixtures[0], encrypt: true }, { ...fixtures[0], publicKeys: ['recipient'] },
  { ...fixtures[0], payload: { dataBase64: base64 } },
]
async function rejectBeforeStaging(request: Record<string, unknown>, multiple = false) {
  let calls = 0
  await assert.rejects(withHomeV2LegacyPublishSources('qortium', request, multiple,
    () => { calls++; throw new Error('unexpected staging') }, () => assert.fail('nothing staged'),
    async () => { calls++; throw new Error('unexpected publishing') }))
  assert.equal(calls, 0)
}
for (const request of invalidSingles) await rejectBeforeStaging(request)
for (const resources of [Array(11).fill(attachment), [attachment, { service: 'JSON', name: common.name, sourceToken: token }], [attachment, { ...attachment, service: '' }]]) {
  await rejectBeforeStaging({ resources }, true)
}
await rejectBeforeStaging({ ...helpBatch, payload: { resources: [{ service: 'JSON', name: common.name, sourceToken: token }] } }, true)
await rejectBeforeStaging({ payload: helpBatch }, true)
await rejectBeforeStaging({ ...helpBatch, base64: 'AA==' }, true)
const tokenItem = { service: 'JSON', name: common.name, sourceToken: token }
for (const fields of [{ base64, filename: 'bad.json' }, { dataBase64: base64 }]) {
  await rejectBeforeStaging({ resources: [tokenItem], ...fields }, true)
  await rejectBeforeStaging({ resources: [tokenItem], payload: fields }, true)
  for (const request of [{ ...tokenItem, ...fields }, { ...tokenItem, payload: { ...tokenItem, ...fields } }]) {
    assert.throws(() => normalizeHomeV2PublicPublishRequest('qortium', request), /sourceToken/)
    assert.throws(() => normalizeHomeV2PublishMultipleRequest('qortium', { resources: [request] }), /sourceToken/)
  }
}
const encodedLength = Math.ceil(HOME_V2_PUBLISH_BLOB_MAX_BYTES / 3) * 4
const maximum = 'A'.repeat(encodedLength - 2) + '=='
assert.equal(homeV2PublishBlobByteLength(maximum), HOME_V2_PUBLISH_BLOB_MAX_BYTES)
assert.throws(() => homeV2PublishBlobByteLength('A'.repeat(encodedLength - 1) + '='), /at most 25 MiB/)
await rejectBeforeStaging({ ...fixtures[0], base64: 'A'.repeat(encodedLength + 4) })
// Both sources fit individually, but staging must not begin for their oversized total.
const half = 'A'.repeat(Math.ceil(13 * 1024 * 1024 / 3) * 4)
await rejectBeforeStaging({ resources: [{ ...attachment, base64: half }, { ...attachment, base64: half }] }, true)
await assert.rejects(withHomeV2LegacyPublishSources('qortal', fixtures[0], false,
  () => assert.fail('metadata invalid on Qortal'), () => {}, async () => assert.fail()), /mutable resource metadata/)
console.log('legacy-publish-source.test: ok')
