import {
  getCoreGithubCommitUrl,
  getCoreGithubLatestReleaseUrl,
  QORTAL_CORE_DESCRIPTOR,
} from './core-network-descriptor.js';
import {
  selectQortalJarRelease,
  type QortalJarRelease,
} from './qortal-release-policy.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RELEASE_BYTES = 512 * 1024;
const MAX_COMMIT_BYTES = 64 * 1024;

export type QortalLatestReleaseFailureCode =
  | 'commit-http-error'
  | 'commit-invalid'
  | 'commit-invalid-json'
  | 'commit-network-error'
  | 'commit-not-found'
  | 'http-error'
  | 'invalid-json'
  | 'invalid-release'
  | 'network-error'
  | 'not-found'
  | 'release-changed';

type QortalLatestReleaseFailure = {
  code: QortalLatestReleaseFailureCode;
  kind: 'unavailable';
};

export type QortalLatestReleaseResult =
  | {
      kind: 'available';
      release: QortalJarRelease;
    }
  | QortalLatestReleaseFailure;

export type QortalExpectedLatestReleaseResult =
  | {
      kind: 'available';
      rawRelease: unknown;
      release: QortalJarRelease;
    }
  | QortalLatestReleaseFailure;

export type QortalLatestReleaseSource = Readonly<{
  getExpectedLatest(expectedTag: string): Promise<QortalExpectedLatestReleaseResult>;
  getLatest(): Promise<QortalLatestReleaseResult>;
}>;

function unavailable(code: QortalLatestReleaseFailureCode): QortalLatestReleaseFailure {
  return Object.freeze({ code, kind: 'unavailable' });
}

function freezeRelease(release: QortalJarRelease): QortalJarRelease {
  return Object.freeze({
    ...release,
    asset: Object.freeze({ ...release.asset }),
  });
}

function githubHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': QORTAL_CORE_DESCRIPTOR.github.userAgent,
  } as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function readBoundedJson(response: Response, maxBytes: number) {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const size = Number(declaredLength);
    if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
      throw new Error('GitHub response size was rejected.');
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('GitHub returned no response body.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('GitHub response exceeded its byte limit.');
    }
    chunks.push(part.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function createQortalLatestReleaseSource(
  fetchRelease: typeof fetch = globalThis.fetch,
  options: { timeoutMs?: number } = {},
): QortalLatestReleaseSource {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    throw new RangeError('Qortal release timeout must be between 1 and 60000 milliseconds.');
  }
  const fetchLatest = async (): Promise<QortalExpectedLatestReleaseResult> => {
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;

    try {
      response = await fetchRelease(getCoreGithubLatestReleaseUrl(QORTAL_CORE_DESCRIPTOR), {
        headers: githubHeaders(),
        redirect: 'error',
        signal,
      });
    } catch {
      return unavailable('network-error');
    }

    if (response.status === 404) return unavailable('not-found');
    if (!response.ok) return unavailable('http-error');

    let rawRelease: unknown;
    try {
      rawRelease = await readBoundedJson(response, MAX_RELEASE_BYTES);
    } catch {
      return unavailable('invalid-json');
    }

    if (!isRecord(rawRelease)) return unavailable('invalid-release');

    // GitHub release payloads may name a branch in target_commitish. Validate
    // every other release field and obtain the safe tag before resolving that
    // tag to the immutable commit used by the manager.
    const provisionalRelease = selectQortalJarRelease({
      ...rawRelease,
      target_commitish: '0'.repeat(40),
    });
    if (!provisionalRelease) return unavailable('invalid-release');

    let commitResponse: Response;
    try {
      commitResponse = await fetchRelease(
        getCoreGithubCommitUrl(QORTAL_CORE_DESCRIPTOR, provisionalRelease.tagName),
        {
          headers: githubHeaders(),
          redirect: 'error',
          signal,
        },
      );
    } catch {
      return unavailable('commit-network-error');
    }
    if (commitResponse.status === 404) return unavailable('commit-not-found');
    if (!commitResponse.ok) return unavailable('commit-http-error');

    let rawCommit: unknown;
    try {
      rawCommit = await readBoundedJson(commitResponse, MAX_COMMIT_BYTES);
    } catch {
      return unavailable('commit-invalid-json');
    }
    const commit = isRecord(rawCommit) && typeof rawCommit.sha === 'string'
      ? rawCommit.sha
      : '';
    if (!/^[a-f0-9]{40}$/i.test(commit)) return unavailable('commit-invalid');

    const resolvedRawRelease = Object.freeze({
      ...rawRelease,
      target_commitish: commit,
    });
    const release = selectQortalJarRelease(resolvedRawRelease);
    return release
      ? Object.freeze({
          kind: 'available',
          rawRelease: resolvedRawRelease,
          release: freezeRelease(release),
        })
      : unavailable('invalid-release');
  };

  let inFlight: Promise<QortalExpectedLatestReleaseResult> | null = null;
  const getCoalescedLatest = () => {
    if (inFlight) return inFlight;
    inFlight = fetchLatest().finally(() => { inFlight = null; });
    return inFlight;
  };

  return Object.freeze({
    async getExpectedLatest(expectedTag: string) {
      const result = await getCoalescedLatest();
      if (result.kind !== 'available') return result;
      return result.release.tagName === expectedTag ? result : unavailable('release-changed');
    },
    async getLatest() {
      const result = await getCoalescedLatest();
      return result.kind === 'available'
        ? Object.freeze({ kind: 'available', release: result.release })
        : result;
    },
  });
}

export const qortalLatestReleaseSource = createQortalLatestReleaseSource();
