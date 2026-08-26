import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createDefaultQdnAppRolesStore,
  grantQdnAccountCapability,
  grantQdnAppCapability,
  listQdnAccountCapabilityGrants,
  resolveQdnCapabilityIdentifier,
  revokeQdnAccountCapability,
  sanitizeQdnCapabilityPrincipal,
  sanitizeQdnGrantAccountId,
  sanitizeQdnAppRolesStore,
  storeHoldsQdnAccountCapability,
  storeHoldsQdnAppCapability,
} from './qdn-manager-permissions.js'
import {
  canReuseQdnViewEntry,
  getQdnViewPartition,
} from './qdn-view-security-context.js'

// --- The identifier resolver must agree with the runtime, vector for vector ---
{
  // Same fixture the render-path twins and the Android QdnRenderProxy use. If
  // the grant principal ever disagreed with this, a durable grant would be
  // keyed to a different resource than the one Core actually serves.
  const fixturePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../src/shared-fixtures/qdn-render-candidate-identifier-vectors.json',
  )
  const vectors = JSON.parse(readFileSync(fixturePath, 'utf8')) as readonly {
    description: string
    path: string
    queryIdentifier: string | null
    expected: string | null
  }[]
  assert.ok(vectors.length > 0, 'identifier vectors must not be empty')
  for (const vector of vectors) {
    // /render/APP/<name>[/<identifier>[/...]] -> the identifier position only.
    const segments = vector.path.split('/').filter(Boolean)
    const pathIdentifier = segments.length > 3 ? segments[3] : null
    assert.equal(
      resolveQdnCapabilityIdentifier(pathIdentifier, vector.queryIdentifier),
      vector.expected,
      vector.description,
    )
  }
}

// --- R4-4: GAME resources can hold a durable grant ---
{
  // Home opens APP, WEBSITE and GAME as app tabs, so all three can reach a
  // capability prompt. The principal pattern used to allow only APP|WEBSITE,
  // which made persisting a GAME app's grant THROW — failing the very action
  // the user had just approved. Granting for a GAME app must not throw.
  assert.equal(sanitizeQdnCapabilityPrincipal('qdn://GAME/Arena/Arena'), 'qdn://GAME/Arena/Arena')
  assert.equal(sanitizeQdnCapabilityPrincipal('qdn://GAME/Arena/default'), 'qdn://GAME/Arena')
  assert.equal(sanitizeQdnCapabilityPrincipal('qortal://GAME/Arena/Arena'), 'qortal://GAME/Arena/Arena')
  assert.equal(sanitizeQdnCapabilityPrincipal('qdn://WEBSITE/Blog/default'), 'qdn://WEBSITE/Blog')

  // The service stays part of the principal, so a GAME and an APP published
  // under the same name never borrow each other's grants.
  assert.notEqual(
    sanitizeQdnCapabilityPrincipal('qdn://GAME/Arena/Arena'),
    sanitizeQdnCapabilityPrincipal('qdn://APP/Arena/Arena'),
  )

  // A real durable grant round-trips for a GAME principal.
  const store = grantQdnAccountCapability(
    createDefaultQdnAppRolesStore(),
    'qdn://GAME/Arena/Arena',
    'wallet:QAAA',
    'account.read',
  )
  assert.equal(
    storeHoldsQdnAccountCapability(store, 'qdn://GAME/Arena/Arena', 'wallet:QAAA', 'account.read'),
    true,
  )
  assert.equal(
    storeHoldsQdnAccountCapability(store, 'qdn://APP/Arena/Arena', 'wallet:QAAA', 'account.read'),
    false,
    'a same-named APP must not inherit the GAME resource grant',
  )
  // And survives the store's own re-canonicalizing read-back.
  const reloaded = sanitizeQdnAppRolesStore(JSON.parse(JSON.stringify(store)))
  assert.equal(
    storeHoldsQdnAccountCapability(reloaded, 'qdn://GAME/Arena/Arena', 'wallet:QAAA', 'account.read'),
    true,
  )

  // Viewer services are still refused a principal outright.
  assert.throws(
    () => sanitizeQdnCapabilityPrincipal('qdn://IMAGE/Gallery/photo'),
    /APP, WEBSITE, or GAME/,
  )
}

