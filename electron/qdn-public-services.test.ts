// Guards the QDN service gate both bridges now share.
//
// "Is this service allowed?" is the check that stands between a QDN app and an
// encrypted resource Home cannot decrypt. It used to be answered twice: the
// desktop bridge (electron/qdn.ts) asked a Set and used its own `isPrivateService`,
// the renderer/Android bridge (src/platform.ts) asked the array and used
// `isPrivateQdnService` from src/qdn.ts. The two predicates happened to be the
// same regex, but nothing made them stay that way.
//
// So this covers the behaviour of the one gate, and then checks the source of
// both bridges to make sure neither has grown a private copy again.
//
// It also owns the offline half of the old QDN drift check: whether the list is
// well-formed, free of duplicates, and consistent with Home's own private-service
// rule. That half used to sit in scripts/smoke-qdn-services.mjs, which needs a
// live node and so never ran — it was broken for months before anyone looked.
// Anything that genuinely needs a node stayed in the smoke script.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  PUBLIC_QDN_SERVICES,
  isPrivateQdnService,
  isPublicQdnService,
} from './qdn-public-services.js';
import { getQdnWriteResourceRequest, getService } from './qdn-request-values.js';

const PRIVATE_REJECTION = 'Private (encrypted) QDN resources cannot be opened in Home yet.';
const PUBLIC_REJECTION = 'Only public QDN services can be browsed right now.';

// 1. The public whitelist.
assert.ok(PUBLIC_QDN_SERVICES.length > 0, 'the public service list is empty.');

for (const service of PUBLIC_QDN_SERVICES) {
  assert.equal(isPublicQdnService(service), true, `${service} should be public.`);
  assert.equal(getService(service), service, `getService should pass ${service} through.`);
}

for (const notPublic of ['', 'app', 'APP_PRIVATE', 'AUTO_UPDATE', 'NOPE', 'APP ', ' APP']) {
  assert.equal(isPublicQdnService(notPublic), false, `${notPublic} should not be public.`);
}

// Every entry must be a Core service name as Core spells them: upper-case, no
// stray whitespace. A typo here is a service Home silently cannot open.
for (const service of PUBLIC_QDN_SERVICES) {
  assert.match(service, /^[A-Z][A-Z0-9_]*$/, `${JSON.stringify(service)} is not a Core service name.`);
}

// A duplicate is harmless to the Set but shows up twice in every menu built
// from the array (the explorer list, the address-bar suggestions).
const duplicates = PUBLIC_QDN_SERVICES.filter(
  (service, index) => PUBLIC_QDN_SERVICES.indexOf(service) !== index,
);

assert.deepEqual([...new Set(duplicates)], [], 'the public service list has duplicate entries.');

// The whitelist is the public list, so no entry may be one the private rule
// claims — the two would contradict each other on the same name.
for (const service of PUBLIC_QDN_SERVICES) {
  assert.equal(
    isPrivateQdnService(service),
    false,
    `${service} is on the public list but the private rule claims it.`,
  );
}

// 2. The private predicate. Core marks encrypted services with a `_PRIVATE` suffix.
for (const service of PUBLIC_QDN_SERVICES) {
  assert.equal(
    isPrivateQdnService(`${service}_PRIVATE`),
    true,
    `${service}_PRIVATE should be recognized as private.`,
  );
}

for (const notPrivate of [
  '',
  'APP',
  'PRIVATE',
  '_PRIVATE',
  'APP_PRIVATE_',
  'APP_PRIVATE_APP',
  'app_private',
  'APP-PRIVATE',
  'APP_PRIVATE\n',
]) {
  assert.equal(
    isPrivateQdnService(notPrivate),
    false,
    `${JSON.stringify(notPrivate)} should not be recognized as private.`,
  );
}

// 3. The gate itself: absent stays absent, casing and padding are normalized.
for (const absent of [undefined, null, '', '   ', 42, {}, []]) {
  assert.equal(getService(absent), '', `${JSON.stringify(absent)} should read as no service.`);
}

