import { Sha256 } from 'asmcrypto.js'

import { isHomeV2LoopbackNodeUrl } from './home-v2-minting.js'
import { isNodeApiKeyTransportSafe } from './node-api-url.js'

/**
 * Administrative trust for a Qortium node.
 *
 * Home administers a node (its QDN lists, its minting accounts, later its
 * settings) only with an API key the USER has bound to that exact node. Two
 * sources qualify, and nothing else does:
 *
 *  - `managed`: the local Core Home runs itself, reached over loopback with
 *    the key Home reconciles from that Core's own apikey.txt.
 *  - `attached`: a key the user explicitly attached to a CUSTOM node — the
 *    self-hosted case, including a node reached through an SSH tunnel, which
 *    presents as plain HTTP to 127.0.0.1 and is therefore allowed.
 *
 * This deliberately replaces the older loopback-ONLY rule. That rule existed
 * because the minting path used to post the account private key to the node;
 * that handoff is gone (the reward-share key is derived locally now), so the
 * remaining exposure is the administrative key itself — which is the user's
 * own credential for their own node, and theirs to place.
 *
 * What does NOT qualify: a public/discovered node (somebody else's Core), a
 * custom node with no attached key, any origin the key was not bound to, and
 * any transport that would put the key on the wire in the clear to a remote
 * host (plain HTTP off-loopback).
 */
export type HomeV2AdminTrustSource = 'attached' | 'managed'

export type HomeV2AdminTrustRefusal =
  | 'key-missing'
  | 'node-disabled'
  | 'origin-mismatch'
  | 'public-node'
  | 'transport-unsafe'
  | 'unsupported-network'

export type HomeV2AdminTrust =
  | {
      readonly trusted: true
      readonly apiKey: string
      readonly origin: string
      readonly revision: string
      readonly source: HomeV2AdminTrustSource
    }
  | {
      readonly trusted: false
      readonly reason: HomeV2AdminTrustRefusal
    }

/**
 * The attached-key record. `origin` is the exact node origin the key was
 * bound to — a URL change discards trust rather than silently re-pointing a
 * credential at a host the user never approved.
 */
export type HomeV2AttachedAdminKey = Readonly<{
  apiKey: string
  origin: string
}>

export function homeV2NodeOrigin(nodeApiUrl: unknown): string {
  if (typeof nodeApiUrl !== 'string' || !nodeApiUrl) return ''
  try {
    return new URL(nodeApiUrl).origin
  } catch {
    return ''
  }
}

/**
 * A stable fingerprint of "which credential, bound to which origin". Carried
 * on every trust answer so a caller can re-check after an approval prompt
 * that neither the node nor the key moved underneath it — without ever
 * holding or comparing the raw key outside the main process.
 */
export function homeV2AdminTrustRevision(origin: string, apiKey: string): string {
  const digest = new Sha256()
    .process(new TextEncoder().encode(`qortium-home-admin-trust-v1\n${origin}\n${apiKey}`))
    .finish().result
  if (!digest) throw new Error('SHA-256 failed.')
  return Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function evaluateHomeV2AdminTrust(input: {
  readonly attached?: HomeV2AttachedAdminKey | null
  readonly managedApiKey?: string
  readonly mode: string
  readonly network: string
  readonly nodeApiUrl: unknown
}): HomeV2AdminTrust {
  // Home holds no administrative concept for Qortal: it never runs a Qortal
  // node and has no key to attach to one.
  if (input.network !== 'qortium') return { trusted: false, reason: 'unsupported-network' }
  if (input.mode === 'disabled') return { trusted: false, reason: 'node-disabled' }
  // A discovered public node is somebody else's Core. Its administration is
  // not the user's to perform, and no key of theirs belongs on it.
  if (input.mode === 'network') return { trusted: false, reason: 'public-node' }
  const origin = homeV2NodeOrigin(input.nodeApiUrl)
  if (!origin) return { trusted: false, reason: 'transport-unsafe' }

  if (input.mode === 'local') {
    const apiKey = input.managedApiKey ?? ''
    if (!apiKey) return { trusted: false, reason: 'key-missing' }
    // The managed Core is always reached over loopback; anything else means
    // the local route was mis-set or tampered with.
    if (!isHomeV2LoopbackNodeUrl(input.nodeApiUrl)) return { trusted: false, reason: 'transport-unsafe' }
    return {
      trusted: true,
      apiKey,
      origin,
      revision: homeV2AdminTrustRevision(origin, apiKey),
      source: 'managed',
    }
  }

  if (input.mode !== 'custom') return { trusted: false, reason: 'public-node' }
  const attached = input.attached
  if (!attached || !attached.apiKey) return { trusted: false, reason: 'key-missing' }
  // Bound to the EXACT origin the user attached it to.
  if (homeV2NodeOrigin(attached.origin) !== origin) return { trusted: false, reason: 'origin-mismatch' }
  // HTTPS anywhere, or plain HTTP to exact loopback — the `ssh -L` case. Core
  // sees a tunnelled request as loopback too, so its default API-key policy
  // already permits it.
  if (!isNodeApiKeyTransportSafe(origin)) return { trusted: false, reason: 'transport-unsafe' }
  return {
    trusted: true,
    apiKey: attached.apiKey,
    origin,
    revision: homeV2AdminTrustRevision(origin, attached.apiKey),
    source: 'attached',
  }
}

/** The user-facing reason a node cannot be administered, by refusal code. */
export function homeV2AdminTrustMessage(reason: HomeV2AdminTrustRefusal, operation: string): string {
  switch (reason) {
    case 'unsupported-network':
      return `${operation} is not available for Qortal: Home has no administrative key for a Qortal node.`
    case 'node-disabled':
      return `${operation} needs a connected Qortium node.`
    case 'public-node':
      return `${operation} administers a node, so it needs your own Qortium Core — not a shared public node. Select your node as a custom node and attach its API key in Settings.`
    case 'key-missing':
      return `${operation} needs your node's API key. Add it to this custom node in Settings; Home stores it protected on this device and sends it only to that node.`
    case 'origin-mismatch':
      return `${operation} needs the API key re-attached: the node address changed since the key was saved.`
    case 'transport-unsafe':
      return `${operation} needs a secure route to the node: use HTTPS, or reach it over 127.0.0.1 (an SSH tunnel works).`
    default:
      return `${operation} is not available for the selected node.`
  }
}
