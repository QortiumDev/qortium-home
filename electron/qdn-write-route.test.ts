import assert from 'node:assert/strict';
import { isSameQdnWriteRoute, resolveQdnWriteRoute } from './qdn-write-route.js';

// Only a node on this machine may be handed the private key.
assert.equal(resolveQdnWriteRoute({ mode: 'local', nodeApiUrl: 'http://127.0.0.1:24891' }), 'local');
assert.equal(resolveQdnWriteRoute({ mode: 'custom', nodeApiUrl: 'http://localhost:24891' }), 'local');
assert.equal(
  resolveQdnWriteRoute({ apiKey: 'key', mode: 'custom', nodeApiUrl: 'http://127.0.0.1:24891' }),
  'local',
);

// A configured remote node with an API key is trusted enough for the
// authenticated endpoints, and is signed for on this machine.
assert.equal(
  resolveQdnWriteRoute({ apiKey: 'key', mode: 'custom', nodeApiUrl: 'https://node.example:24891' }),
  'remote-authenticated',
);
assert.equal(
  resolveQdnWriteRoute({ apiKey: '  key  ', mode: 'custom', nodeApiUrl: 'http://203.0.113.7:24891' }),
  'remote-authenticated',
);

// Without a usable API key there is nothing to authenticate with, and network
// mode is public whatever it was pointed at.
assert.equal(resolveQdnWriteRoute({ mode: 'custom', nodeApiUrl: 'http://203.0.113.7:24891' }), 'public');
assert.equal(
  resolveQdnWriteRoute({ apiKey: '   ', mode: 'custom', nodeApiUrl: 'http://203.0.113.7:24891' }),
  'public',
);
assert.equal(
  resolveQdnWriteRoute({ apiKey: 'key', mode: 'network', nodeApiUrl: 'http://127.0.0.1:24891' }),
  'public',
);
assert.equal(resolveQdnWriteRoute({ mode: 'custom', nodeApiUrl: 'not a url' }), 'public');

// Freshness: the same node on the same route may still be submitted to.
assert.equal(
  isSameQdnWriteRoute(
    { apiKey: 'key', mode: 'custom', nodeApiUrl: 'http://203.0.113.7:24891' },
    { apiKey: 'key', mode: 'custom', nodeApiUrl: 'http://203.0.113.7:24891' },
  ),
  true,
);
assert.equal(
  isSameQdnWriteRoute(
    { mode: 'network', nodeApiUrl: 'https://node.example' },
    { mode: 'network', nodeApiUrl: 'https://node.example' },
  ),
  true,
);

// A different node, or the same node reached a different way, is not.
assert.equal(
  isSameQdnWriteRoute(
    { mode: 'network', nodeApiUrl: 'https://other.example' },
    { mode: 'network', nodeApiUrl: 'https://node.example' },
  ),
  false,
);
assert.equal(
  isSameQdnWriteRoute(
    { mode: 'custom', nodeApiUrl: 'http://203.0.113.7:24891' },
    { apiKey: 'key', mode: 'custom', nodeApiUrl: 'http://203.0.113.7:24891' },
  ),
  false,
);
assert.equal(
  isSameQdnWriteRoute(
    { apiKey: 'key', mode: 'custom', nodeApiUrl: 'http://127.0.0.1:24891' },
    { mode: 'network', nodeApiUrl: 'http://127.0.0.1:24891' },
  ),
  false,
);

console.log('QDN write route tests passed.');