// --- FIX 1: `?identifier=` must not be collapsed away ---
{
  const base = sanitizeQdnCapabilityPrincipal('qdn://APP/Chat/default')
  const evil = sanitizeQdnCapabilityPrincipal('qdn://APP/Chat/default?identifier=evil')
  assert.notEqual(
    base,
    evil,
    'a nonblank ?identifier= names a DIFFERENT resource and must not share a grant',
  )
  assert.equal(base, 'qdn://APP/Chat')
  assert.equal(evil, 'qdn://APP/Chat/evil')

  // A blank or whitespace-only override falls back to the path identifier.
  assert.equal(sanitizeQdnCapabilityPrincipal('qdn://APP/Chat/docs?identifier='), 'qdn://APP/Chat/docs')
  assert.equal(sanitizeQdnCapabilityPrincipal('qdn://APP/Chat/docs?identifier=%20'), 'qdn://APP/Chat/docs')

  // Exactly 'default' is the no-identifier sentinel. Core reserves only the
  // lowercase string, so 'DEFAULT' names a real, distinct resource and must
  // never collapse onto the base principal.
  assert.equal(sanitizeQdnCapabilityPrincipal('qdn://APP/Chat/default'), 'qdn://APP/Chat')
  assert.equal(sanitizeQdnCapabilityPrincipal('qdn://APP/Chat/DEFAULT'), 'qdn://APP/Chat/DEFAULT')
  assert.equal(sanitizeQdnCapabilityPrincipal('qdn://APP/Chat/Default'), 'qdn://APP/Chat/Default')
  assert.notEqual(
    sanitizeQdnCapabilityPrincipal('qdn://APP/Chat/DEFAULT'),
    sanitizeQdnCapabilityPrincipal('qdn://APP/Chat/default'),
  )
  // The sentinel applies to whichever value wins, query or path. Applying it
  // to only one made canonicalization non-idempotent, and the store
  // re-canonicalizes on read, so the second pass moved the grant.
  assert.equal(sanitizeQdnCapabilityPrincipal('qdn://APP/Chat?identifier=default'), 'qdn://APP/Chat')
  assert.equal(
    sanitizeQdnCapabilityPrincipal('qdn://APP/Chat?identifier=DEFAULT'),
    'qdn://APP/Chat/DEFAULT',
  )
  assert.equal(
    sanitizeQdnCapabilityPrincipal('qdn://APP/Chat/docs?identifier=default'),
    'qdn://APP/Chat',
  )

  // An identifier that could not survive re-parsing is refused outright rather
  // than stored under a key the sanitizer would later drop.
  assert.throws(
    () => sanitizeQdnCapabilityPrincipal('qdn://APP/Chat?identifier=%20evil'),
    /identifier is invalid/,
  )

  // Route, hash and unrelated query parameters do NOT change the principal, so
  // a grant follows the app across its own navigation.
  const canonical = 'qdn://APP/Chat/docs'
  for (const variant of [
    'qdn://APP/Chat/docs',
    'qdn://APP/Chat/docs/room/7',
    'qdn://APP/Chat/docs#/thread/9',
    'qdn://APP/Chat/docs?theme=dark',
    'qdn://APP/Chat/docs/room/7?theme=dark#/thread/9',
  ]) {
    assert.equal(sanitizeQdnCapabilityPrincipal(variant), canonical, variant)
  }
}

// --- FIX 3: both schemes are accepted, and never cross ---
{
  assert.equal(sanitizeQdnCapabilityPrincipal('qortal://APP/Chat/docs'), 'qortal://APP/Chat/docs')
  assert.equal(sanitizeQdnCapabilityPrincipal('QORTAL://app/Chat/docs'), 'qortal://APP/Chat/docs')
  assert.notEqual(
    sanitizeQdnCapabilityPrincipal('qortal://APP/Chat/docs'),
    sanitizeQdnCapabilityPrincipal('qdn://APP/Chat/docs'),
  )
  assert.equal(sanitizeQdnCapabilityPrincipal('qdn://WEBSITE/Site'), 'qdn://WEBSITE/Site')

  for (const invalid of [
    '',
    'https://example.com',
    'qdn://OTHER/Chat',
    'qdn://APP',
    'qdn://APP/Chat/has space',
    null,
    17,
  ]) {
    assert.throws(() => sanitizeQdnCapabilityPrincipal(invalid as unknown), /Capability principal/)
  }
}

