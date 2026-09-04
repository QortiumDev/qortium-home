import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (relative: string) => readFileSync(
  fileURLToPath(new URL(`../${relative}`, import.meta.url)),
  'utf8',
)

const adapter = read('src/home-v2-live/android-node-client.ts')
const transport = read('android/app/src/main/java/org/qortium/home/HomeV2BoundedHttpPlugin.java')
const storage = read('android/app/src/main/java/org/qortium/home/HomeV2SecureStoragePlugin.java')

assert.match(adapter, /describeAdminRecord\(\{ accountId: key \}\)/)
assert.match(adapter, /apiKey: `\$\{NATIVE_ADMIN_HANDLE_PREFIX\}\$\{record\.bindingId\}`/)
assert.match(adapter, /Android refused to move a node API key through WebView JavaScript/)
const nativeCall = adapter.match(/HomeV2BoundedHttp\.request\(\{([\s\S]*?)\n  \}\)/)?.[1] ?? ''
assert.ok(nativeCall)
assert.doesNotMatch(nativeCall, /\bapiKey\s*:/)
assert.match(nativeCall, /expectedBindingId/)

assert.doesNotMatch(transport, /call\.getString\("apiKey"/)
assert.match(transport, /HomeV2SecureStoragePlugin\.readProtectedValue/)
assert.match(transport, /bindingId\.equals\(expectedBindingId\)/)
assert.match(transport, /Authenticated node request path is not allowed/)
assert.doesNotMatch(transport, /\/admin\/stop/)

assert.match(storage, /ADMIN_CREDENTIAL_ID\.equals\(accountId\)/)
assert.match(storage, /Administrative credentials cannot be unwrapped into JavaScript/)
assert.match(storage, /public void describeAdminRecord/)

console.log('Android native administrative credential boundary tests passed.')
