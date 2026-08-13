import assert from 'node:assert/strict'
import {
  isQdnRenderUrlSameAppResource,
  parseQdnResourceUrlIdentity,
  parseRenderPathIdentity,
  type QdnArchiveIdentityResolver,
} from './qdn-resource-identity.js'

const NODE_ORIGIN = 'http://127.0.0.1:12391'

// A test double for the Electron-only archive resolver: qdn-resource-
// identity.ts is deliberately free of node/electron imports so it can run
// under plain Node without booting Electron (see the file's header comment).
function fakeArchiveResolver(identityByUrl: Record<string, string | null> = {}): QdnArchiveIdentityResolver {
  return {
    isArchiveUrl: (url) => url.startsWith('file:///archive/'),
    getArchiveIdentity: (url) => identityByUrl[url] ?? null,
  }
}

const noArchives = fakeArchiveResolver()

function sameResource(candidateUrl: string, ref: Parameters<typeof isQdnRenderUrlSameAppResource>[1]) {
  return isQdnRenderUrlSameAppResource(candidateUrl, ref, noArchives)
}

// --- parseRenderPathIdentity -----------------------------------------------

assert.deepEqual(
  parseRenderPathIdentity('/render/APP/Chat/default/settings'),
  { service: 'APP', name: 'Chat', nextSegment: 'default' },
)
assert.deepEqual(
  parseRenderPathIdentity('/render/APP/Chat'),
  { service: 'APP', name: 'Chat', nextSegment: null },
)
assert.deepEqual(
  parseRenderPathIdentity('/render/hash/abc123/index.html'),
  { service: 'HASH', name: 'abc123', nextSegment: 'index.html' },
)
assert.equal(parseRenderPathIdentity('/not-render/APP/Chat'), null)
assert.equal(parseRenderPathIdentity('/render/APP'), null)
assert.equal(parseRenderPathIdentity('/render'), null)
assert.deepEqual(
  parseRenderPathIdentity('/render/APP/Chat/'),
  { service: 'APP', name: 'Chat', nextSegment: null },
  'a trailing slash with no segment after it is treated as no next segment',
)
assert.deepEqual(
  parseRenderPathIdentity('/render/APP/Chat/%65vil'),
  { service: 'APP', name: 'Chat', nextSegment: 'evil' },
  'a percent-encoded next segment is decoded',
)
assert.equal(
  parseRenderPathIdentity('/render/APP/Chat/%zz'),
  null,
  'a next segment that fails to decode invalidates the whole parse (fail closed), rather than ' +
    'silently reporting "no identifier"',
)

// --- parseQdnResourceUrlIdentity -------------------------------------------

assert.deepEqual(
  parseQdnResourceUrlIdentity('qdn://APP/Chat/default'),
  { service: 'APP', name: 'Chat', identifier: null },
)
assert.deepEqual(
  parseQdnResourceUrlIdentity('qdn://APP/Chat/DEFAULT'),
  { service: 'APP', name: 'Chat', identifier: null },
  'a literal "default" identifier segment is case-insensitively the sentinel for "none"',
)
assert.deepEqual(
  parseQdnResourceUrlIdentity('qdn://APP/Chat'),
  { service: 'APP', name: 'Chat', identifier: null },
)
assert.deepEqual(
  parseQdnResourceUrlIdentity('qdn://APP/MyApp/docs'),
  { service: 'APP', name: 'MyApp', identifier: 'docs' },
)
assert.deepEqual(
  parseQdnResourceUrlIdentity('qortal://WEBSITE/Site/docs/some/path?x=1#h'),
  { service: 'WEBSITE', name: 'Site', identifier: 'docs' },
)
assert.equal(parseQdnResourceUrlIdentity('https://example.com/render/APP/Chat'), null)
assert.equal(parseQdnResourceUrlIdentity('not a url'), null)

// --- isQdnRenderUrlSameAppResource: declared resourceUrl, default identifier

