import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import nacl from 'tweetnacl';

import {
  buildUnsignedQortalGroupChatTransactionBytes,
  stampQortalGroupChatNonce,
} from '../dist-electron/qortal-chat.js';
import {
  loadPinnedQortalChatFixture,
  loadPinnedQortiumCoreChatFixture,
  mutateHexSource,
  resolveFixtureValue,
  validateQortalFixture,
  validateQortiumCoreFixture,
} from './lib/chat-interop-fixtures.mjs';

const hexBytes = (hex) => Uint8Array.from(Buffer.from(hex, 'hex'));
const utf8 = (value) => Buffer.from(value, 'utf8');

async function decryptAesGcm({ associatedData, ciphertext, key, nonce }) {
  const cryptoKey = await webcrypto.subtle.importKey(
    'raw',
    hexBytes(key),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  return Buffer.from(await webcrypto.subtle.decrypt(
    {
      additionalData: hexBytes(associatedData),
      iv: hexBytes(nonce),
      name: 'AES-GCM',
      tagLength: 128,
    },
    cryptoKey,
    hexBytes(ciphertext),
  ));
}

function parseQdm1Envelope(hex) {
  const bytes = Buffer.from(hex, 'hex');
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'QDM1');
  const length = bytes.readUInt32BE(80);
  assert.equal(bytes.length, 84 + length, 'QDM1 exact framing');
  return {
    associatedData: Buffer.concat([utf8('QDM1 message v1'), bytes.subarray(0, 68)]).toString('hex'),
    ciphertext: bytes.subarray(84).toString('hex'),
    nonce: bytes.subarray(68, 80).toString('hex'),
  };
}

function parseQpgcMessageEnvelope(hex) {
  const bytes = Buffer.from(hex, 'hex');
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'QPGC');
  assert.equal(bytes[4], 1);
  assert.equal(bytes[5], 1);
  const length = bytes.readUInt32BE(86);
  assert.equal(bytes.length, 90 + length, 'QPGC message exact framing');
  return {
    associatedData: Buffer.concat([utf8('QPGC message v1'), bytes.subarray(6, 74)]).toString('hex'),
    ciphertext: bytes.subarray(90).toString('hex'),
    nonce: bytes.subarray(74, 86).toString('hex'),
  };
}

const { fixture: qortium, source: qortiumSource } = loadPinnedQortiumCoreChatFixture();
validateQortiumCoreFixture(qortium);

const qdm = parseQdm1Envelope(qortium.qdm1.envelope);
assert.equal(qdm.associatedData, qortium.qdm1.associatedData);
assert.equal(qdm.ciphertext, qortium.qdm1.ciphertext);
assert.equal(
  (await decryptAesGcm({ ...qdm, key: qortium.qdm1.sharedKey })).toString('utf8'),
  qortium.qdm1.plaintextUtf8,
);

const qpgc = parseQpgcMessageEnvelope(qortium.qpgc.message.envelope);
assert.equal(qpgc.associatedData, qortium.qpgc.message.associatedData);
assert.equal(qpgc.ciphertext, qortium.qpgc.message.ciphertext);
assert.equal(
  (await decryptAesGcm({ ...qpgc, key: qortium.qpgc.groupKey })).toString('utf8'),
  qortium.qpgc.message.plaintextUtf8,
);

for (const id of ['qdm1-wrong-recipient-key', 'qdm1-wrong-nonce', 'qdm1-bad-tag']) {
  const testCase = qortium.interopCases.negativeCases.find((entry) => entry.id === id);
  const mutated = mutateHexSource(resolveFixtureValue(qortium, testCase.source), testCase.mutation);
  const parsed = parseQdm1Envelope(mutated);
  await assert.rejects(() => decryptAesGcm({ ...parsed, key: qortium.qdm1.sharedKey }), undefined, id);
}
assert.throws(
  () => parseQdm1Envelope(`${qortium.qdm1.envelope}00`),
  /exact framing/,
  'QDM1 trailing byte',
);

