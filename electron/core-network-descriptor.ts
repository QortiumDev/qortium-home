import path from 'node:path';

export type CoreNetworkId = 'qortal' | 'qortium';
export type CoreReleaseChannel = 'prerelease' | 'stable';

export type CoreExactNameMatcher = {
  readonly caseInsensitive: boolean;
  readonly kind: 'exact';
  readonly value: string;
};

export type CorePrefixSuffixNameMatcher = {
  readonly caseInsensitive: boolean;
  readonly kind: 'prefix-suffix';
  readonly prefix: string;
  readonly suffix: string;
};

export type CoreNameMatcher = CoreExactNameMatcher | CorePrefixSuffixNameMatcher;

export type CorePeerInjectionBootstrap = {
  readonly initialDataPeers: readonly string[];
  readonly initialPeers: readonly string[];
  readonly kind: 'peer-injection';
  readonly settingsRelativePath: string;
};

export type CoreSnapshotBootstrap = {
  readonly kind: 'snapshot';
};

export type CoreNoBootstrap = {
  readonly kind: 'none';
};

export type CoreBootstrapStrategy =
  | CoreNoBootstrap
  | CorePeerInjectionBootstrap
  | CoreSnapshotBootstrap;

export type CoreFileChainIdentity = {
  readonly compatibilityHashExcludedFields: readonly string[];
  readonly fileName: string;
  readonly kind: 'file';
};

export type CoreNoChainIdentity = {
  readonly kind: 'none';
};

export type CoreChainIdentityStrategy = CoreFileChainIdentity | CoreNoChainIdentity;

export type CoreZipWithPreviewHelpersPackage = {
  readonly fallbackAssetNameMatcher: CoreNameMatcher;
  readonly jarFileName: string;
  readonly kind: 'zip-with-preview-helpers';
  readonly preferredAssetName: string;
  readonly previewDirectoryName: string;
};

export type CoreBareJarPackage = {
  readonly assetName: string;
  readonly digestPolicy: 'required';
  readonly jarFileName: string;
  readonly kind: 'bare-jar';
};

export type CorePackageStrategy = CoreBareJarPackage | CoreZipWithPreviewHelpersPackage;

export type CoreHelperScriptsLaunchStrategy = {
  readonly kind: 'helper-scripts';
  readonly startArguments: {
    readonly participant: string;
    readonly runtimeDirectoryPrefix: string;
  };
  readonly startScriptNames: {
    readonly default: string;
    readonly win32: string;
  };
  readonly stopArguments: {
    readonly runtimeDirectoryPrefix: string;
  };
  readonly stopScriptNames: {
    readonly default: string;
    readonly win32: string;
  };
};

export type CoreDirectJarLaunchStrategy = {
  readonly javaArguments: readonly string[];
  readonly kind: 'direct-jar';
};

export type CoreLaunchStrategy = CoreDirectJarLaunchStrategy | CoreHelperScriptsLaunchStrategy;

export type CoreProcessProbeDescriptor = {
  readonly apiKeyFileName: string;
  readonly apiKeyPathField: string;
  readonly apiPort: number;
  readonly fallbackSettingsFileName: string;
  readonly jarArgument: string;
  readonly jarNameMatcher: CoreNameMatcher;
  readonly missingApiKeyPathFallback: 'cwd';
  readonly openSettingsNameMatcher: CoreNameMatcher;
  readonly relativeApiKeyPathBase: 'cwd';
  readonly settingsArgumentOffsetFromJarFlag: number;
  readonly settingsRequired: boolean;
};

