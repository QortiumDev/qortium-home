import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectManagedJavaBinary } from './managed-java-asset.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LINUX_X64 = { apiArch: 'x64', apiOs: 'linux', archiveExtension: 'tar.gz' };
const CHECKSUM = 'a'.repeat(64);

function buildRelease(overrides: Record<string, unknown> = {}, packageOverrides: Record<string, unknown> = {}) {
  return {
    binary: {
      architecture: 'x64',
      heap_size: 'normal',
      image_type: 'jre',
      jvm_impl: 'hotspot',
      os: 'linux',
      package: {
        checksum: CHECKSUM,
        link: 'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.1%2B9/OpenJDK25U-jre_x64_linux_hotspot_25.0.1_9.tar.gz',
        name: 'OpenJDK25U-jre_x64_linux_hotspot_25.0.1_9.tar.gz',
        size: 45_678_901,
        ...packageOverrides,
      },
      project: 'jdk',
      ...overrides,
    },
    release_name: 'jdk-25.0.1+9',
    version: { openjdk_version: '25.0.1+9' },
  };
}

// The download link and the checksum must be the two halves of one record.
assert.deepEqual(selectManagedJavaBinary([buildRelease()], LINUX_X64), {
  checksum: `sha256:${CHECKSUM}`,
  downloadUrl:
    'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.1%2B9/OpenJDK25U-jre_x64_linux_hotspot_25.0.1_9.tar.gz',
  packageName: 'OpenJDK25U-jre_x64_linux_hotspot_25.0.1_9.tar.gz',
  size: 45_678_901,
  version: '25.0.1+9',
});

// Adoptium answers a query with more than the binary we asked for, and picking
// the wrong row would install a runtime that cannot run - or, worse, verify a
// download against another build's checksum.
const mixedReleases = [
  buildRelease({ os: 'windows' }),
  buildRelease({ architecture: 'aarch64' }),
  buildRelease({ image_type: 'jdk' }),
  buildRelease({ heap_size: 'large' }),
  buildRelease({ jvm_impl: 'openj9' }),
  buildRelease({ project: 'jfr' }),
  buildRelease(),
];
assert.equal(selectManagedJavaBinary(mixedReleases, LINUX_X64)?.checksum, `sha256:${CHECKSUM}`);

// A package whose extension does not match how Home unpacks it is the wrong
// asset, however well the rest of the record matches.
assert.equal(selectManagedJavaBinary([buildRelease()], { ...LINUX_X64, archiveExtension: 'zip' }), null);

// Fail closed: no usable checksum means no install candidate at all.
assert.equal(selectManagedJavaBinary([buildRelease({}, { checksum: undefined })], LINUX_X64), null);
assert.equal(selectManagedJavaBinary([buildRelease({}, { checksum: '' })], LINUX_X64), null);
assert.equal(selectManagedJavaBinary([buildRelease({}, { checksum: 'not-a-digest' })], LINUX_X64), null);
assert.equal(selectManagedJavaBinary([buildRelease({}, { checksum: CHECKSUM.slice(1) })], LINUX_X64), null);
assert.equal(selectManagedJavaBinary([buildRelease({}, { checksum: `${CHECKSUM}00` })], LINUX_X64), null);

// A hex checksum is case-insensitive, but the digest it is compared against is
// always lower case.
assert.equal(
  selectManagedJavaBinary([buildRelease({}, { checksum: CHECKSUM.toUpperCase() })], LINUX_X64)?.checksum,
  `sha256:${CHECKSUM}`,
);

// A plaintext download link would let the archive be swapped in transit even
// though the checksum arrived over TLS.
assert.equal(
  selectManagedJavaBinary([buildRelease({}, { link: 'http://cdn.example.invalid/jre.tar.gz' })], LINUX_X64),
  null,
);
assert.equal(selectManagedJavaBinary([buildRelease({}, { link: '' })], LINUX_X64), null);

// Nothing about the API response is trusted to have the expected shape.
assert.equal(selectManagedJavaBinary(null, LINUX_X64), null);
assert.equal(selectManagedJavaBinary({ releases: [] }, LINUX_X64), null);
assert.equal(selectManagedJavaBinary([], LINUX_X64), null);
assert.equal(selectManagedJavaBinary([null, 'release', 42, {}], LINUX_X64), null);
assert.equal(selectManagedJavaBinary([{ binary: buildRelease().binary }], LINUX_X64), null);
assert.equal(selectManagedJavaBinary([{ ...buildRelease(), binary: {} }], LINUX_X64), null);
assert.equal(selectManagedJavaBinary([{ ...buildRelease(), version: {} }], LINUX_X64), null);

// The selector is only worth having if the installer actually uses it: the
// managed runtime becomes the interpreter that runs Core, so this asserts the
// wiring that a null digest used to bypass.
const coreManagerSource = readFileSync(path.join(repoRoot, 'electron/core-manager.ts'), 'utf8');
const javaArchiveAsset = /const archive: DownloadAsset = \{([^}]*)\}/.exec(coreManagerSource)?.[1];

assert(javaArchiveAsset, 'The managed Java download asset was not found in core-manager.ts.');
assert(
  javaArchiveAsset.includes('digest: javaBinary.checksum'),
  'The managed Java download must be verified against the checksum Adoptium published for it.',
);
assert(
  javaArchiveAsset.includes('downloadUrl: javaBinary.downloadUrl'),
  'The managed Java download must come from the same Adoptium record as its checksum.',
);
assert(
  coreManagerSource.includes("asset.digest !== digest"),
  'downloadFile must still compare the computed digest against the expected one.',
);

console.log('Managed Java asset selection tests passed.');
