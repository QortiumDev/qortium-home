import assert from 'node:assert/strict';
import path from 'node:path';
import {
  QORTIUM_CORE_DESCRIPTOR,
  getCoreApiKeyPath,
  getCoreFallbackSettingsPath,
  getCoreGithubApiBaseUrl,
  getCoreGithubCommitUrl,
  getCoreGithubLatestReleaseUrl,
  getCoreGithubReleasesUrl,
  getCoreGithubTaggedReleaseUrl,
  getCoreHelperScriptPaths,
  getCoreHelperStartArguments,
  getCoreHelperStopArguments,
  getCoreLsofPidArgs,
  matchesCoreName,
  matchesCoreJarName,
  matchesCoreSettingsName,
  resolveCoreApiKeyDirectory,
  resolveCoreDescriptorPaths,
  resolveCoreProcessPaths,
} from './core-network-descriptor.js';

const descriptor = QORTIUM_CORE_DESCRIPTOR;

assert.equal(descriptor.id, 'qortium');
assert.equal(descriptor.label, 'Qortium');
assert.deepEqual(descriptor.github, {
  apiRoot: 'https://api.github.com',
  repository: 'QortiumDev/qortium-core',
  userAgent: 'QortiumHome/1.0',
});
assert.deepEqual(descriptor.localApi, {
  infoPath: '/admin/info',
  statusPath: '/admin/status',
  stopPath: '/admin/stop',
  updatePath: '/admin/update',
  url: 'http://127.0.0.1:24891',
});
assert.deepEqual(descriptor.releaseChannels, {
  defaultChannel: 'prerelease',
  kind: 'github-stable-and-prerelease',
  matchingReleasePageSize: 100,
  prereleasePageSize: 20,
});
assert.deepEqual(descriptor.package, {
  fallbackAssetNameMatcher: {
    caseInsensitive: true,
    kind: 'prefix-suffix',
    prefix: 'qortium',
    suffix: '.zip',
  },
  jarFileName: 'qortium.jar',
  kind: 'zip-with-preview-helpers',
  preferredAssetName: 'qortium-preview.zip',
  previewDirectoryName: 'preview',
});
assert.deepEqual(descriptor.chain, {
  compatibilityHashExcludedFields: [
    'checkpoints',
    'featureTriggers',
    'featureTriggerScheduleEnforcementHeight',
    'onlineAccountsSignatureV2Height',
    'assetOrderBoundsHeight',
  ],
  fileName: 'previewchain.json',
  kind: 'file',
});
assert.deepEqual(descriptor.bootstrap, {
  initialDataPeers: [
    '146.103.42.59:24894',
    '185.207.104.78:24894',
    '80.241.221.139:24894',
    'qhk6g5hl7vqf5fmlgj6knbajtiszotaf2w26fwjapsr75kbz7fma.b32.i2p',
    'hg3seiuul4pcz6a2svatdahzudphbm464vwqcmiejc77kumglwaq.b32.i2p',
  ],
  initialPeers: [
    '146.103.42.59:24892',
    '185.207.104.78:24892',
    '80.241.221.139:24892',
    '3u25ana5e5hvriqqiuh6fcetxezsqm7la276ljtjxaoxt767n4hq.b32.i2p',
    'zqcackxkhjzfbbc6daigc73zqhzdpgwua3mjc7xgn3hwjed5z3ca.b32.i2p',
  ],
  kind: 'peer-injection',
  settingsRelativePath: path.join('preview', 'settings-preview.json'),
});
assert.equal(descriptor.runtimeSplit, true);
assert.deepEqual(descriptor.settings, {
  fileName: 'settings-preview-local.json',
  location: 'runtime',
});
assert.deepEqual(descriptor.managedI2p, {
  allowedTransportsField: 'allowedTransports',
  kind: 'runtime-settings',
});
assert.equal(descriptor.onChainUpdateStatusShape, 'qortium-v1');
assert.deepEqual(descriptor.storage, {
  currentCoreFileName: 'current.json',
  currentJavaFileName: 'current-java.json',
  dataDirectoryName: 'qortium-core',
  installDirectoryName: 'install',
  legacyDataDirectoryName: 'managed-core',
  logFileName: 'qortium.log',
  runtimeChainFileName: 'runtime-chain.json',
  runtimeDirectoryName: 'runtime',
  runtimeEntryNames: [
    'apikey.txt',
    'db-preview',
    'data-preview',
    'i2p',
    'lists',
    'qortium-backup-preview',
    'qortal-backup-preview',
    'qortium.log',
    'run-error.log',
    'run.log',
    'run.pid',
    'settings-preview-local.json',
    'settings-preview-seed-local.json',
    'settings-preview-seed-netcup-local.json',
  ],
  runtimeMigrationBlockedFileName: 'runtime-migration-blocked.json',
  runtimeOverrideEnvironmentVariable: 'QORTIUM_HOME_CORE_RUNTIME_DIR',
});
assert.deepEqual(descriptor.processProbe, {
  apiKeyFileName: 'apikey.txt',
  apiKeyPathField: 'apiKeyPath',
  apiPort: 24891,
  fallbackSettingsFileName: 'settings.json',
  jarArgument: '-jar',
  jarNameMatcher: {
    caseInsensitive: true,
    kind: 'prefix-suffix',
    prefix: 'qortium',
    suffix: '.jar',
  },
  missingApiKeyPathFallback: 'cwd',
  openSettingsNameMatcher: {
    caseInsensitive: true,
    kind: 'prefix-suffix',
    prefix: 'settings',
    suffix: '.json',
  },
  relativeApiKeyPathBase: 'cwd',
  settingsArgumentOffsetFromJarFlag: 2,
  settingsRequired: true,
});

