import assert from 'node:assert/strict';
import { getAdjacentGalleryFile, getGallerySwipeDirection } from './qdnGalleryNavigation';

const files = ['one.png', 'two.png', 'three.png'];

assert.equal(getAdjacentGalleryFile(files, 'two.png', 'previous'), 'one.png');
assert.equal(getAdjacentGalleryFile(files, 'two.png', 'next'), 'three.png');
assert.equal(getAdjacentGalleryFile(files, 'one.png', 'previous'), null);
assert.equal(getAdjacentGalleryFile(files, 'three.png', 'next'), null);
assert.equal(getAdjacentGalleryFile(files, 'missing.png', 'next'), null);

assert.equal(getGallerySwipeDirection(-80, 10), 'next');
assert.equal(getGallerySwipeDirection(80, -10), 'previous');
assert.equal(getGallerySwipeDirection(47, 0), null);
assert.equal(getGallerySwipeDirection(80, 100), null);

console.log('QDN gallery navigation tests passed.');
