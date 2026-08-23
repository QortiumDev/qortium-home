import assert from 'node:assert/strict'
import {
  buildHomeV2CoreDocsFrameUrl,
  isAllowedHomeV2CoreDocsPath,
  parseHomeV2CoreDocsProtocolUrl,
} from './home-v2-core-docs-contract.js'

assert.equal(
  buildHomeV2CoreDocsFrameUrl('qortium'),
  'qortium-home-core-docs://qortium/api-documentation/',
)
assert.deepEqual(
  parseHomeV2CoreDocsProtocolUrl(
    'qortium-home-core-docs://qortal/api-documentation/swagger-ui.css?v=1',
  ),
  {
    network: 'qortal',
    path: '/api-documentation/swagger-ui.css?v=1',
  },
)
assert.equal(isAllowedHomeV2CoreDocsPath('/openapi.json'), true)
assert.deepEqual(
  parseHomeV2CoreDocsProtocolUrl('qortium-home-core-docs://qortium/openapi.json'),
  { network: 'qortium', path: '/openapi.json' },
)
for (const value of [
  'https://qortium/api-documentation/',
  'qortium-home-core-docs://other/api-documentation/',
  'qortium-home-core-docs://qortium/admin/stop',
  'qortium-home-core-docs://qortium/api-documentation/../admin/stop',
  'qortium-home-core-docs://qortium/api-documentation/%252e%252e/admin/stop',
  'qortium-home-core-docs://qortium/api-documentation/%2fadmin/stop',
  'qortium-home-core-docs://user@qortium/api-documentation/',
]) {
  assert.throws(() => parseHomeV2CoreDocsProtocolUrl(value))
}

console.log('Home v2 Core docs contract tests passed.')
