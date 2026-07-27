import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  QDN_BROWSER_ARCHIVE_SERVICES,
  isQdnBrowserArchiveService,
} from './qdn-browser-archive-services.js';

assert.deepEqual(QDN_BROWSER_ARCHIVE_SERVICES, ['APP', 'WEBSITE', 'GAME']);

for (const service of QDN_BROWSER_ARCHIVE_SERVICES) {
  assert.equal(isQdnBrowserArchiveService(service), true, `${service} should have the browser archive path.`);
}

for (const service of ['GAME_PRIVATE', 'PLUGIN', 'VIDEO', 'game', ' GAME ']) {
  assert.equal(isQdnBrowserArchiveService(service), false, `${JSON.stringify(service)} must stay outside the path.`);
}

// GAME must use this one desktop allowlist everywhere it crosses from a QDN
// URL into browser content. Android has a Java bridge, so assert its matching
// literal separately rather than leaving a silent platform gap.
function readRepoSource(...candidates: string[]) {
  const url = candidates.map((candidate) => new URL(candidate, import.meta.url)).find((each) => existsSync(each));
  assert.ok(url, `source not found: tried ${candidates.join(', ')}`);
  return readFileSync(url, 'utf8');
}

for (const [name, source] of [
  ['src/qdn.ts', readRepoSource('../src/qdn.ts', './qdn.ts')],
  ['src/QdnViewer.tsx', readRepoSource('../src/QdnViewer.tsx', './QdnViewer.tsx')],
  ['electron/qdn.ts', readRepoSource('../electron/qdn.ts', './qdn.ts')],
  ['electron/qdn-views.ts', readRepoSource('../electron/qdn-views.ts', './qdn-views.ts')],
  ['electron/qdn-publish-routing.ts', readRepoSource('../electron/qdn-publish-routing.ts', './qdn-publish-routing.ts')],
] as const) {
  assert.match(source, /qdn-browser-archive-services/, `${name} must use the shared browser archive allowlist.`);
}

const androidBridge = readRepoSource(
  '../android/app/src/main/java/org/qortium/home/QdnBridgeWebViewClient.java',
  '../../android/app/src/main/java/org/qortium/home/QdnBridgeWebViewClient.java',
);
assert.match(androidBridge, /"GAME"\.equals\(service\)/, 'Android must recognize GAME render URLs for the browser bridge.');

console.log('QDN browser archive service tests passed.');
