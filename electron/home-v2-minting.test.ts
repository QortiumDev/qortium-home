import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  buildHomeV2SelfRewardSharesPath,
  createHomeV2MintingAccountsResult,
  createHomeV2RemoveMintingAccountResult,
  createHomeV2StartMintingResult,
  deriveHomeV2MintingStatus,
  hasHomeV2MintingKeyOnNode,
  homeV2MintingOperationLabel,
  isHomeV2MintingAction,
  isHomeV2MintingReadAction,
  isHomeV2MintingWriteAction,
  isHomeV2TrustedMintingNode,
  normalizeHomeV2MintingPublicKey,
  sanitizeHomeV2MintingAccounts,
  selectHomeV2SelfRewardShares,
  HOME_V2_MINTING_READ_ACTIONS,
  HOME_V2_MINTING_WRITE_ACTIONS,
} from './home-v2-minting.js'

const ADDRESS = 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH'
const OTHER = 'QLdBpGnZfP9nSnZ9nSnZ9nSnZ9nSnZ9nSn'
const REWARD_SHARE_KEY = '9NKfLpKvKJGVvLKQ6bYFa6VbTL3cRAHT2eGmSKA3Vd1B'

// ---------------------------------------------------------------------------
// Action classification
// ---------------------------------------------------------------------------

for (const action of HOME_V2_MINTING_READ_ACTIONS) {
  assert.equal(isHomeV2MintingAction(action), true)
  assert.equal(isHomeV2MintingReadAction(action), true)
  assert.equal(isHomeV2MintingWriteAction(action), false, `${action} must not classify as a write.`)
}
for (const action of HOME_V2_MINTING_WRITE_ACTIONS) {
  assert.equal(isHomeV2MintingAction(action), true)
  assert.equal(isHomeV2MintingWriteAction(action), true)
  assert.equal(isHomeV2MintingReadAction(action), false, `${action} must not classify as a read.`)
}
assert.equal(isHomeV2MintingAction('GET_BALANCE'), false)
assert.equal(isHomeV2MintingAction('GET_MINTING'), false)
assert.equal(homeV2MintingOperationLabel('START_MINTING'), 'Start minting')
assert.equal(homeV2MintingOperationLabel('REMOVE_MINTING_ACCOUNT'), 'Remove a minting key')

// ---------------------------------------------------------------------------
// Trusted-node predicate: local Core WITH an API key, nothing else
// ---------------------------------------------------------------------------

assert.equal(isHomeV2TrustedMintingNode({ apiKey: 'abc', mode: 'local' }), true)
assert.equal(isHomeV2TrustedMintingNode({ apiKey: '', mode: 'local' }), false)
for (const mode of ['public', 'custom', 'disabled', 'network']) {
  assert.equal(
    isHomeV2TrustedMintingNode({ apiKey: 'abc', mode }),
    false,
    `${mode} nodes must never be treated as a trusted minting node.`,
  )
}

// ---------------------------------------------------------------------------
// Reward-share selection
// ---------------------------------------------------------------------------

assert.equal(
  buildHomeV2SelfRewardSharesPath(ADDRESS),
  `/addresses/rewardshares?minters=${ADDRESS}&recipients=${ADDRESS}`,
)
assert.equal(buildHomeV2SelfRewardSharesPath('a b').includes('a%20b'), true)

const selfShares = selectHomeV2SelfRewardShares(
  [
    { mintingAccount: ADDRESS, recipient: ADDRESS, rewardSharePublicKey: REWARD_SHARE_KEY, sharePercent: 0 },
    // Home re-checks both sides rather than trusting the node's own filter.
    { mintingAccount: ADDRESS, recipient: OTHER, rewardSharePublicKey: 'other' },
    { mintingAccount: OTHER, recipient: ADDRESS, rewardSharePublicKey: 'other' },
    'not-a-record',
  ],
  ADDRESS,
)
assert.equal(selfShares.length, 1)
assert.equal(selfShares[0].rewardSharePublicKey, REWARD_SHARE_KEY)
assert.equal(selfShares[0].sharePercent, 0)
assert.deepEqual(selectHomeV2SelfRewardShares(null, ADDRESS), [])
assert.deepEqual(selectHomeV2SelfRewardShares({ message: 'no' }, ADDRESS), [])