// --- Account ids ---
{
  assert.equal(sanitizeQdnGrantAccountId('  wallet:QAbc  '), 'wallet:QAbc')
  assert.equal(sanitizeQdnGrantAccountId('wallet:QAbc:2'), 'wallet:QAbc:2')
  for (const invalid of ['', '   ', '__proto__', 'a\u0000b', null, {}]) {
    assert.throws(() => sanitizeQdnGrantAccountId(invalid as unknown), /Grant account/)
  }
}

// --- FIX 2: the durable read grant is bound to an account ---
{
  const accountA = 'wallet:QAAA'
  const accountB = 'wallet:QBBB'
  const app = 'qdn://APP/Chat/default'

  let store = createDefaultQdnAppRolesStore()
  store = grantQdnAccountCapability(store, app, accountA, 'account.read')

  assert.equal(storeHoldsQdnAccountCapability(store, app, accountA, 'account.read'), true)
  // Switching accounts must re-prompt: the grant does not follow the user.
  assert.equal(
    storeHoldsQdnAccountCapability(store, app, accountB, 'account.read'),
    false,
    'a grant approved under one account must not cover another',
  )
  // And it must not leak to a different resource of the same app.
  assert.equal(
    storeHoldsQdnAccountCapability(store, `${app}?identifier=evil`, accountA, 'account.read'),
    false,
    'a ?identifier= resource must not inherit the default resource grant',
  )
  // Route-only differences are the SAME principal, so the grant still applies.
  assert.equal(
    storeHoldsQdnAccountCapability(store, `${app}/room/7#/x`, accountA, 'account.read'),
    true,
  )
  // Cross-scheme lookup misses.
  assert.equal(
    storeHoldsQdnAccountCapability(store, 'qortal://APP/Chat/default', accountA, 'account.read'),
    false,
  )

  // Granting for the second account is additive, and revoking one leaves the
  // other alone.
  store = grantQdnAccountCapability(store, app, accountB, 'account.read')
  assert.deepEqual(
    listQdnAccountCapabilityGrants(store, 'account.read').map(({ accountId }) => accountId),
    [accountA, accountB],
  )
  store = revokeQdnAccountCapability(store, app, accountA, 'account.read')
  assert.equal(storeHoldsQdnAccountCapability(store, app, accountA, 'account.read'), false)
  assert.equal(storeHoldsQdnAccountCapability(store, app, accountB, 'account.read'), true)
  store = revokeQdnAccountCapability(store, app, accountB, 'account.read')
  assert.deepEqual(listQdnAccountCapabilityGrants(store, 'account.read'), [])

  // The account-scoped store is separate from the app-scoped one: an
  // account.read grant is never visible as a chat.send grant and vice versa.
  let mixed = grantQdnAppCapability(createDefaultQdnAppRolesStore(), app, 'chat.send')
  mixed = grantQdnAccountCapability(mixed, app, accountA, 'account.read')
  assert.equal(storeHoldsQdnAppCapability(mixed, app, 'chat.send'), true)
  assert.equal(storeHoldsQdnAccountCapability(mixed, app, accountA, 'account.read'), true)
  assert.equal(
    storeHoldsQdnAppCapability(mixed, app, 'account.read'),
    false,
    'the account-scoped grant must not be readable from the app-scoped map',
  )
}

// --- Round-trips through persistence, for both schemes ---
{
  const accountId = 'wallet:QAAA:3'
  for (const app of ['qdn://APP/Chat/docs', 'qortal://APP/Chat/docs']) {
    let store = grantQdnAccountCapability(createDefaultQdnAppRolesStore(), app, accountId, 'account.read')
    const reloaded = sanitizeQdnAppRolesStore(JSON.parse(JSON.stringify(store)))
    assert.equal(
      storeHoldsQdnAccountCapability(reloaded, app, accountId, 'account.read'),
      true,
      `${app} must survive a store round-trip`,
    )
    store = revokeQdnAccountCapability(reloaded, app, accountId, 'account.read')
    assert.equal(storeHoldsQdnAccountCapability(store, app, accountId, 'account.read'), false)
  }
}

