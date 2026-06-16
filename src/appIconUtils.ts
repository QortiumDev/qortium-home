import { getQdnViewerKind } from './qdn';
import { parseAppAddress } from './routes';

// Resolves the icon shown for a pinned/tabbed QDN APP or WEBSITE. The cascade is:
//   1. the app's own favicon for this identifier (so each identifier can differ),
//   2. the publisher name's THUMBNAIL avatar (shared across identifiers of a name),
//   3. a name-seeded monogram (handled by the <AppIcon> component).
// Only APP/WEBSITE resources get a fetched icon; every other route keeps its
// lucide type icon, so getAppIconResolution returns null for them.

export type AppIconResolution = {
  cacheKey: string;
  candidateUrls: string[];
  monogram: string;
};

// Maps a cache key to the index of the icon candidate that was observed to LOAD
// (only successes are cached — never failures), so re-mounts of an already-resolved
// pin/tab skip straight to the working candidate without re-walking the cascade.
// Keyed by nodeEpoch so reconnecting to a node drops stale entries.
const resolvedIconIndexCache = new Map<string, number>();

export function readCachedIconIndex(cacheKey: string): number {
  return resolvedIconIndexCache.get(cacheKey) ?? 0;
}

export function writeCachedIconIndex(cacheKey: string, index: number): void {
  resolvedIconIndexCache.set(cacheKey, index);
}

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
  const encodedName = encodeURIComponent(resource.name);
  const encodedIdentifier = encodeURIComponent(identifier);

  // async=true lets the node fetch in the background and return a placeholder /
  // error rather than blocking; the <img> cascade falls through until ready.
  const candidateUrls = [
    `${base}/arbitrary/${resource.service}/${encodedName}/${encodedIdentifier}?filepath=favicon.ico&async=true`,
    `${base}/arbitrary/THUMBNAIL/${encodedName}/avatar?async=true`,
  ];

  return {
    cacheKey: `${nodeEpoch}:${base}:${resource.service}:${resource.name}:${identifier}`,
    candidateUrls,
    monogram: getAppIconMonogram(resource.name),
  };
}
