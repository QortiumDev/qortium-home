import assert from 'node:assert/strict';
import { replaceLegacyBookmarksRoutes, resolveBookmarksManagerRoute } from './bookmarksManagerRoute';
import { BOOKMARKS_ROUTE, DASHBOARD_ROUTE } from './routes';

const defaultManager = resolveBookmarksManagerRoute(null);
assert.equal(defaultManager?.kind, 'resource');
assert.equal(defaultManager?.displayUrl, 'qdn://APP/Bookmarks/Bookmarks');

const customManager = resolveBookmarksManagerRoute('qdn://WEBSITE/Example/Manager?tab=bookmarks');
assert.equal(customManager?.kind, 'resource');
assert.equal(customManager?.displayUrl, 'qdn://WEBSITE/Example/Manager/?tab=bookmarks');

assert.equal(resolveBookmarksManagerRoute('qdn://APP/Bookmarks').displayUrl, defaultManager.displayUrl);
assert.equal(resolveBookmarksManagerRoute('https://example.invalid/bookmarks').displayUrl, defaultManager.displayUrl);

assert.ok(defaultManager);
assert.deepEqual(
  replaceLegacyBookmarksRoutes([DASHBOARD_ROUTE, BOOKMARKS_ROUTE], defaultManager),
  [DASHBOARD_ROUTE, defaultManager],
);

const unchanged = [DASHBOARD_ROUTE];
assert.equal(replaceLegacyBookmarksRoutes(unchanged, defaultManager), unchanged);