export type CoreNetworkDescriptor = {
  readonly bootstrap: CoreBootstrapStrategy;
  readonly chain: CoreChainIdentityStrategy;
  readonly github: {
    readonly apiRoot: string;
    readonly repository: string;
    readonly userAgent: string;
  };
  readonly id: CoreNetworkId;
  readonly label: string;
  readonly launch: CoreLaunchStrategy;
  readonly localApi: {
    readonly infoPath: string;
    readonly statusPath: string;
    readonly stopPath: string;
    readonly url: string;
  };
  readonly managedI2p: {
    readonly allowedTransportsField: string;
    readonly kind: 'runtime-settings';
  } | {
    readonly kind: 'none';
  };
  readonly package: CorePackageStrategy;
  readonly processProbe: CoreProcessProbeDescriptor;
  readonly releaseChannels: {
    readonly defaultChannel: CoreReleaseChannel;
    readonly kind: 'github-stable-and-prerelease';
    readonly matchingReleasePageSize: number;
    readonly prereleasePageSize: number;
  } | {
    readonly defaultChannel: 'stable';
    readonly kind: 'github-stable-only';
    readonly matchingReleasePageSize: number;
  };
  readonly runtimeSplit: boolean;
  readonly settings: {
    readonly fileName: string;
    readonly location: 'cwd' | 'runtime';
  };
  readonly storage: {
    readonly currentCoreFileName: string;
    readonly currentJavaFileName: string;
    readonly dataDirectoryName: string;
    readonly installDirectoryName: string;
    readonly legacyDataDirectoryName: string | null;
    readonly legacyManagedJavaDataDirectoryName: string | null;
    readonly logFileName: string;
    readonly managedJavaDataDirectoryName: string;
    readonly runtimeChainFileName: string | null;
    readonly runtimeDirectoryName: string | null;
    readonly runtimeEntryNames: readonly string[];
    readonly runtimeMigrationBlockedFileName: string | null;
    readonly runtimeOverrideEnvironmentVariable: string | null;
  };
  readonly update: {
    readonly kind: 'admin-endpoint';
    readonly path: string;
    readonly statusShape: 'qortium-v1';
  } | {
    readonly defaultEnabled: boolean;
    readonly kind: 'native-setting';
    readonly settingPath: string;
  };
};

export type CoreDescriptorPathContext = {
  readonly appDataPath: string;
  readonly runtimeOverride?: string | null;
  readonly userDataPath: string;
};

export type CoreDescriptorPaths = {
  readonly basePath: string;
  readonly currentCorePath: string;
  readonly currentJavaPath: string;
  readonly downloadsPath: string;
  readonly installPath: string;
  readonly javaBasePath: string;
  readonly javaVersionsPath: string;
  readonly legacyBasePath: string | null;
  readonly legacyCurrentCorePath: string | null;
  readonly legacyCurrentJavaPath: string | null;
  readonly legacyJavaBasePath: string | null;
  readonly runtimePath: string;
};

export const QORTIUM_CORE_DESCRIPTOR = {
  bootstrap: {
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
  },
  chain: {
    compatibilityHashExcludedFields: [
      'checkpoints',
      'featureTriggers',
      'featureTriggerScheduleEnforcementHeight',
      'onlineAccountsSignatureV2Height',
      'assetOrderBoundsHeight',
    ],
    fileName: 'previewchain.json',
    kind: 'file',
  },
  github: {
    apiRoot: 'https://api.github.com',
    repository: 'QortiumDev/qortium-core',
    userAgent: 'QortiumHome/1.0',
  },
  id: 'qortium',
  label: 'Qortium',
  launch: {
    kind: 'helper-scripts',
    startArguments: {
      participant: '--participant',
      runtimeDirectoryPrefix: '--runtime-dir=',
    },
    startScriptNames: {
      default: 'start.sh',
      win32: 'start.bat',
    },
    stopArguments: {
      runtimeDirectoryPrefix: '--runtime-dir=',
    },
    stopScriptNames: {
      default: 'stop.sh',
      win32: 'stop.bat',
    },
  },
  localApi: {
    infoPath: '/admin/info',
    statusPath: '/admin/status',
    stopPath: '/admin/stop',
    url: 'http://127.0.0.1:24891',
  },
  managedI2p: {
    allowedTransportsField: 'allowedTransports',
    kind: 'runtime-settings',
  },
  package: {
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
  },
  processProbe: {
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
  },
  releaseChannels: {
    defaultChannel: 'prerelease',
    kind: 'github-stable-and-prerelease',
    matchingReleasePageSize: 100,
    prereleasePageSize: 20,
  },
  runtimeSplit: true,
  settings: {
    fileName: 'settings-preview-local.json',
    location: 'runtime',
  },
  storage: {
    currentCoreFileName: 'current.json',
    currentJavaFileName: 'current-java.json',
    dataDirectoryName: 'qortium-core',
    installDirectoryName: 'install',
    legacyDataDirectoryName: 'managed-core',
    legacyManagedJavaDataDirectoryName: 'managed-core',
    logFileName: 'qortium.log',
    managedJavaDataDirectoryName: 'qortium-core',
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
  },
  update: {
    kind: 'admin-endpoint',
    path: '/admin/update',
    statusShape: 'qortium-v1',
  },
} as const satisfies CoreNetworkDescriptor;

