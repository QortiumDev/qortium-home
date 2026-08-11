import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { register } from 'node:module'

const root = mkdtempSync(path.join(tmpdir(), 'qortium-home-v2-recovery-'))
globalThis.__homeV2ElectronTest = {
  app: { getPath: (name) => name === 'userData' ? root : root },
  safeStorage: {},
}
register('./home-v2-electron-test-loader.mjs', import.meta.url)

const recovery = await import('../dist-electron/home-v2-profile-recovery.js')
const walletBody = '{"version":1,"wallets":[],"activeAccountId":null}\n'
writeFileSync(path.join(root, 'wallets.json'), walletBody)

const backupId = recovery.ensureHomeV2ProfileBackup(root)
assert.ok(backupId)
assert.deepEqual(recovery.getHomeV2ProfileRecoveryState(), {
  backupId,
  message: null,
  status: 'ready',
})
assert.equal(recovery.ensureHomeV2ProfileBackup(root), backupId)

writeFileSync(path.join(root, 'wallets.json'), 'changed')
// This curated path did not exist in the original profile. Exact restore must
// displace it rather than leaving post-migration state behind.
mkdirSync(path.join(root, 'Local Storage', 'leveldb'), { recursive: true })
writeFileSync(path.join(root, 'Local Storage', 'leveldb', '000003.log'), 'changed')
recovery.requestHomeV2ProfileRestore()
assert.equal(recovery.restoreHomeV2ProfileIfRequested(root), true)
assert.equal(readFileSync(path.join(root, 'wallets.json'), 'utf8'), walletBody)
assert.equal(existsSync(path.join(root, 'Local Storage')), false)
assert.ok(readdirSync(root).some((entry) => entry.startsWith('Local Storage.home-v2-displaced-')))

const manifest = path.join(root, 'home-v2-recovery', 'backups', backupId, 'manifest.json')
const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
parsed.files[0].sha256 = '0'.repeat(64)
writeFileSync(manifest, `${JSON.stringify(parsed, null, 2)}\n`)
assert.throws(() => recovery.ensureHomeV2ProfileBackup(root), /verification failed/)
assert.equal(recovery.getHomeV2ProfileRecoveryState().status, 'recovery')

console.log('Home v2 profile backup, verification, and exact restore tests passed.')
