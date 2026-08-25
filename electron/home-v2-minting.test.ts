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
  isHomeV2LoopbackNodeUrl,
  isHomeV2MintingWriteAction,
  isHomeV2TrustedMintingNode,
  normalizeHomeV2MintingPublicKey,
  resolveHomeV2SelfMintingPublicKey,
  sanitizeHomeV2MintingAccounts,
  selectHomeV2SelfRewardShares,
  HOME_V2_MINTING_READ_ACTIONS,
  HOME_V2_MINTING_WRITE_ACTIONS,
} from './home-v2-minting.js'

const ADDRESS = 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH'
const OTHER = 'QLdBpGnZfP9nSnZ9nSnZ9nSnZ9nSnZ9nSn'
const REWARD_SHARE_KEY = '9NKfLpKvKJGVvLKQ6bYFa6VbTL3cRAHT2eGmSKA3Vd1B'
const OTHER_KEY = '7ZpKvKJGVvLKQ6bYFa6VbTL3cRAHT2eGmSKA3Vd1B9NK'

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
// Trusted-node predicate: loopback local Core WITH an API key, nothing else
// ---------------------------------------------------------------------------

const LOOPBACK = 'http://127.0.0.1:24891'

assert.equal(isHomeV2TrustedMintingNode({ apiKey: 'abc', mode: 'local', nodeApiUrl: LOOPBACK }), true)
assert.equal(isHomeV2TrustedMintingNode({ apiKey: '', mode: 'local', nodeApiUrl: LOOPBACK }), false)
for (const mode of ['public', 'custom', 'disabled', 'network']) {
  assert.equal(
    isHomeV2TrustedMintingNode({ apiKey: 'abc', mode, nodeApiUrl: LOOPBACK }),
    false,
    `${mode} nodes must never be treated as a trusted minting node.`,
  )
}
// The mode and the API key both come from Home's own settings; the URL is the
// backstop that keeps an administrative or account private key off the network.
for (const nodeApiUrl of [
  'http://10.0.0.5:24891',
  'https://node.example.com',
  'http://localhost.evil.com:24891',
  'http://127.0.0.1.evil.com:24891',
  'http://[2001:db8::1]:24891',
  '',
  null,
  undefined,
]) {
  assert.equal(
    isHomeV2TrustedMintingNode({ apiKey: 'abc', mode: 'local', nodeApiUrl }),
    false,
    `${String(nodeApiUrl)} must not be treated as a loopback minting node.`,
  )
}

// ---------------------------------------------------------------------------
// Loopback predicate
// ---------------------------------------------------------------------------

