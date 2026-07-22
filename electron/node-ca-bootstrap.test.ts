import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLoopbackHostname, planNodeCaBootstrap } from './node-ca-bootstrap.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function plan(nodeApiUrl: string) {
  return planNodeCaBootstrap(new URL(nodeApiUrl));
}

for (const hostname of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]', ' localhost ']) {
  assert.equal(isLoopbackHostname(hostname), true, `${hostname} is this machine.`);
}

// Names and addresses that merely look local are not: each of these reaches the
// network, where the plaintext exchange can be answered by anyone.
for (const hostname of [
  '192.168.1.10',
  '10.0.0.4',
  '172.16.9.9',
  'node.example.invalid',
  'localhost.example.invalid',
  'evil-127.0.0.1.example.invalid',
  '127001',
  '1270.0.1',
  'fe80::1',
]) {
  assert.equal(isLoopbackHostname(hostname), false, `${hostname} is not this machine.`);
}

// A plain http node is never verified against a pinned authority, so there is
// nothing to bootstrap.
assert.deepEqual(plan('http://127.0.0.1:24891'), { kind: 'not-required' });
assert.deepEqual(plan('http://node.example.invalid:24891'), { kind: 'not-required' });

// Over loopback the exchange cannot be intercepted, so it keeps working.
assert.deepEqual(plan('https://127.0.0.1:24891/'), {
  createCaUrl: 'http://127.0.0.1:24891/admin/http/createca',
  getCaUrl: 'http://127.0.0.1:24891/admin/http/getca',
  kind: 'plaintext',
});
assert.deepEqual(plan('https://localhost:24891/api?key=secret#fragment'), {
  createCaUrl: 'http://localhost:24891/admin/http/createca',
  getCaUrl: 'http://localhost:24891/admin/http/getca',
  kind: 'plaintext',
});
assert.equal(plan('https://[::1]:24891').kind, 'plaintext');

// A remote node must never be asked for its authority over plaintext: whoever
// answered would be pinned as trusted from then on, and /admin/http/createca
// would hand them the API key.
for (const nodeApiUrl of [
  'https://node.example.invalid',
  'https://node.example.invalid:24891',
  'https://192.168.1.10:24891',
  'https://203.0.113.7:24891',
]) {
  const refusal = plan(nodeApiUrl);

  assert.equal(refusal.kind, 'refused', `${nodeApiUrl} must not be bootstrapped over plaintext.`);
  assert(
    refusal.kind === 'refused' && refusal.reason.includes(new URL(nodeApiUrl).host),
    'A refusal must name the node it applies to.',
  );
}

// Nothing in the module may produce an http URL for a host it refused, so the
// only plaintext URLs that exist are the loopback ones above.
const bootstrapSource = readFileSync(path.join(repoRoot, 'electron/node-ca-bootstrap.ts'), 'utf8');
const httpDowngrades = bootstrapSource.match(/protocol = 'http:'/g) ?? [];

assert.equal(httpDowngrades.length, 1, 'Only the loopback CA URL builder may downgrade to http.');

// Pinning eligibility must be earned by storing an authority, not by having
// been configured: adding the host up front is what let a remote node's
// attacker-supplied certificate become trusted.
const nodeTlsSource = readFileSync(path.join(repoRoot, 'electron/node-tls.ts'), 'utf8');
const ensureNodeCaBody = /export async function ensureNodeCa\([\s\S]*?\n\}/.exec(nodeTlsSource)?.[0];

assert(ensureNodeCaBody, 'ensureNodeCa was not found in node-tls.ts.');
assert(
  !ensureNodeCaBody.includes('configuredNodeHosts.add'),
  'ensureNodeCa must not register a host for pinning before an authority is stored.',
);
assert(
  ensureNodeCaBody.includes('planNodeCaBootstrap'),
  'ensureNodeCa must decide through planNodeCaBootstrap.',
);

console.log('Node CA bootstrap tests passed.');
