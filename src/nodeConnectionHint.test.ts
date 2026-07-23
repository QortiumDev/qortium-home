import assert from 'node:assert/strict';
import { resolveCustomNodeHintKey } from './nodeConnectionHint';

// A node on this machine keeps every capability, with or without an API key.
assert.equal(
  resolveCustomNodeHintKey({ apiKey: '', nodeApiUrl: 'http://127.0.0.1:24891' }),
  'node.customUrlHintLocal',
);
assert.equal(
  resolveCustomNodeHintKey({ apiKey: 'key', nodeApiUrl: 'http://localhost:24891' }),
  'node.customUrlHintLocal',
);

// An encrypted remote node with a key is the only way to reach the node's own
// publish limit.
assert.equal(
  resolveCustomNodeHintKey({ apiKey: 'key', nodeApiUrl: 'https://node.example:24891' }),
  'node.customUrlHintRemoteHttps',
);
assert.equal(
  resolveCustomNodeHintKey({ apiKey: '  key  ', nodeApiUrl: 'https://node.example:24891' }),
  'node.customUrlHintRemoteHttps',
);

// Encrypted but keyless: nothing to authenticate with, so it is the smaller
// checked path.
assert.equal(
  resolveCustomNodeHintKey({ apiKey: '', nodeApiUrl: 'https://node.example:24891' }),
  'node.customUrlHintRemoteHttpsNoKey',
);
assert.equal(
  resolveCustomNodeHintKey({ apiKey: '   ', nodeApiUrl: 'https://node.example:24891' }),
  'node.customUrlHintRemoteHttpsNoKey',
);

// Plaintext remote is the case the hint exists for: an API key does not save it.
assert.equal(
  resolveCustomNodeHintKey({ apiKey: 'key', nodeApiUrl: 'http://myvps:24891' }),
  'node.customUrlHintRemotePlaintext',
);
assert.equal(
  resolveCustomNodeHintKey({ apiKey: '', nodeApiUrl: 'http://203.0.113.7:24891' }),
  'node.customUrlHintRemotePlaintext',
);

// Nothing typed, or nothing usable yet, says nothing at all.
assert.equal(resolveCustomNodeHintKey({ apiKey: '', nodeApiUrl: '' }), null);
assert.equal(resolveCustomNodeHintKey({ apiKey: 'key', nodeApiUrl: '   ' }), null);
assert.equal(resolveCustomNodeHintKey({ apiKey: '', nodeApiUrl: 'myvps:24891' }), null);
assert.equal(resolveCustomNodeHintKey({ apiKey: '', nodeApiUrl: 'https://' }), null);
assert.equal(resolveCustomNodeHintKey({ apiKey: '', nodeApiUrl: 'ftp://node.example' }), null);

console.log('Custom node connection hint tests passed.');
