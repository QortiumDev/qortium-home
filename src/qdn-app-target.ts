import type { AppRoute } from './routes';

export type QdnAppTargetQuery = {
  address?: string;
  group?: string;
};

export function isSameQdnAppRoute(candidate: AppRoute, target: AppRoute) {
  return candidate.kind === 'resource' &&
    target.kind === 'resource' &&
    candidate.resource.service === target.resource.service &&
    candidate.resource.name === target.resource.name;
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
