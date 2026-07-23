// Decides whether Home trusts a remote node's TLS certificate, and on what
// evidence.
//
// Core generates its own certificate (CN=qortium-local-server, signed by
// CN=qortium-local-ca). Nothing publicly trusted vouches for it and it is not
// bound to the operator's hostname, so an https node cannot be reached the way
// an ordinary website is. Over loopback that does not matter - there is no
// network path to intercept - and node-ca-bootstrap keeps that path exactly as
// it was. For a remote host the plaintext bootstrap was closed, because a
// certificate fetched over http is whichever certificate the network chose to
// hand back.
//
// What is left is the only way trust can be established without a third party:
// out of band. Home observes the certificate the node presents, shows its
// fingerprint, and the operator reads the same fingerprint off the node itself.
// If the two match, the user says so and Home pins that exact fingerprint for
// that exact host. Until then the connection fails closed and the API key is
// never sent - the same behaviour as today, with a way out of it.
//
// This module is pure: it hashes, formats and compares. Reading the certificate
// off the wire lives in node-cert-observe, storing confirmations in
// node-cert-pins, and enforcing the verdict in node-tls.

import { createHash } from 'node:crypto';
import { isLoopbackHostname, normalizeHostname } from './node-ca-bootstrap.js';

const FINGERPRINT_HEX_LENGTH = 64;
const DEFAULT_HTTPS_PORT = '443';

/**
 * A certificate the user confirmed out of band.
 *
 * `host` is `hostname:port`, so confirming a node on one port says nothing
 * about another node on the same machine, and `fingerprint` is the SHA-256 of
 * that one certificate - a reissued certificate does not inherit the
 * confirmation, it has to be confirmed again.
 */
export type NodeCertificatePin = {
  confirmedAt: number;
  fingerprint: string;
  host: string;
};

/** What Home may do with a node before any request is sent to it. */
export type NodeCertificateTrust =
  // Plain http: there is no certificate, so there is nothing to confirm.
  | { kind: 'not-applicable' }
  // https on this machine: the loopback authority bootstrap already covers it.
  | { kind: 'loopback' }
  // A remote https node whose certificate the user confirmed out of band.
  | { fingerprint: string; host: string; kind: 'confirmed' }
  // A remote https node that has not been confirmed: fail closed.
  | { host: string; kind: 'unconfirmed'; reason: string };

/** The verdict on a certificate a host actually presented during a handshake. */
export type NodeCertificateVerdict =
  | { kind: 'trusted' }
  | { confirmed: string[]; kind: 'mismatch' }
  | { kind: 'unconfirmed' };

/**
 * Whether the certificate's own validity window contains `now`.
 *
 * A pinned fingerprint says "this is the certificate I confirmed", not "this
 * certificate is still meant to be in use", so the window is checked
 * separately: an expired certificate keeps its fingerprint forever, and
 * accepting one would let a confirmation outlive the key it was made for.
 * Unparseable dates fail closed rather than being treated as unbounded.
 *
 * `now` is injectable so this can be tested without depending on the clock.
 */
export function isCertificateCurrentlyValid(
  certificate: { validFrom: string; validTo: string },
  now: number = Date.now(),
): boolean {
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);

  return Number.isFinite(validFrom) && Number.isFinite(validTo) && validFrom <= now && now <= validTo;
}

/** SHA-256 of the DER certificate, in the colon-separated form tools print. */
export function formatCertificateFingerprint(der: Uint8Array): string {
  const digest = createHash('sha256').update(der).digest('hex').toUpperCase();

  return (digest.match(/../g) ?? []).join(':');
}

/**
 * The same fingerprint in one canonical form, or null when the value is not a
 * SHA-256 fingerprint at all.
 *
 * Users paste what their tools printed, which may be lower case, spaced,
 * unseparated, or still carrying the `SHA256 Fingerprint=` label openssl puts
 * in front of it. Anything that is not exactly 32 bytes of hex is rejected
 * rather than guessed at.
 */
export function normalizeFingerprint(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const hex = value
    .trim()
    .replace(/^sha-?256\s*fingerprint\s*[=:]/i, '')
    .replace(/[\s:-]/g, '')
    .toUpperCase();

  if (hex.length !== FINGERPRINT_HEX_LENGTH || !/^[0-9A-F]+$/.test(hex)) {
    return null;
  }

  return (hex.match(/../g) ?? []).join(':');
}

export function getNodeCertificateHost(url: URL): string {
  const hostname = normalizeHostname(url.hostname);
  const port = url.port || (url.protocol === 'https:' ? DEFAULT_HTTPS_PORT : '80');

  return `${hostname}:${port}`;
}

function getPinHostname(pin: NodeCertificatePin) {
  const separatorIndex = pin.host.lastIndexOf(':');

  return normalizeHostname(separatorIndex === -1 ? pin.host : pin.host.slice(0, separatorIndex));
}

/** Confirmations that apply to a hostname, whichever port they were made on. */
export function getNodeCertificatePinsForHostname(
  hostname: string,
  pins: readonly NodeCertificatePin[],
): NodeCertificatePin[] {
  const normalizedHostname = normalizeHostname(hostname);

  return pins.filter((pin) => getPinHostname(pin) === normalizedHostname);
}