assert.equal(
  hasHomeV2MintingKeyOnNode(
    [{ mintingAccount: ADDRESS, recipientAccount: ADDRESS }],
    ADDRESS,
  ),
  true,
)
// A share that pays someone else is not this account minting on this node.
assert.equal(
  hasHomeV2MintingKeyOnNode(
    [{ mintingAccount: ADDRESS, recipientAccount: OTHER }],
    ADDRESS,
  ),
  false,
)
assert.equal(hasHomeV2MintingKeyOnNode('nope', ADDRESS), false)

// ---------------------------------------------------------------------------
// Status derivation: non-local nulls, and the four boolean combinations
// ---------------------------------------------------------------------------

const untrusted = deriveHomeV2MintingStatus({
  address: ADDRESS,
  nodeAdmin: null,
  rewardShares: [{ mintingAccount: ADDRESS, recipient: ADDRESS, rewardSharePublicKey: REWARD_SHARE_KEY }],
})
assert.deepEqual({ ...untrusted }, {
  address: ADDRESS,
  hasRewardShare: true,
  isMinting: null,
  keyOnNode: null,
  nodeMintingPossible: null,
})

const mintingNow = deriveHomeV2MintingStatus({
  address: ADDRESS,
  nodeAdmin: {
    mintingAccounts: [{ mintingAccount: ADDRESS, recipientAccount: ADDRESS }],
    status: { isMintingPossible: true },
  },
  rewardShares: [{ mintingAccount: ADDRESS, recipient: ADDRESS, rewardSharePublicKey: REWARD_SHARE_KEY }],
})
assert.deepEqual({ ...mintingNow }, {
  address: ADDRESS,
  hasRewardShare: true,
  isMinting: true,
  keyOnNode: true,
  nodeMintingPossible: true,
})

// Authorized on chain but the key is not loaded on this node.
const keyMissing = deriveHomeV2MintingStatus({
  address: ADDRESS,
  nodeAdmin: { mintingAccounts: [], status: { isMintingPossible: false } },
  rewardShares: [{ mintingAccount: ADDRESS, recipient: ADDRESS }],
})
assert.equal(keyMissing.hasRewardShare, true)
assert.equal(keyMissing.keyOnNode, false)
assert.equal(keyMissing.isMinting, false)
assert.equal(keyMissing.nodeMintingPossible, false)

// Key loaded on the node but no on-chain authorization: not minting.
const shareMissing = deriveHomeV2MintingStatus({
  address: ADDRESS,
  nodeAdmin: {
    mintingAccounts: [{ mintingAccount: ADDRESS, recipientAccount: ADDRESS }],
    status: { isMintingPossible: true },
  },
  rewardShares: [],
})
assert.equal(shareMissing.hasRewardShare, false)
assert.equal(shareMissing.keyOnNode, true)
assert.equal(shareMissing.isMinting, false)

// isMintingPossible is a strict true, never a truthy string.
assert.equal(
  deriveHomeV2MintingStatus({
    address: ADDRESS,
    nodeAdmin: { mintingAccounts: [], status: { isMintingPossible: 'true' } },
    rewardShares: [],
  }).nodeMintingPossible,
  false,
)
assert.equal(
  deriveHomeV2MintingStatus({
    address: ADDRESS,
    nodeAdmin: { mintingAccounts: [], status: 'unavailable' },
    rewardShares: [],
  }).nodeMintingPossible,
  false,
)

