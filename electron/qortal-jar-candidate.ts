import { unlink } from 'node:fs/promises';
import {
  downloadVerifiedCoreAsset,
  type VerifiedCoreDownloadProgress,
} from './core-verified-download.js';
import {
  readCoreJarIdentity,
  type CoreJarIdentity,
} from './core-jar-identity.js';
import {
  matchesQortalJarReleaseIdentity,
  type QortalJarRelease,
} from './qortal-release-policy.js';

export type QortalJarCandidateInput = {
  candidateJarPath: string;
  onProgress?: (progress: VerifiedCoreDownloadProgress) => void;
  partialPath: string;
  release: QortalJarRelease;
  userAgent: string;
};

export type QortalJarCandidateOperations = {
  download: typeof downloadVerifiedCoreAsset;
  readIdentity: typeof readCoreJarIdentity;
  remove: (targetPath: string) => Promise<void>;
};

const DEFAULT_OPERATIONS: QortalJarCandidateOperations = {
  download: downloadVerifiedCoreAsset,
  readIdentity: readCoreJarIdentity,
  remove: unlink,
};

function asError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value));
}

async function removeRejectedCandidate(
  candidateJarPath: string,
  originalError: unknown,
  operations: QortalJarCandidateOperations,
) {
  try {
    await operations.remove(candidateJarPath);
  } catch (cleanupError) {
    throw new AggregateError(
      [asError(originalError), asError(cleanupError)],
      'The Qortal JAR candidate was rejected and could not be removed.',
    );
  }
}

/**
 * Produces a byte-verified, release-identified Qortal JAR in caller-owned
 * staging. Installation and Core lifecycle policy deliberately remain outside
 * this pure boundary.
 */
export async function stageVerifiedQortalJarCandidate(
  input: QortalJarCandidateInput,
  options: { operations?: Partial<QortalJarCandidateOperations> } = {},
) {
  const operations: QortalJarCandidateOperations = {
    ...DEFAULT_OPERATIONS,
    ...options.operations,
  };

  const download = await operations.download({
    asset: input.release.asset,
    destinationPath: input.candidateJarPath,
    onProgress: input.onProgress,
    partialPath: input.partialPath,
    userAgent: input.userAgent,
  });

  let identity: CoreJarIdentity | null = null;

  try {
    identity = await operations.readIdentity(input.candidateJarPath);

    if (!identity || !matchesQortalJarReleaseIdentity(input.release, identity)) {
      throw new Error(
        `The downloaded Qortal JAR identity does not match release ${input.release.tagName}.`,
      );
    }
  } catch (error) {
    await removeRejectedCandidate(input.candidateJarPath, error, operations);
    throw error;
  }

  return {
    candidateJarPath: input.candidateJarPath,
    digest: download.digest,
    identity,
    size: download.size,
  };
}
