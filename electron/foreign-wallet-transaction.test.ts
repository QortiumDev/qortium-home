import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { base58, bech32 } from '@scure/base';
import {
  buildForeignWalletSignedTransaction,
  validateForeignWalletRecipient,
  type ForeignWalletWatchInput,
} from './foreign-wallet-transaction.js';
import {
  deriveForeignWalletLeafPublicData,
  getForeignWalletCoins,
  signForeignWalletDigest,
  type ForeignWalletCoin,
  type ForeignWalletCrypto,
} from './foreign-wallets.js';

const PUBLIC_TEST_SEED = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);
const cryptoAdapter: ForeignWalletCrypto = {
  ripemd160: (data) => Uint8Array.from(createHash('ripemd160').update(data).digest()),
  sha256: (data) => Uint8Array.from(createHash('sha256').update(data).digest()),
  sha512: (data) => Uint8Array.from(createHash('sha512').update(data).digest()),
};

// Public deterministic vectors shared with Core's independent bitcoinj
// LegacyTransactionBuilder test. These prove the two runtimes serialize,
// RFC6979-sign and hash the exact same transaction for every admitted chain.
const CROSS_RUNTIME_SIGNING_VECTORS: Record<ForeignWalletCoin, { rawTransactionHex: string; txId: string }> = {
  BTC: {
    rawTransactionHex: '0100000001117f5b50c48dcfc9deb20a477e476baa4da1ddd6c5b5f5f66585d49f6e16075d000000006a47304402207cd448817547dfbd103515d15c6590381edccb6d2a6788f074526739c16313a20220550bdf1f06f39def7e2bd659504b3104ca28b6ea93b1fa5b23d5decb76329abd0121028d93e306d698001f979293d68b635e692e74a750178039ebae77a33c03311912ffffffff016c5f0100000000001976a914e49c35c89163fafb453ace35d49e9d96ed5386ae88ac00000000',
    txId: 'b4dca0ef3381bdb0636662534538e88330091fe5ee9109118546e57fad298568',
  },
  LTC: {
    rawTransactionHex: '0100000001026f2d1c62b4733ef5c0651dfc2a61c08b08d0e02bebeb8b514eb1b398b01c46000000006a473044022029304629cd972862656f60e8fb62cf9dd5f218850666cc5e2eb4eeb77277badd02207da08dff1da87a4ea4b36cd480649657d4b3b36dc80eed842313bab52a2bff2b012102677f55d844e1834bdc7d32b6473f16e313792af3b094b183d8a9ab50396784e2ffffffff016c5f0100000000001976a9148ccc0c390a3c4ad488c38e90399b6b006a5ad2c188ac00000000',
    txId: 'e8375aa35875e045e8fe69006749fb02a74ac7abea19954a13410bb955017ffd',
  },
  DOGE: {
    rawTransactionHex: '0100000001db3dc84fcb3b091a0d1c117c8a1daf78c6760a922119947b476f3307cad83690000000006b483045022100ea020e0201c9f8e2bb3c47ffc1faa20e17c1d959eb25d9a5b26810b8b96f49990220321b6078c3675e43e1661f0a65e01940ac00536e1c4765833840ab2286abcc620121037da2d11d1af5e92e9329ec91553c9fb8acafc6a2b5621e8f419c649853159d6effffffff016c5f0100000000001976a91410f7cf6208aaa93e20cf026df40de45985f6507288ac00000000',
    txId: '67ba7edc828602b5b154076e2ff2bb6178b160d8ac1d8a920ade8a33f9b799de',
  },
  DGB: {
    rawTransactionHex: '010000000116adf820440e8448d4ac685a3441bec9d84c0414d6be594ff3e4252c1e35addb000000006b4830450221008a1c08ef5ee1d247156ef49a6d2d414f02be0281c7ee2bf22cfc1f807a525a4902205a56813d1747c49a224b4ff07d59db1e5bcd4b42900d8478a019593731bbdd7e0121021ce007a9103d30437cbfa330f0b80fcaae4b3ff894c710583b2d618491d0dd0affffffff016c5f0100000000001976a914fcf0e51334259f440ef0e8746b4b42fc0b0e0c3588ac00000000',
    txId: 'b93597634bfed8c6f634faff2bbaed53b173dbae7a4fff42d38cd163e1038009',
  },
  RVN: {
    rawTransactionHex: '0100000001095b442a0874643feffa95fecdfc1192cf16c14cef04dfe1aef657c37f9fa987000000006a47304402203bfe92afa78981b094d213ba02f9f82fc9a1a4c9cd038357be8bdcc18a8edd750220453edc23327d28a6691230ec25bd5d89ee7b3289f52fa06854ac6d53963b23330121027afbd1dd29a0784d6f3726ada86d53e5d304ef69c52afc7f9b3d530bea49befaffffffff016c5f0100000000001976a9143bdd3c57914dc3eaa58c873aa708fe15f73f4d1088ac00000000',
    txId: '61c279f09f6793a21789fc1405b26ad0bc7a2a5d44372bcbe509d43d8be7be54',
  },
  DASH: {
    rawTransactionHex: '0100000001e113b92495ae4e0887648e9e43ad491412cd92bfcfe353d8a7435942caf93cb2000000006a4730440220490ff282fab925e7c3dfc197a3765fb7ba42de0b252daf12143816f209cd288002205b4221da3ca7b51628f0517b6983b234f87a38d589d723fdafb71962a110c321012103828488399bb7d44181b738ff0a92460366af9855404e644f8c6b86ae00225cb8ffffffff016c5f0100000000001976a914a3e040390a9052cf947d97492bc7d7fea13ba77188ac00000000',
    txId: 'ef2cf48a8e9f1aa541d829646ccf5f6403fe9594810d38100ed0508ec92a1aeb',
  },
  NMC: {
    rawTransactionHex: '01000000011ca46210e8b4c10c844074e762b3b389118f01da21956d9b1304b26ae32739ff000000006a473044022017b205d07b1a1f35c75f53dc26c43ef7de3a384a49c89f30884a420352b86cae02200fb36693ba5c25304d030778013f2ea7a3b2e0c1acfce66dab86fe9a789aadb0012103f210f2645f9225a461f27835c55ddd7ff100b95a559781b82480970dcb9ae21effffffff016c5f0100000000001976a9149e55b3914fefd696f4865c6a975cd6b4afdb0ec988ac00000000',
    txId: '69c37d40b722923e0ae3f544526808c59bc7e4083855f98478c3df519690693a',
  },
  FIRO: {
    rawTransactionHex: '0100000001a0e5914e9a8b584cbea0a586360db59d80207c36b07192e685a52199c4588bf9000000006a4730440220495f39f5c3b689d3cac81d8480e2e6575c2600822aeb3598ef7be255c28697000220623b47aa28d302f63dcebe9d13e910647e02eefc0df266efb3e166ec1c3f2bd20121021693c8101243f8ddac815943d2e11681d505ce03fd5aa56bb3a1e90dfb9d5be7ffffffff016c5f0100000000001976a9144c68636f8cc97802cd235da98d8c56e21c276eea88ac00000000',
    txId: 'fa469276ff7791181b10c98a6e4f52d0b5e55e6b5f4a7378d0163fa3254257e4',
  },
};