// The derived answer is exactly five fields, all booleans or null but for the
// address: nothing from the node payloads is forwarded.
assert.deepEqual(Object.keys(mintingNow).sort(), [
  'address',
  'hasRewardShare',
  'isMinting',
  'keyOnNode',
  'nodeMintingPossible',
])
for (const [key, value] of Object.entries(mintingNow)) {
  if (key === 'address') continue
  assert.equal(
    typeof value === 'boolean' || value === null,
    true,
    `${key} must be a boolean or null.`,
  )
}

// ---------------------------------------------------------------------------
// Minting-account sanitization
// ---------------------------------------------------------------------------

const KEY_LIKE = /priv|secret|seed|mnemonic|passphrase/i

const sanitized = sanitizeHomeV2MintingAccounts([
  {
    address: ADDRESS,
    mintingAccount: ADDRESS,
    publicKey: REWARD_SHARE_KEY,
    recipientAccount: ADDRESS,
    // Everything below must be dropped: the sanitizer rebuilds from an
    // allowlist rather than filtering known-bad names.
    privateKey: 'NEVER',
    mintingAccountPrivateKey: 'NEVER',
    seed: 'NEVER',
    apiKey: 'NEVER',
    nested: { privateKey: 'NEVER' },
  },
  'not-a-record',
  null,
  {},
  { mintingAccount: OTHER },
])
assert.equal(sanitized.length, 2)
assert.deepEqual({ ...sanitized[0] }, {
  address: ADDRESS,
  mintingAccount: ADDRESS,
  publicKey: REWARD_SHARE_KEY,
  recipientAccount: ADDRESS,
})
assert.deepEqual({ ...sanitized[1] }, {
  address: null,
  mintingAccount: OTHER,
  publicKey: null,
  recipientAccount: null,
})
for (const entry of sanitized) {
  for (const key of Object.keys(entry)) {
    assert.equal(KEY_LIKE.test(key), false, `Sanitized entries must not carry ${key}.`)
  }
}
assert.equal(
  KEY_LIKE.test(JSON.stringify(sanitized)),
  false,
  'No key-like field may survive minting-account sanitization.',
)
// Non-string values are normalized to null rather than passed through.
assert.equal(sanitizeHomeV2MintingAccounts([{ publicKey: 12345, address: ADDRESS }])[0].publicKey, null)
assert.deepEqual(sanitizeHomeV2MintingAccounts('nope'), [])
assert.equal(
  sanitizeHomeV2MintingAccounts(
    Array.from({ length: 600 }, () => ({ mintingAccount: ADDRESS })),
  ).length,
  500,
)

const unavailable = createHomeV2MintingAccountsResult({
  accounts: [{ mintingAccount: ADDRESS, privateKey: 'NEVER' }],
  available: false,
})
assert.deepEqual({ ...unavailable }, { accounts: [], available: false })
const availableResult = createHomeV2MintingAccountsResult({
  accounts: [{ mintingAccount: ADDRESS, privateKey: 'NEVER' }],
  available: true,
})
assert.equal(availableResult.available, true)
assert.equal(availableResult.accounts.length, 1)
assert.equal(KEY_LIKE.test(JSON.stringify(availableResult)), false)

// ---------------------------------------------------------------------------
// Request and result shapes
// ---------------------------------------------------------------------------

assert.equal(normalizeHomeV2MintingPublicKey(` ${REWARD_SHARE_KEY} `), REWARD_SHARE_KEY)
for (const invalid of ['', 'short', '0OIl-not-base58-0OIl-not-base58-0OI', 12345, null, `${REWARD_SHARE_KEY}!`]) {
  assert.throws(
    () => normalizeHomeV2MintingPublicKey(invalid),
    /base58-encoded public key/,
    `${String(invalid)} must be rejected.`,
  )
}