export const QORTAL_CORE_DESCRIPTOR = {
  bootstrap: { kind: 'snapshot' },
  chain: { kind: 'none' },
  github: {
    apiRoot: 'https://api.github.com',
    repository: 'Qortal/qortal',
    userAgent: 'QortiumHome/1.0',
  },
  id: 'qortal',
  label: 'Qortal',
  launch: {
    javaArguments: [
      '-Djava.net.preferIPv4Stack=false',
      '-XX:MaxRAMPercentage=50',
      '-XX:+UseG1GC',
      '-Xss1024k',
    ],
    kind: 'direct-jar',
  },
  localApi: {
    infoPath: '/admin/info',
    statusPath: '/admin/status',
    stopPath: '/admin/stop',
    url: 'http://127.0.0.1:12391',
  },
  managedI2p: { kind: 'none' },
  package: {
    assetName: 'qortal.jar',
    digestPolicy: 'required',
    jarFileName: 'qortal.jar',
    kind: 'bare-jar',
  },
  processProbe: {
    apiKeyFileName: 'apikey.txt',
    apiKeyPathField: 'apiKeyPath',
    apiPort: 12391,
    fallbackSettingsFileName: 'settings.json',
    jarArgument: '-jar',
    jarNameMatcher: {
      caseInsensitive: true,
      kind: 'exact',
      value: 'qortal.jar',
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
    settingsRequired: false,
  },
  releaseChannels: {
    defaultChannel: 'stable',
    kind: 'github-stable-only',
    matchingReleasePageSize: 100,
  },
  runtimeSplit: false,
  settings: {
    fileName: 'settings.json',
    location: 'cwd',
  },
  storage: {
    currentCoreFileName: 'current.json',
    currentJavaFileName: 'current-java.json',
    dataDirectoryName: 'qortal-core',
    installDirectoryName: 'install',
    legacyDataDirectoryName: null,
    legacyManagedJavaDataDirectoryName: 'managed-core',
    logFileName: 'qortal.log',
    managedJavaDataDirectoryName: 'qortium-core',
    runtimeChainFileName: null,
    runtimeDirectoryName: null,
    runtimeEntryNames: [],
    runtimeMigrationBlockedFileName: null,
    runtimeOverrideEnvironmentVariable: null,
  },
  update: {
    defaultEnabled: true,
    kind: 'native-setting',
    settingPath: '/admin/settings/autoUpdateEnabled',
  },
} as const satisfies CoreNetworkDescriptor;

function normalizeForMatch(value: string, caseInsensitive: boolean) {
  return caseInsensitive ? value.toLowerCase() : value;
}

export function matchesCoreName(matcher: CoreNameMatcher, value: string) {
  const candidate = normalizeForMatch(value, matcher.caseInsensitive);

  if (matcher.kind === 'exact') {
    return candidate === normalizeForMatch(matcher.value, matcher.caseInsensitive);
  }

  const prefix = normalizeForMatch(matcher.prefix, matcher.caseInsensitive);
  const suffix = normalizeForMatch(matcher.suffix, matcher.caseInsensitive);

  return candidate.startsWith(prefix) && candidate.endsWith(suffix);
}

export function matchesCoreJarName(descriptor: CoreNetworkDescriptor, value: string) {
  return matchesCoreName(descriptor.processProbe.jarNameMatcher, path.basename(value));
}

export function matchesCoreSettingsName(descriptor: CoreNetworkDescriptor, value: string) {
  return matchesCoreName(descriptor.processProbe.openSettingsNameMatcher, path.basename(value));
}

export function resolveCoreProcessPaths(
  descriptor: CoreNetworkDescriptor,
  args: readonly string[],
  cwd: string,
) {
  const jarArgumentIndex = args.findIndex((argument) => argument === descriptor.processProbe.jarArgument);

  if (jarArgumentIndex < 0) {
    return null;
  }

  const jarPath = args[jarArgumentIndex + 1] ?? '';
  const settingsPath = args[
    jarArgumentIndex + descriptor.processProbe.settingsArgumentOffsetFromJarFlag
  ] ?? '';

  if (!jarPath || !matchesCoreJarName(descriptor, jarPath)) {
    return null;
  }

  if (descriptor.processProbe.settingsRequired && !settingsPath) {
    return null;
  }

  const resolvedJarPath = path.isAbsolute(jarPath) ? jarPath : path.resolve(cwd, jarPath);
  const resolvedSettingsPath = settingsPath
    ? path.isAbsolute(settingsPath)
      ? settingsPath
      : path.resolve(cwd, settingsPath)
    : path.join(cwd, descriptor.settings.fileName);

  return {
    jarPath: resolvedJarPath,
    settingsPath: resolvedSettingsPath,
  };
}

export function resolveCoreApiKeyDirectory(
  descriptor: CoreNetworkDescriptor,
  settings: unknown,
  cwd: string,
) {
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    const apiKeyPath = (settings as Record<string, unknown>)[descriptor.processProbe.apiKeyPathField];

    if (typeof apiKeyPath === 'string' && apiKeyPath.trim()) {
      return path.isAbsolute(apiKeyPath) ? apiKeyPath : path.resolve(cwd, apiKeyPath);
    }
  }

  return cwd;
}

