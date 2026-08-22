import assert from 'node:assert/strict';
import {
  matchesQortalJarReleaseIdentity,
  selectQortalJarRelease,
} from './qortal-release-policy.js';
import {
  createQortalLatestReleaseSource,
  type QortalLatestReleaseFailureCode,
} from './qortal-latest-release-source.js';

const DIGEST = 'a'.repeat(64);
const COMMIT = 'b'.repeat(40);
const URL = 'https://github.com/Qortal/qortal/releases/download/v6.1.9/qortal.jar';

function release(overrides: Record<string, unknown> = {}) {
  return {
    assets: [
      { browser_download_url: 'https://example.invalid/qortal.exe', name: 'qortal.exe', size: 10 },
      {
        browser_download_url: URL,
        digest: `SHA256:${DIGEST.toUpperCase()}`,
        name: 'qortal.jar',
        size: 94_721_819,
      },
      { browser_download_url: 'https://example.invalid/qortal.zip', name: 'qortal.zip', size: 20 },
    ],
    draft: false,
    prerelease: false,
    tag_name: 'v6.1.9',
    target_commitish: COMMIT,
    ...overrides,
  };
}

assert.deepEqual(selectQortalJarRelease(release()), {
  asset: {
    digest: `sha256:${DIGEST}`,
    downloadUrl: URL,
    name: 'qortal.jar',
    size: 94_721_819,
  },
  commit: COMMIT,
  tagName: 'v6.1.9',
});

const selectedRelease = selectQortalJarRelease(release());
assert.ok(selectedRelease);
assert.equal(
  matchesQortalJarReleaseIdentity(selectedRelease, {
    buildTimestamp: '2026-08-21T00:00:00Z',
    buildVersion: `6.1.9-${COMMIT.slice(0, 10)}`,
    commit: COMMIT.slice(0, 10),
    semver: '6.1.9',
  }),
  true,
);
assert.equal(
  matchesQortalJarReleaseIdentity(selectedRelease, {
    buildTimestamp: '',
    buildVersion: `6.1.8-${COMMIT.slice(0, 10)}`,
    commit: COMMIT.slice(0, 10),
    semver: '6.1.8',
  }),
  false,
);
assert.equal(
  matchesQortalJarReleaseIdentity(selectedRelease, {
    buildTimestamp: '',
    buildVersion: `6.1.8-${COMMIT.slice(0, 10)}`,
    commit: COMMIT.slice(0, 10),
    semver: '6.1.9',
  }),
  false,
);
assert.equal(matchesQortalJarReleaseIdentity(selectedRelease, null), false);
assert.equal(
  matchesQortalJarReleaseIdentity(selectedRelease, {
    buildTimestamp: '',
    buildVersion: '6.1.9-cccccccccc',
    commit: 'c'.repeat(10),
    semver: '6.1.9',
  }),
  false,
);

for (const invalid of [
  null,
  [],
  {},
  release({ draft: true }),
  release({ draft: undefined }),
  release({ prerelease: true }),
  release({ prerelease: undefined }),
  release({ tag_name: '' }),
  release({ tag_name: '../v6.1.9' }),
  release({ assets: null }),
  release({ assets: [] }),
]) {
  assert.equal(selectQortalJarRelease(invalid), null);
}

const validJar = (overrides: Record<string, unknown> = {}) => ({
  browser_download_url: URL,
  digest: `sha256:${DIGEST}`,
  name: 'qortal.jar',
  size: 94_721_819,
  ...overrides,
});

for (const name of ['QORTAL.JAR', 'qortal.zip', 'qortal.jar.exe']) {
  assert.equal(selectQortalJarRelease(release({ assets: [validJar({ name })] })), null);
}

for (const target_commitish of [
  undefined,
  '',
  'main',
  'b'.repeat(39),
  'b'.repeat(41),
  'g'.repeat(40),
]) {
  assert.equal(selectQortalJarRelease(release({ target_commitish })), null);
}

assert.equal(
  selectQortalJarRelease(release({ assets: [validJar(), validJar()] })),
  null,
);

for (const digest of [
  undefined,
  '',
  `sha512:${DIGEST}`,
  `sha256:${'a'.repeat(63)}`,
  `sha256:${'a'.repeat(65)}`,
  `sha256:${'g'.repeat(64)}`,
]) {
  assert.equal(selectQortalJarRelease(release({ assets: [validJar({ digest })] })), null);
}

