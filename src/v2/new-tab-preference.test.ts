import assert from 'node:assert/strict'
import {
  DEFAULT_NEW_TAB_PREFERENCE,
  parseNewTabPreference,
  validateCustomNewTabAddress,
} from './new-tab-preference'
import {
  createHomeV2ShellState,
  parseHomeV2ShellState,
  serializeHomeV2ShellState,
} from '../home-v2-live/shell-state'

function testCustomAddressValidation(): void {
  const accepted = [
    ['home://dashboard', 'home://dashboard'],
    [' HOME://NEWTAB/ ', 'HOME://NEWTAB/'],
    ['qdn://APP/QortiumHome', 'qdn://APP/QortiumHome'],
    [
      ' qdn://APP/QortiumHome ',
      'qdn://APP/QortiumHome',
    ],
    [
      'qdn://APP/QortiumHome/default/start?mode=compact#latest',
      'qdn://APP/QortiumHome/default/start?mode=compact#latest',
    ],
    ['qortal://APP/QortalHome', 'qortal://APP/QortalHome'],
  ] as const

  for (const [input, expected] of accepted) {
    assert.equal(validateCustomNewTabAddress(input), expected)
  }

  // A name-only QDN app address is deliberately retained as entered. The
  // address opener may distinguish an omitted identifier from `/default`.
  assert.equal(
    validateCustomNewTabAddress('qdn://APP/NameOnly'),
    'qdn://APP/NameOnly',
  )

  const rejected = [
    '',
    '   ',
    'dashboard',
    'home://unknown',
    'https://example.invalid/app',
    'qdn://',
    'qdn://APP',
    'qdn://WEBSITE/Example',
    'qdn://user:secret@APP/Example',
    'qdn://APP:1234/Example',
    `qdn://APP/${'a'.repeat(129)}`,
    `qdn://APP/Example/${'b'.repeat(129)}`,
    `qdn://APP/Example/${'c'.repeat(2_001)}`,
  ]

  for (const input of rejected) {
    assert.throws(
      () => validateCustomNewTabAddress(input),
      Error,
      `expected custom new-tab address to be rejected: ${input.slice(0, 80)}`,
    )
  }
}

function testPreferenceParsingFailsClosed(): void {
  assert.equal(parseNewTabPreference(null), DEFAULT_NEW_TAB_PREFERENCE)
  assert.equal(parseNewTabPreference({ kind: 'search' }), DEFAULT_NEW_TAB_PREFERENCE)
  assert.deepEqual(parseNewTabPreference({ kind: 'dashboard' }), {
    kind: 'dashboard',
  })
  assert.deepEqual(
    parseNewTabPreference({
      kind: 'custom',
      address: ' qdn://APP/NameOnly ',
    }),
    {
      kind: 'custom',
      address: 'qdn://APP/NameOnly',
    },
  )

  for (const invalid of [
    undefined,
    'dashboard',
    [],
    {},
    { kind: 'custom' },
    { kind: 'custom', address: 42 },
    { kind: 'custom', address: 'https://example.invalid' },
    { kind: 'other', address: 'qdn://APP/Example' },
  ]) {
    assert.equal(parseNewTabPreference(invalid), DEFAULT_NEW_TAB_PREFERENCE)
  }
}

function testShellStateMigrationAndRoundTrips(): void {
  const fallback = createHomeV2ShellState('light', 'en')
  assert.equal(fallback.version, 2)
  assert.equal(fallback.newTabPreference, DEFAULT_NEW_TAB_PREFERENCE)

  for (const stored of [
    {
      version: 1,
      appearance: {},
      product: fallback.product,
    },
    {
      version: 2,
      appearance: {},
      product: fallback.product,
    },
    {
      version: 2,
      appearance: {},
      newTabPreference: { kind: 'custom', address: 'javascript:alert(1)' },
      product: fallback.product,
    },
  ]) {
    const parsed = parseHomeV2ShellState(stored, 'light', 'en')
    assert.equal(parsed.version, 2)
    assert.equal(parsed.newTabPreference, DEFAULT_NEW_TAB_PREFERENCE)
  }

  const preferences = [
    DEFAULT_NEW_TAB_PREFERENCE,
    { kind: 'dashboard' } as const,
    { kind: 'custom', address: 'qdn://APP/NameOnly' } as const,
  ]
  for (const newTabPreference of preferences) {
    const serialized = serializeHomeV2ShellState({
      ...fallback,
      newTabPreference,
    })
    assert.equal(serialized.version, 2)
    assert.deepEqual(serialized.newTabPreference, newTabPreference)

    const restored = parseHomeV2ShellState(
      JSON.parse(JSON.stringify(serialized)),
      'dark',
      'en',
    )
    assert.equal(restored.version, 2)
    assert.deepEqual(restored.newTabPreference, newTabPreference)
  }
}

testCustomAddressValidation()
testPreferenceParsingFailsClosed()
testShellStateMigrationAndRoundTrips()

console.log('Home v2 new-tab preference tests passed.')
