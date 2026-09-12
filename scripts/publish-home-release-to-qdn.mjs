#!/usr/bin/env node
// Publishes a Home release to QDN so Home can find and download it without
// GitHub: one FILE resource per package, a JSON manifest naming them with
// their SHA-256 digests, and a JSON channel pointer naming the newest tag.
// The shapes are the ones electron/home-v2-release-manifest.ts reads.
//
//   node scripts/publish-home-release-to-qdn.mjs --tag v2.1.0-beta.4 [--assets-dir DIR] [--dry-run] [--force]
//
// Assets are taken from --assets-dir when given (file names as released),
// otherwise downloaded from the GitHub release into ~/.cache/qortium-home-qdn-release/<tag>/
// and verified against the digests GitHub records. Publishing signs with the
// preview accounts file's "local" role (the QortiumHomeTest publisher) via
// the LOCAL node's /transactions/sign -- never across a network.
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const PUBLISHER = 'QortiumHomeTest'
const MANIFEST_SCHEMA = 'qortium-home-release'
const REPOSITORY = 'QortiumDev/qortium-home'
const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS = 30 * 60 * 1000
const PLATFORM_BY_SUFFIX = [
  ['-x86_64.AppImage', 'linux-x64'],
  ['-arm64.AppImage', 'linux-arm64'],
  ['-x64.exe', 'windows-x64'],
  ['-macos11-universal.dmg', 'macos11-universal'],
  ['-macos1015-x64.dmg', 'macos1015-x64'],
  ['-universal.dmg', 'macos-universal'],
  ['-android-release.apk', 'android'],
]

const args = process.argv.slice(2)
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const flag = (name) => args.includes(name)
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const packageVersion = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version
const tag = option('--tag') ?? `v${packageVersion}`
const dryRun = flag('--dry-run')
const force = flag('--force')
const nodeApiUrl = (process.env.QORTIUM_HOME_NODE_API_URL ?? 'http://127.0.0.1:24891').replace(/\/+$/, '')
const previewAccountsPath = expandHome(process.env.QORTIUM_HOME_PREVIEW_ACCOUNTS_PATH ?? '~/qortium/git/qortium-core/preview/secrets/initial-minting-accounts.json')
const cacheDir = path.join(homedir(), '.cache', 'qortium-home-qdn-release', tag)
const log = (message) => console.log(`[qdn-release] ${message}`)

if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(tag)) throw new Error(`Tag ${tag} is not a release tag.`)
const prerelease = tag.includes('-')
const manifestIdentifier = `home-release-${tag}`
const channelIdentifier = `home-latest-${prerelease ? 'prerelease' : 'stable'}`
if (manifestIdentifier.length > 64) throw new Error('The manifest identifier exceeds QDN\'s 64-byte cap.')

function expandHome(value) { return value.startsWith('~/') ? path.join(homedir(), value.slice(2)) : value }
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(filePath).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')))
  })
}
function platformFor(name) {
  for (const [suffix, platform] of PLATFORM_BY_SUFFIX) if (name.endsWith(suffix)) return platform
  return null
}

// --- node access (mirrors the app publish scripts: key from the running local Core) ---
function readText(filePath) { return readFileSync(filePath, 'utf8').trim() }
function runningLocalCoreApiKey() {
  const wanted = Number(new URL(nodeApiUrl).port || 80)
  const found = []
  for (const entry of readdirSync('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    try {
      const procPath = path.join('/proc', entry.name)
      const cmdline = readFileSync(path.join(procPath, 'cmdline'), 'utf8').split('\0').filter(Boolean)
      if (!cmdline.some((arg) => /qortium.*\.jar$/i.test(arg))) continue
      const cwd = readlinkSync(path.join(procPath, 'cwd'))
      const settingsArg = cmdline.find((arg) => arg.endsWith('.json'))
      const settingsPath = settingsArg ? (path.isAbsolute(settingsArg) ? settingsArg : path.join(cwd, settingsArg)) : path.join(cwd, 'settings.json')
      if (!existsSync(settingsPath)) continue
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
      if (Number(settings.apiPort) !== wanted) continue
      const keyDir = settings.apiKeyPath ? (path.isAbsolute(settings.apiKeyPath) ? settings.apiKeyPath : path.join(cwd, settings.apiKeyPath)) : cwd
      const keyPath = path.join(keyDir, 'apikey.txt')
      if (existsSync(keyPath)) found.push(readText(keyPath))
    } catch {
      // processes come and go while /proc is read
    }
  }
  return found.length === 1 ? found[0] : null
}
const apiKey = process.env.QORTIUM_HOME_NODE_API_KEY?.trim()
  || (process.env.QORTIUM_HOME_NODE_API_KEY_PATH ? readText(expandHome(process.env.QORTIUM_HOME_NODE_API_KEY_PATH)) : null)
  || runningLocalCoreApiKey()
  || (existsSync(expandHome('~/.config/qortium-core/runtime/apikey.txt')) ? readText(expandHome('~/.config/qortium-core/runtime/apikey.txt')) : null)