// --- Hostile / legacy stored shapes are dropped rather than trusted ---
{
  const reloaded = sanitizeQdnAppRolesStore({
    ...createDefaultQdnAppRolesStore(),
    accountCapabilityGrants: {
      // Not canonical: must be dropped, not silently honored for the default
      // resource of the same app.
      'qdn://APP/Chat/default?identifier=evil': {
        'wallet:QAAA': { 'account.read': { grantedAt: '2026-08-25T10:00:00.000Z' } },
      },
      'not-a-url': {
        'wallet:QAAA': { 'account.read': { grantedAt: '2026-08-25T10:00:00.000Z' } },
      },
      'qdn://APP/Ok/docs': {
        // Computed so this is a real own property rather than a prototype
        // assignment, which is what a hostile store file would contain.
        ['__proto__']: { 'account.read': { grantedAt: '2026-08-25T10:00:00.000Z' } },
        'wallet:QAAA': { 'chat.send': { grantedAt: '2026-08-25T10:00:00.000Z' } },
        'wallet:QBBB': { 'account.read': { grantedAt: 'not-a-date' } },
        'wallet:QCCC': { 'account.read': { grantedAt: '2026-08-25T10:00:00.000Z' } },
      },
    },
  })
  // The non-canonical key re-canonicalizes to qdn://APP/Chat/evil rather than
  // to the default resource, so it can never widen the default's grant.
  assert.equal(
    storeHoldsQdnAccountCapability(reloaded, 'qdn://APP/Chat/default', 'wallet:QAAA', 'account.read'),
    false,
  )
  assert.equal(
    storeHoldsQdnAccountCapability(reloaded, 'qdn://APP/Chat/evil', 'wallet:QAAA', 'account.read'),
    true,
  )
  // Only the well-formed account.read grant survives on the third app.
  assert.deepEqual(
    listQdnAccountCapabilityGrants(reloaded, 'account.read')
      .filter(({ appKey }) => appKey === 'qdn://APP/Ok/docs')
      .map(({ accountId }) => accountId),
    ['wallet:QCCC'],
  )
  assert.equal(Object.hasOwn(reloaded.accountCapabilityGrants, 'not-a-url'), false)
}

// --- A v2 store with no account grants at all still loads ---
{
  const legacy = createDefaultQdnAppRolesStore() as Record<string, unknown>
  delete legacy.accountCapabilityGrants
  const reloaded = sanitizeQdnAppRolesStore(legacy)
  assert.deepEqual(reloaded.accountCapabilityGrants, {})
  assert.equal(
    storeHoldsQdnAccountCapability(reloaded, 'qdn://APP/Chat/docs', 'wallet:QAAA', 'account.read'),
    false,
  )
}

// --- FIX A: canonicalization is idempotent ---
{
  // Property: for every principal the sanitizer accepts, sanitizing it again
  // is a no-op. The store re-canonicalizes stored keys on read, so a
  // non-idempotent sanitizer silently relocates a grant to a principal the
  // user never approved.
  const fixturePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../src/shared-fixtures/qdn-render-candidate-identifier-vectors.json',
  )
  const vectors = JSON.parse(readFileSync(fixturePath, 'utf8')) as readonly {
    path: string
    queryIdentifier: string | null
  }[]
  const candidates: string[] = []
  for (const vector of vectors) {
    const segments = vector.path.split('/').filter(Boolean)
    const name = segments[2] ?? 'App'
    const rest = segments.slice(3).join('/')
    const query = vector.queryIdentifier === null
      ? ''
      : `?identifier=${encodeURIComponent(vector.queryIdentifier)}`
    for (const scheme of ['qdn', 'qortal']) {
      candidates.push(`${scheme}://APP/${name}${rest ? `/${rest}` : ''}${query}`)
    }
  }
  candidates.push(
    'qdn://APP/Chat',
    'qdn://APP/Chat/default',
    'qdn://APP/Chat/DEFAULT',
    'qdn://APP/Chat/Default',
    'qdn://APP/Chat?identifier=default',
    'qdn://APP/Chat?identifier=DEFAULT',
    'qdn://APP/Chat/default?identifier=DEFAULT',
    'qdn://APP/Chat/DEFAULT?identifier=default',
    'qdn://APP/Chat/docs/room/7?theme=dark#/thread/9',
    'qdn://APP/Chat/docs?identifier=',
    'qdn://WEBSITE/Site/index',
    'QORTAL://app/Chat/DOCS#/x',
    'qdn://APP/Chat/%E2%9C%93',
  )
  let checked = 0
  for (const candidate of candidates) {
    let once: string
    try {
      once = sanitizeQdnCapabilityPrincipal(candidate)
    } catch {
      // A refused principal is fine; idempotency only has to hold for the
      // principals that can actually be stored.
      continue
    }
    assert.equal(
      sanitizeQdnCapabilityPrincipal(once),
      once,
      `sanitize must be idempotent for ${candidate}`,
    )
    checked += 1
  }
  assert.ok(checked >= vectors.length, 'idempotency must cover the fixture vectors')
}

