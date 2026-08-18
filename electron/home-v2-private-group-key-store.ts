import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import type { EncryptedQpgcStoredKey } from './home-v2-private-group-chat-actions.js'

const STORE_VERSION = 1
const MAX_RECORDS = 2_048
const MAX_STORE_BYTES = 8 * 1024 * 1024
const STORE_FILE = 'home-v2-private-group-keys.json'

export type DesktopEncryptedQpgcStoredKey = EncryptedQpgcStoredKey & {
  readonly accountId: string
}

type QpgcKeyStoreFile = {
  readonly records: readonly DesktopEncryptedQpgcStoredKey[]
  readonly version: 1
}

function storePath(userData: string) {
  return path.join(userData, STORE_FILE)
}

function isEncryptedQpgcStoredKey(value: unknown): value is DesktopEncryptedQpgcStoredKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.accountId === 'string' && record.accountId.length >= 1 && record.accountId.length <= 256 &&
    record.version === 1 &&
    record.network === 'qortium' &&
    typeof record.accountPublicKey === 'string' && record.accountPublicKey.length <= 64 &&
    typeof record.ciphertext === 'string' && record.ciphertext.length <= 128 &&
    typeof record.epochId === 'string' && record.epochId.length <= 64 &&
    Number.isSafeInteger(record.groupId) && (record.groupId as number) > 0 &&
    typeof record.keyId === 'string' && record.keyId.length <= 64 &&
    typeof record.nonce === 'string' && record.nonce.length <= 32
}

function recordIdentity(record: DesktopEncryptedQpgcStoredKey) {
  return [record.accountId, record.accountPublicKey, record.network, record.groupId, record.epochId, record.keyId].join('|')
}

export function readEncryptedQpgcKeyRecords(userData: string) {
  const target = storePath(userData)
  if (!existsSync(target)) return []
  const raw = readFileSync(target)
  if (raw.byteLength > MAX_STORE_BYTES) throw new Error('Private-group key store exceeds its size limit.')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch {
    throw new Error('Private-group key store is not valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Private-group key store is invalid.')
  }
  const store = parsed as { records?: unknown; version?: unknown }
  if (store.version !== STORE_VERSION || !Array.isArray(store.records) || store.records.length > MAX_RECORDS) {
    throw new Error('Private-group key store version or record count is invalid.')
  }
  if (!store.records.every(isEncryptedQpgcStoredKey)) {
    throw new Error('Private-group key store contains an invalid record.')
  }
  const identities = new Set(store.records.map(recordIdentity))
  if (identities.size !== store.records.length) {
    throw new Error('Private-group key store contains duplicate records.')
  }
  return store.records.map((record) => ({ ...record }))
}

function writeEncryptedQpgcKeyRecords(
  records: readonly DesktopEncryptedQpgcStoredKey[],
  userData: string,
) {
  if (records.length > MAX_RECORDS || !records.every(isEncryptedQpgcStoredKey)) {
    throw new Error('Private-group key store update is invalid.')
  }
  const target = storePath(userData)
  const staging = `${target}.tmp-${process.pid}`
  const store: QpgcKeyStoreFile = { records, version: STORE_VERSION }
  const raw = `${JSON.stringify(store, null, 2)}\n`
  if (Buffer.byteLength(raw) > MAX_STORE_BYTES) throw new Error('Private-group key store update exceeds its size limit.')
  mkdirSync(path.dirname(target), { recursive: true })
  try {
    writeFileSync(staging, raw, { encoding: 'utf8', mode: 0o600 })
    renameSync(staging, target)
  } finally {
    rmSync(staging, { force: true })
  }
}

export function upsertEncryptedQpgcKeyRecord(
  record: EncryptedQpgcStoredKey,
  accountId: string,
  userData: string,
) {
  const stored = { ...record, accountId }
  if (!isEncryptedQpgcStoredKey(stored)) throw new Error('Private-group key record is invalid.')
  const identity = recordIdentity(stored)
  const records = readEncryptedQpgcKeyRecords(userData)
  const next = [...records.filter((candidate) => recordIdentity(candidate) !== identity), stored]
  writeEncryptedQpgcKeyRecords(next, userData)
}

export function removeEncryptedQpgcAccountRecords(
  accountPublicKey: string,
  userData: string,
) {
  const records = readEncryptedQpgcKeyRecords(userData)
  const next = records.filter((record) => record.accountPublicKey !== accountPublicKey)
  if (next.length === records.length) return false
  writeEncryptedQpgcKeyRecords(next, userData)
  return true
}

export function removeEncryptedQpgcAccountIdRecords(
  accountId: string,
  userData: string,
) {
  const records = readEncryptedQpgcKeyRecords(userData)
  const next = records.filter((record) => record.accountId !== accountId)
  if (next.length === records.length) return false
  writeEncryptedQpgcKeyRecords(next, userData)
  return true
}

export function findEncryptedQpgcKeyRecords(input: {
  readonly accountPublicKey: string
  readonly accountId: string
  readonly epochId?: string
  readonly groupId: number
  readonly keyId?: string
  readonly userData?: string
}) {
  if (!input.userData) throw new Error('Private-group key store path is missing.')
  return readEncryptedQpgcKeyRecords(input.userData).filter((record) =>
    record.accountPublicKey === input.accountPublicKey &&
    record.groupId === input.groupId &&
    (input.epochId === undefined || record.epochId === input.epochId) &&
    (input.keyId === undefined || record.keyId === input.keyId)
  ).sort((left, right) => Number(left.accountId === input.accountId) - Number(right.accountId === input.accountId))
}
