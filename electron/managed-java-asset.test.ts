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
const verifiedDownloadSource = readFileSync(
  path.join(repoRoot, 'electron/core-verified-download.ts'),
  'utf8',
);
const javaArchiveAsset = /const archive: DownloadAsset = \{([^}]*)\}/.exec(coreManagerSource)?.[1];
const rendererInstallRequest = /type CoreInstallRequest = \{([\s\S]*?)\n};/
  .exec(coreManagerSource)?.[1];

assert(javaArchiveAsset, 'The managed Java download asset was not found in core-manager.ts.');
assert(rendererInstallRequest, 'The renderer-reachable Core install request was not found.');
assert.doesNotMatch(
  rendererInstallRequest,
  /activationLease|preDownloadGuard|skipCompletionStatus|skipLayoutMigration/,
  'Automatic-only controls must not be forgeable through the legacy Core install IPC request.',
);
assert.match(
  coreManagerSource,
  /async function installCoreAutomaticallyForHomeV2[\s\S]{0,500}skipCompletionStatus: true[\s\S]{0,120}skipLayoutMigration: true/,
  'Only the dedicated internal automatic Core method may enable the migration/status bypasses.',
);
assert.match(
  coreManagerSource,
  /async function installCore\(request: CoreInstallRequest\)[\s\S]{0,500}const allowlistedRequest: CoreInstallRequest[\s\S]{0,500}installCoreUnlocked\(allowlistedRequest\)/,
  'Legacy Core install requests must be reconstructed before entering the internal installer.',
);
assert(
  javaArchiveAsset.includes('digest: javaBinary.checksum'),
  'The managed Java download must be verified against the checksum Adoptium published for it.',
);
assert.match(
  coreManagerSource,
  /sameManagedJavaGeneration\(current, expected\)/,
  'Managed Java refreshes must compare the captured and current generation before publishing metadata.',
);
assert.match(
  coreManagerSource,
  /javaStatus\.majorVersion !== MANAGED_JAVA_TARGET_MAJOR_VERSION/,
  'Managed Java activation must require the exact managed target major version.',
);
assert.match(
  coreManagerSource,
  /!isNewerJavaVersion\(javaStatus\.version, currentGeneration\.version\)/,
  'Managed Java updates must refuse an equal or older fetched runtime.',
);
assert.match(
  coreManagerSource,
  /sameManagedJavaGeneration\(currentGeneration, expectedGeneration\)/,
  'Managed Java activation must revalidate the selected generation after download.',
);
assert.doesNotMatch(
  coreManagerSource,
  /rm\(previousJava\.installPath/,
  'Installing managed Java must not remove the generation another Core may still be using.',
);
assert.match(
  coreManagerSource,
  /runManagedJavaInstall[\s\S]{0,180}installJavaUnlocked/,
  'Managed Java installation must be single-flighted.',
);
assert.match(
  coreManagerSource,
  /options\.preDownloadGuard\?\.\(\)[\s\S]{0,180}downloadFile\(archive, downloadPath, 'Java runtime'\)/,
  'Automatic Java policy must be revalidated before the archive download begins.',
);
assert.match(
  coreManagerSource,
  /releaseActivation = \(await options\.activationLease\?\.\(\)\)[\s\S]{0,900}rename\(stagingPath, finalPath\)/,
  'Automatic Java policy must be revocable immediately before immutable-generation activation.',
);
assert.match(
  coreManagerSource,
  /request\.preDownloadGuard\?\.\(\)[\s\S]{0,180}downloadFile\(release\.asset, downloadPath\)/,
  'Automatic Core policy must be revalidated before the archive download begins.',
);
assert.match(
  coreManagerSource,
  /releaseActivation = \(await request\.activationLease\?\.\(\)\)[\s\S]{0,700}ensureRuntimeChainCompatible\(getCoreRuntimePath\(\)/,
  'Automatic Core activation must hold its operation lease before mutating shared runtime state.',
);
assert.match(
  coreManagerSource,
  /startForHomeV2:[\s\S]{0,220}upgradeJava: false/,
  'Home 2 lifecycle starts must not invoke the legacy Java update policy.',
);
const automaticStatusStart = coreManagerSource.indexOf('async function getAutomaticUpdateStatusForHomeV2');
const automaticStatusEnd = coreManagerSource.indexOf('\nfunction normalizeInstallRequest', automaticStatusStart);
const automaticStatusSource = automaticStatusStart >= 0 && automaticStatusEnd > automaticStatusStart
  ? coreManagerSource.slice(automaticStatusStart, automaticStatusEnd)
  : null;
assert(automaticStatusSource, 'The Home 2 automatic update status seam was not found.');
assert.doesNotMatch(
  automaticStatusSource,
  /ensureCoreLayout|getStatus\(|readInstalledCoreMetadata\(/,
  'Automatic discovery must not enter Core layout migration or mutable status reconciliation.',
);
assert.match(
  automaticStatusSource,
  /readInstalledCoreMetadataForHomeV2UpdateDiscovery/,
  'Automatic discovery must use the read-only installed-Core metadata seam.',
);
assert.match(
  coreManagerSource,
  /const existingCore = request\.skipLayoutMigration[\s\S]{0,180}readInstalledCoreMetadataForHomeV2UpdateDiscovery/,
  'Automatic Core installation must not reconcile mutable installed metadata before its activation lease.',
);
assert.match(
  coreManagerSource,
  /if \(!request\.skipLayoutMigration\) await ensureCoreLayout\(\)/,
  'Automatic Core installation must be able to bypass lifecycle-capable layout migration.',
);
assert.match(
  coreManagerSource,
  /if \(!options\.skipLayoutMigration\) await ensureCoreLayout\(\)/,
  'Automatic Java installation must be able to bypass lifecycle-capable layout migration.',
);
assert(
  javaArchiveAsset.includes('downloadUrl: javaBinary.downloadUrl'),
  'The managed Java download must come from the same Adoptium record as its checksum.',
);
assert(
  coreManagerSource.includes('downloadVerifiedCoreAsset') &&
    verifiedDownloadSource.includes('digest !== input.asset.digest') &&
    verifiedDownloadSource.includes('receivedBytes !== input.asset.size'),
  'downloadFile must compare both the computed digest and exact byte count against the expected asset.',
);

console.log('Managed Java asset selection tests passed.');