export function resolveNodeCertificateTrust(
  url: URL,
  pins: readonly NodeCertificatePin[],
): NodeCertificateTrust {
  if (url.protocol !== 'https:') {
    return { kind: 'not-applicable' };
  }

  if (isLoopbackHostname(url.hostname)) {
    return { kind: 'loopback' };
  }

  const host = getNodeCertificateHost(url);
  const pin = pins.find((candidate) => candidate.host === host);

  if (pin) {
    return { fingerprint: pin.fingerprint, host, kind: 'confirmed' };
  }

  return {
    host,
    kind: 'unconfirmed',
    reason:
      `Home has not been told which certificate belongs to ${host}. Nothing vouches for a node's ` +
      'self-signed certificate, so Home shows the fingerprint it was offered and waits for you to ' +
      'confirm - on the machine running the node - that it is the same one. Until then Home will ' +
      'not connect to this node or send its API key.',
  };
}

/**
 * Whether the certificate presented during a handshake is the confirmed one.
 *
 * Only an exact fingerprint match on a confirmed hostname is trusted. A host
 * with confirmations that all disagree is reported separately from a host with
 * none, so a certificate that changed underneath the user can be called out
 * instead of quietly looking like a first visit.
 */
export function verifyPresentedNodeCertificate(
  hostname: string,
  presentedFingerprint: string,
  pins: readonly NodeCertificatePin[],
): NodeCertificateVerdict {
  const presented = normalizeFingerprint(presentedFingerprint);
  const hostPins = getNodeCertificatePinsForHostname(hostname, pins);

  if (hostPins.length === 0) {
    return { kind: 'unconfirmed' };
  }

  if (presented && hostPins.some((pin) => pin.fingerprint === presented)) {
    return { kind: 'trusted' };
  }

  return { confirmed: hostPins.map((pin) => pin.fingerprint), kind: 'mismatch' };
}

/** Whether a user's confirmation may be turned into a pin. */
export type NodeCertificateConfirmationPlan =
  | { fingerprint: string; kind: 'pin' }
  | { kind: 'refused'; reason: string };

/**
 * Decide what to do with "these two fingerprints match".
 *
 * The user confirms a fingerprint they were shown, so the certificate the node
 * is serving right now has to be read back and compared against it: otherwise a
 * certificate that changed between being displayed and being confirmed would be
 * pinned without anyone having looked at it. Nothing else is accepted - not a
 * missing reading, not a malformed fingerprint, and not a host that never
 * needed confirming.
 */
export function planNodeCertificateConfirmation(options: {
  presentedFingerprint: string;
  requestedFingerprint: unknown;
  trust: NodeCertificateTrust;
}): NodeCertificateConfirmationPlan {
  if (options.trust.kind === 'not-applicable' || options.trust.kind === 'loopback') {
    return { kind: 'refused', reason: 'This node does not need a confirmed certificate.' };
  }

  const requested = normalizeFingerprint(options.requestedFingerprint);

  if (!requested) {
    return { kind: 'refused', reason: 'That is not a SHA-256 certificate fingerprint.' };
  }

  const presented = normalizeFingerprint(options.presentedFingerprint);

  if (!presented) {
    return {
      kind: 'refused',
      reason: `Home could not read a certificate from ${options.trust.host} to compare against.`,
    };
  }

  if (presented !== requested) {
    return {
      kind: 'refused',
      reason:
        `${options.trust.host} is now presenting a different certificate (${presented}). Check the ` +
        'fingerprint on the node again before confirming it.',
    };
  }

  return { fingerprint: requested, kind: 'pin' };
}

/**
 * The command the operator runs on the node itself.
 *
 * It reads the certificate over the node's own loopback interface, which is the
 * point: that path cannot be intercepted by whoever sits between Home and the
 * node, so the fingerprint it prints is independent evidence.
 */
export function getFingerprintCheckCommand(url: URL): string {
  const port = url.port || DEFAULT_HTTPS_PORT;

  return (
    `openssl s_client -connect 127.0.0.1:${port} </dev/null 2>/dev/null | ` +
    'openssl x509 -noout -fingerprint -sha256'
  );
}

function parseNodeCertificatePin(value: unknown): NodeCertificatePin | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const entry = value as Partial<NodeCertificatePin>;
  const fingerprint = normalizeFingerprint(entry.fingerprint);
  const host = typeof entry.host === 'string' ? entry.host.trim().toLowerCase() : '';

  // A stored record that no longer names one host and one fingerprint is
  // dropped rather than repaired: a half-understood pin must never be the
  // reason Home trusts something.
  if (!fingerprint || !/^\S+:\d{1,5}$/.test(host)) {
    return null;
  }

  return {
    confirmedAt:
      typeof entry.confirmedAt === 'number' && Number.isFinite(entry.confirmedAt) ? entry.confirmedAt : 0,
    fingerprint,
    host,
  };
}

export function parseNodeCertificatePins(value: unknown): NodeCertificatePin[] {
  const entries = Array.isArray(value)
    ? value
    : ((value as { pins?: unknown } | null)?.pins ?? null);

  if (!Array.isArray(entries)) {
    return [];
  }

  const pins: NodeCertificatePin[] = [];

  for (const entry of entries) {
    const pin = parseNodeCertificatePin(entry);

    if (pin && !pins.some((existing) => existing.host === pin.host && existing.fingerprint === pin.fingerprint)) {
      pins.push(pin);
    }
  }

  return pins;
}
