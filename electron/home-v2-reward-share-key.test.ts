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

// Input validation.
assert.throws(() => deriveHomeV2RewardSharePrivateKey(new Uint8Array(31), recipientPub), /32-byte seed or 64-byte/)
assert.throws(() => deriveHomeV2RewardSharePrivateKey(minterSeed, new Uint8Array(31)), /32 bytes/)

console.log('Home v2 reward-share key derivation tests passed.')
