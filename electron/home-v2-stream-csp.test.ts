import assert from 'node:assert/strict'
import { allowHomeV2ResourceStreamInCsp } from './home-v2-stream-csp.js'

// The node's real render CSP (observed 2026-09-01): img-src/connect-src exist,
// media-src exists — every stream directive gains the scheme.
{
  const relaxed = allowHomeV2ResourceStreamInCsp(
    "default-src 'self' 'unsafe-inline' 'unsafe-eval'; font-src 'self' data:; media-src 'self' data: blob: http://127.0.0.1:* http://localhost:*; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' blob:",
  )
  assert.match(relaxed, /img-src 'self' data: blob: qortium-home-resource:/)
  assert.match(relaxed, /connect-src 'self' blob: qortium-home-resource:/)
  assert.match(relaxed, /media-src [^;]*qortium-home-resource:/)
  assert.match(relaxed, /font-src 'self' data:(;|$)/)
}

// 'none' must be replaced, never joined.
assert.equal(
  allowHomeV2ResourceStreamInCsp("img-src 'none'; connect-src 'none'"),
  "img-src qortium-home-resource:; connect-src qortium-home-resource:; media-src 'self' qortium-home-resource:",
)

// Missing directives are created from default-src so they do not silently
// inherit a default that excludes the scheme.
{
  const relaxed = allowHomeV2ResourceStreamInCsp("default-src 'self'")
  for (const directive of ['connect-src', 'img-src', 'media-src']) {
    assert.match(relaxed, new RegExp(`${directive} 'self' qortium-home-resource:`))
  }
}

// Idempotent, and an empty policy stays untouched.
{
  const once = allowHomeV2ResourceStreamInCsp("img-src 'self'")
  assert.equal(allowHomeV2ResourceStreamInCsp(once), once)
}
assert.equal(allowHomeV2ResourceStreamInCsp(''), '')

console.log('home-v2-stream-csp.test: ok')
