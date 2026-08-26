import { useCallback, useState } from 'react'
import type { VisibleAppIconLoader } from '../contracts'
import { parseAppResourceLocation } from '../resource-location'
import { rejectHomeV2Image, useHomeV2Image } from './useHomeV2Image'

const APP_ICON_MAX_BYTES = 256 * 1024
const APP_ICON_LOADING_MS = 6_000

// R4-4: this used to fall back to a hand-rolled WEBSITE parser, because
// parseAppResourceLocation rejected every service but APP and a pinned or
// bookmarked qdn://WEBSITE/... address would otherwise have shown no icon.
// The shared parser now accepts the whole browser-archive set and carries the
// real service through, so that duplicate — which validated names and
// identifiers with its own, subtly different rules and never handled GAME —
// is gone. Callers (HomeV2PinnedApps, HomeV2BookmarkToolbar) only ever used
// it as a nullable target, so nothing depended on the fallback's shape.
export function getHomeV2AppIconTarget(displayUrl: string) {
  try {
    const parsed = parseAppResourceLocation(displayUrl)
    return {
      identifier: parsed.identity.identifier,
      name: parsed.identity.name,
      network: parsed.sourceNetwork,
      service: parsed.identity.service,
    } as const
  } catch {
    return null
  }
}

export function HomeV2AppIcon({
  className,
  displayUrl,
  loader,
  size,
  variant,
}: {
  readonly className?: string
  readonly displayUrl: string
  readonly loader?: VisibleAppIconLoader
  readonly size: number
  readonly variant: 'pin' | 'row' | 'tab'
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const target = getHomeV2AppIconTarget(displayUrl)
  const cacheKey = target
    ? JSON.stringify([
        'app-icon',
        target.network,
        target.name,
        target.identifier ?? 'default',
        target.service,
      ])
    : null
  const load = useCallback(
    () =>
      loader!(target!.network, {
        identifier: target!.identifier,
        name: target!.name,
        service: target!.service,
      }),
    [loader, target?.identifier, target?.name, target?.network, target?.service],
  )
  const image = useHomeV2Image({
    cacheKey,
    load: cacheKey && loader ? load : undefined,
    loadingMs: APP_ICON_LOADING_MS,
    maxBytes: APP_ICON_MAX_BYTES,
  })
  if (!target) return null
  const monogram = target.name.trim().slice(0, 1).toUpperCase() || '?'
  return (
    <span
      className={[
        'home-v2-app-icon',
        `home-v2-app-icon--${variant}`,
        className,
      ].filter(Boolean).join(' ')}
      data-loading={image.loading ? 'true' : 'false'}
      style={{ height: size, width: size, fontSize: Math.round(size * 0.5) }}
      aria-hidden="true"
    >
      <span className="home-v2-app-icon__monogram">{monogram}</span>
      {image.url && image.url !== failedUrl ? (
        // Eager for every variant: a lazy image inside a hidden dashboard tab is
        // never fetched, so pins pop in as monograms when that tab is shown.
        <img
          alt=""
          className="home-v2-app-icon__image"
          decoding="async"
          loading="eager"
          src={image.url}
          onError={() => {
            setFailedUrl(image.url)
            if (cacheKey) rejectHomeV2Image(cacheKey, image.url as string)
          }}
        />
      ) : null}
    </span>
  )
}