for (const coin of getForeignWalletCoins()) {
  const vectorFundingKey = deriveForeignWalletLeafPublicData({
    chain: 0,
    coin,
    crypto: cryptoAdapter,
    index: 0,
    seed: PUBLIC_TEST_SEED,
    walletVersion: 2,
  });
  const vectorRecipientKey = deriveForeignWalletLeafPublicData({
    chain: 0,
    coin,
    crypto: cryptoAdapter,
    index: 1,
    seed: PUBLIC_TEST_SEED,
    walletVersion: 2,
  });
  const vectorFundingScript = p2pkhScript(hash160(vectorFundingKey.publicKey));
  const vectorPreviousTransaction = concat(
    le32(1),
    Uint8Array.of(1),
    new Uint8Array(32),
    le32(0xffffffff),
    Uint8Array.of(1, 0),
    le32(0xffffffff),
    Uint8Array.of(1),
    le64(100_000),
    Uint8Array.of(vectorFundingScript.byteLength),
    vectorFundingScript,
    le32(0),
  );
  const vectorTransactionId = toHex(Uint8Array.from(doubleSha256(vectorPreviousTransaction)).reverse());
  const vectorSigned = buildForeignWalletSignedTransaction({
    coin,
    crypto: cryptoAdapter,
    inputs: [{
      address: vectorFundingKey.address,
      height: 100,
      path: 'M/0/0',
      previousTransactionHex: toHex(vectorPreviousTransaction),
      scriptPubKey: toHex(vectorFundingScript),
      txHash: vectorTransactionId,
      txPos: 0,
      value: 100_000n,
    }],
    outputs: [{ address: vectorRecipientKey.address, value: 89_964n }],
    seed: PUBLIC_TEST_SEED,
    walletVersion: 2,
  });

  assert.equal(vectorSigned.rawTransactionHex, CROSS_RUNTIME_SIGNING_VECTORS[coin].rawTransactionHex, coin);
  assert.equal(vectorSigned.txId, CROSS_RUNTIME_SIGNING_VECTORS[coin].txId, coin);
  assert.equal(vectorSigned.fee, 10_036n, coin);
}

