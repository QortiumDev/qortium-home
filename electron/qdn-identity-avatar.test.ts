import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getLegacyAccountAvatarHint,
  LEGACY_NAMED_THUMBNAIL_AVATAR,
} from './qdn-identity-avatar.js';

assert.deepEqual(getLegacyAccountAvatarHint('https://node.example:24891/', 'Alice Smith'), {
  avatarContract: LEGACY_NAMED_THUMBNAIL_AVATAR,
  url: 'https://node.example:24891/arbitrary/THUMBNAIL/Alice%20Smith/avatar?async=true',
});
assert.deepEqual(getLegacyAccountAvatarHint('https://node.example:24891', null), {
  avatarContract: null,
  url: null,
});
assert.deepEqual(getLegacyAccountAvatarHint('', 'Alice'), {
  avatarContract: null,
  url: null,
});

// Desktop and Android are separate bridge dispatchers. Both identity helpers
// must label the legacy URL so an app cannot mistake it for the pointer-aware
// FETCH_ACCOUNT_AVATAR contract.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const relativePath of ['electron/qdn.ts', 'src/platform.ts']) {
  const source = readFileSync(path.join(repoRoot, relativePath), 'utf8');
  assert(source.includes('getLegacyAccountAvatarHint('), `${relativePath} must use the shared hint builder.`);
  assert(
    source.includes('avatarContract: legacyAvatar.avatarContract'),
    `${relativePath} must expose the legacy contract marker.`,
  );

  // The POINTER avatar path must report the measured decoded byte length as
  // contentLength — never the HTTP Content-Length header, which goes stale
  // when a transport decompresses or re-frames the body. qortium-chat's
  // parseAccountAvatar requires contentLength to equal the decoded byte length
  // exactly, so a surviving stale header would silently drop every pointer
  // avatar. The header may only feed the pre-download oversize preflight.
  const avatarStart = source.indexOf('async function fetchGroupAvatarForApp');
  const avatarEnd = source.indexOf('async function setAccountAvatarForApp');
  assert(
    avatarStart >= 0 && avatarEnd > avatarStart,
    `${relativePath} avatar function markers moved; update this test.`,
  );
  const avatarSource = source.slice(avatarStart, avatarEnd);
  const measuredContentLength = {
    'electron/qdn.ts': 'contentLength: arrayBuffer.byteLength',
    'src/platform.ts': 'contentLength: bytes.byteLength',
  }[relativePath] as string;
  assert(
    avatarSource.includes(measuredContentLength),
    `${relativePath} must return the measured byte length as contentLength on the pointer avatar path.`,
  );
  assert(
    !avatarSource.includes('contentLength: contentLength ??') &&
      !avatarSource.includes('?? bytes.byteLength'),
    `${relativePath} must not fall back to the HTTP Content-Length header for the avatar contentLength.`,
  );
}

console.log('QDN identity avatar compatibility tests passed.');
