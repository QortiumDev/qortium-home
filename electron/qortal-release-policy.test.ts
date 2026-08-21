import assert from 'node:assert/strict';
import { selectQortalJarRelease } from './qortal-release-policy.js';

const DIGEST = 'a'.repeat(64);
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
  tagName: 'v6.1.9',
});

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

console.log('Qortal exact bare-JAR release policy checks passed.');
