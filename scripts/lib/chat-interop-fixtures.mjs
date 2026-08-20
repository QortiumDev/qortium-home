import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourcesPath = path.join(repoRoot, 'scripts/fixtures/chat-interop-sources.json');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function assertHex(value, bytes, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]+$/.test(value) || value.length % 2 !== 0) {
    throw new Error(`${label} must be lowercase hexadecimal.`);
  }
  if (bytes != null && value.length !== bytes * 2) {
    throw new Error(`${label} must contain ${bytes} bytes.`);
  }
  return value;
}

export function getInteropSourceLock() {
  return JSON.parse(readFileSync(sourcesPath, 'utf8'));
}

function readPinnedGitFile(repositoryPath, source) {
  const result = spawnSync(
    'git',
    ['-C', repositoryPath, 'show', `${source.commit}:${source.path}`],
    { encoding: null, maxBuffer: 2 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    const detail = Buffer.from(result.stderr || '').toString('utf8').trim();
    throw new Error(detail || `git show failed in ${repositoryPath}`);
  }
  return Buffer.from(result.stdout);
}

function coreRepositoryCandidates() {
  return [
    process.env.QORTIUM_CORE_REPOSITORY,
    path.join(repoRoot, '.interop/qortium-core'),
    path.resolve(repoRoot, '../qortium-core'),
  ].filter((candidate, index, values) => candidate && values.indexOf(candidate) === index);
}

export function loadPinnedQortiumCoreChatFixture() {
  const lock = getInteropSourceLock();
  const source = assertObject(lock.qortiumCore, 'qortiumCore source');
  const failures = [];

  for (const candidate of coreRepositoryCandidates()) {
    if (!existsSync(candidate)) {
      failures.push(`${candidate}: not found`);
      continue;
    }
    try {
      const bytes = readPinnedGitFile(candidate, source);
      const actualHash = sha256(bytes);
      if (actualHash !== source.sha256) {
        throw new Error(`SHA-256 ${actualHash} did not match ${source.sha256}`);
      }
      return {
        fixture: JSON.parse(bytes.toString('utf8')),
        repositoryPath: candidate,
        source,
      };
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    `Unable to read the pinned Qortium Core chat fixture. Set QORTIUM_CORE_REPOSITORY to a Core checkout containing ${source.commit}. ${failures.join('; ')}`,
  );
}

export function loadPinnedQortiumAttachmentFixture() {
  const lock = getInteropSourceLock();
  const source = assertObject(lock.qortiumAttachment, 'qortiumAttachment source');
  const failures = [];

  for (const candidate of coreRepositoryCandidates()) {
    if (!existsSync(candidate)) {
      failures.push(`${candidate}: not found`);
      continue;
    }
    try {
      const bytes = readPinnedGitFile(candidate, source);
      const actualHash = sha256(bytes);
      if (actualHash !== source.sha256) {
        throw new Error(`SHA-256 ${actualHash} did not match ${source.sha256}`);
      }
      return {
        fixture: JSON.parse(bytes.toString('utf8')),
        repositoryPath: candidate,
        source,
      };
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    `Unable to read the pinned Qortium Core attachment fixture. Set QORTIUM_CORE_REPOSITORY to a Core checkout containing ${source.commit}. ${failures.join('; ')}`,
  );
}

export function loadPinnedQortalChatFixture() {
  const lock = getInteropSourceLock();
  const source = assertObject(lock.qortalFixture, 'qortalFixture source');
  const fixturePath = path.join(repoRoot, source.path);
  const bytes = readFileSync(fixturePath);
  const actualHash = sha256(bytes);
  if (actualHash !== source.sha256) {
    throw new Error(`Qortal chat fixture SHA-256 ${actualHash} did not match ${source.sha256}.`);
  }
  return { fixture: JSON.parse(bytes.toString('utf8')), fixturePath, source };
}

export function resolveFixtureValue(fixture, dottedPath) {
  const value = String(dottedPath || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, part) => (current == null ? undefined : current[part]), fixture);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Fixture source ${dottedPath} did not resolve to a string.`);
  }
  return value;
}

export function mutateHexSource(hex, mutation) {
  assertHex(hex, null, 'mutation source');
  const bytes = Buffer.from(hex, 'hex');
  const rule = assertObject(mutation, 'mutation');

  if (rule.kind === 'xorByte') {
    const offset = Number.isInteger(rule.offset)
      ? rule.offset
      : bytes.length - Number(rule.offsetFromEnd);
    if (!Number.isInteger(offset) || offset < 0 || offset >= bytes.length) {
      throw new Error('xorByte mutation offset is outside the source.');
    }
    bytes[offset] ^= Number(rule.xor);
    return bytes.toString('hex');
  }
  if (rule.kind === 'appendByte') {
    return Buffer.concat([bytes, Buffer.from([Number(rule.value)])]).toString('hex');
  }
  if (rule.kind === 'truncateBytes') {
    const count = Number(rule.count);
    if (!Number.isInteger(count) || count < 1 || count >= bytes.length) {
      throw new Error('truncateBytes mutation count is invalid.');
    }
    return bytes.subarray(0, bytes.length - count).toString('hex');
  }
  if (rule.kind === 'replaceUint32LittleEndianFromEnd') {
    const offset = bytes.length - Number(rule.offsetFromEnd);
    if (!Number.isInteger(offset) || offset < 0 || offset + 4 > bytes.length) {
      throw new Error('uint32 mutation offset is outside the source.');
    }
    bytes.writeUInt32LE(Number(rule.value), offset);
    return bytes.toString('hex');
  }
  if (rule.kind === 'replaceAscii') {
    const replacement = Buffer.from(String(rule.value), 'ascii');
    const offset = Number(rule.offset);
    if (!Number.isInteger(offset) || offset < 0 || offset + replacement.length > bytes.length) {
      throw new Error('ASCII mutation is outside the source.');
    }
    replacement.copy(bytes, offset);
    return bytes.toString('hex');
  }
  throw new Error(`Unsupported fixture mutation ${String(rule.kind)}.`);
}

function validateCases(fixture, label) {
  const cases = assertObject(fixture.interopCases, `${label}.interopCases`);
  const entries = [...(cases.positiveVariants || []), ...(cases.negativeCases || [])];
  const ids = new Set();
  for (const entry of entries) {
    assertObject(entry, `${label} case`);
    if (typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) {
      throw new Error(`${label} interop case ids must be non-empty and unique.`);
    }
    ids.add(entry.id);
    if (entry.source) {
      const source = resolveFixtureValue(fixture, entry.source);
      if (entry.mutation) {
        const mutated = mutateHexSource(source, entry.mutation);
        if (mutated === source) throw new Error(`${label} mutation ${entry.id} changed no bytes.`);
      }
    }
  }
}

export function validateQortiumCoreFixture(fixture) {
  assertObject(fixture, 'Qortium Core fixture');
  if (fixture.format !== 'qortium-chat-crypto-v1') throw new Error('Unexpected Qortium fixture format.');
  assertHex(fixture.accounts.alice.privateKey, 32, 'Qortium Alice private key');
  assertHex(fixture.accounts.alice.publicKey, 32, 'Qortium Alice public key');
  assertHex(fixture.accounts.bob.privateKey, 32, 'Qortium Bob private key');
  assertHex(fixture.accounts.bob.publicKey, 32, 'Qortium Bob public key');

  const qdm = Buffer.from(assertHex(fixture.qdm1.envelope, null, 'QDM1 envelope'), 'hex');
  if (qdm.subarray(0, 4).toString('ascii') !== 'QDM1') throw new Error('QDM1 magic mismatch.');
  if (qdm.subarray(4, 36).toString('hex') !== fixture.accounts.alice.publicKey) throw new Error('QDM1 sender mismatch.');
  if (qdm.subarray(36, 68).toString('hex') !== fixture.accounts.bob.publicKey) throw new Error('QDM1 recipient mismatch.');
  if (qdm.subarray(68, 80).toString('hex') !== fixture.qdm1.nonce) throw new Error('QDM1 nonce mismatch.');
  const qdmLength = qdm.readUInt32BE(80);
  if (qdmLength !== Buffer.from(fixture.qdm1.ciphertext, 'hex').length || qdm.length !== 84 + qdmLength) {
    throw new Error('QDM1 length framing mismatch.');
  }

  const qpgc = Buffer.from(assertHex(fixture.qpgc.message.envelope, null, 'QPGC message envelope'), 'hex');
  if (qpgc.subarray(0, 4).toString('ascii') !== 'QPGC' || qpgc[4] !== 1 || qpgc[5] !== 1) {
    throw new Error('QPGC message header mismatch.');
  }
  if (qpgc.readUInt32BE(6) !== fixture.qpgc.groupId) throw new Error('QPGC group mismatch.');
  if (qpgc.subarray(10, 42).toString('hex') !== fixture.qpgc.epochId) throw new Error('QPGC epoch mismatch.');
  if (qpgc.subarray(42, 74).toString('hex') !== fixture.qpgc.keyId) throw new Error('QPGC key id mismatch.');

  for (const [name, transaction] of Object.entries(fixture.chatTransactions)) {
    assertHex(transaction.unsigned, null, `Qortium ${name} unsigned bytes`);
    assertHex(transaction.signature, 64, `Qortium ${name} signature`);
    if (transaction.signed !== transaction.unsigned + transaction.signature) {
      throw new Error(`Qortium ${name} signed bytes do not concatenate unsigned bytes and signature.`);
    }
  }
  validateCases(fixture, 'Qortium');
  return fixture;
}

export function validateQortiumAttachmentFixture(fixture) {
  assertObject(fixture, 'Qortium attachment fixture');
  if (fixture.format !== 'qortium-chat-attachment-v2') {
    throw new Error('Unexpected Qortium attachment fixture format.');
  }
  assertHex(fixture.accounts.alice.privateKey, 32, 'Attachment Alice private key');
  assertHex(fixture.accounts.alice.publicKey, 32, 'Attachment Alice public key');
  assertHex(fixture.accounts.bob.privateKey, 32, 'Attachment Bob private key');
  assertHex(fixture.accounts.bob.publicKey, 32, 'Attachment Bob public key');
  assertHex(fixture.payload.serialized, null, 'QATT payload');
  assertHex(fixture.direct.envelope, null, 'QENC direct envelope');
  assertHex(fixture.group.envelope, null, 'QENC group envelope');
  if (!Array.isArray(fixture.negativeCases) || fixture.negativeCases.length < 4) {
    throw new Error('Qortium attachment negative cases are incomplete.');
  }
  return fixture;
}

export function validateQortalFixture(fixture) {
  assertObject(fixture, 'Qortal fixture');
  if (fixture.format !== 'qortal-chat-interop-v1') throw new Error('Unexpected Qortal fixture format.');
  if (fixture.provenance?.commit !== '4f1d5127eebbb8747056ae8a4b8cb060b2559820') {
    throw new Error('Qortal fixture provenance commit mismatch.');
  }
  if (fixture.provenance?.license !== 'GPL-3.0' || !Array.isArray(fixture.provenance?.sourceFiles)) {
    throw new Error('Qortal fixture provenance is incomplete.');
  }
  for (const source of fixture.provenance.sourceFiles) {
    if (typeof source.path !== 'string' || !source.path.startsWith('src/')) {
      throw new Error('Qortal fixture source path is invalid.');
    }
    assertHex(source.sha256, 32, `Qortal source hash ${source.path}`);
  }
  for (const name of ['alice', 'bob']) {
    assertHex(fixture.accounts[name].seed, 32, `Qortal ${name} seed`);
    assertHex(fixture.accounts[name].publicKey, 32, `Qortal ${name} public key`);
    assertHex(fixture.accounts[name].privateKey, 64, `Qortal ${name} private key`);
    if (fixture.accounts[name].privateKey !== fixture.accounts[name].seed + fixture.accounts[name].publicKey) {
      throw new Error(`Qortal ${name} test private key is not seed plus public key.`);
    }
  }
  assertHex(fixture.common.lastReference, 64, 'Qortal last reference');
  assertHex(fixture.common.chatReference, 64, 'Qortal chat reference');
  for (const [name, transaction] of Object.entries({
    ...fixture.publicGroup,
    directMessage: fixture.directMessage,
    ...fixture.groupTransactions,
  })) {
    if (!transaction || typeof transaction !== 'object' || !transaction.unsigned) continue;
    assertHex(transaction.unsigned, null, `Qortal ${name} unsigned bytes`);
    assertHex(transaction.signature, 64, `Qortal ${name} signature`);
    if (transaction.signed !== transaction.unsigned + transaction.signature) {
      throw new Error(`Qortal ${name} signed bytes do not concatenate unsigned bytes and signature.`);
    }
  }

  const bundle = Buffer.from(fixture.privateGroup.encryptedBundle, 'base64');
  if (bundle.toString('hex') !== fixture.privateGroup.encryptedBundleHex) throw new Error('Qortal bundle encodings disagree.');
  if (bundle.subarray(0, 24).toString('ascii') !== 'qortalGroupEncryptedData') throw new Error('Qortal private bundle marker mismatch.');
  if (bundle.subarray(24, 48).toString('hex') !== fixture.privateGroup.bundleNonce) throw new Error('Qortal bundle nonce mismatch.');
  if (bundle.subarray(48, 72).toString('hex') !== fixture.privateGroup.keyNonce) throw new Error('Qortal bundle key nonce mismatch.');
  if (bundle.subarray(72, 104).toString('hex') !== fixture.accounts.alice.publicKey) throw new Error('Qortal bundle sender mismatch.');
  if (bundle.readUInt32LE(bundle.length - 4) !== 2) throw new Error('Qortal bundle recipient count mismatch.');

  for (const [name, entry, type] of [
    ['message', fixture.privateGroup.encryptSingle, '002'],
    ['reaction', fixture.privateGroup.reaction, '102'],
  ]) {
    const decoded = Buffer.from(entry.ciphertext, 'base64');
    if (decoded.toString('hex') !== entry.decodedHex) throw new Error(`Qortal ${name} encryptSingle encodings disagree.`);
    if (decoded.subarray(0, 10).toString('ascii') !== '0000000001') throw new Error(`Qortal ${name} key version mismatch.`);
    if (decoded.subarray(10, 13).toString('ascii') !== type) throw new Error(`Qortal ${name} type mismatch.`);
    if (decoded.subarray(13, 37).toString('hex') !== entry.nonce) throw new Error(`Qortal ${name} nonce mismatch.`);
  }
  if (!fixture.privateGroup.oldEncryptSingle.decodedText.startsWith('0000000001')) {
    throw new Error('Qortal old encryptSingle key version mismatch.');
  }

  validateCases(fixture, 'Qortal');
  return fixture;
}
