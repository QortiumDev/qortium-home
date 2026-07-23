import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatCertificateFingerprint,
  getFingerprintCheckCommand,
  getNodeCertificateHost,
  normalizeFingerprint,
  parseNodeCertificatePins,
  planNodeCertificateConfirmation,
  resolveNodeCertificateTrust,
  verifyPresentedNodeCertificate,
  type NodeCertificatePin,
} from './node-cert-trust.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// SHA-256 of the five bytes "test", so the formatting is checked against a
// digest that is known independently of this code.
const TEST_FINGERPRINT =
  '9F:86:D0:81:88:4C:7D:65:9A:2F:EA:A0:C5:5A:D0:15:A3:BF:4F:1B:2B:0B:82:2C:D1:5D:6C:15:B0:F0:0A:08';
const OTHER_FINGERPRINT =
  '11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00';

function pin(host: string, fingerprint: string): NodeCertificatePin {
  return { confirmedAt: 1_700_000_000_000, fingerprint, host };
}

// --- Fingerprints are the whole evidence, so they must be exact -------------

assert.equal(formatCertificateFingerprint(Buffer.from('test', 'utf8')), TEST_FINGERPRINT);
assert.equal(formatCertificateFingerprint(new Uint8Array([0])).length, 95);

// Users paste whatever their tool printed.
for (const value of [
  TEST_FINGERPRINT,
  TEST_FINGERPRINT.toLowerCase(),
  TEST_FINGERPRINT.replaceAll(':', ''),
  TEST_FINGERPRINT.replaceAll(':', ' '),
  `SHA256 Fingerprint=${TEST_FINGERPRINT}`,
  `  sha256 fingerprint=${TEST_FINGERPRINT.toLowerCase()}  `,
]) {
  assert.equal(normalizeFingerprint(value), TEST_FINGERPRINT, `${value} is the same fingerprint.`);
}

// Anything that is not exactly 32 bytes of hex is not a fingerprint. Guessing
// at a near miss is how a wrong certificate gets confirmed.
for (const value of [
  '',
  'not a fingerprint',
  TEST_FINGERPRINT.slice(0, -1),
  `${TEST_FINGERPRINT}:00`,
  TEST_FINGERPRINT.replace('9F', 'ZZ'),
  null,
  undefined,
  42,
  {},
]) {
  assert.equal(normalizeFingerprint(value), null, `${String(value)} is not a fingerprint.`);
}

// --- What Home may do before contacting a node ------------------------------

assert.equal(getNodeCertificateHost(new URL('https://node.example.invalid')), 'node.example.invalid:443');
assert.equal(getNodeCertificateHost(new URL('https://NODE.example.invalid:24891/x')), 'node.example.invalid:24891');

// http has no certificate to confirm, so nothing changes for it.
assert.deepEqual(resolveNodeCertificateTrust(new URL('http://node.example.invalid:24891'), []), {
  kind: 'not-applicable',
});

// Loopback is untouched: a node on this machine has no network path to
// intercept, and its authority bootstrap keeps working with no confirmation.
for (const nodeApiUrl of ['https://127.0.0.1:24891', 'https://localhost:24891', 'https://[::1]:24891']) {
  assert.deepEqual(
    resolveNodeCertificateTrust(new URL(nodeApiUrl), []),
    { kind: 'loopback' },
    `${nodeApiUrl} is this machine.`,
  );
  assert.deepEqual(
    resolveNodeCertificateTrust(new URL(nodeApiUrl), [pin('127.0.0.1:24891', TEST_FINGERPRINT)]),
    { kind: 'loopback' },
    `${nodeApiUrl} stays on the loopback path whatever has been confirmed.`,
  );
}

// A remote https node nobody confirmed: fail closed, and say why.
const unconfirmed = resolveNodeCertificateTrust(new URL('https://node.example.invalid:24891'), [
  pin('other.example.invalid:24891', TEST_FINGERPRINT),
]);

assert.equal(unconfirmed.kind, 'unconfirmed');
assert(
  unconfirmed.kind === 'unconfirmed' && unconfirmed.reason.includes('node.example.invalid:24891'),
  'A refusal must name the node it applies to.',
);
assert(
  unconfirmed.kind === 'unconfirmed' && /API key/i.test(unconfirmed.reason),
  'The refusal must say the API key is withheld too.',
);