export function getCoreApiKeyPath(descriptor: CoreNetworkDescriptor, directory: string) {
  return path.join(directory, descriptor.processProbe.apiKeyFileName);
}

export function getCoreFallbackSettingsPath(
  descriptor: CoreNetworkDescriptor,
  jarPath: string,
  cwd = path.dirname(jarPath),
) {
  const basePath = descriptor.settings.location === 'cwd' ? cwd : path.dirname(jarPath);

  return path.join(basePath, descriptor.processProbe.fallbackSettingsFileName);
}

export function getCoreSettingsPath(
  descriptor: CoreNetworkDescriptor,
  paths: Pick<CoreDescriptorPaths, 'installPath' | 'runtimePath'>,
) {
  return path.join(
    descriptor.settings.location === 'runtime' ? paths.runtimePath : paths.installPath,
    descriptor.settings.fileName,
  );
}

export function getCoreLsofPidArgs(descriptor: CoreNetworkDescriptor) {
  return ['-nP', `-iTCP:${descriptor.processProbe.apiPort}`, '-sTCP:LISTEN', '-t'];
}

export function resolveCoreDescriptorPaths(
  descriptor: CoreNetworkDescriptor,
  context: CoreDescriptorPathContext,
): CoreDescriptorPaths {
  const basePath = path.join(context.appDataPath, descriptor.storage.dataDirectoryName);
  const legacyBasePath = descriptor.storage.legacyDataDirectoryName
    ? path.join(context.userDataPath, descriptor.storage.legacyDataDirectoryName)
    : null;
  const javaBasePath = path.join(
    context.appDataPath,
    descriptor.storage.managedJavaDataDirectoryName,
    'java',
  );
  const legacyJavaBasePath = descriptor.storage.legacyManagedJavaDataDirectoryName
    ? path.join(context.userDataPath, descriptor.storage.legacyManagedJavaDataDirectoryName, 'java')
    : null;
  const runtimeOverride = context.runtimeOverride?.trim();
  const installPath = path.join(basePath, descriptor.storage.installDirectoryName);

  return {
    basePath,
    currentCorePath: path.join(basePath, descriptor.storage.currentCoreFileName),
    currentJavaPath: path.join(javaBasePath, descriptor.storage.currentJavaFileName),
    downloadsPath: path.join(basePath, 'downloads'),
    installPath,
    javaBasePath,
    javaVersionsPath: path.join(javaBasePath, 'versions'),
    legacyBasePath,
    legacyCurrentCorePath: legacyBasePath
      ? path.join(legacyBasePath, descriptor.storage.currentCoreFileName)
      : null,
    legacyCurrentJavaPath: legacyJavaBasePath
      ? path.join(legacyJavaBasePath, descriptor.storage.currentJavaFileName)
      : null,
    legacyJavaBasePath,
    runtimePath: descriptor.runtimeSplit && runtimeOverride
      ? path.resolve(runtimeOverride)
      : descriptor.runtimeSplit && descriptor.storage.runtimeDirectoryName
        ? path.join(basePath, descriptor.storage.runtimeDirectoryName)
        : installPath,
  };
}