const started = createHomeV2StartMintingResult({ address: ADDRESS, keyAdded: true })
assert.deepEqual({ ...started }, {
  accepted: true,
  action: 'START_MINTING',
  address: ADDRESS,
  keyAdded: true,
})
const pending = createHomeV2StartMintingResult({
  address: ADDRESS,
  keyAdded: false,
  rewardSharePending: true,
  transactionSignature: 'sig58',
})
assert.deepEqual({ ...pending }, {
  accepted: true,
  action: 'START_MINTING',
  address: ADDRESS,
  keyAdded: false,
  rewardSharePending: true,
  transactionSignature: 'sig58',
})
assert.deepEqual({ ...createHomeV2RemoveMintingAccountResult(REWARD_SHARE_KEY) }, {
  accepted: true,
  action: 'REMOVE_MINTING_ACCOUNT',
  publicKey: REWARD_SHARE_KEY,
  removed: true,
})

// ---------------------------------------------------------------------------
// Source pins: how the bridge is allowed to reach the node
// ---------------------------------------------------------------------------

function readRepoSource(...candidates: string[]) {
  const url = candidates.map((candidate) => new URL(candidate, import.meta.url)).find((each) => existsSync(each))
  assert.ok(url, `source not found: tried ${candidates.join(', ')}`)
  return readFileSync(url, 'utf8')
}

const bridgeSource = readRepoSource(
  '../electron/home-v2-app-bridge.ts',
  './home-v2-app-bridge.ts',
)
const actionsSource = readRepoSource(
  '../electron/home-v2-app-actions.ts',
  './home-v2-app-actions.ts',
)
const androidSource = readRepoSource(
  '../src/home-v2-live/node-client.ts',
  '../src/home-v2-live/node-client.js',
)

// The admin path is a module constant, never concatenated from app input.
assert.equal(bridgeSource.includes("const MINTING_ACCOUNTS_PATH = '/admin/mintingaccounts'"), true)
assert.equal(
  bridgeSource.split('/admin/mintingaccounts').length - 1,
  2,
  'The minting admin path may appear only in its constant and in the comment naming it.',
)
// Every node call in the minting handlers carries the trusted local API key.
for (const handler of ['startHomeV2Minting', 'removeHomeV2MintingAccount', 'resolveHomeV2MintingNode']) {
  assert.equal(bridgeSource.includes(handler), true, `${handler} must exist in the bridge.`)
}
assert.equal(bridgeSource.includes('getHomeV2TrustedWriteApiKey(network, node.nodeApiUrl)'), true)
assert.equal(bridgeSource.includes("assertHomeV2TrustedMintingNode('START_MINTING'"), true)
assert.equal(bridgeSource.includes("assertHomeV2TrustedMintingNode('REMOVE_MINTING_ACCOUNT'"), true)
// The derived minting key is posted to the node and never returned to the app.
assert.equal(bridgeSource.includes('mintingKeyPair.privateKey58'), true)
assert.equal(
  /return\s+[^\n]*mintingKeyPair\.privateKey58/.test(bridgeSource),
  false,
  'The minting private key must never appear in a returned value.',
)

// The read allowlist stays closed: apps still cannot fetch /admin/mintingaccounts.
assert.equal(actionsSource.includes("pathname === '/admin/status'"), true)
assert.equal(
  actionsSource.includes("'/admin/mintingaccounts'"),
  false,
  'normalizeHomeV2ReadPath must never allow the raw minting admin route.',
)

// Both transports derive minting state through this module (the QDN bridge has
// drifted between electron/ and src/ before, so pin the Android half too).
assert.equal(androidSource.includes('deriveHomeV2MintingStatus({'), true)
assert.equal(
  androidSource.includes('nodeAdmin: null'),
  true,
  'Android has no local Core, so it must report node-side minting state as unknown.',
)
assert.equal(
  androidSource.includes("createHomeV2MintingAccountsResult({ accounts: [], available: false })"),
  true,
)

console.log('Home v2 minting contract tests passed.')