// Confirmation is per host and port: the same machine on another port is a
// different node and is confirmed separately.
assert.deepEqual(
  resolveNodeCertificateTrust(new URL('https://node.example.invalid:24891'), [
    pin('node.example.invalid:24891', TEST_FINGERPRINT),
  ]),
  { fingerprint: TEST_FINGERPRINT, host: 'node.example.invalid:24891', kind: 'confirmed' },
);
assert.equal(
  resolveNodeCertificateTrust(new URL('https://node.example.invalid:31000'), [
    pin('node.example.invalid:24891', TEST_FINGERPRINT),
  ]).kind,
  'unconfirmed',
);

// --- The verdict on a certificate that was actually presented ---------------

const pins = [pin('node.example.invalid:24891', TEST_FINGERPRINT)];

// Nothing confirmed for this host: refused, exactly as before this flow existed.
assert.deepEqual(verifyPresentedNodeCertificate('fresh.example.invalid', TEST_FINGERPRINT, []), {
  kind: 'unconfirmed',
});
assert.deepEqual(verifyPresentedNodeCertificate('fresh.example.invalid', TEST_FINGERPRINT, pins), {
  kind: 'unconfirmed',
});

// The confirmed certificate, however the fingerprint happens to be spelled.
assert.deepEqual(verifyPresentedNodeCertificate('node.example.invalid', TEST_FINGERPRINT, pins), {
  kind: 'trusted',
});
assert.deepEqual(
  verifyPresentedNodeCertificate('NODE.example.invalid', TEST_FINGERPRINT.toLowerCase(), pins),
  { kind: 'trusted' },
);

// A different certificate on a confirmed host is refused and reported as a
// change, not as a first visit: silently continuing is the failure this whole
// flow exists to prevent.
for (const presented of [
  OTHER_FINGERPRINT,
  TEST_FINGERPRINT.replace('9F', '9E'),
  '',
  'garbage',
]) {
  assert.deepEqual(
    verifyPresentedNodeCertificate('node.example.invalid', presented, pins),
    { confirmed: [TEST_FINGERPRINT], kind: 'mismatch' },
    `${presented || '(empty)'} is not the confirmed certificate.`,
  );
}

// --- Turning "these match" into a pin ---------------------------------------

const remoteTrust = resolveNodeCertificateTrust(new URL('https://node.example.invalid:24891'), []);

// The user confirmed the fingerprint the node is serving: pin exactly that.
assert.deepEqual(
  planNodeCertificateConfirmation({
    presentedFingerprint: TEST_FINGERPRINT,
    requestedFingerprint: TEST_FINGERPRINT.toLowerCase().replaceAll(':', ''),
    trust: remoteTrust,
  }),
  { fingerprint: TEST_FINGERPRINT, kind: 'pin' },
);

// The certificate changed between being shown and being confirmed: nothing is
// pinned, because nobody has looked at what is there now.
const changed = planNodeCertificateConfirmation({
  presentedFingerprint: OTHER_FINGERPRINT,
  requestedFingerprint: TEST_FINGERPRINT,
  trust: remoteTrust,
});

assert.equal(changed.kind, 'refused');
assert(
  changed.kind === 'refused' && changed.reason.includes(OTHER_FINGERPRINT),
  'A refused confirmation must show what the node is presenting instead.',
);

// Nothing could be read from the node, so there is nothing to agree with.
assert.equal(
  planNodeCertificateConfirmation({
    presentedFingerprint: '',
    requestedFingerprint: TEST_FINGERPRINT,
    trust: remoteTrust,
  }).kind,
  'refused',
);

// Junk in the confirmation itself is refused rather than stored.
for (const requestedFingerprint of ['', 'yes', TEST_FINGERPRINT.slice(0, -2), null, true]) {
  assert.equal(
    planNodeCertificateConfirmation({
      presentedFingerprint: TEST_FINGERPRINT,
      requestedFingerprint,
      trust: remoteTrust,
    }).kind,
    'refused',
    `${String(requestedFingerprint)} is not a confirmation.`,
  );
}

// A node that never needed confirming cannot acquire a pin either: loopback
// keeps working the way it always did, through its own authority.
for (const trust of [
  resolveNodeCertificateTrust(new URL('https://127.0.0.1:24891'), []),
  resolveNodeCertificateTrust(new URL('http://node.example.invalid:24891'), []),
]) {
  assert.equal(
    planNodeCertificateConfirmation({
      presentedFingerprint: TEST_FINGERPRINT,
      requestedFingerprint: TEST_FINGERPRINT,
      trust,
    }).kind,
    'refused',
    `${trust.kind} needs no confirmation.`,
  );
}

