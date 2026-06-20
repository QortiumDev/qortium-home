// Independent 0BSD helper for stamping + signing a Qortium CHAT transaction on
// the client. Used by the keyless open-group send path so the private key never
// leaves the device: the node only builds the unsigned bytes and broadcasts the
// already-signed bytes.

import nacl from 'tweetnacl';

// The CHAT memory-pow nonce is a big-endian int32 at this byte offset within the
// "bytes-for-signing" (the serialized CHAT transaction without the trailing
// 64-byte signature). Offset = txType(4) + timestamp(8) + txGroupId(4) +
// senderPublicKey(32) = 48. Tracks Qortium Core's ChatTransactionTransformer.
export const CHAT_NONCE_OFFSET = 48;

const SIGNATURE_LENGTH = 64;
const ED25519_SECRET_KEY_LENGTH = 64;

/**
 * Writes the memory-pow nonce (big-endian int32) into a COPY of the unsigned
 * CHAT bytes at the nonce offset. Returns the nonce-stamped, still-unsigned bytes
 * (these are exactly the bytes ed25519 signs over).
 */
export function stampChatNonce(unsignedChatBytes: Uint8Array, nonce: number): Uint8Array {
  if (!Number.isInteger(nonce) || nonce < 0 || nonce > 0xffffffff) {
    throw new Error('CHAT nonce must be a uint32.');
  }

  if (unsignedChatBytes.length < CHAT_NONCE_OFFSET + 4) {
    throw new Error('Unsigned CHAT bytes are too short to contain a nonce field.');
  }

  const stamped = unsignedChatBytes.slice();
  const view = new DataView(stamped.buffer, stamped.byteOffset, stamped.byteLength);
  view.setUint32(CHAT_NONCE_OFFSET, nonce >>> 0, false /* big-endian */);

  return stamped;
}

/**
 * Produces the fully signed CHAT transaction bytes: stamps the nonce, ed25519
 * signs the nonce-stamped bytes, then appends the 64-byte detached signature.
 *
 * @param unsignedChatBytes nonce-free unsigned CHAT bytes from /chat/public/build
 * @param nonce             memory-pow nonce from compute2
 * @param secretKey64       64-byte tweetnacl ed25519 secret key
 *                          (nacl.sign.keyPair.fromSeed(seed).secretKey)
 */
export function signChatTransaction(
  unsignedChatBytes: Uint8Array,
  nonce: number,
  secretKey64: Uint8Array,
): Uint8Array {
  if (secretKey64.length !== ED25519_SECRET_KEY_LENGTH) {
    throw new Error('ed25519 secret key must be 64 bytes.');
  }

  const bytesWithNonce = stampChatNonce(unsignedChatBytes, nonce);
  const signature = nacl.sign.detached(bytesWithNonce, secretKey64);

  if (signature.length !== SIGNATURE_LENGTH) {
    throw new Error('ed25519 signature was not 64 bytes.');
  }

  const signed = new Uint8Array(bytesWithNonce.length + SIGNATURE_LENGTH);
  signed.set(bytesWithNonce, 0);
  signed.set(signature, bytesWithNonce.length);

  return signed;
}
