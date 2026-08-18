import { Worker } from 'node:worker_threads'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'
import nacl from 'tweetnacl'

import { arbitraryRawToSigningBytes } from './arbitrary-tx.js'
import { getAccountSecretKey, stampTransactionNonce } from './accounts.js'
import { base58Decode, base58Encode } from './base58.js'
import { computeHomeV2ChatNonce } from './home-v2-chat-pow.js'
import {
  attestUnsignedQortalArbitraryPublish,
  signAttestedQortalPrivateGroupPublish,
} from './home-v2-qortal-private-group-publish.js'
import {
  createHomeV2PublicPublishDescriptor,
  sha256Hex,
  type HomeV2PublicPublishNetwork,
} from './home-v2-public-publish-contract.js'
import { nodeFetch } from './node-tls.js'
import {
  attestPublicQdnPublish,
  type QdnPublishVerificationInput,
} from './qdn-content-attestation.js'
import type { QdnWriteResourceRequest } from './qdn-request-values.js'
import { appendSignatureToTransactionBytes, getSignatureFromSignedTransactionBytes } from './qortal-payment.js'
import { assertPublicArbitraryTransaction, getStaticQdnServiceId } from './public-transaction-validation.js'

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url))
const ARBITRARY_POW_DIFFICULTY = 11
const RESPONSE_MAX_BYTES = 2 * 1024 * 1024

type PublishInput = {
  readonly accountId: string
  readonly fileName: string
  readonly isStillValid: () => boolean | Promise<boolean>
  readonly network: HomeV2PublicPublishNetwork
  readonly nodeApiUrl: string
  readonly resource: QdnWriteResourceRequest
  readonly sourceBytes: Uint8Array
}

function queryForQortiumResource(resource: QdnWriteResourceRequest, fileName: string) {
  const query = new URLSearchParams({ filename: fileName })
  if (resource.title) query.set('title', resource.title)
  if (resource.description) query.set('description', resource.description)
  if (resource.category) query.set('category', resource.category)
  for (const tag of resource.tags) query.append('tags', tag)
  return query.toString()
}

function resourcePath(resource: QdnWriteResourceRequest) {
  return `/${encodeURIComponent(resource.service)}/${encodeURIComponent(resource.name)}${
    resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : ''
  }`
}

async function responseText(response: Response, label: string) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > RESPONSE_MAX_BYTES) {
    await response.body?.cancel()
    throw new Error(`${label} response exceeded Home's size limit.`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > RESPONSE_MAX_BYTES) throw new Error(`${label} response exceeded Home's size limit.`)
  const body = new TextDecoder().decode(bytes).trim()
  if (!response.ok) throw Object.assign(
    new Error(`${label} returned HTTP ${response.status}${body ? `: ${body}` : '.'}`),
    { status: response.status },
  )
  return body
}

async function postBytes(nodeApiUrl: string, path: string, bytes: Uint8Array, label: string) {
  const url = `${nodeApiUrl}${path}`
  const response = await nodeFetch(url, {
    body: Uint8Array.from(bytes),
    headers: { 'Content-Type': 'application/octet-stream' },
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
  })
  if (response.url && new URL(response.url).toString() !== new URL(url).toString()) {
    throw new Error(`${label} changed the approved node URL.`)
  }
  return responseText(response, label)
}

async function postText(nodeApiUrl: string, path: string, body: string, label: string) {
  const url = `${nodeApiUrl}${path}`
  const response = await nodeFetch(url, {
    body,
    headers: { 'Content-Type': 'text/plain' },
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  })
  if (response.url && new URL(response.url).toString() !== new URL(url).toString()) {
    throw new Error(`${label} changed the approved node URL.`)
  }
  return responseText(response, label)
}

