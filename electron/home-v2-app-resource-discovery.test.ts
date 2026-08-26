import assert from 'node:assert/strict'
import {
  buildHomeV2AppResourceSearchPath,
  buildHomeV2ResourceSignatureSearchPath,
  normalizeHomeV2AppResourceService,
  parseHomeV2AppResourceCandidates,
  parseHomeV2ResourceLatestSignature,
} from './home-v2-app-resource-discovery.js'

const path = buildHomeV2AppResourceSearchPath('Trust App')
assert.match(path, /^\/arbitrary\/resources\/search\?/)
assert.match(path, /service=APP/)
assert.match(path, /name=Trust\+App/)
assert.match(path, /exactmatchnames=true/)

// R4-4: the search is scoped to the browser-archive service the address
// named, and still defaults to APP when the caller does not say (an older
// renderer, or the historical two-argument IPC call).
assert.match(buildHomeV2AppResourceSearchPath('Blog', 'WEBSITE'), /service=WEBSITE/)
assert.match(buildHomeV2AppResourceSearchPath('Arena', 'GAME'), /service=GAME/)
assert.match(buildHomeV2AppResourceSearchPath('Blog', 'website'), /service=WEBSITE/)
assert.match(buildHomeV2AppResourceSearchPath('Trust', undefined), /service=APP/)
assert.equal(normalizeHomeV2AppResourceService(undefined), 'APP')
assert.equal(normalizeHomeV2AppResourceService('game'), 'GAME')
// Viewer services must never reach the node search from this path.
assert.throws(
  () => buildHomeV2AppResourceSearchPath('Gallery', 'IMAGE'),
  /APP, WEBSITE, or GAME/,
)
assert.throws(() => normalizeHomeV2AppResourceService(42), /APP, WEBSITE, or GAME/)

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
  // R4-4: candidates carry their REAL service and WEBSITE/GAME are no longer
  // dropped by the filter. Order is deterministic: browser-archive service
  // order first (so an exact-name APP match still wins a tie), then the
  // default identifier, then identifiers alphabetically.
  [
    { identifier: null, name: 'Trust', service: 'APP' },
    { identifier: 'Trust', name: 'Trust', service: 'APP' },
    { identifier: 'ignore', name: 'Trust', service: 'WEBSITE' },
  ],
)

// A bare name that resolves to a WEBSITE candidate works on its own.
assert.deepEqual(
  parseHomeV2AppResourceCandidates([{ name: 'Blog', service: 'WEBSITE' }], 'blog'),
  [{ identifier: null, name: 'Blog', service: 'WEBSITE' }],
)
assert.deepEqual(
  parseHomeV2AppResourceCandidates(
    [{ identifier: 'Arena', name: 'Arena', service: 'game' }],
    'Arena',
  ),
  [{ identifier: 'Arena', name: 'Arena', service: 'GAME' }],
)

// An APP and a WEBSITE published under the same name AND identifier are two
// different resources: keying the dedupe map on the identifier alone used to
// drop one of them silently.
assert.deepEqual(
  parseHomeV2AppResourceCandidates(
    [
      { identifier: 'Arena', name: 'Arena', service: 'GAME' },
      { identifier: 'Arena', name: 'Arena', service: 'WEBSITE' },
      { identifier: 'Arena', name: 'Arena', service: 'APP' },
    ],
    'Arena',
  ),
  [
    { identifier: 'Arena', name: 'Arena', service: 'APP' },
    { identifier: 'Arena', name: 'Arena', service: 'WEBSITE' },
    { identifier: 'Arena', name: 'Arena', service: 'GAME' },
  ],
)

// A node that answers with viewer services is not trusted to have honoured
// the service scope: those entries are still dropped.
assert.deepEqual(
  parseHomeV2AppResourceCandidates(
    [
      { identifier: 'photo', name: 'Trust', service: 'IMAGE' },
      { identifier: 'clip', name: 'Trust', service: 'VIDEO' },
      { name: 'Trust', service: 'APP' },
    ],
    'Trust',
  ),
  [{ identifier: null, name: 'Trust', service: 'APP' }],
)

assert.throws(
  () => parseHomeV2AppResourceCandidates({}, 'Trust'),
  /invalid app resource list/,
)
assert.throws(() => buildHomeV2AppResourceSearchPath(''), /1 to 128/)

// --- signature search: used by the persistent image cache (R4-7 pass 2) ---
const iconSignaturePath = buildHomeV2ResourceSignatureSearchPath({
  service: 'APP',
  name: 'Chat',
  identifier: null,
})
assert.match(iconSignaturePath, /^\/arbitrary\/resources\/search\?/)
assert.match(iconSignaturePath, /service=APP/)
assert.match(iconSignaturePath, /identifier=default/)
assert.match(iconSignaturePath, /includemetadata=false/)
assert.match(iconSignaturePath, /limit=1/)

// Avatars use THUMBNAIL, which the browser-archive service check would reject
// but the signature search deliberately accepts.
const avatarSignaturePath = buildHomeV2ResourceSignatureSearchPath({
  service: 'THUMBNAIL',
  name: 'Alice',
  identifier: 'avatar',
})
assert.match(avatarSignaturePath, /service=THUMBNAIL/)
assert.match(avatarSignaturePath, /identifier=avatar/)
assert.throws(
  () => buildHomeV2ResourceSignatureSearchPath({ service: '../bad', name: 'X', identifier: null }),
  /uppercase token/,
)

// The signature is extracted only for the exact requested identity.
assert.equal(
  parseHomeV2ResourceLatestSignature(
    [
      { name: 'Chat', service: 'APP', latestSignature: 'sigDefault' },
      { name: 'Chat', service: 'APP', identifier: 'other', latestSignature: 'sigOther' },
    ],
    { service: 'APP', name: 'Chat', identifier: null },
  ),
  'sigDefault',
)
assert.equal(
  parseHomeV2ResourceLatestSignature(
    [{ name: 'Chat', service: 'APP', identifier: 'other', latestSignature: 'sigOther' }],
    { service: 'APP', name: 'Chat', identifier: null },
  ),
  null,
  'a non-matching identifier yields no signature (uncached fetch)',
)
assert.equal(
  parseHomeV2ResourceLatestSignature('not-an-array', { service: 'APP', name: 'Chat', identifier: null }),
  null,
)
assert.equal(
  parseHomeV2ResourceLatestSignature(
    [{ name: 'Chat', service: 'APP' }],
    { service: 'APP', name: 'Chat', identifier: null },
  ),
  null,
  'a missing latestSignature yields null',
)

console.log('Home v2 app resource discovery tests passed.')
