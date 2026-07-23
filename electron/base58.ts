// The base58 codec shared by both QDN bridges.
//
// The desktop bridge (electron/qdn.ts) and the renderer/Android bridge
// (src/platform.ts) both decode base58 to raw transaction bytes and encode raw
// bytes back to base58 before anything is signed or sent to a node. Each one
// carried its own private copy of the same alphabet, the same lookup map and
// the same encode/decode pair. A codec on the signing path is the last place
// two copies should be allowed to drift, so it lives here once.
//
// getSignedTransactionSignature is here too: it is nothing but a decode, a
// length check and an encode of the trailing 64 bytes, so it has no reason to
// exist anywhere the codec does not.

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_ALPHABET_MAP = new Map<string, number>(
  [...BASE58_ALPHABET].map((character, index) => [character, index]),
);

function base58Encode(buffer: Uint8Array) {
  if (buffer.length === 0) {
    return '';
  }

  const digits = [0];

  for (const byte of buffer) {
    for (let index = 0; index < digits.length; index += 1) {
      digits[index] <<= 8;
    }

    digits[0] += byte;

    let carry = 0;

    for (let index = 0; index < digits.length; index += 1) {
      digits[index] += carry;
      carry = (digits[index] / 58) | 0;
      digits[index] %= 58;
    }

    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  for (let index = 0; buffer[index] === 0 && index < buffer.length - 1; index += 1) {
    digits.push(0);
  }

  return digits
    .reverse()
    .map((digit) => BASE58_ALPHABET[digit])
    .join('');
}

function base58Decode(value: string) {
  if (value.length === 0) {
    return new Uint8Array(0);
  }

  const bytes = [0];

  for (const character of value) {
    const mappedValue = BASE58_ALPHABET_MAP.get(character);

    if (mappedValue === undefined) {
      throw new Error(`Base58 value contains an invalid character: ${character}`);
    }

    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] *= 58;
    }

    bytes[0] += mappedValue;

    let carry = 0;

    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] += carry;
      carry = bytes[index] >> 8;
      bytes[index] &= 0xff;
    }

    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (let index = 0; value[index] === '1' && index < value.length - 1; index += 1) {
    bytes.push(0);
  }

  return new Uint8Array(bytes.reverse());
}

function getSignedTransactionSignature(signedTransactionBytes58: string) {
  const signedTransactionBytes = base58Decode(signedTransactionBytes58);

  if (signedTransactionBytes.length < 64) {
    throw new Error('Signed transaction did not contain a signature.');
  }

  return base58Encode(signedTransactionBytes.slice(-64));
}

export { BASE58_ALPHABET, BASE58_ALPHABET_MAP };
export { base58Encode, base58Decode, getSignedTransactionSignature };
