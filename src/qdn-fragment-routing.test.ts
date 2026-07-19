import assert from 'node:assert/strict';
import {
  buildQdnRawResourceUrl,
  buildQdnRenderUrl,
  buildQdnStatusUrl,
} from './qdn';
import { parseAppAddress } from './routes';

function getResource(address: string) {
  const parsed = parseAppAddress(address);

  assert.equal(parsed.success, true, `${address} should parse`);

  if (!parsed.success || parsed.route.kind !== 'resource') {
    throw new Error(`${address} did not parse as a QDN resource`);
  }

  return parsed.route.resource;
}

const direct = getResource('qdn://APP/Help/Help/page?view=docs#install-linux');

assert.equal(direct.path, 'page?view=docs');
assert.equal(direct.fragment, 'install-linux');
assert.equal(direct.displayUrl, 'qdn://APP/Help/Help/page?view=docs#install-linux');
assert.equal(
  buildQdnRenderUrl(direct, 'https://node.example'),
  'https://node.example/render/APP/Help/Help/page?view=docs#install-linux',
  'a cold direct route gives the browser its fragment',
);
assert.equal(
  buildQdnRawResourceUrl(direct, 'https://node.example'),
  'https://node.example/arbitrary/APP/Help/Help?view=docs&filepath=page',
  'the fragment never becomes a Core filepath or query parameter',
);
assert.equal(
  buildQdnStatusUrl(direct, 'https://node.example'),
  'https://node.example/arbitrary/resource/status/APP/Help/Help',
);

const hashOnly = getResource('qdn://APP/Help/Help#faq');

assert.equal(hashOnly.path, '');
assert.equal(hashOnly.fragment, 'faq');
assert.equal(buildQdnRenderUrl(hashOnly, 'https://node.example'), 'https://node.example/render/APP/Help/Help#faq');

// Closed tabs, duplicate tabs, and move-to-window snapshots all persist route
// histories by displayUrl and reparse them when restored. Exercise that durable
// boundary rather than relying on in-memory object identity.
const durableSnapshot = JSON.parse(JSON.stringify({
  entries: [{ displayUrl: direct.displayUrl }],
  index: 0,
})) as { entries: Array<{ displayUrl: string }>; index: number };
const restored = getResource(durableSnapshot.entries[durableSnapshot.index].displayUrl);

assert.equal(restored.displayUrl, direct.displayUrl, 'reopen/duplicate/window snapshots retain the fragment');
assert.equal(
  buildQdnRenderUrl(restored, 'https://node.example'),
  'https://node.example/render/APP/Help/Help/page?view=docs#install-linux',
  'reload and restored tabs reopen the same client-side location',
);

console.log('QDN fragment route persistence tests passed.');