for (const size of [undefined, '94721819', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  assert.equal(selectQortalJarRelease(release({ assets: [validJar({ size })] })), null);
}

for (const browser_download_url of [
  URL.replace('https:', 'http:'),
  URL.replace('github.com', 'example.com'),
  URL.replace('/Qortal/qortal/', '/QortiumDev/qortal/'),
  URL.replace('v6.1.9', 'v6.1.8'),
  URL.replace('qortal.jar', 'qortal.zip'),
  `${URL}?download=1`,
  `${URL}#asset`,
  URL.replace('https://', 'https://user@'),
]) {
  assert.equal(
    selectQortalJarRelease(release({ assets: [validJar({ browser_download_url })] })),
    null,
  );
}

{
  const requests: Array<{ headers: Headers; redirect: RequestRedirect | undefined; signal: AbortSignal | null | undefined; url: string }> = [];
  const rawRelease = release({ target_commitish: 'master' });
  const source = createQortalLatestReleaseSource(async (input, init) => {
    const url = String(input);
    requests.push({
      headers: new Headers(init?.headers),
      redirect: init?.redirect,
      signal: init?.signal,
      url,
    });
    return new Response(JSON.stringify(url.endsWith('/commits/v6.1.9')
      ? { sha: COMMIT }
      : rawRelease), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  });
  const result = await source.getLatest();
  assert.equal(
    requests[0]?.url,
    'https://api.github.com/repos/Qortal/qortal/releases/latest',
  );
  assert.equal(
    requests[1]?.url,
    'https://api.github.com/repos/Qortal/qortal/commits/v6.1.9',
  );
  for (const request of requests) {
    assert.equal(request.headers.get('Accept'), 'application/vnd.github+json');
    assert.equal(request.headers.get('User-Agent'), 'QortiumHome/1.0');
    assert.equal(request.redirect, 'error');
    assert.equal(request.signal instanceof AbortSignal, true);
  }
  assert.equal(result.kind, 'available');
  if (result.kind === 'available') {
    assert.equal(result.release.commit, COMMIT);
    assert.equal(result.release.tagName, 'v6.1.9');
    assert.equal('rawRelease' in result, false);
  }
  const expected = await source.getExpectedLatest('v6.1.9');
  assert.equal(expected.kind, 'available');
  if (expected.kind === 'available') {
    assert.deepEqual(expected.rawRelease, { ...rawRelease, target_commitish: COMMIT });
  }
  assert.deepEqual(await source.getExpectedLatest('v6.2.0'), {
    code: 'release-changed',
    kind: 'unavailable',
  });
  assert.equal(requests.length, 6, 'each expected-tag check must refetch release and commit');
}

{
  let calls = 0;
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  const source = createQortalLatestReleaseSource(async (input) => {
    calls += 1;
    if (!String(input).includes('/commits/')) await gate;
    return new Response(JSON.stringify(String(input).includes('/commits/')
      ? { sha: COMMIT }
      : release()), { status: 200 });
  });
  const first = source.getLatest();
  const second = source.getLatest();
  await Promise.resolve();
  assert.equal(calls, 1, 'concurrent checks must share the release request');
  releaseGate();
  assert.equal((await first).kind, 'available');
  assert.equal((await second).kind, 'available');
  assert.equal(calls, 2, 'concurrent checks must share one release/commit pair');
}

{
  const oversized = new Response('{}', {
    headers: { 'Content-Length': String(512 * 1024 + 1) },
    status: 200,
  });
  assert.deepEqual(
    await createQortalLatestReleaseSource(async () => oversized.clone()).getLatest(),
    { code: 'invalid-json', kind: 'unavailable' },
  );
}

{
  const keepAlive = setInterval(() => {}, 100);
  try {
    const timedOut = await createQortalLatestReleaseSource(async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }), { timeoutMs: 5 }).getLatest();
    assert.deepEqual(timedOut, { code: 'network-error', kind: 'unavailable' });
  } finally {
    clearInterval(keepAlive);
  }
}

const releaseFailureCases: Array<{
  code: QortalLatestReleaseFailureCode;
  fetchRelease: typeof fetch;
  label: string;
}> = [
  { code: 'not-found', fetchRelease: async () => new Response('', { status: 404 }), label: 'not found' },
  { code: 'http-error', fetchRelease: async () => new Response('private upstream details', { status: 503 }), label: 'upstream failure' },
  { code: 'invalid-json', fetchRelease: async () => new Response('{', { status: 200 }), label: 'invalid json' },
  { code: 'invalid-release', fetchRelease: async () => new Response(JSON.stringify(release({ prerelease: true })), { status: 200 }), label: 'invalid release' },
  { code: 'network-error', fetchRelease: async () => { throw new Error('private network details'); }, label: 'network failure' },
];

for (const { code: expectedCode, fetchRelease, label } of releaseFailureCases) {
  const result = await createQortalLatestReleaseSource(fetchRelease).getLatest();
  assert.deepEqual(result, { code: expectedCode, kind: 'unavailable' }, label);
  assert.doesNotMatch(JSON.stringify(result), /private/i);
}

const commitFailureCases = [
  { code: 'commit-not-found', label: 'commit not found', response: new Response('', { status: 404 }) },
  { code: 'commit-http-error', label: 'commit upstream failure', response: new Response('private', { status: 503 }) },
  { code: 'commit-invalid-json', label: 'invalid commit json', response: new Response('{', { status: 200 }) },
  { code: 'commit-invalid', label: 'invalid commit sha', response: new Response(JSON.stringify({ sha: 'main' }), { status: 200 }) },
] as const;
for (const { code, label, response } of commitFailureCases) {
  const result = await createQortalLatestReleaseSource(async (input) =>
    String(input).includes('/commits/')
      ? response.clone()
      : new Response(JSON.stringify(release()), { status: 200 })).getLatest();
  assert.deepEqual(result, { code, kind: 'unavailable' }, label);
  assert.doesNotMatch(JSON.stringify(result), /private/i);
}

{
  const result = await createQortalLatestReleaseSource(async (input) => {
    if (String(input).includes('/commits/')) throw new Error('private commit network details');
    return new Response(JSON.stringify(release()), { status: 200 });
  }).getLatest();
  assert.deepEqual(result, { code: 'commit-network-error', kind: 'unavailable' });
}

console.log('Qortal exact bare-JAR release policy checks passed.');