assert.equal(matchesCoreJarName(descriptor, 'qortium.jar'), true);
assert.equal(
  matchesCoreName(
    { caseInsensitive: true, kind: 'exact', value: 'qortal.jar' },
    'QORTAL.JAR',
  ),
  true,
);
assert.equal(
  matchesCoreName(
    { caseInsensitive: false, kind: 'exact', value: 'qortal.jar' },
    'QORTAL.JAR',
  ),
  false,
);
assert.equal(matchesCoreJarName(descriptor, 'QORTIUM-preview.jar'), true);
assert.equal(matchesCoreJarName(descriptor, '/opt/core/qortium-test.JAR'), true);
assert.equal(matchesCoreJarName(descriptor, 'qortal.jar'), false);
assert.equal(matchesCoreJarName(descriptor, 'qortium.zip'), false);
assert.equal(matchesCoreSettingsName(descriptor, 'settings.json'), true);
assert.equal(matchesCoreSettingsName(descriptor, 'settings-preview-local.JSON'), true);
assert.equal(matchesCoreSettingsName(descriptor, 'other-settings.json'), false);

assert.deepEqual(
  resolveCoreProcessPaths(
    descriptor,
    ['java', '-Xmx8g', '-jar', './qortium-preview.jar', './settings-preview-local.json'],
    '/srv/qortium',
  ),
  {
    jarPath: path.resolve('/srv/qortium/qortium-preview.jar'),
    settingsPath: path.resolve('/srv/qortium/settings-preview-local.json'),
  },
);
assert.equal(
  resolveCoreProcessPaths(descriptor, ['java', '-jar', './qortal.jar', './settings.json'], '/srv/qortal'),
  null,
);
assert.equal(
  resolveCoreProcessPaths(descriptor, ['java', '-jar', './qortium.jar'], '/srv/qortium'),
  null,
);
assert.deepEqual(getCoreLsofPidArgs(descriptor), [
  '-nP',
  '-iTCP:24891',
  '-sTCP:LISTEN',
  '-t',
]);
assert.equal(getCoreFallbackSettingsPath(descriptor, '/srv/qortium/qortium.jar'), '/srv/qortium/settings.json');
assert.equal(getCoreApiKeyPath(descriptor, '/srv/qortium/runtime'), '/srv/qortium/runtime/apikey.txt');
assert.equal(
  resolveCoreApiKeyDirectory(descriptor, { apiKeyPath: './runtime' }, '/srv/qortium'),
  path.resolve('/srv/qortium/runtime'),
);
assert.equal(
  resolveCoreApiKeyDirectory(descriptor, { apiKeyPath: '/var/lib/qortium' }, '/srv/qortium'),
  '/var/lib/qortium',
);
assert.equal(resolveCoreApiKeyDirectory(descriptor, {}, '/srv/qortium'), '/srv/qortium');

