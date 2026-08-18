import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { EncryptedQortalPrivateGroupKeyRing } from './home-v2-qortal-private-group-actions.js'

const STORE_FILE = 'home-v2-qortal-private-group-keys.json'
const MAX_STORE_BYTES = 16 * 1024 * 1024
const MAX_RECORDS = 2_048

export type DesktopEncryptedQortalPrivateGroupKeyRing = EncryptedQortalPrivateGroupKeyRing & {
  readonly accountId: string
}

function targetPath(userData: string) { return path.join(userData, STORE_FILE) }

function isRecord(value: unknown): value is DesktopEncryptedQortalPrivateGroupKeyRing {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.version === 1 && record.network === 'qortal' &&
    typeof record.accountId === 'string' && record.accountId.length >= 1 && record.accountId.length <= 256 &&
    typeof record.accountPublicKey === 'string' && record.accountPublicKey.length >= 40 && record.accountPublicKey.length <= 64 &&
    typeof record.ciphertext === 'string' && record.ciphertext.length >= 24 && record.ciphertext.length <= 2_800_000 &&
    Number.isSafeInteger(record.groupId) && (record.groupId as number) > 0 &&
    typeof record.nonce === 'string' && record.nonce.length === 16 &&
    typeof record.publisherName === 'string' && record.publisherName.length >= 1 && record.publisherName.length <= 128 &&
    Number.isSafeInteger(record.recipientCount) && (record.recipientCount as number) >= 1 && (record.recipientCount as number) <= 4_096 &&
    typeof record.resourceSignature === 'string' && record.resourceSignature.length >= 32 && record.resourceSignature.length <= 128
}

function identity(record: DesktopEncryptedQortalPrivateGroupKeyRing) {
  return [record.accountId, record.accountPublicKey, record.groupId, record.publisherName, record.resourceSignature].join('|')
}

export function readEncryptedQortalPrivateGroupRecords(userData: string) {
  const target = targetPath(userData)
  if (!existsSync(target)) return []
  const raw = readFileSync(target)
  if (raw.byteLength > MAX_STORE_BYTES) throw new Error('Qortal private-group key store exceeds its size limit.')
  let value: unknown
  try { value = JSON.parse(raw.toString('utf8')) } catch { throw new Error('Qortal private-group key store is not valid JSON.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Qortal private-group key store is invalid.')
  const store = value as { records?: unknown; version?: unknown }
  if (store.version !== 1 || !Array.isArray(store.records) || store.records.length > MAX_RECORDS || !store.records.every(isRecord)) {
    throw new Error('Qortal private-group key store version or records are invalid.')
  }
  if (new Set(store.records.map(identity)).size !== store.records.length) throw new Error('Qortal private-group key store contains duplicate records.')
  return store.records.map((record) => ({ ...record }))
}

function writeRecords(records: readonly DesktopEncryptedQortalPrivateGroupKeyRing[], userData: string) {
  if (records.length > MAX_RECORDS || !records.every(isRecord)) throw new Error('Qortal private-group key store update is invalid.')
  const target = targetPath(userData)
  const staging = `${target}.tmp-${process.pid}`
  const raw = `${JSON.stringify({ records, version: 1 }, null, 2)}\n`
  if (Buffer.byteLength(raw) > MAX_STORE_BYTES) throw new Error('Qortal private-group key store update exceeds its size limit.')
  mkdirSync(path.dirname(target), { recursive: true })
  try {
    writeFileSync(staging, raw, { encoding: 'utf8', mode: 0o600 })
    renameSync(staging, target)
  } finally {
    rmSync(staging, { force: true })
  }
}

export function upsertEncryptedQortalPrivateGroupRecord(
  record: EncryptedQortalPrivateGroupKeyRing,
  accountId: string,
  userData: string,
) {
  const stored = { ...record, accountId }
  if (!isRecord(stored)) throw new Error('Qortal private-group key record is invalid.')
  const records = readEncryptedQortalPrivateGroupRecords(userData)
  const sameGroup = (candidate: DesktopEncryptedQortalPrivateGroupKeyRing) =>
    candidate.accountId === accountId &&
    candidate.accountPublicKey === stored.accountPublicKey &&
    candidate.groupId === stored.groupId
  writeRecords([...records.filter((candidate) => !sameGroup(candidate)), stored], userData)
}

export function findEncryptedQortalPrivateGroupRecord(input: {
  readonly accountId: string
  readonly accountPublicKey: string
  readonly groupId: number
  readonly userData: string
}) {
  return readEncryptedQortalPrivateGroupRecords(input.userData).find((record) =>
    record.accountId === input.accountId &&
    record.accountPublicKey === input.accountPublicKey &&
    record.groupId === input.groupId,
  ) ?? null
}

export function removeEncryptedQortalPrivateGroupAccountIdRecords(accountId: string, userData: string) {
  const records = readEncryptedQortalPrivateGroupRecords(userData)
  const next = records.filter((record) => record.accountId !== accountId)
  if (next.length === records.length) return false
  writeRecords(next, userData)
  return true
}