for (const url of [
  'http://127.0.0.1:24891',
  'http://127.0.0.1',
  'https://127.0.0.1:24891',
  'http://127.1.2.3:24891',
  'http://localhost:24891',
  'http://LOCALHOST:24891',
  'http://[::1]:24891',
  // WHATWG normalizes the long form to ::1 before the comparison.
  'http://[0:0:0:0:0:0:0:1]:24891',
]) {
  assert.equal(isHomeV2LoopbackNodeUrl(url), true, `${url} is loopback.`)
}
for (const url of [
  // Substring lookalikes: matching is on the parsed hostname only.
  'http://localhost.evil.com',
  'http://127.0.0.1.evil.com',
  'http://evil.com/127.0.0.1',
  'http://evil.com/?host=localhost',
  'http://evil.com#127.0.0.1',
  // Credentials cannot smuggle a loopback host past the hostname check.
  'http://127.0.0.1@evil.com',
  'http://localhost@evil.com',
  'http://128.0.0.1',
  'http://126.255.255.255',
  'http://12.7.0.0.1',
  'http://[::2]',
  'http://[2001:db8::1]',
  // IPv4-mapped IPv6 is deliberately refused: Home's Core is plain 127.0.0.1.
  'http://[::ffff:127.0.0.1]',
  'http://192.168.1.10',
  'file:///etc/passwd',
  'ftp://127.0.0.1',
  'not-a-url',
  '127.0.0.1:24891',
  '',
  null,
  42,
]) {
  assert.equal(isHomeV2LoopbackNodeUrl(url), false, `${String(url)} is not loopback.`)
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
// Self-share minting key resolution (what REMOVE_MINTING_ACCOUNT deletes)
// ---------------------------------------------------------------------------

assert.equal(
  resolveHomeV2SelfMintingPublicKey(
    [
      // Another minter on the same node must never be resolved.
      { mintingAccount: OTHER, recipientAccount: OTHER, publicKey: OTHER_KEY },
      { mintingAccount: ADDRESS, recipientAccount: ADDRESS, publicKey: REWARD_SHARE_KEY },
    ],
    ADDRESS,
  ),
  REWARD_SHARE_KEY,
)
// A share this account pays to someone else is not its own self share.
assert.equal(
  resolveHomeV2SelfMintingPublicKey(
    [{ mintingAccount: ADDRESS, recipientAccount: OTHER, publicKey: OTHER_KEY }],
    ADDRESS,
  ),
  null,
)
assert.equal(
  resolveHomeV2SelfMintingPublicKey(
    [{ mintingAccount: OTHER, recipientAccount: ADDRESS, publicKey: OTHER_KEY }],
    ADDRESS,
  ),
  null,
)
assert.equal(resolveHomeV2SelfMintingPublicKey([], ADDRESS), null)
assert.equal(resolveHomeV2SelfMintingPublicKey('nope', ADDRESS), null)
assert.equal(resolveHomeV2SelfMintingPublicKey(null, ADDRESS), null)
// A matching entry with no usable key resolves to null rather than to junk
// that would then be echoed back to the node.
for (const publicKey of [undefined, null, '', 'not base58!', 'short', 12345]) {
  assert.equal(
    resolveHomeV2SelfMintingPublicKey(
      [{ mintingAccount: ADDRESS, publicKey, recipientAccount: ADDRESS }],
      ADDRESS,
    ),
    null,
    `${String(publicKey)} must not resolve as a removable minting key.`,
  )
}
// The first well-formed self-share entry wins, and only self-share entries are
// ever considered.
assert.equal(
  resolveHomeV2SelfMintingPublicKey(
    [
      { mintingAccount: ADDRESS, publicKey: 'bad key', recipientAccount: ADDRESS },
      { mintingAccount: ADDRESS, publicKey: REWARD_SHARE_KEY, recipientAccount: ADDRESS },
    ],
    ADDRESS,
  ),
  REWARD_SHARE_KEY,
)

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
assert.deepEqual(
  { ...createHomeV2RemoveMintingAccountResult({
    address: ADDRESS,
    publicKey: REWARD_SHARE_KEY,
    removed: true,
  }) },
  {
    accepted: true,
    action: 'REMOVE_MINTING_ACCOUNT',
    address: ADDRESS,
    publicKey: REWARD_SHARE_KEY,
    removed: true,
  },
)
// The node held no self-share key for this account: a no-op, not a failure.
assert.deepEqual(
  { ...createHomeV2RemoveMintingAccountResult({
    address: ADDRESS,
    publicKey: null,
    removed: false,
  }) },
  {
    accepted: true,
    action: 'REMOVE_MINTING_ACCOUNT',
    address: ADDRESS,
    publicKey: null,
    removed: false,
  },
)

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

// The admin path is a module constant, never concatenated from app input. Only
// one QUOTED occurrence may exist; prose mentioning the route is fine.
assert.equal(bridgeSource.includes("const MINTING_ACCOUNTS_PATH = '/admin/mintingaccounts'"), true)
assert.equal(
  bridgeSource.split("'/admin/mintingaccounts'").length - 1,
  1,
  'The minting admin path may appear only in its single module constant.',
)
// Every node call in the minting handlers carries the trusted local API key.
for (const handler of [
  'startHomeV2Minting',
  'removeHomeV2MintingAccount',
  'resolveHomeV2MintingNode',
  'readHomeV2SelfMintingKey',
  'deleteHomeV2MintingKey',
]) {
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

// The trusted-node predicate is given the node URL, so the loopback check
// above actually runs on the real route.
assert.equal(
  /isHomeV2TrustedMintingNode\(\{[^}]*nodeApiUrl/s.test(bridgeSource),
  true,
  'The bridge must pass the node URL to the trusted-minting-node predicate.',
)

const mintingSection = (() => {
  const start = bridgeSource.indexOf('// Minting (R3-11)')
  assert.notEqual(start, -1, 'The minting section marker must exist.')
  const end = bridgeSource.indexOf('async function showHomeV2DesktopContextMenu', start)
  assert.notEqual(end, -1, 'The minting section must end before the context-menu handler.')
  return bridgeSource.slice(start, end)
})()

// FIX 1: removal deletes a key Home resolved from the node, never one the app
// supplied. The app's value may only be compared against it.
assert.equal(
  mintingSection.includes('deleteHomeV2MintingKey(node.nodeApiUrl, publicKey, apiKey)'),
  true,
  'Removal must delete the key resolved from the node.',
)
assert.equal(
  mintingSection.includes('resolveHomeV2SelfMintingPublicKey('),
  true,
  'Removal must resolve the selected account\'s own key in main.',
)
for (const line of mintingSection.split('\n')) {
  if (!line.includes('assertedPublicKey')) continue
  assert.equal(
    /deleteHomeV2MintingKey\(|postHomeV2MintingText\(|postHomeV2ChatText\(|body:/.test(line),
    false,
    `An app-supplied minting key must never reach the node: ${line.trim()}`,
  )
}
// The re-resolve after approval must compare against the key the user saw.
assert.equal(mintingSection.includes('freshPublicKey !== publicKey'), true)

// FIX 3: no node response body may reach the app from the secret-bearing calls.
assert.equal(
  mintingSection.includes('readableNodeErrorMessage'),
  false,
  'The minting section must never surface a node error body to the app.',
)
assert.equal(mintingSection.includes('function scrubbedHomeV2MintingError'), true)
function isScrubbedCall(needle: string) {
  const at = mintingSection.indexOf(needle)
  assert.notEqual(at, -1, `${needle} must appear in the minting section.`)
  const before = mintingSection.slice(0, at)
  return before.lastIndexOf('postHomeV2MintingText(') > before.lastIndexOf('postHomeV2ChatText(')
}
for (const needle of [
  "'/addresses/rewardsharekey',",
  "'/utils/publickey',",
  "'/addresses/rewardshare',",
  'mintingKeyPair.privateKey58,',
]) {
  assert.equal(isScrubbedCall(needle), true, `${needle} must be posted through the scrubbing wrapper.`)
}

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
