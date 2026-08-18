import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  findEncryptedQpgcKeyRecords,
  readEncryptedQpgcKeyRecords,
  removeEncryptedQpgcAccountIdRecords,
  removeEncryptedQpgcAccountRecords,
  upsertEncryptedQpgcKeyRecord,
} from './home-v2-private-group-key-store.js'

const userData = mkdtempSync(path.join(tmpdir(), 'qortium-home-qpgc-store-'))
const accountId = 'wallet-1:address-0'
const record = {
  accountPublicKey: 'ERITFBUWFxgZGhscHR4fICEiIyQlJicoKSorLC0uLzA=',
  ciphertext: 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5',
  epochId: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=',
  groupId: 12,
  keyId: 'ISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0A=',
  network: 'qortium' as const,
  nonce: 'cXJzdHV2d3h5ent8',
  version: 1 as const,
}

assert.deepEqual(readEncryptedQpgcKeyRecords(userData), [])
upsertEncryptedQpgcKeyRecord(record, accountId, userData)
assert.deepEqual(readEncryptedQpgcKeyRecords(userData), [{ ...record, accountId }])
const storePath = path.join(userData, 'home-v2-private-group-keys.json')
if (process.platform !== 'win32') {
  assert.equal(statSync(storePath).mode & 0o777, 0o600, 'private-group key store is owner-only')
}
assert.equal(readFileSync(storePath, 'utf8').includes('groupKey'), false, 'store never contains a plaintext key field')

const replacement = { ...record, ciphertext: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWZnaGlqa2xt' }
upsertEncryptedQpgcKeyRecord(replacement, accountId, userData)
assert.deepEqual(readEncryptedQpgcKeyRecords(userData), [{ ...replacement, accountId }], 'upsert replaces the same key identity')
assert.deepEqual(findEncryptedQpgcKeyRecords({
  accountId,
  accountPublicKey: record.accountPublicKey,
  groupId: record.groupId,
  userData,
}), [{ ...replacement, accountId }])

const reimportedAccountId = 'wallet-2:address-0'
assert.deepEqual(findEncryptedQpgcKeyRecords({
  accountId: reimportedAccountId,
  accountPublicKey: record.accountPublicKey,
  groupId: record.groupId,
  userData,
}), [{ ...replacement, accountId }], 'a re-imported wallet can recover keys bound to the same public key')

const reimportedReplacement = {
  ...record,
  ciphertext: 'YmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5emFiY2RlZmdoaWprbG1u',
}
upsertEncryptedQpgcKeyRecord(reimportedReplacement, reimportedAccountId, userData)
assert.deepEqual(findEncryptedQpgcKeyRecords({
  accountId: reimportedAccountId,
  accountPublicKey: record.accountPublicKey,
  groupId: record.groupId,
  userData,
}), [
  { ...replacement, accountId },
  { ...reimportedReplacement, accountId: reimportedAccountId },
], 'the current local account record is tried before an older re-import record')

assert.equal(removeEncryptedQpgcAccountIdRecords('different-account', userData), false)
assert.equal(removeEncryptedQpgcAccountIdRecords(accountId, userData), true)
assert.deepEqual(readEncryptedQpgcKeyRecords(userData), [{ ...reimportedReplacement, accountId: reimportedAccountId }])
assert.equal(removeEncryptedQpgcAccountIdRecords(reimportedAccountId, userData), true)
assert.deepEqual(readEncryptedQpgcKeyRecords(userData), [])
upsertEncryptedQpgcKeyRecord(replacement, accountId, userData)
assert.equal(removeEncryptedQpgcAccountRecords(record.accountPublicKey, userData), true)
assert.deepEqual(readEncryptedQpgcKeyRecords(userData), [])
assert.equal(removeEncryptedQpgcAccountRecords(record.accountPublicKey, userData), false)

writeFileSync(storePath, '{not json', 'utf8')
assert.throws(() => readEncryptedQpgcKeyRecords(userData), /not valid JSON/)

console.log('Home v2 private-group key store tests passed')