assert.equal(getService('app'), 'APP', 'getService should upper-case the service.');
assert.equal(getService('  Image  '), 'IMAGE', 'getService should trim and upper-case.');

// 4. The rejection paths, and that each gets its own message.
for (const privateService of ['APP_PRIVATE', 'image_private', 'IMAGE_GALLERY_PRIVATE']) {
  assert.throws(
    () => getService(privateService),
    (error: Error) => error.message === PRIVATE_REJECTION,
    `${privateService} should be rejected as private.`,
  );
}

for (const unknownService of ['NOPE', 'AUTO_UPDATE', 'PRIVATE', 'APP_PRIVATE_APP']) {
  assert.throws(
    () => getService(unknownService),
    (error: Error) => error.message === PUBLIC_REJECTION,
    `${unknownService} should be rejected as not public.`,
  );
}

// 5. The write path goes through the same gate, so a private service cannot be
// published to either.
assert.deepEqual(
  getQdnWriteResourceRequest({ name: 'alice', service: 'app' }),
  {
    category: undefined,
    description: undefined,
    fee: undefined,
    identifier: undefined,
    name: 'alice',
    service: 'APP',
    tags: [],
    title: undefined,
  },
  'a public write request should be accepted.',
);

assert.throws(
  () => getQdnWriteResourceRequest({ name: 'alice', service: 'APP_PRIVATE' }),
  (error: Error) => error.message === PRIVATE_REJECTION,
  'a private service should be rejected on the write path too.',
);

assert.throws(
  () => getQdnWriteResourceRequest({ name: 'alice', service: 'NOPE' }),
  (error: Error) => error.message === PUBLIC_REJECTION,
  'an unknown service should be rejected on the write path too.',
);

assert.throws(
  () => getQdnWriteResourceRequest({ name: 'alice' }),
  /QDN resource service is required\./,
  'a missing service should still be reported as missing, not as not-public.',
);

// 6. Neither bridge may answer the question itself again.
// Compiled tests run from dist-electron/, the sources live in electron/ and src/.
function readRepoSource(...candidates: string[]) {
  const url = candidates.map((candidate) => new URL(candidate, import.meta.url)).find((each) => existsSync(each));
  assert.ok(url, `source not found: tried ${candidates.join(', ')}`);
  return readFileSync(url, 'utf8');
}

const bridges = [
  {
    importSpecifier: "from './qdn-request-values.js'",
    name: 'electron/qdn.ts',
    source: readRepoSource('../electron/qdn.ts', './qdn.ts'),
  },
  {
    importSpecifier: "from '../electron/qdn-request-values'",
    name: 'src/platform.ts',
    source: readRepoSource('../src/platform.ts', './platform.ts'),
  },
] as const;

for (const { importSpecifier, name, source } of bridges) {
  assert.ok(
    source.includes(importSpecifier),
    `${name} must import the shared request values (${importSpecifier}).`,
  );
  assert.ok(
    !/\bfunction getService\s*\(/.test(source),
    `${name} declares its own getService again; import the shared one instead.`,
  );
  assert.ok(
    !/_PRIVATE\$\//.test(source),
    `${name} carries its own private-service regex again; use isPrivateQdnService instead.`,
  );
  assert.ok(
    !/\bfunction getQdnWriteResourceRequest\s*\(/.test(source),
    `${name} declares its own getQdnWriteResourceRequest again; import the shared one instead.`,
  );
}

assert.ok(
  !/_PRIVATE\$\//.test(readRepoSource('../src/qdn.ts')),
  'src/qdn.ts carries its own private-service regex again; use isPrivateQdnService instead.',
);

console.log(
  `QDN service gate checks passed (${PUBLIC_QDN_SERVICES.length} public services, 2 bridges checked for re-drift).`,
);