const fundingKey = deriveForeignWalletLeafPublicData({
  chain: 0,
  coin: 'BTC',
  crypto: cryptoAdapter,
  index: 0,
  seed: PUBLIC_TEST_SEED,
  walletVersion: 2,
});
const recipientKey = deriveForeignWalletLeafPublicData({
  chain: 0,
  coin: 'BTC',
  crypto: cryptoAdapter,
  index: 1,
  seed: PUBLIC_TEST_SEED,
  walletVersion: 2,
});
const fundingScript = p2pkhScript(hash160(fundingKey.publicKey));
const previousTransaction = concat(
  le32(1),
  Uint8Array.of(1),
  new Uint8Array(32),
  le32(0xffffffff),
  Uint8Array.of(1, 0),
  le32(0xffffffff),
  Uint8Array.of(1),
  le64(100_000),
  Uint8Array.of(fundingScript.byteLength),
  fundingScript,
  le32(0),
);
const previousTransactionHex = toHex(previousTransaction);
const previousTransactionId = toHex(Uint8Array.from(doubleSha256(previousTransaction)).reverse());
const watchInput: ForeignWalletWatchInput = {
  address: fundingKey.address,
  height: 100,
  path: 'M/0/0',
  previousTransactionHex,
  scriptPubKey: toHex(fundingScript),
  txHash: previousTransactionId,
  txPos: 0,
  value: 100_000n,
};

const signed = buildForeignWalletSignedTransaction({
  coin: 'BTC',
  crypto: cryptoAdapter,
  inputs: [watchInput],
  outputs: [{ address: recipientKey.address, value: 90_000n }],
  seed: PUBLIC_TEST_SEED,
  walletVersion: 2,
});
const repeated = buildForeignWalletSignedTransaction({
  coin: 'BTC',
  crypto: cryptoAdapter,
  inputs: [watchInput],
  outputs: [{ address: recipientKey.address, value: 90_000n }],
  seed: PUBLIC_TEST_SEED,
  walletVersion: 2,
});

assert.deepEqual(repeated, signed, 'RFC6979 signing must be deterministic');
assert.equal(signed.rawTransactionHex, '0100000001117f5b50c48dcfc9deb20a477e476baa4da1ddd6c5b5f5f66585d49f6e16075d000000006b483045022100be4e023338be1cc6a7b072874e37efb8aa5caad65c5d27de2544c736099d321a022036f81759c2efd7b2926fb142b4c4c663581b8d59aa8d6bab131bfc4dba3fdd7f0121028d93e306d698001f979293d68b635e692e74a750178039ebae77a33c03311912ffffffff01905f0100000000001976a914e49c35c89163fafb453ace35d49e9d96ed5386ae88ac00000000');
assert.equal(signed.inputAmount, 100_000n);
assert.equal(signed.outputAmount, 90_000n);
assert.equal(signed.fee, 10_000n);
assert.equal(signed.transactionSize, signed.rawTransactionHex.length / 2);
assert.equal(signed.txId, toHex(Uint8Array.from(doubleSha256(fromHex(signed.rawTransactionHex))).reverse()));
assert.equal(signed.rawTransactionHex.slice(0, 10), '0100000001');
assert.ok(signed.rawTransactionHex.includes(toHex(fundingScript)) === false, 'scriptPubKey must not be copied into scriptSig');

const parsedInput = parseSingleInputTransaction(signed.rawTransactionHex);
assert.equal(parsedInput.previousTransactionId, previousTransactionId);
assert.equal(parsedInput.outputIndex, 0);
assert.equal(parsedInput.sequence, 0xffffffff);
assert.equal(parsedInput.signature.at(-1), 0x01);
assert.deepEqual(parsedInput.publicKey, fundingKey.publicKey);
const sighash = doubleSha256(concat(
  le32(1),
  Uint8Array.of(1),
  Uint8Array.from(fromHex(previousTransactionId)).reverse(),
  le32(0),
  Uint8Array.of(fundingScript.byteLength),
  fundingScript,
  le32(0xffffffff),
  parsedInput.serializedOutputsAndLockTime,
  le32(1),
));
assert.equal(
  secp256k1.verify(parsedInput.signature.subarray(0, -1), sighash, fundingKey.publicKey, {
    lowS: true,
    prehash: false,
    format: 'der',
  }),
  true,
);

