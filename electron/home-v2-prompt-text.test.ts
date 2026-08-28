import assert from 'node:assert/strict'

import {
  homeV2AvatarPointerText,
  homeV2PromptText,
  homeV2QuotedPromptText,
  homeV2ResourceCoordinateText,
} from './home-v2-prompt-text.js'

// --- The escape is INJECTIVE -------------------------------------------------
// The backslash is doubled FIRST, so no two inputs can produce the same output.
// That is what stops a crafted value from painting the appearance of other rows.
assert.equal(homeV2PromptText('plain text', 'v'), 'plain text')
assert.equal(homeV2PromptText('a\\b', 'v'), 'a\\\\b', 'a literal backslash is doubled')
assert.equal(homeV2PromptText('a\u0000b', 'v'), 'a\\u0000b', 'C0 controls are escaped')
assert.equal(homeV2PromptText('a\u202eb', 'v'), 'a\\u202eb', 'bidi controls cannot reorder a row')
assert.notEqual(
  homeV2PromptText('\\u202e', 'v'),
  homeV2PromptText('\u202e', 'v'),
  'a literal backslash-u sequence and a real control character stay distinguishable',
)

// The double quote is escaped so QUOTING a value can mean something.
assert.equal(homeV2PromptText('say "hi"', 'v'), 'say \\u0022hi\\u0022')
assert.equal(homeV2QuotedPromptText('(unchanged)', 'v'), '"(unchanged)"')
assert.notEqual(
  homeV2QuotedPromptText('(unchanged)', 'v'),
  '(unchanged)',
  'a value that spells the annotation Home appends cannot render as that annotation',
)
// The forgery this exists to stop: no input can produce the unquoted marker,
// and no input can produce a quoted form that contains a bare quote.
for (const attempt of ['(unchanged)', '"(unchanged)"', 'x" (unchanged)', '\\"']) {
  const quoted = homeV2QuotedPromptText(attempt, 'v')
  assert.equal(quoted.startsWith('"') && quoted.endsWith('"'), true, 'quoting wraps the whole value')
  assert.equal(quoted.slice(1, -1).includes('"'), false, 'no quote survives inside a quoted value')
}

// Over-length values REFUSE rather than truncating: a prompt the user cannot
// read in full is not an approval.
assert.throws(() => homeV2PromptText('x'.repeat(4_001), 'The value'), /too large to display safely/)
assert.equal(homeV2PromptText('x'.repeat(4_000), 'v').length, 4_000, 'the cap itself is allowed')

// --- Coordinates and pointers parse back to exactly one triple ---------------
assert.equal(
  homeV2ResourceCoordinateText({ identifier: 'default', name: 'alice', service: 'WEBSITE' }),
  'WEBSITE/alice/default',
)
assert.equal(
  homeV2ResourceCoordinateText({ name: 'alice', service: 'WEBSITE' }),
  'WEBSITE/alice/default',
  'an absent identifier displays as default',
)
// The ambiguity this fixes: an identifier may legitimately contain '/', and raw
// concatenation would let WEBSITE/alice/b/c read as name "alice/b".
assert.equal(
  homeV2ResourceCoordinateText({ identifier: 'b/c', name: 'alice', service: 'WEBSITE' }),
  'WEBSITE/alice/b\\u002fc',
)
assert.equal(
  homeV2ResourceCoordinateText({ identifier: 'c', name: 'alice/b', service: 'WEBSITE' }),
  'WEBSITE/alice\\u002fb/c',
)
assert.notEqual(
  homeV2ResourceCoordinateText({ identifier: 'b/c', name: 'alice', service: 'WEBSITE' }),
  homeV2ResourceCoordinateText({ identifier: 'c', name: 'alice/b', service: 'WEBSITE' }),
  'two different coordinates can never render identically',
)
assert.equal(
  homeV2ResourceCoordinateText({ identifier: 'b/c', name: 'alice', service: 'WEBSITE' }).split('/').length,
  3,
  'the rendered coordinate always has exactly three components',
)

assert.equal(
  homeV2AvatarPointerText({ identifier: '', name: 'alice', service: 'THUMBNAIL' }),
  'THUMBNAIL/alice/default',
  'an empty avatar identifier displays as default',
)
// The service is NOT upper-cased here: normalization belongs to the selectors
// that read the pointer, and this function only renders what it is given.
assert.equal(
  homeV2AvatarPointerText({ identifier: '', name: 'alice', service: 'thumbnail' }),
  'thumbnail/alice/default',
)
assert.notEqual(
  homeV2AvatarPointerText({ identifier: 'c', name: 'a/b', service: 'THUMBNAIL' }),
  homeV2AvatarPointerText({ identifier: 'b/c', name: 'a', service: 'THUMBNAIL' }),
  'the avatar pointer is injective for the same reason',
)

console.log('Home 2 prompt-text tests passed.')
