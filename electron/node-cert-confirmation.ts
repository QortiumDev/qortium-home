// The out-of-band confirmation flow, as the settings UI drives it.
//
// Look at the certificate a remote node presents, report it next to whatever
// the user confirmed before, and pin it only when the user says the fingerprint
// matches the one they read on the node itself. Confirming re-reads the
// certificate first, so what gets pinned is the certificate the node is serving
// now - not a fingerprint that was on screen a while ago.

import {
  confirmNodeCertificatePin,
  forgetNodeCertificatePin,
  readNodeCertificatePins,
} from './node-cert-pins.js';
import { observeNodeCertificate, type ObservedNodeCertificate } from './node-cert-observe.js';
import {
  getFingerprintCheckCommand,
  planNodeCertificateConfirmation,
  resolveNodeCertificateTrust,
} from './node-cert-trust.js';

export type NodeCertificateStatus = {
  // False for http and for loopback https: there is nothing for the user to do.
  confirmationRequired: boolean;
  confirmedFingerprint: string | null;
  host: string;
  matchesConfirmed: boolean;
  nodeApiUrl: string;
  observeError: string | null;
  presented: ObservedNodeCertificate | null;
  verifyCommand: string;
};

function parseNodeApiUrl(nodeApiUrl: string) {
  const url = new URL(nodeApiUrl);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Node URL must use HTTP or HTTPS.');
  }

  return url;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function getNodeCertificateStatus(nodeApiUrl: string): Promise<NodeCertificateStatus> {
  const url = parseNodeApiUrl(nodeApiUrl);
  const trust = resolveNodeCertificateTrust(url, readNodeCertificatePins());
  const confirmedFingerprint = trust.kind === 'confirmed' ? trust.fingerprint : null;
  const host = trust.kind === 'confirmed' || trust.kind === 'unconfirmed' ? trust.host : url.host;
  const status: NodeCertificateStatus = {
    confirmationRequired: trust.kind === 'confirmed' || trust.kind === 'unconfirmed',
    confirmedFingerprint,
    host,
    matchesConfirmed: false,
    nodeApiUrl: url.origin,
    observeError: null,
    presented: null,
    verifyCommand: getFingerprintCheckCommand(url),
  };

  if (!status.confirmationRequired) {
    return status;
  }

  try {
    const presented = await observeNodeCertificate(url);

    return {
      ...status,
      matchesConfirmed: !!confirmedFingerprint && presented.fingerprint === confirmedFingerprint,
      presented,
    };
  } catch (error) {
    return { ...status, observeError: getErrorMessage(error) };
  }
}

export async function confirmNodeCertificate(
  nodeApiUrl: string,
  fingerprint: unknown,
): Promise<NodeCertificateStatus> {
  const url = parseNodeApiUrl(nodeApiUrl);
  const trust = resolveNodeCertificateTrust(url, readNodeCertificatePins());
  // Read the certificate the node is serving right now, and let the pure
  // decision say whether the user's confirmation applies to it. A node that
  // needs no confirmation is not contacted at all.
  const presented =
    trust.kind === 'confirmed' || trust.kind === 'unconfirmed'
      ? await observeNodeCertificate(url).catch(() => null)
      : null;
  const plan = planNodeCertificateConfirmation({
    presentedFingerprint: presented?.fingerprint ?? '',
    requestedFingerprint: fingerprint,
    trust,
  });

  if (plan.kind === 'refused') {
    throw new Error(plan.reason);
  }

  confirmNodeCertificatePin(url, plan.fingerprint);

  return await getNodeCertificateStatus(url.origin);
}

export async function forgetNodeCertificate(nodeApiUrl: string): Promise<NodeCertificateStatus> {
  const url = parseNodeApiUrl(nodeApiUrl);

  forgetNodeCertificatePin(url);

  return await getNodeCertificateStatus(url.origin);
}
