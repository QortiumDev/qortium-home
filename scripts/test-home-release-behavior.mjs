import assert from 'node:assert/strict';
import {
  BOOKMARKS_STATE_VERSION,
  isBookmarkTreeStateVersion,
  normalizeBookmarkToolbarVisibility,
  shouldShowBookmarkToolbar,
} from '../dist-electron/bookmark-toolbar.js';
import {
  classifyCoreApiDocsProbe,
  resolveCoreApiDocsProbe,
} from '../dist-electron/core-api-docs.js';

assert.equal(BOOKMARKS_STATE_VERSION, 3);
assert.equal(isBookmarkTreeStateVersion(1), false);
assert.equal(isBookmarkTreeStateVersion(2), true);
assert.equal(isBookmarkTreeStateVersion(3), true);

assert.equal(normalizeBookmarkToolbarVisibility('always'), 'always');
assert.equal(normalizeBookmarkToolbarVisibility('dashboard'), 'dashboard');
assert.equal(normalizeBookmarkToolbarVisibility('hidden'), 'hidden');
assert.equal(normalizeBookmarkToolbarVisibility(undefined, true), 'always');
assert.equal(normalizeBookmarkToolbarVisibility(undefined, false), 'hidden');
assert.equal(normalizeBookmarkToolbarVisibility('invalid', true), 'always');

assert.equal(shouldShowBookmarkToolbar('always', false), true);
assert.equal(shouldShowBookmarkToolbar('dashboard', true), true);
assert.equal(shouldShowBookmarkToolbar('dashboard', false), false);
assert.equal(shouldShowBookmarkToolbar('hidden', true), false);

assert.deepEqual(classifyCoreApiDocsProbe(200, '<html>Swagger UI</html>', false), {
  kind: 'available',
});
assert.deepEqual(classifyCoreApiDocsProbe(200, 'API documentation currently disabled', false), {
  kind: 'disabled',
});
assert.deepEqual(classifyCoreApiDocsProbe(403, 'Forbidden', false), { kind: 'forbidden' });
assert.deepEqual(resolveCoreApiDocsProbe({ kind: 'forbidden' }, 'custom'), { kind: 'restricted' });
assert.deepEqual(resolveCoreApiDocsProbe({ kind: 'forbidden' }, 'network'), { kind: 'disabled' });
assert.deepEqual(resolveCoreApiDocsProbe({ kind: 'forbidden' }, 'local'), { kind: 'disabled' });
assert.deepEqual(classifyCoreApiDocsProbe(404, 'Not found', false), { kind: 'disabled' });
assert.deepEqual(classifyCoreApiDocsProbe(502, 'Bad gateway', false), {
  kind: 'http-error',
  status: 502,
});
assert.deepEqual(classifyCoreApiDocsProbe(200, 'API documentation currently disabled', true), {
  kind: 'available',
});

console.log('Home 1.3.2 bookmark and Core API docs behavior tests passed.');
