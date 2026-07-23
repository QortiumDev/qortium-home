import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

// Home decides QDN write routing twice: electron/qdn.ts drives the desktop
// transport, src/platform.ts the Android/Capacitor one. They drifted once
// already - the desktop keyless freshness gate learned about routes while
// Android kept `settings.mode !== 'network'`, which no 'custom' connection can
// ever satisfy, so every Android write to a configured remote node died after
// proof-of-work with QDN_POW_CANCELLED. Both now ask electron/qdn-write-route.ts
// the same question, and this guards that they keep doing so: the shared module
// has its own behavioural tests, but nothing else notices when a transport
// stops calling it.
// Compiled tests run from dist-electron/, the sources live in electron/ and src/.
function readRepoSource(...candidates: string[]) {
  const url = candidates.map((candidate) => new URL(candidate, import.meta.url)).find((each) => existsSync(each));
  assert.ok(url, `source not found: tried ${candidates.join(', ')}`);
  return readFileSync(url, 'utf8');
}

const qdnSource = readRepoSource('../electron/qdn.ts', './qdn.ts');
const platformSource = readRepoSource('../src/platform.ts', './platform.ts');

// The gate body, from its declaration to the first closing brace in column 1,
// with comment lines dropped: the comments explain the bug being guarded
// against and would otherwise match the patterns this scans for.
function readKeylessFreshnessGate(name: string, source: string) {
  const start = source.indexOf('async function isKeylessWriteContextFresh(');
  assert.notEqual(start, -1, `${name} no longer declares isKeylessWriteContextFresh.`);
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, `${name} isKeylessWriteContextFresh has no closing brace.`);
  return source
    .slice(start, end)
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const transports = [
  {
    // src/ is bundled by Vite and imports the electron module without an
    // extension, electron/ is NodeNext and imports it with one.
    importSpecifier: "from './qdn-write-route.js'",
    name: 'electron/qdn.ts',
    source: qdnSource,
  },
  {
    importSpecifier: "from '../electron/qdn-write-route'",
    name: 'src/platform.ts',
    source: platformSource,
  },
] as const;

for (const { importSpecifier, name, source } of transports) {
  assert.ok(
    source.includes(importSpecifier),
    `${name} must import the shared write-route logic (${importSpecifier}).`,
  );

  // Neither transport may grow its own copy: two implementations of "which
  // route is this" is exactly the drift that caused the Android bug.
  for (const shared of ['resolveQdnWriteRoute', 'isSameQdnWriteRoute']) {
    assert.ok(
      !new RegExp(`function ${shared}\\b`).test(source),
      `${name} must use the shared ${shared}, not re-declare it.`,
    );
  }

  const gate = readKeylessFreshnessGate(name, source);

  assert.ok(
    gate.includes('isSameQdnWriteRoute('),
    `${name} keyless freshness gate must compare write routes through isSameQdnWriteRoute.`,
  );

  // The mode check is the bug, not a belt-and-braces extra: it is false for
  // every 'custom' connection, so re-adding it re-breaks remote-node writes.
  assert.ok(
    !/mode\s*[!=]==\s*'network'/.test(gate),
    `${name} keyless freshness gate must not gate on node mode; the route comparison covers it.`,
  );
}

// Android holds mode, API key and URL as three separate values, so its call has
// to carry all three into the comparison. Dropping mode would silently stop
// network and custom connections from being told apart, and dropping apiKey
// would stop a key removed mid-publish from being noticed.
const platformGate = readKeylessFreshnessGate('src/platform.ts', platformSource);
for (const field of ['apiKey:', 'mode:', 'nodeApiUrl:']) {
  assert.equal(
    platformGate.split(field).length - 1,
    2,
    `src/platform.ts keyless freshness gate must pass ${field} for both the current and the built-against connection.`,
  );
}

console.log('QDN write route parity tests passed.');
