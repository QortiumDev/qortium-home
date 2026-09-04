import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canReplayNodeFetchAfterCaRefresh,
  isExactNodeCaResponseUrl,
  isLoopbackHostname,
  planNodeCaBootstrap,
  shouldReportNodeCaRefusal,
} from './node-ca-bootstrap.js';

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

for (const method of [undefined, '', 'GET', 'get', 'HEAD', ' head ']) {
  assert.equal(
    canReplayNodeFetchAfterCaRefresh(method),
    true,
    `${method ?? 'default'} is safe to replay once.`,
  );
}

for (const method of ['POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS']) {
  assert.equal(
    canReplayNodeFetchAfterCaRefresh(method),
    false,
    `${method} must never be replayed after an ambiguous failure.`,
  );
}

assert.equal(
  canReplayNodeFetchAfterCaRefresh('POST', 'GET'),
  true,
  'RequestInit method overrides the Request method exactly as fetch does.',
);
assert.equal(
  canReplayNodeFetchAfterCaRefresh('GET', 'POST'),
  false,
  'A RequestInit mutation override must prevent automatic replay.',
);

assert.equal(
  isExactNodeCaResponseUrl(
    'http://127.0.0.1:24891/admin/http/getca',
    'http://127.0.0.1:24891/admin/http/getca',
  ),
  true,
);
assert.equal(
  isExactNodeCaResponseUrl('http://127.0.0.1:24891/admin/http/getca', ''),
  true,
  'Electron net.fetch leaves Response.url empty when redirects are forbidden.',
);
for (const responseUrl of [
  'http://127.0.0.1:24891/admin/http/other',
  'http://192.168.1.10:24891/admin/http/getca',
  'https://example.invalid/authority.pem',
  'not a URL',
]) {
  assert.equal(
    isExactNodeCaResponseUrl('http://127.0.0.1:24891/admin/http/getca', responseUrl),
    false,
    `CA bootstrap must reject response URL ${responseUrl}.`,
  );
}

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
assert(
  nodeTlsSource.includes("plan.kind !== 'plaintext'"),
  'Automatic CA refresh after a fetch failure must remain loopback-only.',
);
assert(
  nodeTlsSource.includes('refreshNodeCaAfterFetchFailure'),
  'A stale localhost authority must be refreshable after certificate rollover.',
);
assert.equal(
  nodeTlsSource.match(/redirect: 'error'/g)?.length,
  2,
  'Both localhost CA endpoints must refuse redirects.',
);

// A refused bootstrap is permanent for that host. Home probes every public
// node on a 15-second status poll, so re-reporting it flooded the console and
// buried unrelated diagnostics; report each host once, and never lose the
// first (actionable) report.
assert.equal(shouldReportNodeCaRefusal('ext-node.qortal.link:443'), true);
assert.equal(shouldReportNodeCaRefusal('ext-node.qortal.link:443'), false);
assert.equal(shouldReportNodeCaRefusal('ext-node.qortal.link:443'), false);
assert.equal(shouldReportNodeCaRefusal('api.qortal.org:443'), true);
assert.equal(shouldReportNodeCaRefusal('api.qortal.org:443'), false);
// Host and port together identify the node, so a different port still reports.
assert.equal(shouldReportNodeCaRefusal('ext-node.qortal.link:8443'), true);

assert(
  nodeTlsSource.includes('shouldReportNodeCaRefusal(getNodeCaKey(url))'),
  'The refused branch must de-duplicate its warning the way the other branches cache.',
);

console.log('Node CA bootstrap tests passed.');
