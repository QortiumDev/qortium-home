import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  findEncryptedQortalPrivateGroupRecord,
  readEncryptedQortalPrivateGroupRecords,
  removeEncryptedQortalPrivateGroupAccountIdRecords,
  upsertEncryptedQortalPrivateGroupRecord,
} from './home-v2-qortal-private-group-key-store.js'

const userData = mkdtempSync(path.join(tmpdir(), 'qortium-home-qortal-private-store-'))
const record = {
  accountPublicKey: Buffer.alloc(32, 1).toString('base64'),
  ciphertext: Buffer.alloc(80, 2).toString('base64'),
  groupId: 12,
  network: 'qortal' as const,
  nonce: Buffer.alloc(12, 3).toString('base64'),
  publisherName: 'Alice',
  recipientCount: 2,
  resourceSignature: '4ES8QtY4rzwkEvWz7R1ApGLsAvymgBRSqZdQUGiTrrEazQCiMpmUFnyU6bwySrM7ULpH6e7frgkF17gQ7wsTy3oD',
  version: 1 as const,
}

try {
  assert.deepEqual(readEncryptedQortalPrivateGroupRecords(userData), [])
  upsertEncryptedQortalPrivateGroupRecord(record, 'wallet:1', userData)
  assert.deepEqual(findEncryptedQortalPrivateGroupRecord({
    accountId: 'wallet:1',
    accountPublicKey: record.accountPublicKey,
    groupId: 12,
    userData,
  }), { ...record, accountId: 'wallet:1' })
  upsertEncryptedQortalPrivateGroupRecord({ ...record, ciphertext: Buffer.alloc(96, 4).toString('base64') }, 'wallet:1', userData)
  assert.equal(readEncryptedQortalPrivateGroupRecords(userData).length, 1)
  assert.equal(removeEncryptedQortalPrivateGroupAccountIdRecords('other', userData), false)
  assert.equal(removeEncryptedQortalPrivateGroupAccountIdRecords('wallet:1', userData), true)
  assert.deepEqual(readEncryptedQortalPrivateGroupRecords(userData), [])
} finally {
  rmSync(userData, { force: true, recursive: true })
}

console.log('Home v2 Qortal private-group key-store tests passed.')