async function getText(nodeApiUrl: string, path: string, label: string) {
  const url = `${nodeApiUrl}${path}`
  const response = await nodeFetch(url, {
    method: 'GET', redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  if (response.url && new URL(response.url).toString() !== new URL(url).toString()) {
    throw new Error(`${label} changed the approved node URL.`)
  }
  return responseText(response, label)
}

function verifyQdnPublishInWorker(input: QdnPublishVerificationInput) {
  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(nodePath.join(__dirname, 'qdn-attestation.worker.js'))
    const timeout = setTimeout(() => {
      void worker.terminate()
      reject(new Error('QDN content attestation timed out.'))
    }, 180_000)
    const finish = (error?: Error) => {
      clearTimeout(timeout)
      void worker.terminate()
      error ? reject(error) : resolve()
    }
    worker.once('error', finish)
    worker.once('message', (message: { error?: string; ok?: boolean }) => {
      message?.ok ? finish() : finish(new Error(message?.error || 'QDN content attestation failed.'))
    })
    worker.postMessage(input)
  })
}

async function fetchQdnArtifact(nodeApiUrl: string, hash: Uint8Array, maxBytes: number) {
  if (hash.byteLength !== 32) throw new Error('QDN builder returned an invalid artifact hash.')
  const url = `${nodeApiUrl}/arbitrary/public/data/${encodeURIComponent(base58Encode(hash))}`
  const response = await nodeFetch(
    url,
    { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(120_000) },
  )
  if (response.url && new URL(response.url).toString() !== new URL(url).toString()) {
    throw new Error('QDN content attestation changed the approved node URL.')
  }
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel()
    throw new Error('QDN attestation artifact exceeded the approved size.')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!response.ok) throw new Error(`QDN content attestation returned HTTP ${response.status}.`)
  if (!bytes.byteLength || bytes.byteLength > maxBytes) throw new Error('QDN attestation artifact has an invalid size.')
  return bytes
}

async function publishQortium(input: PublishInput, signingKey: ReturnType<typeof getAccountSecretKey>) {
  const query = queryForQortiumResource(input.resource, input.fileName)
  const started = Date.now()
  const unsignedBase58 = await postBytes(
    input.nodeApiUrl,
    `/arbitrary/public${resourcePath(input.resource)}/upload?${query}`,
    input.sourceBytes,
    'Qortium public publish staging',
  )
  if (!(await input.isStillValid())) throw new Error('The app, account, or node route changed before QDN attestation.')
  const unsignedBytes = base58Decode(unsignedBase58)
  const details = assertPublicArbitraryTransaction(unsignedBytes, {
    identifier: input.resource.identifier && input.resource.identifier !== 'default' ? input.resource.identifier : undefined,
    method: 0,
    name: input.resource.name,
    publicKey: base58Decode(signingKey.publicKey58),
    service: getStaticQdnServiceId(input.resource.service),
    txGroupId: 0,
  })
  await attestPublicQdnPublish({
    details,
    expectedMetadata: {
      category: input.resource.category,
      description: input.resource.description,
      tags: input.resource.tags,
      title: input.resource.title,
    },
    fetchArtifact: (hash, maxBytes) => fetchQdnArtifact(input.nodeApiUrl, hash, maxBytes),
    source: { bytes: input.sourceBytes, filename: input.fileName, unpackZip: false },
    verify: verifyQdnPublishInWorker,
  })
  const signingBytes = arbitraryRawToSigningBytes(unsignedBytes)
  const nonce = await computeHomeV2ChatNonce(signingBytes, ARBITRARY_POW_DIFFICULTY, input.isStillValid)
  if (!(await input.isStillValid())) throw new Error('The app, account, or node route changed before QDN signing.')
  const rawWithNonce = stampTransactionNonce(unsignedBytes, nonce)
  const signingWithNonce = stampTransactionNonce(signingBytes, nonce)
  const signatureBytes = nacl.sign.detached(signingWithNonce, signingKey.secretKey)
  const signedBytes = appendSignatureToTransactionBytes(rawWithNonce, signatureBytes)
  return {
    signedBytes,
    signature: getSignatureFromSignedTransactionBytes(signedBytes),
    timestamp: started,
  }
}

function atomicFee(value: string) {
  if (!/^\d+$/.test(value)) throw new Error('Qortal ARBITRARY fee response is invalid.')
  const fee = BigInt(value)
  if (fee > 9_223_372_036_854_775_807n) throw new Error('Qortal ARBITRARY fee is outside the transaction range.')
  return fee
}

