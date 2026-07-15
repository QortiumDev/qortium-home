import { verifyPublicQdnPublishArtifacts, type QdnPublishVerificationInput } from '../electron/qdn-content-attestation';

self.onmessage = async (event: MessageEvent<QdnPublishVerificationInput>) => {
  try {
    await verifyPublicQdnPublishArtifacts(event.data);
    self.postMessage({ ok: true });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'QDN content attestation failed.' });
  }
};
