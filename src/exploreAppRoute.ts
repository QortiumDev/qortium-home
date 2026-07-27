import { buildQdnDisplayUrl, type QdnExplorerRoute, type QdnResource } from './qdn';
import type { AppRoute } from './routes';

export const EXPLORE_APP = {
  identifier: 'Explore',
  name: 'Explore',
  service: 'APP',
} as const;

export type ExploreAppRoute = Extract<AppRoute, { kind: 'resource' }>;

function isLegacyQdnExplorerRoute(route: AppRoute): route is QdnExplorerRoute {
  return route.kind === 'services' || route.kind === 'service' || route.kind === 'name-services' || route.kind === 'name';
}

function getExploreFragment(route: QdnExplorerRoute) {
  switch (route.kind) {
    case 'services':
      return '/services';
    case 'service':
      return `/service/${encodeURIComponent(route.service)}`;
    case 'name-services':
      return `/name/${encodeURIComponent(route.name)}/services`;
    case 'name':
      return `/resource/${encodeURIComponent(route.service)}/${encodeURIComponent(route.name)}`;
  }
}

/**
 * Moves only Home's four legacy QDN listing routes into the published Explore
 * app. Direct resources deliberately remain native Home viewer routes.
 */
export function resolveExploreAppRoute(route: AppRoute): ExploreAppRoute | null {
  if (!isLegacyQdnExplorerRoute(route)) {
    return null;
  }

  const fragment = getExploreFragment(route);
  const resource = {
    ...EXPLORE_APP,
    fragment,
    path: '',
  } satisfies Omit<QdnResource, 'displayUrl'>;
  const displayUrl = buildQdnDisplayUrl(resource);

  return {
    kind: 'resource',
    displayUrl,
    resource: {
      ...resource,
      displayUrl,
    },
  };
}

export function replaceLegacyQdnExplorerRoutes(entries: AppRoute[]): AppRoute[] {
  let changed = false;
  const nextEntries = entries.map((entry) => {
    const exploreRoute = resolveExploreAppRoute(entry);

    if (!exploreRoute) return entry;
    changed = true;
    return exploreRoute;
  });

  return changed ? nextEntries : entries;
}
