import { parentPort } from 'node:worker_threads';

import { verifyPublicQdnPublishArtifacts, type QdnPublishVerificationInput } from './qdn-content-attestation.js';

if (!parentPort) throw new Error('QDN attestation worker requires a parent port.');

parentPort.once('message', async (input: QdnPublishVerificationInput) => {
  try {
    await verifyPublicQdnPublishArtifacts(input);
    parentPort!.postMessage({ ok: true });
  } catch (error) {
    parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : 'QDN content attestation failed.' });
  }
});