// --- FIX A: DEFAULT and default are distinct end to end ---
{
  const accountId = 'wallet:QAAA'
  const upper = 'qdn://APP/Chat/DEFAULT'
  const lower = 'qdn://APP/Chat/default'

  let store = grantQdnAccountCapability(createDefaultQdnAppRolesStore(), upper, accountId, 'account.read')
  // The grant is held for the DEFAULT resource and NOT for the base resource
  // that a lowercase 'default' path resolves to.
  assert.equal(storeHoldsQdnAccountCapability(store, upper, accountId, 'account.read'), true)
  assert.equal(
    storeHoldsQdnAccountCapability(store, lower, accountId, 'account.read'),
    false,
    'a grant for .../DEFAULT must not be held by the no-identifier base resource',
  )
  assert.equal(
    storeHoldsQdnAccountCapability(store, 'qdn://APP/Chat', accountId, 'account.read'),
    false,
  )
  // ...and it survives a store round-trip under its OWN key rather than being
  // re-canonicalized onto the base principal.
  const reloaded = sanitizeQdnAppRolesStore(JSON.parse(JSON.stringify(store)))
  assert.deepEqual(
    listQdnAccountCapabilityGrants(reloaded, 'account.read').map(({ appKey }) => appKey),
    [upper],
  )
  assert.equal(storeHoldsQdnAccountCapability(reloaded, upper, accountId, 'account.read'), true)
  assert.equal(storeHoldsQdnAccountCapability(reloaded, lower, accountId, 'account.read'), false)

  // The reverse direction: a grant for the base resource does not cover
  // .../DEFAULT either.
  store = grantQdnAccountCapability(createDefaultQdnAppRolesStore(), lower, accountId, 'account.read')
  assert.equal(storeHoldsQdnAccountCapability(store, lower, accountId, 'account.read'), true)
  assert.equal(storeHoldsQdnAccountCapability(store, upper, accountId, 'account.read'), false)
}

