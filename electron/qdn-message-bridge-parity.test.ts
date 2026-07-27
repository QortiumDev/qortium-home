import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { QDN_APP_BRIDGE_ACTIONS, QDN_PUBLIC_NODE_BRIDGE_ACTIONS } from './qdn-app-actions.js';

function readRepoSource(...candidates: string[]) {
  const url = candidates.map((candidate) => new URL(candidate, import.meta.url)).find((each) => existsSync(each));
  assert.ok(url, `source not found: tried ${candidates.join(', ')}`);
  return readFileSync(url, 'utf8');
}

function readFunction(source: string, name: string) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist.`);
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `${name} must have a closing brace.`);
  return source.slice(start, end);
}

const desktop = readRepoSource('../electron/qdn.ts', './qdn.ts');
const android = readRepoSource('../src/platform.ts', './platform.ts');
const appTypes = readRepoSource('../src/vite-env.d.ts', './vite-env.d.ts');
const appUi = readRepoSource('../src/App.tsx', './App.tsx');

assert(QDN_APP_BRIDGE_ACTIONS.includes('SEND_MESSAGE'));
assert(QDN_PUBLIC_NODE_BRIDGE_ACTIONS.includes('SEND_MESSAGE'));
assert(appTypes.includes("| 'SEND_MESSAGE'"), 'Window approval type must include SEND_MESSAGE.');
assert(appUi.includes("case 'SEND_MESSAGE':"), 'Home approval dialog must label SEND_MESSAGE specifically.');

for (const [name, source, importSpecifier] of [
  ['electron/qdn.ts', desktop, "from './qdn-at-message.js'"],
  ['src/platform.ts', android, "from '../electron/qdn-at-message'"],
] as const) {
  assert(source.includes(importSpecifier), `${name} must use the shared fixed-field MESSAGE serializer.`);
  assert(source.includes("case 'SEND_MESSAGE':"), `${name} must dispatch SEND_MESSAGE.`);

  const body = readFunction(source, 'sendMessageForApp');
  for (const required of [
    "action: 'SEND_MESSAGE'",
    'getQortiumAtMessageRequest(request)',
    'buildUnsignedQortiumAtMessageTransactionBytes',
    'QORTIUM_AT_MESSAGE_POW_DIFFICULTY',
    'signAndProcessKeylessStandardTransaction',
    "permissionScope: 'single-request'",
  ]) {
    assert(body.includes(required), `${name} SEND_MESSAGE must include ${required}.`);
  }

  assert(!body.includes('/transactions/mempow'), `${name} must not use the unsupported generic mempow endpoint for MESSAGE.`);
  assert(!body.includes('/transactions/sign'), `${name} must never send a private key to sign MESSAGE.`);
  assert(body.includes("// /transactions/process is public; do not disclose a custom-node API key"), `${name} must not disclose an API key for MESSAGE broadcast.`);
}

assert(
  readFunction(desktop, 'sendMessageForApp').includes('assertFreshQdnWriteContext(sender, context)'),
  'Desktop must reject a stale view before MESSAGE proof-of-work.',
);
assert(
  readFunction(android, 'sendMessageForApp').includes('context.isCurrent && !context.isCurrent()'),
  'Android must reject a stale view before MESSAGE proof-of-work.',
);

console.log('QDN MESSAGE bridge parity tests passed.');