export function getCoreGithubApiBaseUrl(descriptor: CoreNetworkDescriptor) {
  return `${descriptor.github.apiRoot.replace(/\/+$/, '')}/repos/${descriptor.github.repository}`;
}

export function getCoreGithubCommitUrl(descriptor: CoreNetworkDescriptor, tagName: string) {
  return `${getCoreGithubApiBaseUrl(descriptor)}/commits/${encodeURIComponent(tagName)}`;
}

export function getCoreGithubLatestReleaseUrl(descriptor: CoreNetworkDescriptor) {
  return `${getCoreGithubApiBaseUrl(descriptor)}/releases/latest`;
}

export function getCoreGithubReleasesUrl(descriptor: CoreNetworkDescriptor, perPage: number) {
  return `${getCoreGithubApiBaseUrl(descriptor)}/releases?per_page=${perPage}`;
}

export function getCoreGithubTaggedReleaseUrl(descriptor: CoreNetworkDescriptor, tagName: string) {
  return `${getCoreGithubApiBaseUrl(descriptor)}/releases/tags/${encodeURIComponent(tagName)}`;
}

function assertHelperScriptsLaunch(
  descriptor: CoreNetworkDescriptor,
): CoreHelperScriptsLaunchStrategy {
  if (descriptor.launch.kind !== 'helper-scripts') {
    throw new Error(`${descriptor.label} Core does not use helper scripts.`);
  }

  return descriptor.launch;
}

function assertDirectJarLaunch(descriptor: CoreNetworkDescriptor): CoreDirectJarLaunchStrategy {
  if (descriptor.launch.kind !== 'direct-jar') {
    throw new Error(`${descriptor.label} Core does not use direct JAR launch.`);
  }

  return descriptor.launch;
}

export function getCoreDirectJarArguments(
  descriptor: CoreNetworkDescriptor,
  jarPath: string,
  settingsPath: string,
) {
  const launch = assertDirectJarLaunch(descriptor);

  return [...launch.javaArguments, descriptor.processProbe.jarArgument, jarPath, settingsPath];
}

export function getCoreHelperScriptPaths(
  descriptor: CoreNetworkDescriptor,
  previewPath: string,
  platform: NodeJS.Platform,
) {
  const launch = assertHelperScriptsLaunch(descriptor);

  return {
    startScriptPath: path.join(
      previewPath,
      platform === 'win32' ? launch.startScriptNames.win32 : launch.startScriptNames.default,
    ),
    stopScriptPath: path.join(
      previewPath,
      platform === 'win32' ? launch.stopScriptNames.win32 : launch.stopScriptNames.default,
    ),
  };
}

export function getCoreHelperStartArguments(
  descriptor: CoreNetworkDescriptor,
  runtimePath: string,
) {
  const launch = assertHelperScriptsLaunch(descriptor);

  return [launch.startArguments.participant, `${launch.startArguments.runtimeDirectoryPrefix}${runtimePath}`];
}

export function getCoreHelperStopArguments(
  descriptor: CoreNetworkDescriptor,
  runtimePath: string,
) {
  const launch = assertHelperScriptsLaunch(descriptor);

  return [`${launch.stopArguments.runtimeDirectoryPrefix}${runtimePath}`];
}