// --- Stored confirmations ---------------------------------------------------

assert.deepEqual(
  parseNodeCertificatePins({
    pins: [
      { confirmedAt: 5, fingerprint: TEST_FINGERPRINT.toLowerCase(), host: 'Node.Example.Invalid:24891' },
      { confirmedAt: 5, fingerprint: TEST_FINGERPRINT, host: 'node.example.invalid:24891' },
      { confirmedAt: 6, fingerprint: 'nonsense', host: 'node.example.invalid:24891' },
      { confirmedAt: 6, fingerprint: TEST_FINGERPRINT, host: '' },
      { confirmedAt: 6, fingerprint: TEST_FINGERPRINT },
      'not a pin',
      null,
    ],
  }),
  [{ confirmedAt: 5, fingerprint: TEST_FINGERPRINT, host: 'node.example.invalid:24891' }],
  'Only records that name one host and one fingerprint survive.',
);
assert.deepEqual(parseNodeCertificatePins(null), []);
assert.deepEqual(parseNodeCertificatePins({ pins: 'all of them' }), []);
assert.deepEqual(
  parseNodeCertificatePins([{ confirmedAt: 1, fingerprint: TEST_FINGERPRINT, host: '203.0.113.7:24891' }]).length,
  1,
);

// The check is meant to be run on the node itself, over its own loopback, where
// nobody between Home and the node can answer for it.
const command = getFingerprintCheckCommand(new URL('https://node.example.invalid:24891'));

assert(command.includes('127.0.0.1:24891'), 'The check runs against the node loopback.');
assert(command.includes('-fingerprint -sha256'), 'The check prints a SHA-256 fingerprint.');
assert(!command.includes('node.example.invalid'), 'The check must not go back over the network.');

// --- The guards these decisions are worth nothing without -------------------

function readSource(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const observeSource = readSource('electron/node-cert-observe.ts');

// Observing a certificate is a TLS handshake and nothing else: no plaintext
// fetch (that is what #191 closed) and no credentials on an unconfirmed node.
assert(!/http:\/\//.test(observeSource), 'Observing a certificate must never use plaintext http.');
assert(!/API-KEY/i.test(observeSource), 'Observing a certificate must never send the API key.');
assert(
  (observeSource.match(/rejectUnauthorized/g) ?? []).length === 1,
  'Only the observation may disable verification, and only once.',
);

const tlsSource = readSource('electron/node-tls.ts');
const verifyProcBody = /setCertificateVerifyProc\([\s\S]*?\n  \}\);/.exec(tlsSource)?.[0];

assert(verifyProcBody, 'The certificate verify proc was not found in node-tls.ts.');
assert(
  verifyProcBody.includes('isConfirmedNodeCertificate'),
  'A remote certificate may only be accepted through the confirmed-fingerprint check.',
);
assert(
  (verifyProcBody.match(/callback\(0\)/g) ?? []).length === 2,
  'Only the stored authority and the confirmed fingerprint may accept a certificate.',
);

const confirmationSource = readSource('electron/node-cert-confirmation.ts');

assert(
  /planNodeCertificateConfirmation\(\{[\s\S]*?presentedFingerprint: presented\?\.fingerprint/.test(
    confirmationSource,
  ),
  'Confirming must go through the decision above, against the certificate read back from the node.',
);
assert(
  confirmationSource.indexOf('observeNodeCertificate(url)') <
    confirmationSource.indexOf('confirmNodeCertificatePin('),
  'Nothing may be pinned before the live certificate has been read back.',
);

const settingsSource = readSource('electron/node-settings.ts');

assert(
  /getSendableNodeApiKey|assertNodeCertificateConfirmed/.test(settingsSource),
  'node-settings must gate the API key on a confirmed certificate.',
);
assert(
  /const nodeApiUrl = await resolveNodeApiUrl\(settings\);\n\n  assertNodeCertificateConfirmed\(nodeApiUrl\);/.test(
    settingsSource,
  ),
  'Protected requests must refuse an unconfirmed node before the API key is read.',
);

console.log('Node certificate trust tests passed.');
