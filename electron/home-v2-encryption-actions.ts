import { base58Decode, base58Encode } from './base58.js'

/**
 * Request shapes for the app-facing encryption family.
 *
 * Only ENCRYPT_DATA lives here today. It is Qortal's plain `ENCRYPT_DATA`,
 * whose wire output is the envelope in home-v2-app-encryption.ts — NOT
 * ENCRYPT_QORTAL_GROUP_DATA, which takes a groupId and a shared symmetric key
 * fetched from a DOCUMENT_PRIVATE resource and is a different mechanism
 * entirely. That module's header explains the naming trap in full.
 *
 * Compatibility is the point of every rule below: an app written against
 * Qortal must behave identically here, so the accepted field names, their
 * aliases, and the default when `publicKeys` is absent all follow Qortal Hub's
 * `encryptData` (src/qortal/get.ts) rather than a shape of Home's choosing.
 */

/**
 * The one legitimate caption for an ENCRYPT_DATA prompt.
 *
 * Pinned in the shared module because the shell re-checks it: a forged prompt
 * payload must not be able to caption an encryption as something more benign.
 */
export const HOME_V2_ENCRYPT_DATA_OPERATION_LABEL = 'Encrypt data with your account key'

const PUBLIC_KEY_BYTES = 32

// Qortal's own limit is implicit (it wraps one 48-byte key per recipient with
// no cap). Home bounds it so a single request cannot be used to make the
// signing thread do unbounded scalar multiplications. Kept identical to the
// envelope module's own cap so a request that normalizes can always encrypt.
const MAX_RECIPIENTS = 256

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requestField(request: Record<string, unknown>, field: string): unknown {
  const payload = isRecord(request.payload) ? request.payload : null
  return payload?.[field] ?? request[field]
}

function normalizePublicKey(value: unknown, index: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Recipient public key ${index + 1} must be a Base58 string.`)
  }
  const text = value.trim()
  let decoded: Uint8Array
  try {
    decoded = base58Decode(text)
  } catch {
    throw new Error(`Recipient public key ${index + 1} is not valid Base58.`)
  }
  // Round-tripping rejects the non-canonical spellings Base58 admits, so two
  // request forms can never name the same recipient by different text.
  if (decoded.byteLength !== PUBLIC_KEY_BYTES || base58Encode(decoded) !== text) {
    throw new Error(`Recipient public key ${index + 1} must be an exact 32-byte Base58 key.`)
  }
  return text
}

export type HomeV2EncryptDataRequest = Readonly<{
  action: 'ENCRYPT_DATA'
  data64: string
  /**
   * Exactly what the app asked for, de-duplicated and in request order.
   *
   * The SENDER IS NOT ADDED HERE. Qortal appends the user's own public key
   * inside `encryptDataGroup`, and Home's envelope does the same, so adding it
   * here too would silently double it — the envelope de-duplicates, but the
   * prompt would then disclose a recipient the app never asked for. Keeping
   * this list to the app's own request is what makes the prompt truthful.
   */
  publicKeys: readonly string[]
}>

export function normalizeHomeV2EncryptDataRequest(
  request: Record<string, unknown>,
): HomeV2EncryptDataRequest {
  // A Qortal app may send a File or a Blob and expect the wallet to read it.
  // Home refuses by name rather than silently encrypting something else, the
  // same way SAVE_FILE refuses its blob form: the bridge is structured-clone
  // only, so what actually arrives is an empty object, and encrypting that
  // would produce a valid envelope over no data at all.
  for (const field of ['file', 'blob'] as const) {
    if (requestField(request, field) !== undefined) {
      throw new Error(
        `ENCRYPT_DATA does not accept a ${field}. Read it in the app and send base64 as data64.`,
      )
    }
  }

  // `base64` is Qortal's older spelling of the same field and real apps still
  // send it; `data64` wins when both are present, matching Hub's `||` order.
  const dataRaw = requestField(request, 'data64') ?? requestField(request, 'base64')
  if (typeof dataRaw !== 'string' || dataRaw === '') {
    throw new Error('ENCRYPT_DATA requires the data to encrypt as base64 in data64.')
  }

  const keysRaw = requestField(request, 'publicKeys')
  // Absent means "encrypt to myself only": Qortal defaults publicKeys to [] and
  // then appends the user's own key. An explicit non-array is still an error —
  // only ABSENCE carries that meaning.
  if (keysRaw !== undefined && keysRaw !== null && !Array.isArray(keysRaw)) {
    throw new Error('ENCRYPT_DATA publicKeys must be an array of Base58 public keys.')
  }
  const keys = Array.isArray(keysRaw) ? keysRaw : []
  if (keys.length > MAX_RECIPIENTS) {
    throw new Error(`ENCRYPT_DATA accepts at most ${MAX_RECIPIENTS} recipient public keys.`)
  }

  const seen = new Set<string>()
  const publicKeys: string[] = []
  for (const [index, value] of keys.entries()) {
    const key = normalizePublicKey(value, index)
    if (seen.has(key)) continue
    seen.add(key)
    publicKeys.push(key)
  }

  return Object.freeze({
    action: 'ENCRYPT_DATA',
    data64: dataRaw,
    publicKeys: Object.freeze(publicKeys),
  })
}

/**
 * The approved-state binding for ENCRYPT_DATA.
 *
 * On Android the shell describes the operation and the VAULT performs it, so
 * the vault must not derive what it encrypts from anything the shell says. It
 * re-normalizes the original request itself and calls this with both lists:
 * what the prompt disclosed, and what it independently derived. They must be
 * the same recipients in the same order, or an app could have one set approved
 * and a different set encrypted to.
 *
 * Order matters as well as membership: the prompt numbers its rows
 * (`Recipient 1`, `Recipient 2`, ...), so a reordering would make the approved
 * rows describe different keys than the ones used.
 */
export function assertApprovedEncryptRecipients(
  derived: readonly string[],
  approved: readonly string[],
) {
  const same =
    derived.length === approved.length &&
    derived.every((key, index) => key === approved[index])
  if (!same) throw new Error('The encryption recipients changed after approval.')
}
