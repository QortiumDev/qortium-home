import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  buildHomeV2AssetReadPath,
  buildHomeV2NamePath,
  buildHomeV2ResourcePath,
  buildHomeV2ResourceRenderPath,
  getHomeV2AppActions,
  normalizeHomeV2OpenAddress,
  normalizeHomeV2ReadPath,
  normalizeHomeV2ResponseMaxBytes,
} from './home-v2-app-actions.js'

const qdnActions = getHomeV2AppActions('qdnRequest')
const qortalActions = getHomeV2AppActions('qortalRequest')

assert.equal(qdnActions.includes('GET_SELECTED_ACCOUNT'), true)
assert.equal(qdnActions.includes('FETCH_QDN_RESOURCE'), true)
assert.equal(qdnActions.includes('GET_ASSET_INFO'), true)
assert.equal(qdnActions.includes('GET_ASSET_BALANCES'), true)
assert.equal(qdnActions.includes('GET_ASSET_TRANSFERS'), true)
assert.equal(qdnActions.includes('GET_USER_ACCOUNT'), false)
assert.equal(qortalActions.includes('GET_USER_ACCOUNT'), true)
assert.equal(qortalActions.includes('GET_SELECTED_ACCOUNT'), false)
assert.equal(qortalActions.includes('FETCH_QDN_RESOURCE'), true)
assert.equal(qortalActions.includes('GET_ASSET_INFO'), false)

assert.equal(
  buildHomeV2AssetReadPath('GET_ASSET_INFO', { assetName: 'MY ASSET/ONE' }),
  '/assets/info?assetName=MY%20ASSET%2FONE',
)
assert.equal(
  buildHomeV2AssetReadPath('GET_ASSET_BALANCES', {
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
    assetId: '5',
    excludeZero: false,
    limit: 0,
  }),
  '/assets/balances?address=QH143K2qjVdn864NSY7aNESo88ao1ZnALH&assetid=5&excludeZero=false&limit=0',
)
assert.equal(
  buildHomeV2AssetReadPath('GET_ASSET_TRANSFERS', { assetId: 5, limit: 20, reverse: true }),
  '/assets/transfers/5?limit=20&reverse=true',
)
assert.throws(
  () => buildHomeV2AssetReadPath('GET_ASSET_BALANCES', {
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
    assetId: 'invalid',
  }),
  /non-negative safe integer/,
)

function readRepoSource(...candidates: string[]) {
  const url = candidates.map((candidate) => new URL(candidate, import.meta.url)).find((each) => existsSync(each))
  assert.ok(url, `source not found: tried ${candidates.join(', ')}`)
  return readFileSync(url, 'utf8')
}

for (const [name, source] of [
  ['electron/home-v2-app-bridge.ts', readRepoSource('../electron/home-v2-app-bridge.ts', './home-v2-app-bridge.ts')],
  ['src/home-v2-live/node-client.ts', readRepoSource('../src/home-v2-live/node-client.ts', '../src/home-v2-live/node-client.js')],
] as const) {
  assert(
    source.includes('buildHomeV2AssetReadPath(action,'),
    `${name} must dispatch asset reads through the shared Home v2 builder.`,
  )
}

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
assert.equal(normalizeHomeV2ResponseMaxBytes(undefined), 2 * 1024 * 1024)
assert.equal(normalizeHomeV2ResponseMaxBytes(5 * 1024 * 1024), 5 * 1024 * 1024)
assert.throws(
  () => normalizeHomeV2ResponseMaxBytes(5 * 1024 * 1024 + 1),
  /between 1 byte and 5 MiB/,
)
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
