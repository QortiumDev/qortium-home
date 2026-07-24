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
}

console.log('QDN identity avatar compatibility tests passed.');
