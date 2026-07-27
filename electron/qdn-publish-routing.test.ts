import assert from 'node:assert/strict';
import { shouldStreamQdnPublishSource, shouldUnpackQdnPublishArchive } from './qdn-publish-routing.js';

// Every path-backed source streams, whatever the service: a path only resolves
// on the node's own filesystem, so naming one to a remote Core publishes
// nothing and fails with NoSuchFileException.
assert.equal(shouldStreamQdnPublishSource({ path: '/tmp/site.zip', isZip: true }), true);
assert.equal(shouldStreamQdnPublishSource({ path: '/tmp/dist.zip', isZip: true }), true);
assert.equal(shouldStreamQdnPublishSource({ path: '/tmp/notes.txt', isZip: false }), true);
assert.equal(shouldStreamQdnPublishSource({ path: '/tmp/project' }), true);
assert.equal(shouldStreamQdnPublishSource({ isZip: true }), false);
assert.equal(shouldStreamQdnPublishSource({ path: '' }), false);

// Unpacking stays a browser-rendering concern, so APP, WEBSITE, and GAME can
// publish HTML archives while a ZIP for any other service remains the resource
// itself.
assert.equal(shouldUnpackQdnPublishArchive({ service: 'WEBSITE' }, { path: '/tmp/site.zip', isZip: true }), true);
assert.equal(shouldUnpackQdnPublishArchive({ service: 'APP' }, { path: '/tmp/app.zip', isZip: true }), true);
assert.equal(shouldUnpackQdnPublishArchive({ service: 'GAME' }, { path: '/tmp/game.zip', isZip: true }), true);
assert.equal(shouldUnpackQdnPublishArchive({ service: 'WEBSITE' }, { path: '/tmp/index.html', isZip: false }), false);
assert.equal(shouldUnpackQdnPublishArchive({ service: 'FILE' }, { path: '/tmp/archive.zip', isZip: true }), false);
assert.equal(shouldUnpackQdnPublishArchive({ service: 'DOCUMENT' }, { path: '/tmp/dist.zip', isZip: true }), false);
assert.equal(shouldUnpackQdnPublishArchive({ service: 'WEBSITE' }, { isZip: true }), true);
assert.equal(shouldUnpackQdnPublishArchive({ service: 'GAME_PRIVATE' }, { path: '/tmp/game.zip', isZip: true }), false);

console.log('QDN publish routing tests passed.');
