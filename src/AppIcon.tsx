import { useEffect, useState } from 'react';
import type { AppIconResolution } from './appIconUtils';
import { readCachedIconIndex, writeCachedIconIndex } from './appIconUtils';

// Renders an APP/WEBSITE icon as a square chip. A name-seeded monogram is always
// drawn as the base so there is never a broken-image flash or layout shift; the
// fetched icon is overlaid and fades in once it decodes. On error the cascade
// advances to the next candidate URL; when every candidate fails the monogram
// remains visible. The resolved candidate index is cached so re-mounts (tab
// switches, pin re-renders during a drag) skip candidates already known to fail.
export function AppIcon({
  resolution,
  size,
  variant,
}: {
  resolution: AppIconResolution;
  size: number;
  variant: 'pin' | 'tab';
}) {
  const { cacheKey, candidateUrls, monogram } = resolution;
  const [index, setIndex] = useState(() => readCachedIconIndex(cacheKey));
  const [isLoaded, setIsLoaded] = useState(false);

  // Restart the cascade whenever the resolved resource (or node epoch) changes.
  useEffect(() => {
    setIndex(readCachedIconIndex(cacheKey));
    setIsLoaded(false);
  }, [cacheKey]);

  const currentUrl = index < candidateUrls.length ? candidateUrls[index] : null;

  return (
    <span
      className={`app-icon app-icon--${variant}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      aria-hidden="true"
    >
      <span className="app-icon__monogram">{monogram}</span>
      {currentUrl ? (
        <img
          key={currentUrl}
          className="app-icon__image"
          src={currentUrl}
          alt=""
          loading="lazy"
          decoding="async"
          data-loaded={isLoaded ? 'true' : 'false'}
          onLoad={() => {
            setIsLoaded(true);
            // Only successes are cached, so a transient error (a not-yet-built
            // resource fetched with async=true, or an aborted lazy tab image)
            // never sticks a pin/tab on its monogram: a later re-mount re-probes
            // from the top, matching TabAvatar's per-instance retry behavior.
            writeCachedIconIndex(cacheKey, index);
          }}
          onError={() => {
            setIsLoaded(false);
            setIndex(index + 1);
          }}
        />
      ) : null}
    </span>
  );
}
