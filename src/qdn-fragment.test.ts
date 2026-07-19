import assert from 'node:assert/strict';
import { appendQdnFragment, splitQdnFragment } from './qdn-fragment.js';
import { normalizeQdnBridgeNavigationSnapshot } from './qdn-navigation-bridge.js';

assert.deepEqual(
  splitQdnFragment('APP/Help/Help/page?view=docs#install-linux'),
  {
    fragment: 'install-linux',
    location: 'APP/Help/Help/page?view=docs',
  },
  'the browser fragment is separate from the Core-facing path and query',
);
assert.deepEqual(splitQdnFragment('APP/Help/Help#'), {
  fragment: '',
  location: 'APP/Help/Help',
});
assert.equal(
  appendQdnFragment('https://node/render/APP/Help/Help/page?view=docs', 'install-linux'),
  'https://node/render/APP/Help/Help/page?view=docs#install-linux',
);

assert.deepEqual(
  normalizeQdnBridgeNavigationSnapshot({
    activeIndex: 2,
    entries: [
      { index: 1, url: '/render/APP/Help/Help/page?view=docs#overview' },
      { index: 2, url: 'https://node.example/render/APP/Help/Help/page?view=docs#details' },
    ],
  }, 'https://node.example/render/APP/Help/Help/#cold-direct'),
  {
    activeIndex: 2,
    entries: [
      { index: 1, url: 'https://node.example/render/APP/Help/Help/page?view=docs#overview' },
      { index: 2, url: 'https://node.example/render/APP/Help/Help/page?view=docs#details' },
    ],
  },
  'Android bridge snapshots preserve path, query, and fragment',
);

assert.equal(
  normalizeQdnBridgeNavigationSnapshot({
    activeIndex: 0,
    entries: [{ index: 0, url: 'https://other.example/render/APP/Help/Help/#forged' }],
  }, 'https://node.example/render/APP/Help/Help/'),
  null,
  'Android bridge snapshots remain confined to the selected node origin',
);

console.log('QDN fragment and bridge tests passed.');