// --- A view is only reused within one app's own security context ---
//
// The Chromium partition a view is CREATED with carries that app's cookies,
// localStorage and IndexedDB, and a view keeps its partition for life. Reusing
// a view whose app changed (OPEN_CURRENT_TAB) would therefore hand the
// incoming app the outgoing app's browser storage. canReuseQdnViewEntry is the
// gate that stops that; anything it refuses is destroyed and rebuilt the way a
// freshly opened tab is.
{
  const node = 'http://127.0.0.1:24891'
  const chat = 'qdn://APP/Alice/chat'
  const trust = 'qdn://APP/Bob/trust'

  // The ordinary case: same tab, same app, re-shown after a resize, a zoom or
  // a suspend/restore. Must reuse, or all of those would reload the app.
  assert.equal(
    canReuseQdnViewEntry({ nodeOrigin: node, resourceUrl: chat }, { nodeOrigin: node, resourceUrl: chat }),
    true,
  )
  // A different app in the same tab is a different security context.
  assert.equal(
    canReuseQdnViewEntry({ nodeOrigin: node, resourceUrl: chat }, { nodeOrigin: node, resourceUrl: trust }),
    false,
    'a replacement by a different app must never inherit the previous app view',
  )
  // Same app, different node: rebuilt before this change, still rebuilt.
  assert.equal(
    canReuseQdnViewEntry(
      { nodeOrigin: node, resourceUrl: chat },
      { nodeOrigin: 'http://127.0.0.1:12391', resourceUrl: chat },
    ),
    false,
  )
  // The identifier is part of the principal: `?identifier=` names a DIFFERENT
  // resource the runtime really serves, and it must not borrow the default
  // resource's storage. Same rule the durable-grant principal enforces above —
  // deliberately the same function.
  assert.equal(
    canReuseQdnViewEntry(
      { nodeOrigin: node, resourceUrl: 'qdn://APP/Alice/default' },
      { nodeOrigin: node, resourceUrl: 'qdn://APP/Alice/default?identifier=evil' },
    ),
    false,
  )
  // Cross-chain: same name, different source chain, never one context.
  assert.equal(
    canReuseQdnViewEntry(
      { nodeOrigin: node, resourceUrl: 'qdn://APP/Alice/chat' },
      { nodeOrigin: node, resourceUrl: 'qortal://APP/Alice/chat' },
    ),
    false,
  )
  // Fails closed: a resource URL that cannot be canonicalized cannot be proven
  // to name the same app, so it is rebuilt — EXCEPT when byte-identical, which
  // is what widget and null-resource views rely on.
  assert.equal(
    canReuseQdnViewEntry({ nodeOrigin: node, resourceUrl: null }, { nodeOrigin: node, resourceUrl: null }),
    true,
  )
  assert.equal(
    canReuseQdnViewEntry({ nodeOrigin: node, resourceUrl: null }, { nodeOrigin: node, resourceUrl: chat }),
    false,
  )
  assert.equal(
    canReuseQdnViewEntry(
      { nodeOrigin: node, resourceUrl: 'not-a-qdn-url' },
      { nodeOrigin: node, resourceUrl: 'also-not-a-qdn-url' },
    ),
    false,
  )
  // Two apps must never share a partition — the property the reuse gate exists
  // to protect.
  assert.notEqual(getQdnViewPartition(node, chat), getQdnViewPartition(node, trust))
  assert.equal(getQdnViewPartition(node, chat), getQdnViewPartition(node, chat))
}

