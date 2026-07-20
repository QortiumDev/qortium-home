import type { AppRoute } from './routes';

export type QdnAppTargetQuery = Record<string, string>;

// Apps that handle the OPEN_APP_TARGET message, and the query parameters each
// one treats as a navigation target rather than as part of its identity.
//
// This is deliberately an allowlist rather than "every query parameter is a
// target". Apps that deep-link through the URL but do not handle the message —
// qortium-help and qortium-boards both use `?post=<id>` — rely on a differing
// query producing a NEW tab. Treating their parameters as targets would make
// Home focus the existing tab and post a message they ignore, so the link would
// silently do nothing.
//
// Longer term an app should declare this itself (qortium-app.json), but that
// manifest is fetched asynchronously inside QdnViewer, while the tab-matching
// decision in App.tsx is synchronous and runs before any tab exists.
const QDN_APP_TARGET_PARAMS: ReadonlyArray<{
  service: string;
  name: string;
  identifier: string;
  params: readonly string[];
}> = [
  { service: 'APP', name: 'Chat', identifier: 'Chat', params: ['address', 'group'] },
  { service: 'APP', name: 'Recipes', identifier: 'Recipes', params: ['recipe', 'author'] },
];

function getTargetParams(route: AppRoute): readonly string[] {
  if (route.kind !== 'resource') {
    return [];
  }

  const { identifier, name, service } = route.resource;
  const entry = QDN_APP_TARGET_PARAMS.find(
    (candidate) =>
      candidate.service === service &&
      candidate.name === name &&
      candidate.identifier === (identifier ?? 'default'),
  );

  return entry?.params ?? [];
}

function getPathWithoutTargetQuery(path: string, params: readonly string[]) {
  const queryIndex = path.indexOf('?');

  if (queryIndex === -1) {
    return path;
  }

  const search = new URLSearchParams(path.slice(queryIndex + 1));
  for (const parameter of params) {
    search.delete(parameter);
  }
  const remainingQuery = search.toString();

  return `${path.slice(0, queryIndex)}${remainingQuery ? `?${remainingQuery}` : ''}`;
}

export function isSameQdnAppRoute(candidate: AppRoute, target: AppRoute) {
  if (candidate.kind !== 'resource' || target.kind !== 'resource') {
    return false;
  }

  if (
    candidate.resource.service !== target.resource.service ||
    candidate.resource.name !== target.resource.name ||
    (candidate.resource.identifier ?? 'default') !== (target.resource.identifier ?? 'default')
  ) {
    return false;
  }

  // Both sides address the same app, so either one resolves the same params.
  const params = getTargetParams(target);

  return getPathWithoutTargetQuery(candidate.resource.path, params) ===
    getPathWithoutTargetQuery(target.resource.path, params);
}

export function getQdnAppTargetQuery(route: AppRoute): QdnAppTargetQuery | null {
  if (route.kind !== 'resource') {
    return null;
  }

  const queryIndex = route.resource.path.indexOf('?');

  if (queryIndex === -1) {
    return null;
  }

  const search = new URLSearchParams(route.resource.path.slice(queryIndex + 1));
  const query: QdnAppTargetQuery = {};

  for (const parameter of getTargetParams(route)) {
    const value = search.get(parameter)?.trim();
    if (value) {
      query[parameter] = value;
    }
  }

  return Object.keys(query).length > 0 ? query : null;
}

export function getOpenAppTargetMessage(query: QdnAppTargetQuery) {
  return {
    action: 'OPEN_APP_TARGET' as const,
    requestedHandler: 'UI' as const,
    query,
  };
}
