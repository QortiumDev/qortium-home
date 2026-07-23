// Reads the certificate a node presents, without trusting it.
//
// Establishing the TLS session is the only way to see the certificate at all,
// so the handshake runs with verification turned off - and nothing else
// happens: no request is written, no API key is sent, and the socket is closed
// as soon as the certificate is in hand. The result is evidence to show the
// user, never a reason to trust anything.
//
// This is not the plaintext bootstrap that was closed: nothing is fetched over
// http, and whatever is observed here is inert until the user confirms its
// fingerprint against the node itself.

import { isIP } from 'node:net';
import { connect } from 'node:tls';
import { formatCertificateFingerprint } from './node-cert-trust.js';

const OBSERVE_TIMEOUT_MS = 5_000;

export type ObservedNodeCertificate = {
  fingerprint: string;
  issuer: string;
  subject: string;
  validFrom: string;
  validTo: string;
};

function formatCertificateName(value: unknown) {
  if (!value || typeof value !== 'object') {
    return '';
  }

  return Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => `${key}=${String(entry)}`)
    .join(', ');
}

export function observeNodeCertificate(
  url: URL,
  timeoutMs = OBSERVE_TIMEOUT_MS,
): Promise<ObservedNodeCertificate> {
  return new Promise((resolve, reject) => {
    if (url.protocol !== 'https:') {
      reject(new Error('Only an https node presents a certificate.'));
      return;
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const socket = connect({
      host: hostname,
      port: Number(url.port || 443),
      // The certificate is what we came to look at; judging it is the user's
      // job, and node-tls refuses the connection until they have done it.
      rejectUnauthorized: false,
      ...(isIP(hostname) ? {} : { servername: hostname }),
    });
    let settled = false;

    function finish(error: Error | null, certificate?: ObservedNodeCertificate) {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();

      if (certificate) {
        resolve(certificate);
      } else {
        reject(error ?? new Error(`Home could not read a certificate from ${url.host}.`));
      }
    }

    socket.setTimeout(timeoutMs, () => finish(new Error(`${url.host} did not answer in time.`)));
    socket.on('error', (error: Error) => finish(error));
    socket.on('secureConnect', () => {
      const peerCertificate = socket.getPeerCertificate(false);

      if (!peerCertificate?.raw?.length) {
        finish(new Error(`${url.host} did not present a certificate.`));
        return;
      }

      finish(null, {
        fingerprint: formatCertificateFingerprint(peerCertificate.raw),
        issuer: formatCertificateName(peerCertificate.issuer),
        subject: formatCertificateName(peerCertificate.subject),
        validFrom: peerCertificate.valid_from ?? '',
        validTo: peerCertificate.valid_to ?? '',
      });
    });
  });
}
