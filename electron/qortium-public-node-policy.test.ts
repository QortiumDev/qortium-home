import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isUsableQortiumPublicNode,
  QORTIUM_PUBLIC_NODE_API_URLS,
  rankQortiumPublicNodes,
  type QortiumPublicNodeCandidate,
} from './qortium-public-node-policy.js';

assert.deepEqual(QORTIUM_PUBLIC_NODE_API_URLS, [
  'https://node1.qortium.app',
  'https://node2.qortium.app',
]);
assert.equal(new Set(QORTIUM_PUBLIC_NODE_API_URLS).size, 2);
for (const endpoint of QORTIUM_PUBLIC_NODE_API_URLS) {
  const url = new URL(endpoint);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.port, '');
  assert.equal(url.origin, endpoint);
}

function candidate(
  nodeApiUrl: string,
  overrides: Partial<QortiumPublicNodeCandidate> = {},
): QortiumPublicNodeCandidate {
  return {
    height: 85_000,
    isSynced: true,
    latencyMs: 100,
    nodeApiUrl,
    peerCount: 12,
    supportsPublicReads: true,
    ...overrides,
  };
}

assert.equal(
  isUsableQortiumPublicNode(
    candidate(QORTIUM_PUBLIC_NODE_API_URLS[0], { isSynced: false }),
  ),
  false,
);
assert.equal(
  isUsableQortiumPublicNode(
    candidate(QORTIUM_PUBLIC_NODE_API_URLS[0], {
      supportsPublicReads: false,
    }),
  ),
  false,
);

const faster = candidate(QORTIUM_PUBLIC_NODE_API_URLS[0], {
  height: 85_000,
  latencyMs: 40,
});
const slowerHigher = candidate(QORTIUM_PUBLIC_NODE_API_URLS[1], {
  height: 85_001,
  latencyMs: 120,
});
assert.equal(rankQortiumPublicNodes([slowerHigher, faster])[0], faster);

const unhealthyFast = candidate(QORTIUM_PUBLIC_NODE_API_URLS[0], {
  isSynced: false,
  latencyMs: 1,
});
assert.equal(
  rankQortiumPublicNodes([unhealthyFast, slowerHigher])[0],
  slowerHigher,
);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const sourcePath of ['electron/node-settings.ts', 'src/platform.ts']) {
  const source = readFileSync(path.join(repoRoot, sourcePath), 'utf8');
  assert.match(source, /QORTIUM_PUBLIC_NODE_API_URLS/);
  assert.match(source, /selectedPublicNodeApiUrl/);
  assert.doesNotMatch(source, /fetchKnownPeerNodeApiUrls/);
  assert.doesNotMatch(source, /http:\/\/146\.103\.42\.59:24891/);
  assert.doesNotMatch(source, /http:\/\/185\.207\.104\.78:24891/);
}

console.log('Qortium public node policy tests passed.');
