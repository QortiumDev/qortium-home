import assert from 'node:assert/strict';
import { replaceLegacyQdnExplorerRoutes, resolveExploreAppRoute } from './exploreAppRoute';
import { DASHBOARD_ROUTE, parseAppAddress } from './routes';

const cases = [
  [{ kind: 'services', displayUrl: 'qdn://' }, 'qdn://APP/Explore/Explore#/services'],
  [{ kind: 'service', service: 'APP', displayUrl: 'qdn://APP' }, 'qdn://APP/Explore/Explore#/service/APP'],
  [{ kind: 'name-services', name: 'Alice & Bob', displayUrl: 'qdn://*/Alice%20%26%20Bob' }, 'qdn://APP/Explore/Explore#/name/Alice%20%26%20Bob/services'],
  [{ kind: 'name', service: 'DOCUMENT', name: 'Alice & Bob', displayUrl: 'qdn://DOCUMENT/Alice%20%26%20Bob' }, 'qdn://APP/Explore/Explore#/resource/DOCUMENT/Alice%20%26%20Bob'],
] as const;

for (const [legacyRoute, expectedUrl] of cases) {
  assert.equal(resolveExploreAppRoute(legacyRoute)?.displayUrl, expectedUrl);
}

// A user-selected default fragment is used for direct launches, but controlled
// legacy-route delegation replaces (never concatenates) that fragment.
assert.equal(
  resolveExploreAppRoute({ kind: 'service', service: 'APP', displayUrl: 'qdn://APP' }, 'qdn://APP/Explore/Explore#/service/VIDEO')?.displayUrl,
  'qdn://APP/Explore/Explore#/service/APP',
);

// home://preview is gone: the native launcher it opened was unreachable, and
// pre-publish preview now runs through PREVIEW_QDN_PUBLISH_SOURCE instead.
assert.equal(parseAppAddress('home://preview').success, false);
assert.equal(
  resolveExploreAppRoute({
    kind: 'resource',
    displayUrl: 'qdn://APP/Chat/Chat',
    resource: { service: 'APP', name: 'Chat', identifier: 'Chat', path: '', displayUrl: 'qdn://APP/Chat/Chat' },
  }),
  null,
  'direct resources remain Home viewer routes',
);

const migrated = replaceLegacyQdnExplorerRoutes([DASHBOARD_ROUTE, cases[0][0]]);
assert.equal(migrated[0], DASHBOARD_ROUTE);
assert.equal(migrated[1].displayUrl, cases[0][1]);

const unchanged = [DASHBOARD_ROUTE];
assert.equal(replaceLegacyQdnExplorerRoutes(unchanged), unchanged);

console.log('Explore app route cutover tests passed.');