if (!apiKey) throw new Error('No node API key: set QORTIUM_HOME_NODE_API_KEY(_PATH) or run beside the local Core.')
const headers = (contentType) => ({ 'X-API-KEY': apiKey, ...(contentType ? { 'Content-Type': contentType } : {}) })

async function request(pathname, options = {}) {
  const response = await fetch(`${nodeApiUrl}${pathname}`, options)
  const text = await response.text()
  if (!response.ok) throw new Error(text || `${options.method ?? 'GET'} ${pathname} failed with HTTP ${response.status}.`)
  return text
}
const requestJson = async (pathname, options) => { const text = await request(pathname, options); return text ? JSON.parse(text) : null }

async function signAndProcess(rawUnsignedBytes58, privateKey58) {
  const withNonce = await request('/arbitrary/compute', { method: 'POST', headers: headers('text/plain'), body: rawUnsignedBytes58 })
  const signed = await request('/transactions/sign', { method: 'POST', headers: headers('application/json'), body: JSON.stringify({ privateKey: privateKey58, transactionBytes: withNonce }) })
  const result = (await request('/transactions/process', { method: 'POST', headers: headers('text/plain'), body: signed })).trim()
  if (result !== 'true') {
    let parsed
    try { parsed = JSON.parse(result) } catch { throw new Error(`Transaction was not accepted: ${result.slice(0, 300)}`) }
    if (!parsed || typeof parsed !== 'object' || parsed.error !== undefined || typeof parsed.type !== 'string') {
      throw new Error(`Transaction was not accepted: ${result.slice(0, 300)}`)
    }
  }
}

async function resourceExists(service, identifier) {
  const found = await requestJson(`/arbitrary/resources/search?service=${service}&name=${encodeURIComponent(PUBLISHER)}&identifier=${encodeURIComponent(identifier)}&exactmatch=true&limit=1`)
  return Array.isArray(found) && found.length > 0
}

async function waitReady(service, identifier) {
  const startedAt = Date.now()
  let last = 'unknown'
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const status = await requestJson(`/arbitrary/resource/status/${service}/${encodeURIComponent(PUBLISHER)}/${encodeURIComponent(identifier)}?build=true`, { headers: headers() }).catch(() => null)
    last = status?.status ?? last
    if (last === 'READY') return
    if (last === 'BLOCKED' || last === 'BUILD_FAILED') throw new Error(`${service}/${identifier} status is ${last}.`)
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`Timed out waiting for ${service}/${identifier} (last status ${last}).`)
}

async function publish(service, identifier, filePath, title, account) {
  if (!force && await resourceExists(service, identifier)) {
    log(`${service}/${PUBLISHER}/${identifier} already published; skipping (use --force to republish)`)
    return
  }
  if (dryRun) { log(`DRY RUN: would publish ${service}/${PUBLISHER}/${identifier} from ${filePath}`); return }
  log(`publishing ${service}/${PUBLISHER}/${identifier} (${statSync(filePath).size} bytes)`)
  const raw = await request(`/arbitrary/${service}/${encodeURIComponent(PUBLISHER)}/${encodeURIComponent(identifier)}?title=${encodeURIComponent(title)}&fee=0`, {
    method: 'POST', headers: headers('text/plain'), body: filePath,
  })
  await signAndProcess(raw, account.accountPrivateKey)
  await waitReady(service, identifier)
  log(`READY ${service}/${PUBLISHER}/${identifier}`)
}

