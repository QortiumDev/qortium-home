import assert from 'node:assert/strict';
import { DEFAULT_PREFERRED_APPS, normalizePreferredApps, parsePreferredAppUrl } from './preferredApps.js';

assert.equal(parsePreferredAppUrl(' qdn://app/Bookmarks/Bookmarks?view=all '), 'qdn://APP/Bookmarks/Bookmarks');
assert.equal(parsePreferredAppUrl('qdn://WEBSITE/example/site'), 'qdn://WEBSITE/example/site');
assert.throws(() => parsePreferredAppUrl('https://example.org'));
assert.throws(() => parsePreferredAppUrl('home://bookmarks'));
assert.deepEqual(normalizePreferredApps({ version: 1, bookmarksManager: 'qdn://app/Other/Manager' }), {
  version: 1,
  bookmarksManager: 'qdn://APP/Other/Manager',
});
assert.deepEqual(normalizePreferredApps({ version: 1, bookmarksManager: 'not an app' }), DEFAULT_PREFERRED_APPS);
assert.deepEqual(normalizePreferredApps({ version: 2, bookmarksManager: 'qdn://APP/Other/Manager' }), DEFAULT_PREFERRED_APPS);

console.log('preferred app settings tests passed');
