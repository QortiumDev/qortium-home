import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

function readRepoSource(...candidates: string[]) {
  const url = candidates
    .map((candidate) => new URL(candidate, import.meta.url))
    .find((each) => existsSync(each));
  assert.ok(url, `source not found: tried ${candidates.join(', ')}`);
  return readFileSync(url, 'utf8');
}

const platform = readRepoSource('../src/platform.ts', './platform.ts');

function sourceBetween(start: string, end: string) {
  const startIndex = platform.indexOf(start);
  const endIndex = platform.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return platform.slice(startIndex, endIndex);
}

const bytePost = sourceBetween(
  'async function postLocalNodeBytes(',
  '// Maps a file extension to the QDN service used to preview it',
);
assert.match(
  bytePost,
  /body: File,/,
  'Android streamed QDN uploads must require the File body that Capacitor transports losslessly.',
);

const uploadSource = sourceBetween(
  'function getQdnPublishUploadSource(',
  'function assertLegacyQdnPublishFallbackSize(',
);
assert.match(
  uploadSource,
  /body: new File\(\s*\[bytes as BlobPart\],\s*source\.fileName,\s*\{ type: 'application\/octet-stream' \},\s*\)/,
  'Android QDN upload sources must use Capacitor\'s exact-byte File conversion path.',
);
assert.doesNotMatch(
  uploadSource,
  /body: new Blob\(/,
  'A plain Blob falls through Capacitor\'s native JSON conversion and corrupts the upload body.',
);

console.log('Android QDN upload body contract tests passed.');
