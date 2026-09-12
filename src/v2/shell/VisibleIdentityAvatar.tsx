import { useCallback, useState, type ReactNode } from 'react'
import type {
  NetworkIdentityLookup,
  NetworkId,
  VisibleAvatarLoader,
} from '../contracts'
import {
  rejectHomeV2Image,
  useHomeV2Image,
  validateHomeV2ImagePayload,
} from './useHomeV2Image'

const AVATAR_MAX_BYTES = 500 * 1024
export const VISIBLE_AVATAR_LOADING_MS = 6_000

function avatarInitial(identity: NetworkIdentityLookup, query: string) {
  return (identity.primaryName ?? query).trim().slice(0, 1).toUpperCase() || '?'
}

export function validateVisibleAvatarPayload(
  body: string,
  contentLength: number,
  contentType: string,
) {
  return validateHomeV2ImagePayload(
    body,
    contentLength,
    contentType,
    AVATAR_MAX_BYTES,
  )
}

export function VisibleIdentityAvatar({
  className,
  fallback,
  identity,
  loader,
  network,
  query,
}: {
  readonly className?: string
  /**
   * What to show while there is no image — a not-yet-resolved avatar, an
   * account that has published none, or one that failed to decode. Defaults to
   * the monogram tile the presence lists use; the tab strip passes its own
   * initials so a tab chip looks exactly as it did before this could show an
   * image at all.
   */
  readonly fallback?: ReactNode
  readonly identity: NetworkIdentityLookup
  readonly loader?: VisibleAvatarLoader
  readonly network: NetworkId
  readonly query: string
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const pointer = identity.avatar
  const cacheKey =
    loader && identity.address && pointer
      ? JSON.stringify([
          'identity-avatar',
          network,
          identity.address,
          pointer.source,
          pointer.service,
          pointer.name,
          pointer.identifier,
        ])
      : null
  const load = useCallback(
    () =>
      loader!(network, {
        address: identity.address as string,
        pointer: pointer as NonNullable<typeof pointer>,
      }),
    [identity.address, loader, network, pointer],
  )
  const image = useHomeV2Image({
    cacheKey,
    load: cacheKey ? load : undefined,
    loadingMs: VISIBLE_AVATAR_LOADING_MS,
    maxBytes: AVATAR_MAX_BYTES,
  })
  const avatarClassName = ['home-v2-presence__avatar', className]
    .filter(Boolean)
    .join(' ')

  if (image.url && image.url !== failedUrl) {
    return (
      <img
        className={avatarClassName}
        data-network={network}
        src={image.url}
        alt=""
        aria-hidden="true"
        onError={() => {
          setFailedUrl(image.url)
          if (cacheKey) rejectHomeV2Image(cacheKey, image.url as string)
        }}
      />
    )
  }

  if (fallback !== undefined) return <>{fallback}</>

  return (
    <div
      className={avatarClassName}
      data-network={network}
      data-loading={image.loading ? 'true' : 'false'}
      aria-hidden="true"
    >
      {avatarInitial(identity, query)}
    </div>
  )
}