// --- assets ---
async function githubRelease() {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/tags/${encodeURIComponent(tag)}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'QortiumHome-qdn-release' } })
  if (!response.ok) throw new Error(`GitHub release ${tag}: HTTP ${response.status}`)
  return response.json()
}
async function collectAssets() {
  const assetsDir = option('--assets-dir')
  const files = []
  if (assetsDir) {
    for (const name of readdirSync(assetsDir)) {
      if (platformFor(name) && name.includes(tag.slice(1))) files.push({ name, filePath: path.join(assetsDir, name), expectedDigest: null })
    }
  } else {
    const release = await githubRelease()
    if (release.draft) throw new Error('The GitHub release is still a draft.')
    mkdirSync(cacheDir, { recursive: true })
    for (const asset of release.assets ?? []) {
      if (!platformFor(asset.name)) continue
      const filePath = path.join(cacheDir, asset.name)
      const expectedDigest = /^sha256:[0-9a-f]{64}$/.test(asset.digest ?? '') ? asset.digest.slice(7) : null
      if (!existsSync(filePath) || statSync(filePath).size !== asset.size) {
        log(`downloading ${asset.name} (${asset.size} bytes)`)
        const response = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'QortiumHome-qdn-release' } })
        if (!response.ok || !response.body) throw new Error(`${asset.name}: HTTP ${response.status}`)
        await pipeline(Readable.fromWeb(response.body), createWriteStream(`${filePath}.part`))
        const { renameSync } = await import('node:fs')
        renameSync(`${filePath}.part`, filePath)
      }
      files.push({ name: asset.name, filePath, expectedDigest })
    }
  }
  if (files.length === 0) throw new Error('No release packages found.')
  const assets = []
  for (const file of files) {
    const sha256 = await sha256File(file.filePath)
    if (file.expectedDigest && file.expectedDigest !== sha256) throw new Error(`${file.name}: digest ${sha256} does not match GitHub's ${file.expectedDigest}`)
    const platform = platformFor(file.name)
    const identifier = `home-${tag}-${platform}`
    if (identifier.length > 64) throw new Error(`${identifier} exceeds QDN's identifier cap.`)
    assets.push({ name: file.name, identifier, size: statSync(file.filePath).size, sha256, filePath: file.filePath, platform })
  }
  return assets
}

// --- main ---
const status = await requestJson('/admin/status')
if (!status || status.syncPercent !== 100 || status.isSynchronizing) throw new Error(`Node is not synced: ${JSON.stringify(status)}`)
const accounts = JSON.parse(readFileSync(previewAccountsPath, 'utf8'))
const account = accounts.accounts?.find((item) => item.role === 'local')
if (!account?.accountPrivateKey) throw new Error(`No "local" preview account in ${previewAccountsPath}.`)
const nameInfo = await fetch(`${nodeApiUrl}/names/${PUBLISHER}`).then((r) => (r.ok ? r.json() : null))
if (!nameInfo || nameInfo.owner !== account.accountAddress) throw new Error(`${PUBLISHER} is not owned by the local preview account (${account.accountAddress}).`)

const assets = await collectAssets()
log(`${tag}: ${assets.length} packages -> ${assets.map((asset) => asset.platform).join(', ')}`)
for (const asset of assets) await publish('FILE', asset.identifier, asset.filePath, `Qortium Home ${tag} ${asset.platform}`, account)

mkdirSync(cacheDir, { recursive: true })
const manifest = {
  schema: MANIFEST_SCHEMA,
  product: 'home',
  tag,
  name: `Qortium Home ${tag}`,
  prerelease,
  publishedAt: new Date().toISOString(),
  assets: assets.map(({ name, identifier, size, sha256 }) => ({ name, identifier, size, sha256 })),
}
const manifestPath = path.join(cacheDir, `${manifestIdentifier}.json`)
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
if (statSync(manifestPath).size > 25 * 1024) throw new Error('The manifest exceeds the JSON service cap (25 KiB).')
await publish('JSON', manifestIdentifier, manifestPath, `Qortium Home ${tag} release manifest`, account)

const pointerPath = path.join(cacheDir, `${channelIdentifier}.json`)
writeFileSync(pointerPath, `${JSON.stringify({ tag }, null, 2)}\n`)
// The pointer always moves: publishing a release means it is the newest on its channel.
if (dryRun) log(`DRY RUN: would point ${channelIdentifier} at ${tag}`)
else {
  const raw = await request(`/arbitrary/JSON/${encodeURIComponent(PUBLISHER)}/${encodeURIComponent(channelIdentifier)}?title=${encodeURIComponent(`Qortium Home latest ${prerelease ? 'prerelease' : 'stable'}`)}&fee=0`, { method: 'POST', headers: headers('text/plain'), body: pointerPath })
  await signAndProcess(raw, account.accountPrivateKey)
  await waitReady('JSON', channelIdentifier)
  log(`${channelIdentifier} -> ${tag}`)
}
log(`done: manifest ${manifestIdentifier}, pointer ${channelIdentifier}`)