const paths = resolveCoreDescriptorPaths(descriptor, {
  appDataPath: '/home/alice/.config',
  userDataPath: '/home/alice/.config/Qortium Home',
});
assert.deepEqual(paths, {
  basePath: '/home/alice/.config/qortium-core',
  currentCorePath: '/home/alice/.config/qortium-core/current.json',
  currentJavaPath: '/home/alice/.config/qortium-core/java/current-java.json',
  downloadsPath: '/home/alice/.config/qortium-core/downloads',
  installPath: '/home/alice/.config/qortium-core/install',
  javaBasePath: '/home/alice/.config/qortium-core/java',
  javaVersionsPath: '/home/alice/.config/qortium-core/java/versions',
  legacyBasePath: '/home/alice/.config/Qortium Home/managed-core',
  legacyCurrentCorePath: '/home/alice/.config/Qortium Home/managed-core/current.json',
  legacyCurrentJavaPath: '/home/alice/.config/Qortium Home/managed-core/java/current-java.json',
  legacyJavaBasePath: '/home/alice/.config/Qortium Home/managed-core/java',
  runtimePath: '/home/alice/.config/qortium-core/runtime',
});
assert.equal(
  resolveCoreDescriptorPaths(descriptor, {
    appDataPath: '/home/alice/.config',
    runtimeOverride: ' /srv/qortium-runtime ',
    userDataPath: '/home/alice/.config/Qortium Home',
  }).runtimePath,
  '/srv/qortium-runtime',
);

assert.equal(getCoreGithubApiBaseUrl(descriptor), 'https://api.github.com/repos/QortiumDev/qortium-core');
assert.equal(
  getCoreGithubCommitUrl(descriptor, 'v1.2.3 preview'),
  'https://api.github.com/repos/QortiumDev/qortium-core/commits/v1.2.3%20preview',
);
assert.equal(
  getCoreGithubLatestReleaseUrl(descriptor),
  'https://api.github.com/repos/QortiumDev/qortium-core/releases/latest',
);
assert.equal(
  getCoreGithubReleasesUrl(descriptor, descriptor.releaseChannels.prereleasePageSize),
  'https://api.github.com/repos/QortiumDev/qortium-core/releases?per_page=20',
);
assert.equal(
  getCoreGithubReleasesUrl(descriptor, descriptor.releaseChannels.matchingReleasePageSize),
  'https://api.github.com/repos/QortiumDev/qortium-core/releases?per_page=100',
);
assert.equal(
  getCoreGithubTaggedReleaseUrl(descriptor, 'v1.2.3 preview'),
  'https://api.github.com/repos/QortiumDev/qortium-core/releases/tags/v1.2.3%20preview',
);

assert.deepEqual(getCoreHelperScriptPaths(descriptor, '/opt/qortium/preview', 'linux'), {
  startScriptPath: '/opt/qortium/preview/start.sh',
  stopScriptPath: '/opt/qortium/preview/stop.sh',
});
assert.deepEqual(getCoreHelperScriptPaths(descriptor, 'C:\\Qortium\\preview', 'win32'), {
  startScriptPath: path.join('C:\\Qortium\\preview', 'start.bat'),
  stopScriptPath: path.join('C:\\Qortium\\preview', 'stop.bat'),
});
assert.deepEqual(getCoreHelperStartArguments(descriptor, '/srv/qortium/runtime'), [
  '--participant',
  '--runtime-dir=/srv/qortium/runtime',
]);
assert.deepEqual(getCoreHelperStopArguments(descriptor, '/srv/qortium/runtime'), [
  '--runtime-dir=/srv/qortium/runtime',
]);

console.log('Core network descriptor Qortium parity tests passed.');
