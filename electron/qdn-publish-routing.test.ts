import assert from 'node:assert/strict';
import { shouldUseQdnLocalArchiveUpload } from './qdn-publish-routing.js';

assert.equal(
  shouldUseQdnLocalArchiveUpload({ service: 'WEBSITE' }, { path: '/tmp/site.zip', isZip: true }),
  true,
);
assert.equal(
  shouldUseQdnLocalArchiveUpload({ service: 'APP' }, { path: '/tmp/app.zip', isZip: true }),
  true,
);
assert.equal(
  shouldUseQdnLocalArchiveUpload({ service: 'WEBSITE' }, { path: '/tmp/index.html', isZip: false }),
  false,
);
assert.equal(
  shouldUseQdnLocalArchiveUpload({ service: 'FILE' }, { path: '/tmp/archive.zip', isZip: true }),
  false,
);
assert.equal(
  shouldUseQdnLocalArchiveUpload({ service: 'WEBSITE' }, { isZip: true }), false);

console.log('QDN local archive publish routing tests passed.');
