import { app, safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  homeV2AdminTrustRevision,
  homeV2NodeOrigin,
  type HomeV2AttachedAdminKey,
} from './home-v2-admin-trust.js'
import { isHomeV2SecureStorageAvailable } from './home-v2-account-security.js'

/**
 * Storage for a user-attached node administration key.
 *
 * The key is a full administrative credential for the user's own Qortium
 * Core, so it never goes near `node-settings.json`, which is plaintext. It
 * lives here instead, wrapped with Electron `safeStorage` (the same OS-backed
 * primitive the remembered-unlock key uses) in an 0600 file, and is bound to
 * the exact node origin the user attached it to.
 *
 * Secure storage being unavailable means the key CANNOT be attached through
 * this module — it throws rather than falling back to plaintext. (The legacy
 * settings writer, which cannot destroy a key it was handed, leaves such a
 * value where it was; administration stays refused either way, since trust
 * is resolved only from this store.)
 */
const ADMIN_KEY_FILE = 'home-v2-node-admin-keys.json'
const ADMIN_KEY_VERSION = 1
const MAX_API_KEY_LENGTH = 256

/**
 * A random, credential-independent handle for one attachment.
 *
 * Everything that leaves the main process — the adminTrust channel, a
 * persisted preview tab, an approval token round-tripped through React — names
 * a credential by this rather than by `homeV2AdminTrustRevision`, which is a
 * digest of the key and therefore an offline verifier for a weak one
 * (security review, 2026-09-02). It is minted fresh whenever the key changes,
 * so it invalidates exactly when the digest would have.
 */
export function createHomeV2AdminBindingId() {
  return randomBytes(16).toString('hex')
}

function isBindingId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)
}

type StoredAdminKey = {
  bindingId: string
  origin: string
  wrappedKey: string
}

/**
 * The managed local Core's binding id.
 *
 * Home does not own that Core's credential — Core writes its own apikey.txt —
 * so there is no attach moment to mint an id at. `keyRevision` is the
 * main-process-only digest of the key the id was minted for; a key Core
 * rotated no longer matches it and the id is re-minted. The digest never
 * leaves this file, which is the same 0600 file the wrapped keys live in.
 */
type StoredManagedBinding = {
  bindingId: string
  keyRevision: string
}

type AdminKeyStore = {
  managed: Record<string, StoredManagedBinding>
  nodes: Record<string, StoredAdminKey>
  version: typeof ADMIN_KEY_VERSION
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function getStorePath() {
  return path.join(app.getPath('userData'), ADMIN_KEY_FILE)
}

function emptyStore(): AdminKeyStore {
  return { managed: {}, nodes: {}, version: ADMIN_KEY_VERSION }
}

function readStore(): AdminKeyStore {
  const storePath = getStorePath()
  if (!existsSync(storePath)) return emptyStore()
  try {
    const value: unknown = JSON.parse(readFileSync(storePath, 'utf8'))
    if (!isRecord(value) || !isRecord(value.nodes)) return emptyStore()
    const nodes: Record<string, StoredAdminKey> = {}
    for (const [network, candidate] of Object.entries(value.nodes)) {
      if (!isRecord(candidate)) continue
      const { bindingId, origin, wrappedKey } = candidate
      if (typeof origin === 'string' && origin && typeof wrappedKey === 'string' && wrappedKey) {
        // A record written before binding ids existed has none; it is minted
        // on the next read (getHomeV2NodeAdminKey) rather than here, so a
        // plain read of the store never rewrites the file.
        nodes[network] = { bindingId: isBindingId(bindingId) ? bindingId : '', origin, wrappedKey }
      }
    }
    const managed: Record<string, StoredManagedBinding> = {}
    if (isRecord(value.managed)) {
      for (const [network, candidate] of Object.entries(value.managed)) {
        if (!isRecord(candidate)) continue
        const { bindingId, keyRevision } = candidate
        if (isBindingId(bindingId) && typeof keyRevision === 'string' && keyRevision) {
          managed[network] = { bindingId, keyRevision }
        }
      }
    }
    return { managed, nodes, version: ADMIN_KEY_VERSION }
  } catch {
    return emptyStore()
  }
}

function writeStore(store: AdminKeyStore) {
  const storePath = getStorePath()
  mkdirSync(path.dirname(storePath), { recursive: true })
  if (Object.keys(store.nodes).length === 0 && Object.keys(store.managed).length === 0) {
    // Nothing attached anywhere: remove the file rather than leaving an empty
    // shell that looks like a credential store.
    if (existsSync(storePath)) rmSync(storePath)
    return
  }
  writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  // `mode` applies only when the file is created, so tighten an existing one
  // written by an earlier build (review round 3).
  try {
    chmodSync(storePath, 0o600)
  } catch {
    // Best effort — never block saving over a filesystem that cannot chmod.
  }
}

export function normalizeHomeV2NodeAdminKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('The node API key must be text.')
  const apiKey = value.trim()
  if (!apiKey) throw new Error('The node API key is required.')
  if (apiKey.length > MAX_API_KEY_LENGTH) throw new Error('That node API key is too long.')
  // Core's key is Base58; refuse anything that could not be one rather than
  // storing (and later transmitting) arbitrary header bytes.
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(apiKey)) {
    throw new Error('That does not look like a Core API key (expected Base58 characters).')
  }
  return apiKey
}

