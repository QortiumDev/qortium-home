import assert from 'node:assert/strict'
import { isSameRenderResourcePath, parseRenderPathIdentity } from './render-path-identity.js'

assert.deepEqual(
  parseRenderPathIdentity('/render/APP/Chat/default/settings'),
  { service: 'APP', name: 'Chat', nextSegment: 'default' },
)
assert.deepEqual(parseRenderPathIdentity('/render/APP/Chat'), { service: 'APP', name: 'Chat', nextSegment: null })
assert.equal(parseRenderPathIdentity('/not-render/APP/Chat'), null)
assert.equal(parseRenderPathIdentity('/render/APP'), null)

// Default (omitted) launch identifier: any deeper path/query segment is
// in-app routing, always allowed.
{
  const launch = { name: 'Chat', identifier: null }
  assert.equal(isSameRenderResourcePath('/render/APP/Chat', launch), true)
  assert.equal(isSameRenderResourcePath('/render/APP/Chat/settings', launch), true)
  assert.equal(isSameRenderResourcePath('/render/APP/Chat/deep/route', launch), true)
  assert.equal(isSameRenderResourcePath('/render/APP/OtherApp', launch), false, 'different app name is blocked')
  assert.equal(isSameRenderResourcePath('/render/WEBSITE/Chat', launch), false, 'non-APP service is blocked')
  assert.equal(isSameRenderResourcePath('/not-render/APP/Chat', launch), false)
}

// Explicit (pinned) launch identifier must be preserved exactly.
{
  const launch = { name: 'MyApp', identifier: 'docs' }
  assert.equal(isSameRenderResourcePath('/render/APP/MyApp/docs', launch), true)
  assert.equal(isSameRenderResourcePath('/render/APP/MyApp/docs/page-2', launch), true)
  assert.equal(isSameRenderResourcePath('/render/APP/MyApp/otherIdentifier', launch), false)
  assert.equal(isSameRenderResourcePath('/render/APP/MyApp', launch), false, 'dropping the pinned identifier is blocked')
}

console.log('render-path-identity.test.ts passed')