// --- Partition names are digests, so they cannot collide ---
//
// The partition name used to be the resource URL with unsafe characters
// replaced by '_' and the result truncated to 60 characters. Neither step is
// injective, so two DIFFERENT apps could be handed one partition name — and a
// shared partition is a shared cookie jar, localStorage and IndexedDB. These
// are the two collision shapes that construction allowed.
{
  const node = 'http://127.0.0.1:24891'
  const chatUrl = 'qdn://APP/Alice/chat'
  const partitionOf = (resourceUrl: string) => getQdnViewPartition(node, resourceUrl)

  // 1. TRUNCATION. 'qdn://APP/' is 10 characters, so a 50-character name fills
  //    the old 60-character budget exactly, and everything after it — the part
  //    saying WHICH resource — used to be cut off.
  const longName = 'a'.repeat(50)
  const truncatedOne = `qdn://APP/${longName}/one`
  const truncatedTwo = `qdn://APP/${longName}/two`
  assert.equal(
    truncatedOne.slice(0, 60),
    truncatedTwo.slice(0, 60),
    'fixture check: these two differ only past the old 60-character cut',
  )
  assert.notEqual(
    partitionOf(truncatedOne),
    partitionOf(truncatedTwo),
    'apps differing only past the old truncation point must not share a partition',
  )

  // 2. CHARACTER REPLACEMENT. '~' and '!' were both outside the old safe set
  //    and both rewritten to '_', collapsing two distinct identifiers onto one
  //    name.
  const foldedOne = 'qdn://APP/Alice/a~b'
  const foldedTwo = 'qdn://APP/Alice/a!b'
  const oldFold = (value: string) => value.replace(/[^a-z0-9:/._-]/gi, '_').slice(0, 60)
  assert.equal(
    oldFold(foldedOne),
    oldFold(foldedTwo),
    'fixture check: these two folded onto one name under the old scheme',
  )
  assert.notEqual(
    partitionOf(foldedOne),
    partitionOf(foldedTwo),
    'apps differing only in characters the old scheme folded must not share a partition',
  )

  // Stability: the same app on the same node keeps one partition across tabs,
  // windows and restarts, or apps would lose their storage constantly.
  assert.equal(partitionOf(chatUrl), partitionOf(chatUrl))
  // ...and the node origin still separates partitions.
  assert.notEqual(
    getQdnViewPartition(node, chatUrl),
    getQdnViewPartition('http://127.0.0.1:12391', chatUrl),
  )
  // Derived from the canonical PRINCIPAL, so an app navigating within itself
  // (same resource, different route) keeps its storage — the same rule that
  // keeps its durable grant.
  assert.equal(
    partitionOf('qdn://APP/Alice/apps'),
    partitionOf('qdn://APP/Alice/apps/browse?tab=1#/x'),
  )

  // The name is exactly a SHA-256 over the JSON-encoded identity, recomputed
  // here independently: this pins the derivation, not merely its shape.
  const expected = createHash('sha256')
    .update(JSON.stringify([node, 'principal', 'qdn://APP/Alice/apps']), 'utf8')
    .digest('hex')
  assert.equal(partitionOf('qdn://APP/Alice/apps'), `persist:qdn-${expected}`)
  // Full 256-bit digest: 64 hex characters, never truncated below 128 bits.
  assert.match(partitionOf(chatUrl), /^persist:qdn-[0-9a-f]{64}$/)
  // A resource URL that cannot be canonicalized is tagged apart from a
  // principal, so a raw URL can never be crafted to hash into an app's
  // partition, and two different unparseable URLs stay apart.
  assert.notEqual(partitionOf('qdn://APP/Alice/apps'), getQdnViewPartition(node, null))
  assert.notEqual(partitionOf('not-a-qdn-url'), partitionOf('also-not-a-qdn-url'))
}

// The replacement path must route through view DESTRUCTION, not a partial
// state reset: a reused view keeps its partition no matter what is later
// assigned to entry.resourceUrl.
{
  // Resolved from either the source tree or dist-electron, wherever this test
  // is executed from.
  const viewsUrl = ['../electron/qdn-views.ts', './qdn-views.ts']
    .map((candidate) => new URL(candidate, import.meta.url))
    .find((candidate) => existsSync(candidate))
  assert.ok(viewsUrl, 'qdn-views.ts source must be readable for the reuse-gate pin')
  const views = readFileSync(viewsUrl, 'utf8')
  assert.match(
    views,
    /if \(existingEntry && canReuseQdnViewEntry\(existingEntry, request\)\) \{/,
    'qdn-views must gate view reuse on canReuseQdnViewEntry',
  )
  assert.match(
    views,
    /canReuseQdnViewEntry\(existingEntry, request\)\)[\s\S]{0,900}if \(existingEntry\) \{\s*destroyEntry\(existingEntry\);/,
    'a view that cannot be reused must be destroyed before a new one is created',
  )
  assert.doesNotMatch(
    views,
    /existingEntry\.nodeOrigin === request\.nodeOrigin/,
    'node origin alone must no longer decide view reuse',
  )
}

// The partition name must stay a digest. A readable name is what allowed the
// truncation and character-folding collisions above.
{
  const securityContextUrl = [
    '../electron/qdn-view-security-context.ts',
    './qdn-view-security-context.ts',
  ]
    .map((candidate) => new URL(candidate, import.meta.url))
    .find((candidate) => existsSync(candidate))
  assert.ok(securityContextUrl, 'the view security-context source must be readable')
  const securityContext = readFileSync(securityContextUrl, 'utf8')
  assert.match(
    securityContext,
    /createHash\('sha256'\)/,
    'the partition name must be a SHA-256 digest',
  )
  assert.match(
    securityContext,
    /\.digest\('hex'\)/,
    'the digest must be used in full hex, never truncated',
  )
  assert.doesNotMatch(
    securityContext,
    /\.slice\(0, \d+\)/,
    'nothing in the partition derivation may truncate — that was the original collision',
  )
}

console.log('QDN capability principal tests passed')