/**
 * Attaches an administration key to one node origin. Replaces any key
 * previously attached for that network — including one bound to a different
 * origin, which is exactly how a node move drops the old trust.
 */
export function setHomeV2NodeAdminKey(network: string, nodeApiUrl: string, apiKey: string) {
  const origin = homeV2NodeOrigin(nodeApiUrl)
  if (!origin) throw new Error('A valid node address is required before attaching an API key.')
  const normalized = normalizeHomeV2NodeAdminKey(apiKey)
  if (!isHomeV2SecureStorageAvailable()) {
    throw new Error(
      'This device has no protected storage available, so Home cannot store a node API key. Node administration stays unavailable rather than saving the key unprotected.',
    )
  }
  const store = readStore()
  store.nodes[network] = {
    // A NEW id for every attach: replacing a key must invalidate every token
    // handed out for the old one, exactly as the digest used to.
    bindingId: createHomeV2AdminBindingId(),
    origin,
    wrappedKey: safeStorage.encryptString(normalized).toString('base64'),
  }
  writeStore(store)
}

export function clearHomeV2NodeAdminKey(network: string) {
  const store = readStore()
  if (!(network in store.nodes)) return
  delete store.nodes[network]
  writeStore(store)
}

/**
 * The attached record for a network, or null. Returns the raw key, so this is
 * main-process-only: it must never be handed to a renderer, a QDN app, or a
 * node other than the bound origin.
 */
export function getHomeV2NodeAdminKey(network: string): HomeV2AttachedAdminKey | null {
  const stored = readStore().nodes[network]
  if (!stored) return null
  if (!isHomeV2SecureStorageAvailable()) return null
  try {
    const apiKey = safeStorage.decryptString(Buffer.from(stored.wrappedKey, 'base64'))
    if (!apiKey) return null
    let bindingId = stored.bindingId
    if (!bindingId) {
      // Upgrade in place: a key attached before binding ids existed gets one
      // now, once, so trust does not silently fail closed for it.
      bindingId = createHomeV2AdminBindingId()
      const store = readStore()
      const record = store.nodes[network]
      if (record && record.wrappedKey === stored.wrappedKey) {
        record.bindingId = bindingId
        writeStore(store)
      }
    }
    return Object.freeze({ apiKey, bindingId, origin: stored.origin })
  } catch {
    return null
  }
}

/**
 * The managed local Core's binding id for `apiKey`, minted on first use and
 * re-minted whenever Core rotates its key.
 *
 * MAIN-PROCESS ONLY, like every other function here: it reads the key to
 * decide whether the stored id is still current.
 */
export function getHomeV2ManagedAdminBindingId(
  network: string,
  origin: string,
  apiKey: string,
): string {
  if (!origin || !apiKey) return ''
  const keyRevision = homeV2AdminTrustRevision(origin, apiKey)
  const store = readStore()
  const stored = store.managed[network]
  if (stored && stored.keyRevision === keyRevision) return stored.bindingId
  const bindingId = createHomeV2AdminBindingId()
  store.managed[network] = { bindingId, keyRevision }
  try {
    writeStore(store)
  } catch {
    // A store that cannot be written yields no id, and trust fails closed
    // rather than handing out an id that will not be there next time.
    return ''
  }
  return bindingId
}

/** Whether a key is attached, and to which origin — safe for the UI. */
export function getHomeV2NodeAdminKeySummary(network: string): { attached: boolean; origin: string } {
  const stored = readStore().nodes[network]
  return { attached: !!stored, origin: stored?.origin ?? '' }
}
