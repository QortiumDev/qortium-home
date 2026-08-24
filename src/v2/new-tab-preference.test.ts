import assert from 'node:assert/strict'
import {
  DEFAULT_NEW_TAB_PREFERENCE,
  parseHomeV2CoreDocsAddress,
  parseHomeV2ReleaseNotesAddress,
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
    ['home://releases/home/v2.1.0', 'home://releases/home/v2.1.0'],
    ['core://', 'core://'],
    ['QORTAL-CORE://api-documentation/', 'QORTAL-CORE://api-documentation/'],
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
    'home://releases',
    'home://releases/other/v2.1.0',
    'core://admin/stop',
    'qortal-core://admin/stop',
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
  assert.deepEqual(parseHomeV2ReleaseNotesAddress('HOME://RELEASES/CORE/v1.2.3'), {
    product: 'core',
    tagName: 'v1.2.3',
  })
  assert.deepEqual(parseHomeV2ReleaseNotesAddress('home://releases/home/v2.1.0%2Dbeta.1'), {
    product: 'home',
    tagName: 'v2.1.0-beta.1',
  })
  assert.equal(parseHomeV2ReleaseNotesAddress('home://releases/home/%zz'), null)
  assert.equal(parseHomeV2CoreDocsAddress('core://'), 'qortium')
  assert.equal(parseHomeV2CoreDocsAddress('qortal-core://'), 'qortal')
  assert.equal(parseHomeV2CoreDocsAddress('qortal-core://admin/stop'), null)
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
  assert.equal(fallback.version, 3)
  assert.equal(fallback.appearance.theme, 'dark')
  assert.equal(fallback.appearance.resolvedTheme, 'dark')
  assert.equal(fallback.onboarding.status, 'in-progress')
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
    assert.equal(parsed.version, 3)
    assert.equal(parsed.appearance.theme, 'dark')
    assert.equal(parsed.appearance.resolvedTheme, 'dark')
    assert.equal(parsed.onboarding.status, 'skipped')
    assert.equal(parsed.newTabPreference, DEFAULT_NEW_TAB_PREFERENCE)
  }

  const explicitSystemTheme = parseHomeV2ShellState(
    {
      version: 3,
      appearance: { theme: 'system' },
      product: fallback.product,
    },
    'light',
    'en',
  )
  assert.equal(explicitSystemTheme.appearance.theme, 'system')
  assert.equal(explicitSystemTheme.appearance.resolvedTheme, 'light')

  const explicitLightTheme = parseHomeV2ShellState(
    {
      version: 3,
      appearance: { theme: 'light' },
      product: fallback.product,
    },
    'dark',
    'en',
  )
  assert.equal(explicitLightTheme.appearance.theme, 'light')
  assert.equal(explicitLightTheme.appearance.resolvedTheme, 'light')

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
    assert.equal(serialized.version, 3)
    assert.deepEqual(serialized.newTabPreference, newTabPreference)

    const restored = parseHomeV2ShellState(
      JSON.parse(JSON.stringify(serialized)),
      'dark',
      'en',
    )
    assert.equal(restored.version, 3)
    assert.deepEqual(restored.newTabPreference, newTabPreference)
  }
}

testCustomAddressValidation()
testPreferenceParsingFailsClosed()
testShellStateMigrationAndRoundTrips()

console.log('Home v2 new-tab preference tests passed.')
