import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const SECURITY_FILE = 'home-v2-account-security.json'
const SECURITY_VERSION = 1

type StoredAccountSecurity = {
  lockOnExit: boolean
  manuallyLocked: boolean
  rememberUnlock: boolean
  wrappedKey?: string
}

type SecurityStore = {
  accounts: Record<string, StoredAccountSecurity>
  version: typeof SECURITY_VERSION
}

export type HomeV2AccountSecurity = Omit<StoredAccountSecurity, 'wrappedKey'>

const DEFAULT_SECURITY: HomeV2AccountSecurity = Object.freeze({
  lockOnExit: true,
  manuallyLocked: false,
  rememberUnlock: false,
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function getSecurityPath() {
  return path.join(app.getPath('userData'), SECURITY_FILE)
}

function emptyStore(): SecurityStore {
  return { accounts: {}, version: SECURITY_VERSION }
}

function parseAccountSecurity(value: unknown): StoredAccountSecurity | null {
  if (!isRecord(value)) return null
  return {
    lockOnExit: value.lockOnExit !== false,
    manuallyLocked: value.manuallyLocked === true,
    rememberUnlock: value.rememberUnlock === true,
    ...(typeof value.wrappedKey === 'string' && value.wrappedKey
      ? { wrappedKey: value.wrappedKey }
      : {}),
  }
}

function readStore(): SecurityStore {
  const securityPath = getSecurityPath()
  if (!existsSync(securityPath)) return emptyStore()
  try {
    const value: unknown = JSON.parse(readFileSync(securityPath, 'utf8'))
    if (!isRecord(value) || !isRecord(value.accounts)) return emptyStore()
    const accounts: Record<string, StoredAccountSecurity> = {}
    for (const [accountId, candidate] of Object.entries(value.accounts)) {
      const security = parseAccountSecurity(candidate)
      if (accountId && security) accounts[accountId] = security
    }
    return { accounts, version: SECURITY_VERSION }
  } catch {
    return emptyStore()
  }
}

function writeStore(store: SecurityStore) {
  const securityPath = getSecurityPath()
  mkdirSync(path.dirname(securityPath), { recursive: true })
  writeFileSync(securityPath, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

function accountEntry(store: SecurityStore, accountId: string): StoredAccountSecurity {
  return store.accounts[accountId] ?? { ...DEFAULT_SECURITY }
}

export function isHomeV2SecureStorageAvailable() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    if (process.platform !== 'linux') return true
    const backend = safeStorage.getSelectedStorageBackend()
    return backend !== 'basic_text' && backend !== 'unknown'
  } catch {
    return false
  }
}

export function getHomeV2AccountSecurity(accountId: string): HomeV2AccountSecurity {
  const { wrappedKey: _wrappedKey, ...summary } = accountEntry(readStore(), accountId)
  return summary
}

export function setHomeV2RememberedKey(accountId: string, key: Uint8Array) {
  if (!isHomeV2SecureStorageAvailable()) {
    throw new Error('Secure device storage is not available. Remembered unlock cannot be enabled.')
  }
  const store = readStore()
  const current = accountEntry(store, accountId)
  const keyBuffer = Buffer.from(key)
  let wrapped: Buffer
  try {
    wrapped = safeStorage.encryptString(keyBuffer.toString('base64'))
  } finally {
    keyBuffer.fill(0)
  }
  store.accounts[accountId] = {
    ...current,
    manuallyLocked: false,
    rememberUnlock: true,
    wrappedKey: wrapped.toString('base64'),
  }
  writeStore(store)
}

export function getHomeV2RememberedKey(accountId: string): Uint8Array | null {
  const store = readStore()
  const security = accountEntry(store, accountId)
  if (!security.rememberUnlock || security.manuallyLocked || !security.wrappedKey) return null
  if (!isHomeV2SecureStorageAvailable()) return null
  try {
    const plaintext = safeStorage.decryptString(Buffer.from(security.wrappedKey, 'base64'))
    const key = Buffer.from(plaintext, 'base64')
    if (key.byteLength !== 64) throw new Error('Invalid remembered unlock key length.')
    const result = Uint8Array.from(key)
    key.fill(0)
    return result
  } catch {
    delete security.wrappedKey
    security.rememberUnlock = false
    security.lockOnExit = true
    store.accounts[accountId] = security
    writeStore(store)
    return null
  }
}

export function updateHomeV2AccountSecurity(
  accountId: string,
  update: { lockOnExit?: boolean; rememberUnlock?: boolean },
) {
  const store = readStore()
  const current = accountEntry(store, accountId)
  if (update.rememberUnlock === false) {
    delete current.wrappedKey
    current.rememberUnlock = false
    current.lockOnExit = true
  }
  if (typeof update.lockOnExit === 'boolean') current.lockOnExit = update.lockOnExit
  store.accounts[accountId] = current
  writeStore(store)
  return getHomeV2AccountSecurity(accountId)
}

export function markHomeV2AccountManuallyLocked(accountId: string) {
  const store = readStore()
  const current = accountEntry(store, accountId)
  current.manuallyLocked = true
  store.accounts[accountId] = current
  writeStore(store)
}

export function clearHomeV2AccountManualLock(accountId: string) {
  const store = readStore()
  const current = accountEntry(store, accountId)
  current.manuallyLocked = false
  store.accounts[accountId] = current
  writeStore(store)
}

export function removeHomeV2AccountSecurity(accountId: string) {
  const store = readStore()
  if (!(accountId in store.accounts)) return
  delete store.accounts[accountId]
  writeStore(store)
}

export function getHomeV2AutoUnlockAccountIds(selectedAccountId: string | null) {
  if (!selectedAccountId) return []
  const store = readStore()
  const security = accountEntry(store, selectedAccountId)
  return security.rememberUnlock && !security.lockOnExit && !security.manuallyLocked
    ? [selectedAccountId]
    : []
}
