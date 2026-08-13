import assert from 'node:assert/strict'
import { isSameRenderResourcePath, parseRenderPathIdentity } from './render-path-identity.js'

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

console.log('render-path-identity.test.ts passed')
