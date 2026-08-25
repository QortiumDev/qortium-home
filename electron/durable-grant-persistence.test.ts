import assert from 'node:assert/strict'
import {
  persistDurableGrant,
  persistDurableGrantAsync,
} from './durable-grant-persistence.js'

// A store fake whose write can be made to throw, to succeed, or — the case
// this module exists for — to return normally while persisting nothing.
function createStoreFake(options: { readonly mode: 'drops' | 'throws' | 'works' }) {
  const held = new Set<string>()
  return {
    held,
    isHeld: (key: string) => held.has(key),
    write: (key: string) => {
      if (options.mode === 'throws') throw new Error('capability principal refused')
      // 'drops' persists nothing and reports no error at all.
      if (options.mode === 'works') held.add(key)
    },
  }
}

// --- A grant that really persists is reported as durable ---
{
  const store = createStoreFake({ mode: 'works' })
  const reports: string[] = []
  assert.equal(persistDurableGrant({
    capability: 'chat.send',
    isHeld: () => store.isHeld('app'),
    onFallback: (message) => reports.push(message),
    write: () => store.write('app'),
  }), true)
  assert.deepEqual(reports, [], 'a grant that stuck must not report a fallback')
  assert.equal(store.held.has('app'), true)
}

// --- A write that throws falls back instead of propagating ---
{
  const store = createStoreFake({ mode: 'throws' })
  const reports: string[] = []
  assert.equal(persistDurableGrant({
    capability: 'account.read',
    isHeld: () => store.isHeld('app'),
    onFallback: (message) => reports.push(message),
    write: () => store.write('app'),
  }), false, 'a throwing write must degrade, never deny the approved action')
  assert.equal(reports.length, 1)
  assert.match(reports[0], /account\.read/)
  assert.match(reports[0], /session grant/)
}

// --- The reason this module exists: a SILENT persistence failure ---
{
  // The write returns normally and throws nothing, but the store discarded the
  // key (its own sanitizer refuses the principal on read-back). Without the
  // confirming read the caller would return as though the user's "always"
  // answer had been recorded, and the grant would simply vanish.
  const store = createStoreFake({ mode: 'drops' })
  const reports: string[] = []
  assert.equal(persistDurableGrant({
    capability: 'account.read',
    isHeld: () => store.isHeld('app'),
    onFallback: (message) => reports.push(message),
    write: () => store.write('app'),
  }), false, 'a silently dropped grant must be reported as NOT durable')
  assert.equal(store.held.size, 0)
  assert.equal(reports.length, 1)
}

// --- A false isHeld is never overridden by a successful-looking write ---
{
  let wrote = false
  assert.equal(persistDurableGrant({
    capability: 'chat.send',
    isHeld: () => false,
    onFallback: () => {},
    write: () => { wrote = true },
  }), false)
  assert.equal(wrote, true, 'the write is still attempted before the check')
}

// --- The async twin behaves identically, including on a rejected write ---
{
  const works = createStoreFake({ mode: 'works' })
  assert.equal(await persistDurableGrantAsync({
    capability: 'chat.send',
    isHeld: async () => works.isHeld('app'),
    onFallback: () => { throw new Error('must not report a fallback') },
    write: async () => works.write('app'),
  }), true)

  const drops = createStoreFake({ mode: 'drops' })
  const reports: string[] = []
  assert.equal(await persistDurableGrantAsync({
    capability: 'chat.send',
    isHeld: async () => drops.isHeld('app'),
    onFallback: (message) => reports.push(message),
    write: async () => drops.write('app'),
  }), false)
  assert.equal(reports.length, 1)

  const rejects: string[] = []
  assert.equal(await persistDurableGrantAsync({
    capability: 'chat.send',
    isHeld: async () => true,
    onFallback: (message) => rejects.push(message),
    write: async () => { throw new Error('refused') },
  }), false, 'a rejected async write must degrade even when isHeld would pass')
  assert.equal(rejects.length, 1)

  // A rejecting isHeld is a failure to confirm, not a durable grant.
  const unreadable: string[] = []
  assert.equal(await persistDurableGrantAsync({
    capability: 'account.read',
    isHeld: async () => { throw new Error('unreadable store') },
    onFallback: (message) => unreadable.push(message),
    write: async () => {},
  }), false)
  assert.equal(unreadable.length, 1)
}

console.log('Durable grant persistence tests passed')
