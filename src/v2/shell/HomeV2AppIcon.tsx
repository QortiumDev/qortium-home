import { useCallback, useState } from 'react'
import type { VisibleAppIconLoader } from '../contracts'
import { parseAppResourceLocation } from '../resource-location'
import { rejectHomeV2Image, useHomeV2Image } from './useHomeV2Image'

const APP_ICON_MAX_BYTES = 256 * 1024
const APP_ICON_LOADING_MS = 6_000

export function getHomeV2AppIconTarget(displayUrl: string) {
  try {
    const parsed = parseAppResourceLocation(displayUrl)
    return {
      identifier: parsed.identity.identifier,
      name: parsed.identity.name,
      network: parsed.sourceNetwork,
      service: 'APP' as const,
    } as const
  } catch {
    try {
      const parsed = new URL(displayUrl.trim())
      const scheme = parsed.protocol.toLowerCase()
      const service = decodeURIComponent(parsed.hostname).toUpperCase()
      const segments = parsed.pathname.split('/').filter(Boolean)
      const name = decodeURIComponent(segments[0] ?? '').trim()
      const rawIdentifier = decodeURIComponent(segments[1] ?? 'default').trim()
      if (
        (scheme !== 'qdn:' && scheme !== 'qortal:') ||
        service !== 'WEBSITE' ||
        !name ||
        name.length > 128 ||
        !rawIdentifier ||
        rawIdentifier.length > 128 ||
        /[\u0000-\u001f\u007f]/.test(name) ||
        /[\u0000-\u001f\u007f]/.test(rawIdentifier)
      ) {
        return null
      }
      return {
        identifier: rawIdentifier === 'default' ? null : rawIdentifier,
        name,
        network: scheme === 'qdn:' ? 'qortium' as const : 'qortal' as const,
        service: 'WEBSITE' as const,
      }
    } catch {
      return null
    }
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
        <img
          alt=""
          className="home-v2-app-icon__image"
          decoding="async"
          loading={variant === 'pin' ? 'lazy' : 'eager'}
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
