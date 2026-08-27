import nacl from 'tweetnacl'
import ed2curve from 'ed2curve'
import { Sha256 } from 'asmcrypto.js'

/**
 * The reward-share private key, derived LOCALLY — exactly Core's
 * PrivateKeyAccount.getRewardSharePrivateKey: SHA-256 of the X25519 shared
 * secret between the minter's converted Ed25519 private key and the
 * recipient's converted Ed25519 public key.
 *
 * This exists so the minting family NEVER sends the account private key to
 * any node: the 1.x and early-2.x flows posted it to Core's
 * /addresses/rewardsharekey, which is precisely the exposure the whole
 * restoration wave eliminated elsewhere. The construction is the one the
 * direct-chat encryption already interoperates with Core on (raw X25519
 * agreement — NOT nacl.box.before, whose extra HSalsa20 would not match),
 * and the test suite pins it to a vector generated from Core's own
 * implementation.
 */
export function deriveHomeV2RewardSharePrivateKey(
  minterSecretKey: Uint8Array,
  recipientPublicKey: Uint8Array,
): Uint8Array {
  if (minterSecretKey.length !== 64 && minterSecretKey.length !== 32) {
    throw new Error('Minter secret key must be a 32-byte seed or 64-byte Ed25519 secret key.')
  }
  if (recipientPublicKey.length !== 32) {
    throw new Error('Recipient public key must be 32 bytes.')
  }
  const secretKey = minterSecretKey.length === 64
    ? minterSecretKey
    : nacl.sign.keyPair.fromSeed(minterSecretKey).secretKey
  const curveSecretKey = ed2curve.convertSecretKey(secretKey)
  const curvePublicKey = ed2curve.convertPublicKey(recipientPublicKey)
  if (!curvePublicKey) throw new Error('Recipient public key cannot be converted for reward-share derivation.')
  const sharedSecret = nacl.scalarMult(curveSecretKey, curvePublicKey)
  curveSecretKey.fill(0)
  if (secretKey !== minterSecretKey) secretKey.fill(0)
  // Core's X25519 agreement REFUSES an all-zero shared secret (a small-order
  // or identity public key); tweetnacl returns it. Refuse identically rather
  // than deriving a key from a degenerate agreement Core would never accept.
  if (sharedSecret.every((byte) => byte === 0)) {
    sharedSecret.fill(0)
    throw new Error('Recipient public key produced a degenerate shared secret.')
  }
  const digest = new Sha256().process(sharedSecret).finish().result
  sharedSecret.fill(0)
  if (!digest) throw new Error('SHA-256 failed.')
  return new Uint8Array(digest)
}
