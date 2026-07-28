import assert from 'node:assert/strict';
import {
  getQdnFrameMessageOrigin,
  resolveQdnFrameMessageUrl,
} from './qdnFrameMessaging';

const upstreamRenderUrl = 'http://preview.example:24891/render/APP/Example/App';
const proxiedFrameUrl =
  'https://n0123456789abcdef0123456789abcdef.qdn.androidplatform.net/render/APP/Example/App';

assert.equal(resolveQdnFrameMessageUrl(null, upstreamRenderUrl), upstreamRenderUrl);
assert.equal(
  resolveQdnFrameMessageUrl(proxiedFrameUrl, upstreamRenderUrl),
  proxiedFrameUrl,
);
assert.equal(
  getQdnFrameMessageOrigin(resolveQdnFrameMessageUrl(proxiedFrameUrl, upstreamRenderUrl)),
  'https://n0123456789abcdef0123456789abcdef.qdn.androidplatform.net',
);
assert.notEqual(
  getQdnFrameMessageOrigin(resolveQdnFrameMessageUrl(proxiedFrameUrl, upstreamRenderUrl)),
  new URL(upstreamRenderUrl).origin,
);
assert.equal(getQdnFrameMessageOrigin('not a URL'), '*');

console.log('QDN frame messaging tests passed.');
