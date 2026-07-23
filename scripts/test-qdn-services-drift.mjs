// Drives the QDN drift comparison against fabricated Core catalogues.
//
// scripts/smoke-qdn-services.mjs needs a live Previewnet node, so its logic used
// to be unrunnable in CI and unprovable in review — it spent months broken
// without anyone noticing. The comparison is now a pure function, so the part
// that matters (does it actually fail when Core and Home disagree?) can be
// checked here with no node at all.
import assert from 'node:assert/strict';

import { PUBLIC_QDN_SERVICES, isPrivateQdnService } from '../dist-electron/qdn-public-services.js';
import { findCatalogueDrift, parseServiceCatalogue } from './qdn-services-drift.mjs';

const homeServices = [...PUBLIC_QDN_SERVICES];

// A catalogue that looks like a healthy Core: every Home service public, an
// encrypted twin for each, and a couple of system services Home never surfaces.
function goodCatalogue() {
  return [
    ...homeServices.map((id) => ({ id, private: false })),
    ...homeServices.map((id) => ({ id: `${id}_PRIVATE`, private: true })),
    { id: 'AUTO_UPDATE', private: false },
    { id: 'QCHAT_ATTACHMENT', private: false },
  ];
}

function driftOf(catalogue, isPrivateService = isPrivateQdnService) {
  return findCatalogueDrift({ homeServices, catalogue, isPrivateService });
}

function messages(result) {
  return result.failures.join('\n');
}

// 1. The healthy case passes, and an intentional omission stays a note.
const healthy = driftOf(goodCatalogue());

assert.deepEqual(healthy.failures, [], `a healthy catalogue should not fail:\n${messages(healthy)}`);
assert.equal(healthy.coreCount, homeServices.length * 2 + 2);
assert.equal(healthy.corePublicCount, homeServices.length + 2);
assert.deepEqual(
  healthy.notSurfaced,
  ['AUTO_UPDATE', 'QCHAT_ATTACHMENT'],
  'public Core services Home does not surface should be reported, not failed.',
);
assert.equal(healthy.notes.length, 1, 'the omissions should be reported as a note.');

// 2. (a) Core dropped or renamed a service Home still lists.
const dropped = driftOf(goodCatalogue().filter((service) => service.id !== 'BLOG_POST'));

assert.ok(dropped.failures.length > 0, 'a service Core dropped must fail.');
assert.match(messages(dropped), /Core no longer reports: BLOG_POST\b/);
assert.doesNotMatch(messages(dropped), /BLOG_COMMENT/, 'only the dropped service should be named.');

// A rename is the same failure from Home's side, and the new name shows up as
// an unsurfaced public service rather than as a second failure.
const renamed = driftOf(
  goodCatalogue().map((service) => (service.id === 'PODCAST' ? { ...service, id: 'PODCAST_FEED' } : service)),
);

assert.match(messages(renamed), /Core no longer reports: PODCAST\b/);
assert.ok(renamed.notSurfaced.includes('PODCAST_FEED'), 'the new name should be reported as unsurfaced.');

// 3. (b) Core reclassified a service Home lists as private.
const reclassified = driftOf(
  goodCatalogue().map((service) => (service.id === 'IMAGE' ? { ...service, private: true } : service)),
);

assert.ok(reclassified.failures.length > 0, 'a service Core made private must fail.');
assert.match(messages(reclassified), /Core reports as private: IMAGE\b/);

// 4. (c) Core's flag and Home's `_PRIVATE`-suffix rule disagree.
// The dangerous direction: Core says private, Home would have browsed it.
const privateWithoutSuffix = driftOf([...goodCatalogue(), { id: 'SEALED_NOTE', private: true }]);

assert.ok(privateWithoutSuffix.failures.length > 0, 'a private service without the suffix must fail.');
assert.match(privateWithoutSuffix.failures.join('\n'), /reads as public: SEALED_NOTE\b/);
assert.ok(
  !privateWithoutSuffix.notSurfaced.includes('SEALED_NOTE'),
  'a private service is not an omission Home could have surfaced.',
);

// The other direction: Core says public, Home would have refused to open it.
const publicWithSuffix = driftOf([...goodCatalogue(), { id: 'LEGACY_PRIVATE', private: false }]);

assert.ok(publicWithSuffix.failures.length > 0, 'a public service Home reads as private must fail.');
assert.match(publicWithSuffix.failures.join('\n'), /reads service\(s\) as private that Core reports as public: LEGACY_PRIVATE\b/);

// The check is about the predicate, not about this one regex: a predicate that
// gives up entirely must be caught across the whole catalogue.
const blindPredicate = driftOf(goodCatalogue(), () => false);

assert.ok(blindPredicate.failures.length > 0, 'a predicate that never says private must fail.');
assert.match(blindPredicate.failures.join('\n'), /reads as public: APP_PRIVATE\b/);

// 5. Several disagreements at once are all named, not just the first.
const multiple = driftOf([
  ...goodCatalogue().filter((service) => service.id !== 'STORE' && service.id !== 'COUPON'),
  { id: 'SEALED_NOTE', private: true },
]);

assert.match(messages(multiple), /Core no longer reports: STORE, COUPON\b/);
assert.match(messages(multiple), /reads as public: SEALED_NOTE\b/);

// 6. A catalogue shape Core is not supposed to send stops the run instead of
// quietly comparing nothing.
assert.throws(() => parseServiceCatalogue([]), /non-empty array/);
assert.throws(() => parseServiceCatalogue(undefined), /non-empty array/);
assert.throws(() => parseServiceCatalogue({ id: 'APP', private: false }), /non-empty array/);
assert.throws(() => parseServiceCatalogue([{ id: 'APP' }]), /no boolean "private" flag/);
assert.throws(() => parseServiceCatalogue([{ id: 'APP', private: 'false' }]), /no boolean "private" flag/);
assert.throws(() => parseServiceCatalogue([{ private: false }]), /no string "id"/);
assert.throws(() => parseServiceCatalogue(['APP']), /is not an object/);
assert.deepEqual(parseServiceCatalogue([{ id: 'APP', private: false, extra: 1 }]), [
  { id: 'APP', private: false },
]);

console.log(
  `QDN service drift comparison checks passed ` +
    `(${homeServices.length} Home services against ${goodCatalogue().length} fabricated Core services).`,
);
