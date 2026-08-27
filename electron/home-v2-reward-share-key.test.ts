import assert from 'node:assert/strict'
import nacl from 'tweetnacl'

import { base58Decode, base58Encode } from './base58.js'
import { deriveHomeV2RewardSharePrivateKey } from './home-v2-reward-share-key.js'

// Vector generated from Core's own implementation
// (PrivateKeyAccount.getRewardSharePrivateKey, qortium-1.7.3.jar,
// 2026-08-27): deterministic throwaway seeds, never real accounts.
// minterSeed = bytes 0x01..0x20; recipientSeed = bytes 0x65..0x84.
const minterSeed = base58Decode('4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw')
const expectedMinterPub = '9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj'
const recipientPub = base58Decode('FgcwodK7aTtn3DgvqwPuSseKgTPcMpGmK6zdf7Ri9KXm')
const expectedRewardShareKey = '8QqzzPDi8ykWjDB7QkndLbvKcbKcEYFC7SDZHGn4hemC'

// The seed itself round-trips to Core's public key (same Ed25519 keygen).
const minterPair = nacl.sign.keyPair.fromSeed(minterSeed)
assert.equal(base58Encode(minterPair.publicKey), expectedMinterPub)

// 32-byte seed form and 64-byte secret-key form both match Core's output.
assert.equal(
  base58Encode(deriveHomeV2RewardSharePrivateKey(minterSeed, recipientPub)),
  expectedRewardShareKey,
)
assert.equal(
  base58Encode(deriveHomeV2RewardSharePrivateKey(minterPair.secretKey, recipientPub)),
  expectedRewardShareKey,
)

// Derivation is directional: swapping roles gives a DIFFERENT key... actually
// X25519 agreement is symmetric in (privA, pubB)/(privB, pubA) — Core relies
// on that same symmetry, so assert it holds here too.
{
  const recipientSeed = new Uint8Array(32)
  for (let index = 0; index < 32; index += 1) recipientSeed[index] = 101 + index
  const recipientPair = nacl.sign.keyPair.fromSeed(recipientSeed)
  assert.equal(base58Encode(recipientPair.publicKey), base58Encode(recipientPub))
  assert.equal(
    base58Encode(deriveHomeV2RewardSharePrivateKey(recipientSeed, minterPair.publicKey)),
    expectedRewardShareKey,
  )
}

// Five independent Core-generated vectors (same source), so equivalence is
// established across a spread of key material rather than one lucky pair.
const CORE_VECTORS: readonly (readonly [string, string, string])[] = [
  ['4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw', '961gFHQZwMYAVMtR5jM8AHfQ6xcBsnq8P1gHvvFNUswH', '2PerD2FeUbkdKxSipFt5JAAfCRRi3frMHNcshBfroEKc'],
  ['USxhdMQhkMoYC52vEK6giwuQeu2F5SWuXeqS3EeyidB', 'J6VzoQSCmPyVdsFZXHqAf9m3hwqqXvcaGziVQusELihK', 'AfzYXaaYPnb21X8W7qhtrYwwqvYUEvxVedLGCQYqTnzf'],
  ['3ELeRTTg5W5hAYaEFznzFV1jknNFkjHqS8ytwvQEQP1Z', 'HqJyTimjBJAuCb8ctZVCaCiynXBKjucJa5TBViZoDprb', '4XyqagfRgCdyEJ9h4oE8CGbwfCmto5YATNXwRoPYRx4x'],
  ['HtjnUoWtGM68EeA86t2zDVQawhYoNoZ8LVMqa7FjZBwN', '6HzhRWxxJ7B5KQW38bnHnBMpicF6z8bnufd6na4NxSwD', '7w4a3epYrQwkmcFxbmnJtX2TMCp72qfSiQ851rHnftu6'],
  ['7gz9sLCM7BgeNX5j3iKdTFx5sGFYCvbxK4yCo1MmiNJD', 'EZfd2oLepe3yxcv5bz9vRZheqtEvCcTG1gEL6QMaCK8h', '4CEJ87uLWzoKEgS8LrqJQs4XuCzprYdDDemFqe3ABgqN'],
]
for (const [seed58, recipient58, expected58] of CORE_VECTORS) {
  const seed = base58Decode(seed58)
  assert.equal(
    base58Encode(deriveHomeV2RewardSharePrivateKey(seed, base58Decode(recipient58))),
    expected58,
    `Core vector ${seed58.slice(0, 8)} must match`,
  )
  // The 64-byte secret-key input must agree with the 32-byte seed input.
  assert.equal(
    base58Encode(deriveHomeV2RewardSharePrivateKey(nacl.sign.keyPair.fromSeed(seed).secretKey, base58Decode(recipient58))),
    expected58,
  )
}

// Degenerate agreements are REFUSED, matching Core's X25519, which rejects an
// all-zero shared secret rather than deriving a key from it. tweetnacl would
// return the zero secret, so this rejection is ours to make.
for (const smallOrder of [
  new Uint8Array(32), // identity
  Uint8Array.from([1, ...new Array(31).fill(0)]),
]) {
  assert.throws(
    () => deriveHomeV2RewardSharePrivateKey(minterSeed, smallOrder),
    /degenerate shared secret|cannot be converted/,
    `small-order key ${smallOrder[0]} must refuse`,
  )
}

// Input validation.
assert.throws(() => deriveHomeV2RewardSharePrivateKey(new Uint8Array(31), recipientPub), /32-byte seed or 64-byte/)
assert.throws(() => deriveHomeV2RewardSharePrivateKey(minterSeed, new Uint8Array(31)), /32 bytes/)

console.log('Home v2 reward-share key derivation tests passed.')