for (const id of ['qpgc-wrong-group', 'qpgc-wrong-epoch', 'qpgc-wrong-key-id', 'qpgc-wrong-nonce', 'qpgc-bad-tag']) {
  const testCase = qortium.interopCases.negativeCases.find((entry) => entry.id === id);
  const mutated = mutateHexSource(resolveFixtureValue(qortium, testCase.source), testCase.mutation);
  const parsed = parseQpgcMessageEnvelope(mutated);
  await assert.rejects(() => decryptAesGcm({ ...parsed, key: qortium.qpgc.groupKey }), undefined, id);
}
assert.throws(
  () => parseQpgcMessageEnvelope(`${qortium.qpgc.message.envelope}00`),
  /exact framing/,
  'QPGC trailing byte',
);

for (const transaction of Object.values(qortium.chatTransactions)) {
  assert.equal(
    nacl.sign.detached.verify(
      hexBytes(transaction.unsigned),
      hexBytes(transaction.signature),
      hexBytes(qortium.accounts[transaction.sender].publicKey),
    ),
    true,
  );
}

for (const item of ['keyAnnouncement', 'keyRequest', 'currentKeyRequest', 'rotationRequest']) {
  const entry = qortium.qpgc[item];
  const signer = entry.announcer || entry.requester;
  assert.equal(
    nacl.sign.detached.verify(
      hexBytes(entry.signingBytes),
      hexBytes(entry.signature),
      hexBytes(qortium.accounts[signer].publicKey),
    ),
    true,
    `Qortium ${item} signature`,
  );
}

const { fixture: qortal, source: qortalSource } = loadPinnedQortalChatFixture();
validateQortalFixture(qortal);

for (const [name, chatReference] of [
  ['initialTransaction', null],
  ['editTransaction', qortal.common.chatReference],
  ['reactionTransaction', qortal.common.chatReference],
]) {
  const payloadName = name.replace('Transaction', '');
  const expected = qortal.publicGroup[name];
  const unsigned = buildUnsignedQortalGroupChatTransactionBytes({
    ...(chatReference ? { chatReference: hexBytes(chatReference) } : {}),
    lastReference: hexBytes(qortal.common.lastReference),
    message: qortal.publicGroup.payloads[payloadName],
    senderPublicKey: hexBytes(qortal.accounts.alice.publicKey),
    timestamp: qortal.common.timestamp,
    txGroupId: qortal.common.groupId,
  });
  const stamped = stampQortalGroupChatNonce(unsigned, qortal.common.proofOfWorkNonce);
  assert.equal(Buffer.from(stamped).toString('hex'), expected.unsigned, `${name} unsigned bytes`);
}

for (const [label, transaction] of [
  ['public initial', qortal.publicGroup.initialTransaction],
  ['public edit', qortal.publicGroup.editTransaction],
  ['public reaction', qortal.publicGroup.reactionTransaction],
  ['legacy direct', qortal.directMessage],
  ['join group', qortal.groupTransactions.join],
  ['leave group', qortal.groupTransactions.leave],
]) {
  assert.equal(
    nacl.sign.detached.verify(
      hexBytes(transaction.unsigned),
      hexBytes(transaction.signature),
      hexBytes(qortal.accounts.alice.publicKey),
    ),
    true,
    `${label} signature`,
  );
}

const directPlaintext = nacl.secretbox.open(
  hexBytes(qortal.directMessage.ciphertext),
  hexBytes(qortal.common.lastReference).subarray(0, 24),
  hexBytes(qortal.directMessage.encryptionKey),
);
assert.ok(directPlaintext, 'Qortal legacy direct message authentication');
assert.equal(Buffer.from(directPlaintext).toString('utf8'), qortal.directMessage.plaintext);
const badDirectCiphertext = hexBytes(qortal.directMessage.ciphertext);
badDirectCiphertext[badDirectCiphertext.length - 1] ^= 1;
assert.equal(
  nacl.secretbox.open(
    badDirectCiphertext,
    hexBytes(qortal.common.lastReference).subarray(0, 24),
    hexBytes(qortal.directMessage.encryptionKey),
  ),
  null,
  'Qortal direct bad tag',
);
const badDirectNonce = hexBytes(qortal.common.lastReference).subarray(0, 24);
badDirectNonce[0] ^= 1;
assert.equal(
  nacl.secretbox.open(
    hexBytes(qortal.directMessage.ciphertext),
    badDirectNonce,
    hexBytes(qortal.directMessage.encryptionKey),
  ),
  null,
  'Qortal direct wrong reference-derived nonce',
);
assert.equal(
  nacl.secretbox.open(
    hexBytes(qortal.directMessage.ciphertext),
    hexBytes(qortal.common.lastReference).subarray(0, 24),
    hexBytes(qortal.privateGroup.messageKey),
  ),
  null,
  'Qortal direct wrong recipient-derived key',
);

