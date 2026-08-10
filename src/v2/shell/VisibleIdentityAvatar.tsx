import { useEffect, useState } from 'react'
import type {
  NetworkIdentityLookup,
  NetworkId,
  VisibleAvatarLoader,
} from '../contracts'

const AVATAR_MAX_BYTES = 500 * 1024
const MAX_PENDING_ATTEMPTS = 12
const MAX_TRANSIENT_ATTEMPTS = 3
const ALLOWED_CONTENT_TYPES = new Set([
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

function avatarInitial(identity: NetworkIdentityLookup, query: string) {
  return (identity.primaryName ?? query).trim().slice(0, 1).toUpperCase() || '?'
}

export function validateVisibleAvatarPayload(
  body: string,
  contentLength: number,
  contentType: string,
) {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error('Avatar content type is not allowed.')
  }
  const binary = globalThis.atob(body)
  if (binary.length !== contentLength || binary.length > AVATAR_MAX_BYTES) {
    throw new Error('Avatar byte length did not match the bounded response.')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function avatarObjectUrl(
  body: string,
  contentLength: number,
  contentType: string,
) {
  const bytes = validateVisibleAvatarPayload(body, contentLength, contentType)
  return URL.createObjectURL(new Blob([bytes], { type: contentType }))
}

export function VisibleIdentityAvatar({
  identity,
  loader,
  network,
  query,
}: {
  readonly identity: NetworkIdentityLookup
  readonly loader?: VisibleAvatarLoader
  readonly network: NetworkId
  readonly query: string
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    setObjectUrl(null)
    setFailedUrl(null)
    setIsLoading(false)
    if (!loader || !identity.address || !identity.avatar) return
    setIsLoading(true)

    let cancelled = false
    let activeUrl: string | null = null
    let timer: number | null = null
    let attempts = 0

    const load = async () => {
      attempts += 1
      const result = await loader(network, {
        address: identity.address as string,
        pointer: identity.avatar as NonNullable<typeof identity.avatar>,
      }).catch(() => ({ status: 'unavailable' as const, message: 'Avatar request failed.' }))
      if (cancelled) return
      if (result.status === 'pending' && attempts < MAX_PENDING_ATTEMPTS) {
        const delaySeconds = Math.max(
          1,
          Math.min(result.retryAfterSeconds ?? 5, 10),
        )
        timer = window.setTimeout(() => void load(), delaySeconds * 1000)
        return
      }
      if (result.status === 'unavailable' && attempts < MAX_TRANSIENT_ATTEMPTS) {
        timer = window.setTimeout(() => void load(), 2_000)
        return
      }
      if (result.status !== 'ready') {
        setIsLoading(false)
        return
      }
      try {
        activeUrl = avatarObjectUrl(
          result.body,
          result.contentLength,
          result.contentType,
        )
        setObjectUrl(activeUrl)
        setIsLoading(false)
      } catch {
        // Keep the deterministic initial when a response fails renderer checks.
        setIsLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
      if (activeUrl) URL.revokeObjectURL(activeUrl)
    }
  }, [identity.address, identity.avatar, loader, network])

  if (objectUrl && objectUrl !== failedUrl) {
    return (
      <img
        className="home-v2-presence__avatar"
        src={objectUrl}
        alt=""
        aria-hidden="true"
        onError={() => setFailedUrl(objectUrl)}
      />
    )
  }

  return (
    <div
      className="home-v2-presence__avatar"
      data-loading={isLoading ? 'true' : 'false'}
      aria-hidden="true"
    >
      {avatarInitial(identity, query)}
    </div>
  )
}
