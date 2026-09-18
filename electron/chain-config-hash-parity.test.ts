// Guards electron/core-network-descriptor.ts's compatibilityHashExcludedFields
// against Core's own hash-exclusion rule. core-manager.ts uses that list to
// decide whether two previewchain.json files are "the same chain config" for
// runtime-data reuse (getCoreCompatiblePreviewChainSha256): it strips the
// listed fields, canonicalizes the remaining JSON (recursive key sort, no
// whitespace) and sha256's it. That must answer the same question Core's own
// getChainConfigHash() answers, or Home can decide two configs are
// compatible when Core would treat them as different (or vice versa).
//
// Fixture: org.qortium.block.BlockChain, qortium-core commit 6eade4fc0.
//   private static final Set<String> CHAIN_CONFIG_HASH_EXCLUDED_FIELDS = Set.of(
//       "checkpoints",
//       "featureTriggers",
//       "featureTriggerScheduleEnforcementHeight");
// Core hashes with Jackson's ObjectMapper configured with
// SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS (recursive key sort on every
// nested object, compact - no extra whitespace) and a single SHA-256
// (org.qortium.crypto.Crypto.digest -> MessageDigest.getInstance("SHA-256")).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { QORTIUM_CORE_DESCRIPTOR } from './core-network-descriptor.js';

const CORE_CHAIN_CONFIG_HASH_EXCLUDED_FIELDS = Object.freeze([
  'checkpoints',
  'featureTriggers',
  'featureTriggerScheduleEnforcementHeight',
]);

// 1. The data fix: Home's list must be exactly Core's list, in the same
// order Core's Set.of(...) literal lists them (order doesn't matter for the
// hash, since both sides key-sort, but keeping it identical here rules out
// "same set, but a stray duplicate/typo slipped in" without needing to sort).
assert.deepEqual(
  QORTIUM_CORE_DESCRIPTOR.chain.compatibilityHashExcludedFields,
  CORE_CHAIN_CONFIG_HASH_EXCLUDED_FIELDS,
  'compatibilityHashExcludedFields must equal Core\'s CHAIN_CONFIG_HASH_EXCLUDED_FIELDS exactly.',
);

// 2. The canonicalization algorithm. This mirrors
// core-manager.ts's private canonicalJsonStringify + getCoreCompatiblePreviewChainSha256
// (recursive key sort, compact JSON, sha256:<hex>) closely enough to catch
// drift in either the field list or the canonical form, without needing to
// export core-manager.ts's internals (it is an Electron-entry module; these
// two helpers have no side effects, so re-implementing them here from their
// documented behaviour is the safer, lower-risk test surface).
function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJsonStringify(entry)).join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

function hashChainConfig(parsedChain: Record<string, unknown>, excludedFields: readonly string[]) {
  const excluded = new Set(excludedFields);
  const compatibleChain: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(parsedChain)) {
    if (!excluded.has(key)) {
      compatibleChain[key] = value;
    }
  }

  return `sha256:${createHash('sha256').update(canonicalJsonStringify(compatibleChain)).digest('hex')}`;
}

// A representative previewchain.json shape carrying all five fields that were
// ever candidates for exclusion, plus fields that should always be hashed.
const baseChain = {
  blockTimingsByHeight: [{ height: 1, target: 60000 }],
  checkpoints: [{ height: 1, signature: 'base58sig' }],
  featureTriggerScheduleEnforcementHeight: 500,
  featureTriggers: { messageHeight: 1 },
  genesisInfo: { timestamp: 0 },
  networkId: 'qortium-previewnet',
  onlineAccountsSignatureV2Height: 100,
  assetOrderBoundsHeight: 250,
};

// 3. Only the three Core actually excludes may change without changing the
// hash. checkpoints/featureTriggers/featureTriggerScheduleEnforcementHeight
// differing must still hash the same (matches Core: still excluded).
const varyOnlyExcludedFields = {
  ...baseChain,
  checkpoints: [{ height: 2, signature: 'different' }],
  featureTriggers: { messageHeight: 999 },
  featureTriggerScheduleEnforcementHeight: 999999,
};

assert.equal(
  hashChainConfig(baseChain, QORTIUM_CORE_DESCRIPTOR.chain.compatibilityHashExcludedFields),
  hashChainConfig(varyOnlyExcludedFields, QORTIUM_CORE_DESCRIPTOR.chain.compatibilityHashExcludedFields),
  'varying only the three Core-excluded fields must not change the hash.',
);

// 4. onlineAccountsSignatureV2Height and assetOrderBoundsHeight are NOT
// excluded by Core, so Home must hash them: this is the exact regression this
// test guards against (Home previously excluded both, silently treating
// configs that differ only in these heights as identical when Core would not).
const differentTriggerHeights = {
  ...baseChain,
  onlineAccountsSignatureV2Height: 101,
  assetOrderBoundsHeight: 251,
};

assert.notEqual(
  hashChainConfig(baseChain, QORTIUM_CORE_DESCRIPTOR.chain.compatibilityHashExcludedFields),
  hashChainConfig(differentTriggerHeights, QORTIUM_CORE_DESCRIPTOR.chain.compatibilityHashExcludedFields),
  'onlineAccountsSignatureV2Height/assetOrderBoundsHeight are not Core-excluded and must change the hash.',
);

// 5. Canonicalization shape: recursive key sort (independent of source key
// order) and compact (no inserted whitespace) - both required for the hash to
// agree with Jackson's ORDER_MAP_ENTRIES_BY_KEYS + default compact writer.
const reordered = {
  networkId: baseChain.networkId,
  genesisInfo: baseChain.genesisInfo,
  assetOrderBoundsHeight: baseChain.assetOrderBoundsHeight,
  onlineAccountsSignatureV2Height: baseChain.onlineAccountsSignatureV2Height,
  featureTriggers: baseChain.featureTriggers,
  featureTriggerScheduleEnforcementHeight: baseChain.featureTriggerScheduleEnforcementHeight,
  checkpoints: baseChain.checkpoints,
  blockTimingsByHeight: baseChain.blockTimingsByHeight,
};

assert.equal(
  hashChainConfig(baseChain, QORTIUM_CORE_DESCRIPTOR.chain.compatibilityHashExcludedFields),
  hashChainConfig(reordered, QORTIUM_CORE_DESCRIPTOR.chain.compatibilityHashExcludedFields),
  'source key order must not affect the hash (Core sorts keys before hashing).',
);

assert.equal(
  canonicalJsonStringify({ b: 1, a: 2 }),
  '{"a":2,"b":1}',
  'canonical form must be compact (no whitespace) with sorted keys.',
);

console.log('Chain config hash exclusion parity tests passed.');
