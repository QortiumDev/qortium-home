import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { homeV2NodeOrigin, type HomeV2AttachedAdminKey } from './home-v2-admin-trust.js'
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
 * Secure storage being unavailable means the key CANNOT be attached — never
 * that Home falls back to writing it in the clear.
 */
const ADMIN_KEY_FILE = 'home-v2-node-admin-keys.json'
const ADMIN_KEY_VERSION = 1
const MAX_API_KEY_LENGTH = 256

type StoredAdminKey = {
  origin: string
  wrappedKey: string
}

type AdminKeyStore = {
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
  return { nodes: {}, version: ADMIN_KEY_VERSION }
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
      const { origin, wrappedKey } = candidate
      if (typeof origin === 'string' && origin && typeof wrappedKey === 'string' && wrappedKey) {
        nodes[network] = { origin, wrappedKey }
      }
    }
    return { nodes, version: ADMIN_KEY_VERSION }
  } catch {
    return emptyStore()
  }
}

function writeStore(store: AdminKeyStore) {
  const storePath = getStorePath()
  mkdirSync(path.dirname(storePath), { recursive: true })
  if (Object.keys(store.nodes).length === 0) {
    // Nothing attached anywhere: remove the file rather than leaving an empty
    // shell that looks like a credential store.
    if (existsSync(storePath)) rmSync(storePath)
    return
  }
  writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
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
    return Object.freeze({ apiKey, origin: stored.origin })
  } catch {
    return null
  }
}

/** Whether a key is attached, and to which origin — safe for the UI. */
export function getHomeV2NodeAdminKeySummary(network: string): { attached: boolean; origin: string } {
  const stored = readStore().nodes[network]
  return { attached: !!stored, origin: stored?.origin ?? '' }
}
