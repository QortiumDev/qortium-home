import assert from 'node:assert/strict'
import {
  isFullySyncedQortalStatus,
  parseQortalNodeSettings,
  QORTAL_PUBLIC_NODE_API_URLS,
  resolveQortalNodePolicy,
  selectQortalPublicNode,
} from './qortal-node-policy.js'

assert.deepEqual(QORTAL_PUBLIC_NODE_API_URLS, [
  'https://ext-node.qortal.link',
  'https://api.qortal.org',
])

const syncedStatus = {
  height: 2_000_000,
  isSynchronizing: false,
  syncBlocksRemaining: 0,
  syncPercent: 100,
  syncPhase: 'SYNCED',
}

assert.equal(isFullySyncedQortalStatus(syncedStatus), true)
assert.equal(
  isFullySyncedQortalStatus({
    height: 2_680_538,
    isSynchronizing: false,
    numberOfConnections: 220,
    syncPercent: 100,
  }),
  true,
)
assert.equal(
  isFullySyncedQortalStatus({ ...syncedStatus, syncBlocksRemaining: 1 }),
  false,
)
assert.equal(
  isFullySyncedQortalStatus({ ...syncedStatus, syncPhase: 'SYNCING' }),
  false,
)

assert.deepEqual(parseQortalNodeSettings({ mode: 'disabled' }), {
  customUrl: '',
  mode: 'disabled',
})
assert.deepEqual(
  parseQortalNodeSettings({ mode: 'custom', customUrl: 'node.example:12391' }),
  { customUrl: 'https://node.example:12391', mode: 'custom' },
)

await assert.rejects(
  resolveQortalNodePolicy(
    { customUrl: '', mode: 'disabled' },
    {
      localUrl: 'http://127.0.0.1:12391',
      resolvePublic: async () => 'https://public.example',
    },
  ),
  (error: unknown) => {
    assert.equal((error as { code?: unknown }).code, 'NODE_DISABLED')
    return true
  },
)
assert.deepEqual(
  await resolveQortalNodePolicy(
    { customUrl: '', mode: 'local' },
    {
      localUrl: 'http://127.0.0.1:12391',
      resolvePublic: async () => 'https://public.example',
    },
  ),
  { mode: 'local', nodeApiUrl: 'http://127.0.0.1:12391' },
)
assert.deepEqual(
  await resolveQortalNodePolicy(
    {
      customUrl: 'https://custom.example:12391',
      mode: 'custom',
    },
    {
      localUrl: 'http://127.0.0.1:12391',
      resolvePublic: async () => 'https://public.example',
    },
  ),
  { mode: 'custom', nodeApiUrl: 'https://custom.example:12391' },
)

const attempts: string[] = []
const selected = await selectQortalPublicNode(
  ['https://low.example', 'https://high.example', 'https://stale.example'],
  async (url) => {
    attempts.push(url)
    if (url.includes('stale')) {
      return {
        isSynced: false,
        latencyMs: 1,
        status: { ...syncedStatus, height: 2_100_000, syncPercent: 90 },
        supportsPublicReads: true,
        url,
      }
    }
    return {
      isSynced: true,
      latencyMs: url.includes('high') ? 40 : 120,
      status: {
        ...syncedStatus,
        height: url.includes('high') ? 2_050_000 : 2_000_000,
      },
      supportsPublicReads: true,
      url,
    }
  },
)
assert.equal(selected?.url, 'https://high.example')
assert.deepEqual(attempts, [
  'https://low.example',
  'https://high.example',
  'https://stale.example',
])

let disabledProbeCalls = 0
await assert.rejects(
  resolveQortalNodePolicy(
    { customUrl: '', mode: 'disabled' },
    {
      localUrl: 'http://127.0.0.1:12391',
      resolvePublic: async () => {
        disabledProbeCalls += 1
        return 'https://public.example'
      },
    },
  ),
)
assert.equal(disabledProbeCalls, 0)

assert.equal(
  await selectQortalPublicNode(['https://unusable.example'], async (url) => {
    disabledProbeCalls += 1
    return {
      isSynced: true,
      latencyMs: 1,
      status: syncedStatus,
      supportsPublicReads: false,
      url,
    }
  }),
  null,
)
assert.equal(disabledProbeCalls, 1)

console.log('qortal node settings contract tests passed')