async function publishQortal(input: PublishInput, signingKey: ReturnType<typeof getAccountSecretKey>) {
  const timestamp = Date.now()
  const [feeText, referenceText] = await Promise.all([
    getText(input.nodeApiUrl, `/transactions/unitfee?txType=ARBITRARY&timestamp=${timestamp}`, 'Qortal publish fee lookup'),
    getText(input.nodeApiUrl, `/addresses/lastreference/${encodeURIComponent(signingKey.address)}`, 'Qortal publish reference lookup'),
  ])
  const fee = atomicFee(feeText)
  const reference = base58Decode(referenceText)
  if (reference.byteLength !== 64 || base58Encode(reference) !== referenceText) {
    throw new Error('Qortal publish reference is invalid.')
  }
  if (!(await input.isStillValid())) throw new Error('The app, account, or node route changed before Qortal staging.')
  const started = Date.now()
  const unsignedBase58 = await postText(
    input.nodeApiUrl,
    `/arbitrary${resourcePath(input.resource)}/base64?fee=${encodeURIComponent(String(fee))}`,
    Buffer.from(input.sourceBytes).toString('base64'),
    'Qortal public publish staging',
  )
  const attested = attestUnsignedQortalArbitraryPublish(unsignedBase58, {
    dataSize: input.sourceBytes.byteLength,
    feeAtomic: fee,
    identifier: input.resource.identifier ?? 'default',
    lastReference: reference,
    name: input.resource.name,
    senderPublicKey: base58Decode(signingKey.publicKey58),
    service: getStaticQdnServiceId(input.resource.service),
    timestampMaximum: Date.now() + 5_000,
    timestampMinimum: started - 5_000,
  })
  const expectedHash = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(input.sourceBytes).buffer)
  if (base58Encode(new Uint8Array(expectedHash)) !== base58Encode(attested.dataHash)) {
    throw new Error('Qortal publish builder changed the approved resource content.')
  }
  if (!(await input.isStillValid())) throw new Error('The app, account, or node route changed before Qortal signing.')
  const signed = signAttestedQortalPrivateGroupPublish({
    selectedAccountSecretKey: signingKey.secretKey,
    signingBytes: attested.signingBytes,
    unsignedBytes: attested.unsignedBytes,
  })
  return { signedBytes: signed.signedBytes, signature: signed.signature, timestamp: attested.timestamp }
}

export async function publishHomeV2PublicResource(input: PublishInput) {
  const signingKey = getAccountSecretKey(input.accountId)
  try {
    const contentHash = await sha256Hex(input.sourceBytes)
    let transaction
    try {
      transaction = input.network === 'qortium'
        ? await publishQortium(input, signingKey)
        : await publishQortal(input, signingKey)
    } catch (error) {
      const status = typeof (error as { status?: unknown })?.status === 'number'
        ? (error as { status: number }).status
        : null
      if (status === 401 || status === 403 || status === 404 || status === 405) {
        throw new Error(
          `The selected ${input.network === 'qortal' ? 'Qortal' : 'Qortium'} node does not expose a compatible public QDN publish staging route.`,
        )
      }
      throw error
    }
    if (!(await input.isStillValid())) throw new Error('The app, account, or node route changed before publication broadcast.')
    try {
      await postText(
        input.nodeApiUrl,
        '/transactions/process?apiVersion=2',
        base58Encode(transaction.signedBytes),
        `${input.network === 'qortal' ? 'Qortal' : 'Qortium'} public publish broadcast`,
      )
      return createHomeV2PublicPublishDescriptor({
        contentHash,
        fileName: input.fileName,
        network: input.network,
        resource: input.resource,
        size: input.sourceBytes.byteLength,
        transactionSignature: transaction.signature,
      })
    } catch (error) {
      return Object.freeze({
        ...createHomeV2PublicPublishDescriptor({
          contentHash,
          fileName: input.fileName,
          network: input.network,
          resource: input.resource,
          size: input.sourceBytes.byteLength,
          transactionSignature: transaction.signature,
        }),
        accepted: false as const,
        error: error instanceof Error ? error.message : 'Publish broadcast outcome is unknown.',
        errorType: 'BROADCAST_UNKNOWN',
        outcome: 'unknown' as const,
        retryable: false as const,
        timestamp: transaction.timestamp,
      })
    }
  } finally {
    signingKey.secretKey.fill(0)
  }
}
