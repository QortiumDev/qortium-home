import assert from 'node:assert/strict'
import {
  buildHomeV2NamePath,
  buildHomeV2ResourcePath,
  buildHomeV2ResourceRenderPath,
  getHomeV2AppActions,
  normalizeHomeV2OpenAddress,
  normalizeHomeV2ReadPath,
} from './home-v2-app-actions.js'

const qdnActions = getHomeV2AppActions('qdnRequest')
const qortalActions = getHomeV2AppActions('qortalRequest')

assert.equal(qdnActions.includes('GET_SELECTED_ACCOUNT'), true)
assert.equal(qdnActions.includes('FETCH_QDN_RESOURCE'), true)
assert.equal(qdnActions.includes('GET_USER_ACCOUNT'), false)
assert.equal(qortalActions.includes('GET_USER_ACCOUNT'), true)
assert.equal(qortalActions.includes('GET_SELECTED_ACCOUNT'), false)
assert.equal(qortalActions.includes('FETCH_QDN_RESOURCE'), true)

assert.equal(
  buildHomeV2ResourcePath('FETCH_QDN_RESOURCE', {
    async: true,
    identifier: 'q-support-post-v1-example',
    name: 'Help',
    path: 'post.json',
    service: 'DOCUMENT',
  }),
  '/arbitrary/DOCUMENT/Help/q-support-post-v1-example?filepath=post.json&async=true',
)
assert.equal(
  buildHomeV2ResourcePath('GET_QDN_RESOURCE_STATUS', {
    build: false,
    name: 'Q-Tube',
    service: 'APP',
  }),
  '/arbitrary/resource/status/APP/Q-Tube?build=false',
)
assert.equal(
  buildHomeV2ResourcePath('SEARCH_QDN_RESOURCES', {
    exactMatchNames: true,
    limit: 25,
    names: ['Help', 'Trust'],
    service: 'DOCUMENT',
  }),
  '/arbitrary/resources/search?exactmatchnames=true&limit=25&name=Help&name=Trust&service=DOCUMENT',
)
assert.equal(
  buildHomeV2ResourceRenderPath(
    { name: 'Trust', path: 'profile/Qabc?view=compact', service: 'APP' },
    { accent: 'orange', language: 'en', textSize: 'medium', theme: 'dark', ui: 'classic' },
  ),
  '/render/APP/Trust/profile/Qabc?view=compact&theme=dark&lang=en&textSize=medium&accent=orange&uiStyle=classic',
)

assert.equal(
  buildHomeV2NamePath('GET_ACCOUNT_NAMES', {
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
  }),
  '/names/address/QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
)
assert.equal(normalizeHomeV2OpenAddress({ address: 'qdn://APP/Trust' }), 'qdn://APP/Trust')
assert.equal(normalizeHomeV2OpenAddress({ qdnUrl: 'qortal://APP/Q-Tube' }), 'qortal://APP/Q-Tube')
assert.throws(
  () => normalizeHomeV2OpenAddress({ address: 'https://example.com' }),
  /only accepts/,
)
assert.throws(() => normalizeHomeV2ReadPath('/admin/stop'), /outside Home v2 read-only scope/)
assert.equal(normalizeHomeV2ReadPath('/names/Alice?limit=1'), '/names/Alice?limit=1')
assert.throws(
  () => buildHomeV2ResourcePath('FETCH_QDN_RESOURCE', {
    name: 'Alice',
    service: '../addresses',
  }),
  /service is invalid/,
)
assert.throws(
  () => buildHomeV2ResourcePath('FETCH_QDN_RESOURCE', {
    name: '..',
    service: 'DOCUMENT',
  }),
  /path segments/,
)
assert.throws(
  () => buildHomeV2ResourcePath('FETCH_QDN_RESOURCE', {
    name: 'Alice',
    path: '../admin/status',
    service: 'DOCUMENT',
  }),
  /file paths/,
)

console.log('Home v2 app action contract tests passed.')