{
  const ref = { nodeOrigin: NODE_ORIGIN, requestedUrl: null, resourceUrl: 'qdn://APP/Chat/default' }
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/APP/Chat`, ref),
    true,
    'exact launch URL is always the same resource',
  )
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/APP/Chat?x=1#h`, ref),
    true,
    'a query/hash that is not `identifier` within the same app is allowed (SPA routing)',
  )
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/APP/Chat/settings`, ref),
    false,
    'a default (omitted) launch identifier does NOT free the first path segment for in-app ' +
      'routing — Core cannot be asked from the client whether "settings" is a real identifier, ' +
      'so it is treated as one and blocked, fail closed (Sol re-review finding 1)',
  )
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/APP/Chat/evil`, ref),
    false,
    'the previously-passing bypass: default launch, path-segment identifier spoof — now BLOCKED',
  )
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/APP/Chat?identifier=evil`, ref),
    false,
    'the previously-passing bypass: default launch, ?identifier= spoof — now BLOCKED',
  )
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/APP/Chat/default`, ref),
    true,
    'a literal (case-insensitive) "default" first segment is never an identifier',
  )
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/APP/Chat/DEFAULT/settings`, ref),
    true,
    '"default" is matched case-insensitively, same as Core, and routing below it is unrestricted',
  )
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/APP/Chat/%65vil`, ref),
    false,
    'an encoded first segment still resolves to a possible identifier and is blocked',
  )
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/APP/Chat/?identifier=`, ref),
    true,
    'a blank ?identifier= query does not count as an explicit identifier (Core: !isBlank())',
  )
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/APP/OtherApp`, ref),
    false,
    'a different app name is blocked (the core cross-app case)',
  )
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/WEBSITE/Chat`, ref),
    false,
    'a different service is blocked even with the same name',
  )
  assert.equal(
    sameResource('https://a-different-node.example/render/APP/Chat', ref),
    false,
    'a different node origin is blocked',
  )
  assert.equal(sameResource('not a url', ref), false)
}

// --- isQdnRenderUrlSameAppResource: explicit (pinned) identifier -----------

{
  const ref = { nodeOrigin: NODE_ORIGIN, requestedUrl: null, resourceUrl: 'qdn://APP/MyApp/docs' }
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/APP/MyApp/docs`, ref),
    true,
    'the explicit identifier segment must be present and match',
  )
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/APP/MyApp/docs/page-2?x=1`, ref),
    true,
    'deeper routing under a matching explicit identifier is still allowed',
  )
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/APP/MyApp/docs?identifier=docs`, ref),
    true,
    'a redundant ?identifier= that agrees with the path segment is still allowed',
  )
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/APP/MyApp/otherIdentifier`, ref),
    false,
    'a different explicit identifier under the same name is a distinct resource — blocked',
  )
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/APP/MyApp`, ref),
    false,
    'dropping a pinned explicit identifier entirely is blocked',
  )
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/APP/MyApp/docs?identifier=evil`, ref),
    false,
    'the previously-passing bypass: explicit launch identifier, ?identifier= override — the ' +
      'query wins over the matching path segment and reaches a different resource — BLOCKED',
  )
}

// --- isQdnRenderUrlSameAppResource: hash-service routing --------------------

{
  const ref = { nodeOrigin: NODE_ORIGIN, requestedUrl: null, resourceUrl: null }
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/hash/abc123`, {
      ...ref,
      requestedUrl: `${NODE_ORIGIN}/render/hash/abc123/index.html`,
    }),
    true,
    'a hash-addressed resource has no identifier concept: dropping the sub-path is allowed',
  )
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/hash/abc123/some/deep/route?identifier=evil`, {
      ...ref,
      requestedUrl: `${NODE_ORIGIN}/render/hash/abc123/index.html`,
    }),
    true,
    'same-hash routing tolerates any sub-path AND any query, including one named "identifier"',
  )
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/hash/xyz789`, {
      ...ref,
      requestedUrl: `${NODE_ORIGIN}/render/hash/abc123/index.html`,
    }),
    false,
    'a different hash is a different resource',
  )
}

// --- isQdnRenderUrlSameAppResource: no declared resourceUrl (fallback) -----

{
  const ref = {
    nodeOrigin: NODE_ORIGIN,
    requestedUrl: `${NODE_ORIGIN}/render/APP/Direct/default`,
    resourceUrl: null,
  }
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/APP/Direct`, ref),
    true,
    'no declared resourceUrl falls back to a default (null) launch identifier',
  )
  assert.equal(
    sameResource(`${NODE_ORIGIN}/render/APP/Direct/anything/here`, ref),
    false,
    'the fallback launch identity is still null, so a non-default first segment is blocked too',
  )
  assert.equal(sameResource(`${NODE_ORIGIN}/render/APP/SomeoneElse`, ref), false)
}

// --- isQdnRenderUrlSameAppResource: nothing to compare against yet ---------

assert.equal(
  sameResource(`${NODE_ORIGIN}/render/APP/Anything`, { nodeOrigin: NODE_ORIGIN, requestedUrl: null, resourceUrl: null }),
  true,
  'a view with no prior identity at all defers entirely to the caller\'s own allowlist',
)

// --- isQdnRenderUrlSameAppResource: managed archive URLs -------------------

{
  const archive = fakeArchiveResolver({
    'file:///archive/app-aaa111/contents/index.html': 'app-aaa111',
    'file:///archive/app-aaa111/contents/page2.html': 'app-aaa111',
    'file:///archive/app-bbb222/contents/index.html': 'app-bbb222',
  })
  const ref = {
    nodeOrigin: NODE_ORIGIN,
    requestedUrl: 'file:///archive/app-aaa111/contents/index.html',
    resourceUrl: null,
  }
  assert.equal(
    isQdnRenderUrlSameAppResource('file:///archive/app-aaa111/contents/page2.html', ref, archive),
    true,
    'navigation within the same extracted archive is allowed',
  )
  assert.equal(
    isQdnRenderUrlSameAppResource('file:///archive/app-bbb222/contents/index.html', ref, archive),
    false,
    'a different archive cache directory is a different resource',
  )
  assert.equal(
    isQdnRenderUrlSameAppResource(`${NODE_ORIGIN}/render/APP/Anything`, ref, archive),
    false,
    'an archive launch cannot be satisfied by a non-archive candidate',
  )
  const httpRef = { nodeOrigin: NODE_ORIGIN, requestedUrl: null, resourceUrl: 'qdn://APP/Chat/default' }
  assert.equal(
    isQdnRenderUrlSameAppResource('file:///archive/app-aaa111/contents/index.html', httpRef, archive),
    false,
    'a render-identity launch cannot be satisfied by an archive candidate',
  )
}

console.log('qdn-resource-identity.test.ts passed')
