import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { register } from 'node:module'

const root = mkdtempSync(path.join(tmpdir(), 'qortium-home-v2-security-'))
let backend = 'gnome_libsecret'
globalThis.__homeV2ElectronTest = {
  app: { getPath: () => root },
  safeStorage: {
    decryptString: (value) => Buffer.from(value).toString('utf8').replace(/^wrapped:/, ''),
    encryptString: (value) => Buffer.from(`wrapped:${value}`, 'utf8'),
    getSelectedStorageBackend: () => backend,
    isEncryptionAvailable: () => true,
  },
}
register('./home-v2-electron-test-loader.mjs', import.meta.url)

const security = await import('../dist-electron/home-v2-account-security.js')
const accountId = 'wallet:Qtest'
assert.equal(security.isHomeV2SecureStorageAvailable(), true)
backend = 'basic_text'
assert.equal(security.isHomeV2SecureStorageAvailable(), false)
backend = 'gnome_libsecret'

const key = Uint8Array.from({ length: 64 }, (_, index) => index)
security.setHomeV2RememberedKey(accountId, key)
assert.deepEqual(security.getHomeV2RememberedKey(accountId), key)
assert.deepEqual(security.getHomeV2AccountSecurity(accountId), {
  lockOnExit: true,
  manuallyLocked: false,
  rememberUnlock: true,
})
security.markHomeV2AccountManuallyLocked(accountId)
assert.equal(security.getHomeV2RememberedKey(accountId), null)
security.clearHomeV2AccountManualLock(accountId)
security.updateHomeV2AccountSecurity(accountId, { lockOnExit: false })
assert.deepEqual(security.getHomeV2AutoUnlockAccountIds(accountId), [accountId])
security.updateHomeV2AccountSecurity(accountId, { rememberUnlock: false })
assert.deepEqual(security.getHomeV2AccountSecurity(accountId), {
  lockOnExit: true,
  manuallyLocked: false,
  rememberUnlock: false,
})

security.setHomeV2RememberedKey(accountId, key)
const storePath = path.join(root, 'home-v2-account-security.json')
const store = JSON.parse(readFileSync(storePath, 'utf8'))
store.accounts[accountId].wrappedKey = Buffer.from('not wrapped', 'utf8').toString('base64')
writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`)
assert.equal(security.getHomeV2RememberedKey(accountId), null)
assert.equal(security.getHomeV2AccountSecurity(accountId).rememberUnlock, false)

console.log('Home v2 secure-storage and remembered-lock state tests passed.')
