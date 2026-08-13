import assert from 'node:assert/strict'
import {
  isSameRenderResourcePath,
  parseRenderPathIdentity,
  resolveLaunchIdentifier,
} from './render-path-identity.js'

assert.deepEqual(
  parseRenderPathIdentity('/render/APP/Chat/default/settings'),
  { service: 'APP', name: 'Chat', nextSegment: 'default' },
)
assert.deepEqual(parseRenderPathIdentity('/render/APP/Chat'), { service: 'APP', name: 'Chat', nextSegment: null })
assert.equal(parseRenderPathIdentity('/not-render/APP/Chat'), null)
assert.equal(parseRenderPathIdentity('/render/APP'), null)

const ORIGIN = 'https://n0123456789abcdef.qdn.androidplatform.net'

// Default (omitted) launch identifier: query/hash in-app routing is allowed,
// but a non-default first path segment is a POSSIBLE identifier and is
// blocked, fail closed (Sol re-review finding 1 — this client cannot verify
// a segment is a REAL published identifier the way Core can).
{
  const launch = { name: 'Chat', identifier: null }
  assert.equal(isSameRenderResourcePath(`${ORIGIN}/render/APP/Chat`, launch), true)
  assert.equal(isSameRenderResourcePath(`${ORIGIN}/render/APP/Chat?x=1#h`, launch), true)
  assert.equal(
    isSameRenderResourcePath(`${ORIGIN}/render/APP/Chat/settings`, launch),
    false,
    'a default launch identifier does not free the first path segment for in-app routing',
  )
  assert.equal(
    isSameRenderResourcePath(`${ORIGIN}/render/APP/Chat/evil`, launch),
    false,
    'the previously-passing bypass: default launch, path-segment identifier spoof — now BLOCKED',
  )
  assert.equal(
    isSameRenderResourcePath(`${ORIGIN}/render/APP/Chat?identifier=evil`, launch),
    false,
    'the previously-passing bypass: default launch, ?identifier= spoof — now BLOCKED',
  )
  assert.equal(
    isSameRenderResourcePath(`${ORIGIN}/render/APP/Chat/default/settings`, launch),
    true,
    'a literal (case-insensitive) "default" first segment is never an identifier',
  )
  assert.equal(isSameRenderResourcePath(`${ORIGIN}/render/APP/OtherApp`, launch), false, 'different app name is blocked')
  assert.equal(isSameRenderResourcePath(`${ORIGIN}/render/WEBSITE/Chat`, launch), false, 'non-APP service is blocked')
  assert.equal(isSameRenderResourcePath(`${ORIGIN}/not-render/APP/Chat`, launch), false)
  assert.equal(isSameRenderResourcePath('not a url', launch), false)
}

// Explicit (pinned) launch identifier must be preserved exactly.
{
  const launch = { name: 'MyApp', identifier: 'docs' }
  assert.equal(isSameRenderResourcePath(`${ORIGIN}/render/APP/MyApp/docs`, launch), true)
  assert.equal(isSameRenderResourcePath(`${ORIGIN}/render/APP/MyApp/docs/page-2`, launch), true)
  assert.equal(isSameRenderResourcePath(`${ORIGIN}/render/APP/MyApp/otherIdentifier`, launch), false)
  assert.equal(
    isSameRenderResourcePath(`${ORIGIN}/render/APP/MyApp`, launch),
    false,
    'dropping the pinned identifier is blocked',
  )
  assert.equal(
    isSameRenderResourcePath(`${ORIGIN}/render/APP/MyApp/docs?identifier=evil`, launch),
    false,
    'the previously-passing bypass: explicit launch identifier, ?identifier= override — BLOCKED',
  )
}

// Round 4, Defect B (Sol round-3 re-review): resolveLaunchIdentifier is what
// AppTabStage.tsx now feeds into the native authorize() registration AND its
// own launchIdentity self-report check, instead of the raw
// parseAppResourceLocation-derived (path-only) identifier — closing the
// `.../default?identifier=evil` OPEN_NEW_TAB smuggling exploit at its root:
// the DECLARED launch identity now matches what actually gets served.
{
  const chatUrl = 'https://n0123456789abcdef.qdn.androidplatform.net/render/APP/Chat'

  // Before this fix: AppTabStage.tsx used resolved.identity.identifier
  // directly, which is null here (the qdn:// address's PATH says "default")
  // — even though the render URL's OWN query says otherwise. Declaring the
  // launch identity as "evil" instead is what makes it consistent with the
  // content Core will actually serve for a query that always wins outright.
  assert.equal(
    resolveLaunchIdentifier(null, `${chatUrl}?identifier=evil&accent=clay`),
    'evil',
    'an explicit ?identifier= query in the render URL overrides a null (default) path-based identifier',
  )
  assert.equal(
    resolveLaunchIdentifier('docs', `${chatUrl}?identifier=evil`),
    'evil',
    'an explicit ?identifier= query overrides an explicit path-based identifier too — query always wins',
  )
  assert.equal(
    resolveLaunchIdentifier(null, `${chatUrl}?accent=clay`),
    null,
    'with no ?identifier= query, the already-correct path-based identifier is used unchanged',
  )
  assert.equal(
    resolveLaunchIdentifier('docs', chatUrl),
    'docs',
    'no query at all: the path-based identifier passes through unchanged',
  )
  assert.equal(
    resolveLaunchIdentifier(null, `${chatUrl}?identifier=`),
    null,
    'a blank ?identifier= query does not override — falls back to the path-based identifier',
  )
  assert.equal(
    resolveLaunchIdentifier('docs', 'not a url'),
    'docs',
    'an unparseable render URL fails back to the path-based identifier rather than throwing',
  )
}

console.log('render-path-identity.test.ts passed')
