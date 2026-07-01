import { getQdnViewerKind } from './qdn';
import { parseAppAddress } from './routes';
import type { QdnImageResource } from './useQdnImageResource';

// Resolves the icon shown for a pinned/tabbed QDN APP or WEBSITE. The cascade is:
//   1. the app's own favicon for this identifier (so each identifier can differ),
//   2. the publisher name's THUMBNAIL avatar (shared across identifiers of a name),
//   3. a name-seeded monogram (handled by the <AppIcon> component).
// Only APP/WEBSITE resources get a fetched icon; every other route keeps its
// lucide type icon, so getAppIconResolution returns null for them.

export type AppIconResolution = {
  cacheKey: string;
  candidates: QdnImageResource[];
  monogram: string;
  nodeApiUrl: string;
  nodeEpoch: number;
};

export function getAppIconMonogram(value: string): string {
  const character = value.trim().charAt(0);

  return character ? character.toUpperCase() : '?';
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getAppIconResolution(
  displayUrl: string,
  nodeApiUrl: string,
  nodeEpoch: number,
): AppIconResolution | null {
  if (!nodeApiUrl) {
    return null;
  }

  const parsed = parseAppAddress(displayUrl);

  if (!parsed.success || parsed.route.kind !== 'resource') {
    return null;
  }

  const { resource } = parsed.route;

  // APP / WEBSITE only — these are the iframe-rendered "apps" that have a favicon.
  if (getQdnViewerKind(resource.service) !== 'iframe') {
    return null;
  }

  const identifier = resource.identifier ?? 'default';
  const base = trimTrailingSlashes(nodeApiUrl);

  const candidates: QdnImageResource[] = [
    {
      cacheKey: `app-icon:${resource.service}:${resource.name}:${identifier}:favicon.ico`,
      identifier,
      maxBytes: 256 * 1024,
      name: resource.name,
      path: 'favicon.ico',
      service: resource.service,
    },
    {
      cacheKey: `app-icon:THUMBNAIL:${resource.name}:avatar`,
      identifier: 'avatar',
      maxBytes: 1024 * 1024,
      name: resource.name,
      service: 'THUMBNAIL',
    },
  ];

  return {
    cacheKey: `${base}:${resource.service}:${resource.name}:${identifier}`,
    candidates,
    monogram: getAppIconMonogram(resource.name),
    nodeApiUrl: base,
    nodeEpoch,
  };
}
