// Stores the certificate fingerprints the user confirmed out of band.
//
// One file, one record per host:port, holding the SHA-256 of the certificate
// that was confirmed and when. Deliberately separate from the CA directory
// node-tls keeps for loopback nodes: those are authorities Home fetched itself,
// these are decisions the user made, and only the second kind may apply to a
// remote host.

import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  getNodeCertificateHost,
  normalizeFingerprint,
  parseNodeCertificatePins,
  type NodeCertificatePin,
} from './node-cert-trust.js';

const NODE_CERT_PINS_FILE = 'node-cert-pins.json';

let cachedPins: NodeCertificatePin[] | null = null;

function getNodeCertPinsPath() {
  return path.join(app.getPath('userData'), NODE_CERT_PINS_FILE);
}

export function readNodeCertificatePins(): NodeCertificatePin[] {
  if (cachedPins) {
    return cachedPins;
  }

  try {
    cachedPins = parseNodeCertificatePins(JSON.parse(readFileSync(getNodeCertPinsPath(), 'utf8')));
  } catch {
    cachedPins = [];
  }

  return cachedPins;
}

function writeNodeCertificatePins(pins: NodeCertificatePin[]) {
  const pinsPath = getNodeCertPinsPath();

  mkdirSync(path.dirname(pinsPath), { recursive: true });
  writeFileSync(pinsPath, `${JSON.stringify({ pins }, null, 2)}\n`, 'utf8');
  cachedPins = pins;
}

/**
 * Record that the user confirmed this fingerprint for this host.
 *
 * One host keeps one confirmation: confirming a reissued certificate replaces
 * the old one instead of leaving both acceptable.
 */
export function confirmNodeCertificatePin(url: URL, fingerprint: string): NodeCertificatePin {
  const normalizedFingerprint = normalizeFingerprint(fingerprint);

  if (!normalizedFingerprint) {
    throw new Error('That is not a SHA-256 certificate fingerprint.');
  }

  const host = getNodeCertificateHost(url);
  const pin: NodeCertificatePin = {
    confirmedAt: Date.now(),
    fingerprint: normalizedFingerprint,
    host,
  };

  writeNodeCertificatePins([...readNodeCertificatePins().filter((entry) => entry.host !== host), pin]);

  return pin;
}

export function forgetNodeCertificatePin(url: URL): boolean {
  const host = getNodeCertificateHost(url);
  const pins = readNodeCertificatePins();
  const remaining = pins.filter((entry) => entry.host !== host);

  if (remaining.length === pins.length) {
    return false;
  }

  writeNodeCertificatePins(remaining);

  return true;
}
