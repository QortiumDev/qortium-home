import assert from 'node:assert/strict';
import { getAppIconResolution } from './appIconUtils';
import { QdnImageMissingRevisionCache } from './qdnImageMissingRevisionCache';

const resolution = getAppIconResolution(
  'qdn://APP/Example/Example',
  'http://127.0.0.1:24891/',
  3,
);

assert(resolution);
assert.equal(resolution.candidates.length, 2);
assert.deepEqual(
  resolution.candidates.map(({ identifier, name, optional, path, service }) => ({
    identifier,
    name,
    optional,
    path,
    service,
  })),
  [
    {
      identifier: 'Example',
      name: 'Example',
      optional: true,
      path: 'favicon.ico',
      service: 'APP',
    },
    {
      identifier: 'avatar',
      name: 'Example',
      optional: undefined,
      path: undefined,
      service: 'THUMBNAIL',
    },
  ],
  'APP icons must retain the favicon, publisher avatar, then monogram cascade.',
);

const missingRevisions = new QdnImageMissingRevisionCache(2);
missingRevisions.remember('favicon:a', 'revision-1');
assert.equal(missingRevisions.has('favicon:a', 'revision-1'), true);
assert.equal(
  missingRevisions.has('favicon:a', 'revision-2'),
  false,
  'A new publication revision must retry an optional favicon.',
);

missingRevisions.remember('favicon:b', 'revision-1');
missingRevisions.remember('favicon:c', 'revision-1');
assert.equal(missingRevisions.has('favicon:a', 'revision-1'), false, 'The cache must remain bounded.');
missingRevisions.forget('favicon:b');
assert.equal(missingRevisions.has('favicon:b', 'revision-1'), false);

console.log('QDN app icon fallback and missing-revision cache tests passed.');