const witnessTransactionBody = concat(
  Uint8Array.of(1),
  new Uint8Array(32),
  le32(0xffffffff),
  Uint8Array.of(1, 0),
  le32(0xffffffff),
  Uint8Array.of(1),
  le64(100_000),
  Uint8Array.of(fundingScript.byteLength),
  fundingScript,
);
const witnessPreviousTransaction = concat(
  le32(2),
  Uint8Array.of(0, 1),
  witnessTransactionBody,
  Uint8Array.of(1, 2, 0xaa, 0xbb),
  le32(0),
);
const witnessTransactionId = toHex(Uint8Array.from(doubleSha256(concat(
  le32(2),
  witnessTransactionBody,
  le32(0),
))).reverse());
const witnessWatchInput: ForeignWalletWatchInput = {
  ...watchInput,
  previousTransactionHex: toHex(witnessPreviousTransaction),
  txHash: witnessTransactionId,
};
assert.equal(buildForeignWalletSignedTransaction({
  coin: 'BTC',
  crypto: cryptoAdapter,
  inputs: [witnessWatchInput],
  outputs: [{ address: recipientKey.address, value: 90_000n }],
  seed: PUBLIC_TEST_SEED,
}).inputAmount, 100_000n, 'SegWit funding transactions must attest using their non-witness txid');

const digest = Uint8Array.from({ length: 32 }, (_value, index) => 0xa0 + index);
const digestSignature = signForeignWalletDigest({
  chain: 0,
  coin: 'BTC',
  crypto: cryptoAdapter,
  digest,
  index: 0,
  seed: PUBLIC_TEST_SEED,
  walletVersion: 2,
});
assert.equal(toHex(digestSignature.derSignature), '304402200c445658eb1c5c003a6672b8f161e38634d6590ee4c69e351e895930cfdbbc5b02200c3dd5724f5d55fc64f25f01c0ceaf917d72e5cb9366a073fbff13db8a547969');
assert.equal(secp256k1.verify(digestSignature.derSignature, digest, digestSignature.publicKey, {
  lowS: true,
  prehash: false,
  format: 'der',
}), true);
assert.equal(secp256k1.Signature.fromBytes(digestSignature.derSignature, 'der').hasHighS(), false);

const p2shHash = Uint8Array.from({ length: 20 }, () => 0x22);
const btcP2sh = encodeBase58Check(Uint8Array.of(0x05, ...p2shHash));
assert.deepEqual(validateForeignWalletRecipient({ address: btcP2sh, coin: 'BTC', crypto: cryptoAdapter }), {
  address: btcP2sh,
  outputType: 'P2SH',
  scriptPubKey: Uint8Array.of(0xa9, 0x14, ...p2shHash, 0x87),
});

const btcWitnessProgram = Uint8Array.from({ length: 20 }, () => 0x33);
const btcBech32 = bech32.encode('bc', [0, ...bech32.toWords(btcWitnessProgram)]);
assert.equal(validateForeignWalletRecipient({ address: btcBech32, coin: 'BTC', crypto: cryptoAdapter }).outputType, 'P2WPKH');
const legacyLitecoinP2sh = encodeBase58Check(Uint8Array.of(0x05, ...p2shHash));
const normalizedLitecoinP2sh = validateForeignWalletRecipient({
  address: legacyLitecoinP2sh,
  coin: 'LTC',
  crypto: cryptoAdapter,
});
assert.equal(fromBase58Check(normalizedLitecoinP2sh.address)[0], 0x32);
assert.equal(normalizedLitecoinP2sh.outputType, 'P2SH');

for (const mutation of [
  { ...watchInput, height: 0 },
  { ...watchInput, path: 'M/1/0' },
  { ...watchInput, scriptPubKey: `76a914${'55'.repeat(20)}88ac` },
  { ...watchInput, txHash: '66'.repeat(32) },
  { ...watchInput, value: 99_999n },
]) {
  assert.throws(() => buildForeignWalletSignedTransaction({
    coin: 'BTC',
    crypto: cryptoAdapter,
    inputs: [mutation],
    outputs: [{ address: recipientKey.address, value: 90_000n }],
    seed: PUBLIC_TEST_SEED,
  }), /Foreign wallet input|foreign wallet input/);
}