const privateBundle = Buffer.from(qortal.privateGroup.encryptedBundle, 'base64');
const bundlePlaintextLength = utf8(qortal.privateGroup.bundlePlaintext).length;
const encryptedBundleData = privateBundle.subarray(104, 104 + bundlePlaintextLength + 16);
const decryptedBundle = nacl.secretbox.open(
  encryptedBundleData,
  hexBytes(qortal.privateGroup.bundleNonce),
  hexBytes(qortal.privateGroup.bundleEncryptionKey),
);
assert.ok(decryptedBundle, 'Qortal private key bundle authentication');
assert.equal(Buffer.from(decryptedBundle).toString('utf8'), qortal.privateGroup.bundlePlaintext);

const bobWrappedBundleKey = privateBundle.subarray(
  104 + bundlePlaintextLength + 16,
  104 + bundlePlaintextLength + 16 + 48,
);
const unwrappedBundleKey = nacl.secretbox.open(
  bobWrappedBundleKey,
  hexBytes(qortal.privateGroup.keyNonce),
  hexBytes(qortal.directMessage.sharedSecret),
);
assert.ok(unwrappedBundleKey, 'Qortal Bob bundle-key wrapper authentication');
assert.equal(Buffer.from(unwrappedBundleKey).toString('hex'), qortal.privateGroup.bundleEncryptionKey);

for (const [entry, expectedBase64] of [
  [qortal.privateGroup.encryptSingle, qortal.privateGroup.singlePlaintextBase64],
  [qortal.privateGroup.reaction, Buffer.from(qortal.publicGroup.payloads.reaction).toString('base64')],
]) {
  const decoded = Buffer.from(entry.ciphertext, 'base64');
  const plaintext = nacl.secretbox.open(
    decoded.subarray(37),
    decoded.subarray(13, 37),
    hexBytes(qortal.privateGroup.messageKey),
  );
  assert.ok(plaintext, `Qortal encryptSingle type ${entry.typeNumber} authentication`);
  assert.equal(Buffer.from(plaintext).toString('base64'), expectedBase64);
}
const oldDecoded = Buffer.from(qortal.privateGroup.oldEncryptSingle.ciphertext, 'base64').toString('ascii');
const oldPlaintext = nacl.secretbox.open(
  Buffer.from(oldDecoded.slice(10), 'base64'),
  hexBytes(qortal.privateGroup.oldEncryptSingle.nonce),
  hexBytes(qortal.privateGroup.messageKey),
);
assert.ok(oldPlaintext, 'Qortal old encryptSingle authentication');
assert.equal(Buffer.from(oldPlaintext).toString('base64'), qortal.privateGroup.singlePlaintextBase64);

const badJoin = hexBytes(qortal.groupTransactions.join.signed);
badJoin[badJoin.length - 1] ^= 1;
assert.equal(
  nacl.sign.detached.verify(
    badJoin.subarray(0, badJoin.length - 64),
    badJoin.subarray(badJoin.length - 64),
    hexBytes(qortal.accounts.alice.publicKey),
  ),
  false,
  'Qortal join mutated signature',
);

assert.equal(qortal.resourceDescriptors.userAvatar.identifier, 'qortal_avatar');
assert.equal(qortal.resourceDescriptors.groupAvatar.identifier, 'qortal_group_avatar_12');
assert.match(qortal.resourceDescriptors.publicGroupImage.embedUri, /^qortal:\/\/use-embed\/IMAGE\?/);
assert.match(qortal.resourceDescriptors.privateGroupImage.embedUri, /encryptionType=group$/);

console.log(
  `Home chat interop vectors passed: direct Core fixture ${qortiumSource.commit.slice(0, 9)}, ` +
  `Qortal fixture ${qortalSource.sha256.slice(0, 12)}, crypto/framing negatives and 6 Qortal signatures verified.`,
);
