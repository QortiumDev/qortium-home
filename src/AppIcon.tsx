import type { AppIconResolution } from './appIconUtils';
import { useQdnImageCandidates } from './useQdnImageResource';

// Renders an APP/WEBSITE icon as a square chip. A name-seeded monogram is always
// drawn as the base; a shared QDN resolver overlays the best ready candidate and
// keeps the last good image visible while network/node state refreshes.
export function AppIcon({
  className,
  resolution,
  size,
  variant,
}: {
  className?: string;
  resolution: AppIconResolution;
  size: number;
  variant: 'bookmark' | 'pin' | 'tab';
}) {
  const { candidates, monogram, nodeApiUrl, nodeEpoch } = resolution;
  const icon = useQdnImageCandidates(candidates, nodeApiUrl, nodeEpoch);

  return (
    <span
      className={['app-icon', `app-icon--${variant}`, className].filter(Boolean).join(' ')}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      aria-hidden="true"
    >
      <span className="app-icon__monogram">{monogram}</span>
      {icon.url ? (
        <img
          key={icon.url}
          className="app-icon__image"
          src={icon.url}
          alt=""
          loading="lazy"
          decoding="async"
          data-loaded="true"
        />
      ) : null}
    </span>
  );
}
