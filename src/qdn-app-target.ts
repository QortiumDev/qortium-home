import type { AppRoute } from './routes';

export type QdnAppTargetQuery = {
  address?: string;
  group?: string;
};

function getPathWithoutTargetQuery(path: string) {
  const queryIndex = path.indexOf('?');

  if (queryIndex === -1) {
    return path;
  }

  const params = new URLSearchParams(path.slice(queryIndex + 1));
  params.delete('address');
  params.delete('group');
  const remainingQuery = params.toString();

  return `${path.slice(0, queryIndex)}${remainingQuery ? `?${remainingQuery}` : ''}`;
}

export function isSameQdnAppRoute(candidate: AppRoute, target: AppRoute) {
  return candidate.kind === 'resource' &&
    target.kind === 'resource' &&
    candidate.resource.service === target.resource.service &&
    candidate.resource.name === target.resource.name &&
    (candidate.resource.identifier ?? 'default') === (target.resource.identifier ?? 'default') &&
    getPathWithoutTargetQuery(candidate.resource.path) === getPathWithoutTargetQuery(target.resource.path);
}

export function getQdnAppTargetQuery(route: AppRoute): QdnAppTargetQuery | null {
  if (route.kind !== 'resource') {
    return null;
  }

  const queryIndex = route.resource.path.indexOf('?');

  if (queryIndex === -1) {
    return null;
  }

  const params = new URLSearchParams(route.resource.path.slice(queryIndex + 1));
  const address = params.get('address')?.trim();
  const group = params.get('group')?.trim();

  if (!address && !group) {
    return null;
  }

  return {
    ...(address ? { address } : {}),
    ...(group ? { group } : {}),
  };
}

export function getOpenAppTargetMessage(query: QdnAppTargetQuery) {
  return {
    action: 'OPEN_APP_TARGET' as const,
    requestedHandler: 'UI' as const,
    query,
  };
}
