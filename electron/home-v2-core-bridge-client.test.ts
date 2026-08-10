import assert from 'node:assert/strict';
import { isHomeV2CoreBridgeClientRequest } from './home-v2-core-bridge-client.js';

const qortalOrigin = 'https://ext-node.qortal.link';

assert.equal(
  isHomeV2CoreBridgeClientRequest(`${qortalOrigin}/apps/q-apps.js`, qortalOrigin),
  true,
);
assert.equal(
  isHomeV2CoreBridgeClientRequest(`${qortalOrigin}/apps/q-apps.js?timestamp=123`, qortalOrigin),
  true,
);
assert.equal(
  isHomeV2CoreBridgeClientRequest('http://127.0.0.1:12391/apps/q-apps.js?v=3', 'http://127.0.0.1:12391'),
  true,
);
assert.equal(
  isHomeV2CoreBridgeClientRequest('https://api.qortal.org/apps/q-apps.js', qortalOrigin),
  false,
);
assert.equal(
  isHomeV2CoreBridgeClientRequest(`${qortalOrigin}/apps/q-apps.js/extra`, qortalOrigin),
  false,
);
assert.equal(
  isHomeV2CoreBridgeClientRequest(`${qortalOrigin}/apps/q-apps.js.map`, qortalOrigin),
  false,
);
assert.equal(
  isHomeV2CoreBridgeClientRequest(`${qortalOrigin}/render/APP/q-apps.js`, qortalOrigin),
  false,
);
assert.equal(isHomeV2CoreBridgeClientRequest('not a URL', qortalOrigin), false);

console.log('Home v2 Core bridge-client request tests passed.');