assert.throws(() => buildForeignWalletSignedTransaction({
  coin: 'BTC',
  crypto: cryptoAdapter,
  inputs: [watchInput, watchInput],
  outputs: [{ address: recipientKey.address, value: 90_000n }],
  seed: PUBLIC_TEST_SEED,
}), /duplicate input/);
assert.throws(() => buildForeignWalletSignedTransaction({
  coin: 'BTC',
  crypto: cryptoAdapter,
  inputs: [watchInput],
  outputs: [{ address: recipientKey.address, value: 100_001n }],
  seed: PUBLIC_TEST_SEED,
}), /outputs exceed inputs/);
assert.throws(() => buildForeignWalletSignedTransaction({
  coin: 'BTC',
  crypto: cryptoAdapter,
  inputs: [{
    ...watchInput,
    previousTransactionHex: `${watchInput.previousTransactionHex}00`,
    txHash: toHex(Uint8Array.from(doubleSha256(concat(previousTransaction, Uint8Array.of(0)))).reverse()),
  }],
  outputs: [{ address: recipientKey.address, value: 90_000n }],
  seed: PUBLIC_TEST_SEED,
}), /trailing data/);
assert.throws(() => buildForeignWalletSignedTransaction({
  coin: 'BTC',
  crypto: cryptoAdapter,
  inputs: Array.from({ length: 1_001 }, () => watchInput),
  outputs: [{ address: recipientKey.address, value: 90_000n }],
  seed: PUBLIC_TEST_SEED,
}), /input count exceeds/);

function parseSingleInputTransaction(rawHex: string) {
  const bytes = fromHex(rawHex);
  let offset = 4;
  assert.equal(bytes[offset++], 1);
  const previousTransactionId = toHex(Uint8Array.from(bytes.subarray(offset, offset + 32)).reverse());
  offset += 32;
  const outputIndex = readLe32(bytes, offset);
  offset += 4;
  const scriptLength = bytes[offset++];
  const script = bytes.subarray(offset, offset + scriptLength);
  offset += scriptLength;
  const sequence = readLe32(bytes, offset);
  offset += 4;
  const serializedOutputsAndLockTime = bytes.subarray(offset);
  const signatureLength = script[0];
  const signature = script.subarray(1, 1 + signatureLength);
  const publicKeyOffset = 1 + signatureLength;
  const publicKeyLength = script[publicKeyOffset];
  const publicKey = script.subarray(publicKeyOffset + 1, publicKeyOffset + 1 + publicKeyLength);
  assert.equal(publicKeyOffset + 1 + publicKeyLength, script.byteLength);
  return { outputIndex, previousTransactionId, publicKey, sequence, serializedOutputsAndLockTime, signature };
}

function p2pkhScript(hash: Uint8Array) {
  return Uint8Array.of(0x76, 0xa9, 0x14, ...hash, 0x88, 0xac);
}

function hash160(bytes: Uint8Array) {
  return cryptoAdapter.ripemd160(cryptoAdapter.sha256(bytes));
}

function doubleSha256(bytes: Uint8Array) {
  return cryptoAdapter.sha256(cryptoAdapter.sha256(bytes));
}

function encodeBase58Check(payload: Uint8Array) {
  return base58.encode(concat(payload, doubleSha256(payload).subarray(0, 4)));
}

function fromBase58Check(value: string) {
  const decoded = base58.decode(value);
  const payload = decoded.subarray(0, -4);
  assert.deepEqual(decoded.subarray(-4), doubleSha256(payload).subarray(0, 4));
  return payload;
}

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function le32(value: number) {
  return Uint8Array.of(
    value & 0xff,
    Math.floor(value / 0x100) & 0xff,
    Math.floor(value / 0x10000) & 0xff,
    Math.floor(value / 0x1000000) & 0xff,
  );
}

function le64(value: number | bigint) {
  const result = new Uint8Array(8);
  let remaining = BigInt(value);
  for (let index = 0; index < result.byteLength; index += 1) {
    result[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
}

function readLe32(bytes: Uint8Array, offset: number) {
  return bytes[offset]
    + bytes[offset + 1] * 0x100
    + bytes[offset + 2] * 0x10000
    + bytes[offset + 3] * 0x1000000;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value: string) {
  return Uint8Array.from({ length: value.length / 2 }, (_entry, index) => (
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  ));
}
