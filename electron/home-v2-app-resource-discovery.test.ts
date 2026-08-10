import assert from 'node:assert/strict'
import {
  buildHomeV2AppResourceSearchPath,
  parseHomeV2AppResourceCandidates,
} from './home-v2-app-resource-discovery.js'

const path = buildHomeV2AppResourceSearchPath('Trust App')
assert.match(path, /^\/arbitrary\/resources\/search\?/)
assert.match(path, /service=APP/)
assert.match(path, /name=Trust\+App/)
assert.match(path, /exactmatchnames=true/)

assert.deepEqual(
  parseHomeV2AppResourceCandidates(
    [
      { identifier: 'Trust', name: 'Trust', service: 'APP' },
      { identifier: 'trust', name: 'Trust', service: 'APP' },
      { name: 'Trust', service: 'APP' },
      { identifier: 'ignore', name: 'Other', service: 'APP' },
      { identifier: 'ignore', name: 'Trust', service: 'WEBSITE' },
    ],
    'trust',
  ),
  [
    { identifier: null, name: 'Trust' },
    { identifier: 'Trust', name: 'Trust' },
  ],
)

assert.throws(
  () => parseHomeV2AppResourceCandidates({}, 'Trust'),
  /invalid app resource list/,
)
assert.throws(() => buildHomeV2AppResourceSearchPath(''), /1 to 128/)

console.log('Home v2 app resource discovery tests passed.')
