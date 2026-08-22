import assert from 'node:assert/strict';
import type { CoreJarIdentity } from './core-jar-identity.js';
import { stageVerifiedQortalJarCandidate } from './qortal-jar-candidate.js';
import type { QortalJarRelease } from './qortal-release-policy.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const CANDIDATE_PATH = '/home-owned-staging/qortal-v6.1.9.jar';
const PARTIAL_PATH = `${CANDIDATE_PATH}.partial`;
const RELEASE_COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const RELEASE: QortalJarRelease = {
  asset: {
    digest: DIGEST,
    downloadUrl: 'https://github.com/Qortal/qortal/releases/download/v6.1.9/qortal.jar',
    name: 'qortal.jar',
    size: 94_721_819,
  },
  commit: RELEASE_COMMIT,
  tagName: 'v6.1.9',
};
const IDENTITY: CoreJarIdentity = {
  buildTimestamp: '2026-08-21T00:00:00Z',
  buildVersion: '6.1.9-a1b2c3d4',
  commit: 'a1b2c3d4',
  semver: '6.1.9',
};

function input() {
  return {
    candidateJarPath: CANDIDATE_PATH,
    partialPath: PARTIAL_PATH,
    release: RELEASE,
    userAgent: 'QortiumHome/test',
  };
}

{
  const events: string[] = [];
  const progressEvents: number[] = [];
  const result = await stageVerifiedQortalJarCandidate(
    {
      ...input(),
      onProgress: ({ percent }) => progressEvents.push(percent),
    },
    {
      operations: {
        download: async (downloadInput) => {
          events.push('download');
          assert.equal(downloadInput.asset, RELEASE.asset);
          assert.equal(downloadInput.destinationPath, CANDIDATE_PATH);
          assert.equal(downloadInput.partialPath, PARTIAL_PATH);
          downloadInput.onProgress?.({ expectedBytes: 1, percent: 100, receivedBytes: 1 });
          return { digest: DIGEST, size: RELEASE.asset.size };
        },
        readIdentity: async (jarPath) => {
          events.push('identity');
          assert.equal(jarPath, CANDIDATE_PATH);
          return IDENTITY;
        },
        remove: async () => {
          events.push('remove');
        },
      },
    },
  );

  assert.deepEqual(events, ['download', 'identity']);
  assert.deepEqual(progressEvents, [100]);
  assert.deepEqual(result, {
    candidateJarPath: CANDIDATE_PATH,
    digest: DIGEST,
    identity: IDENTITY,
    size: RELEASE.asset.size,
  });
}

for (const [label, identity] of [
  ['missing', null],
  ['wrong-version', { ...IDENTITY, buildVersion: '6.1.8-a1b2c3d4', semver: '6.1.8' }],
  ['inconsistent', { ...IDENTITY, buildVersion: '6.1.8-a1b2c3d4' }],
  ['wrong-commit', { ...IDENTITY, commit: 'b1b2c3d4' }],
] as const) {
  const events: string[] = [];

  await assert.rejects(
    stageVerifiedQortalJarCandidate(input(), {
      operations: {
        download: async () => {
          events.push('download');
          return { digest: DIGEST, size: RELEASE.asset.size };
        },
        readIdentity: async () => {
          events.push('identity');
          return identity;
        },
        remove: async (targetPath) => {
          events.push(`remove:${targetPath}`);
        },
      },
    }),
    new RegExp(`identity does not match release.*${RELEASE.tagName}`, 'i'),
    label,
  );

  assert.deepEqual(events, ['download', 'identity', `remove:${CANDIDATE_PATH}`]);
}

{
  const events: string[] = [];
  await assert.rejects(
    stageVerifiedQortalJarCandidate(
      { ...input(), release: { ...RELEASE, commit: 'a1b2c3d4' } },
      {
        operations: {
          download: async () => {
            events.push('download');
            return { digest: DIGEST, size: RELEASE.asset.size };
          },
          readIdentity: async () => {
            events.push('identity');
            return IDENTITY;
          },
          remove: async (targetPath) => {
            events.push(`remove:${targetPath}`);
          },
        },
      },
    ),
    /identity does not match release/i,
  );
  assert.deepEqual(events, ['download', 'identity', `remove:${CANDIDATE_PATH}`]);
}

{
  const identityError = new Error('unable to inspect JAR');
  const cleanupError = new Error('candidate remained locked');

  await assert.rejects(
    stageVerifiedQortalJarCandidate(input(), {
      operations: {
        download: async () => ({ digest: DIGEST, size: RELEASE.asset.size }),
        readIdentity: async () => {
          throw identityError;
        },
        remove: async () => {
          throw cleanupError;
        },
      },
    }),
    (error) =>
      error instanceof AggregateError &&
      error.errors[0] === identityError &&
      error.errors[1] === cleanupError,
  );
}

{
  const downloadError = new Error('verified download failed');
  let identityRead = false;
  let removed = false;

  await assert.rejects(
    stageVerifiedQortalJarCandidate(input(), {
      operations: {
        download: async () => {
          throw downloadError;
        },
        readIdentity: async () => {
          identityRead = true;
          return IDENTITY;
        },
        remove: async () => {
          removed = true;
        },
      },
    }),
    (error) => error === downloadError,
  );

  assert.equal(identityRead, false);
  assert.equal(removed, false, 'the downloader retains cleanup ownership until promotion');
}

console.log('Qortal verified JAR candidate staging checks passed.');
