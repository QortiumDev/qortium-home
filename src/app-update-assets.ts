export type AppUpdateAssetPlatform = {
  arch: string;
  os: string;
  osVersion?: string;
};

type NamedAsset = {
  name: string;
};

type MacOsVersion = {
  major: number;
  minor: number;
};

function parseMacOsVersion(value: string | undefined): MacOsVersion | null {
  if (!value?.trim()) {
    return null;
  }

  const normalizedValue = value.trim();

  if (!/^\d+(?:\.\d+){0,2}$/.test(normalizedValue)) {
    return null;
  }

  const parts = normalizedValue.split('.');
  const major = Number.parseInt(parts[0] ?? '', 10);
  const minor = Number.parseInt(parts[1] ?? '0', 10);

  if (!Number.isInteger(major) || major < 1 || !Number.isInteger(minor) || minor < 0) {
    return null;
  }

  return { major, minor };
}

function matchesArchitecture(assetName: string, architecture: string) {
  const normalizedArch = architecture.toLowerCase();

  if (normalizedArch === 'x64') {
    return /(?:x64|x86_64|amd64)/.test(assetName);
  }

  if (normalizedArch === 'arm64') {
    return /(?:arm64|aarch64)/.test(assetName);
  }

  return false;
}

function getMacOsAssetPriority(assetName: string, platform: AppUpdateAssetPlatform) {
  const version = parseMacOsVersion(platform.osVersion);
  const isMacOs11Compatibility = assetName.includes('macos11') && assetName.includes('universal');
  const isMacOs1015Compatibility = assetName.includes('macos1015') && matchesArchitecture(assetName, 'x64');
  const isCompatibilityAsset = isMacOs11Compatibility || isMacOs1015Compatibility;
  const isStandardUniversal = assetName.includes('universal') && !isCompatibilityAsset;
  const isStandardArchitecture = !isCompatibilityAsset && matchesArchitecture(assetName, platform.arch);

  // Browser-mode fallback cannot reliably recover the host macOS version from
  // its reduced user agent. Prefer the current universal package instead of
  // guessing that a compatibility build is required.
  if (!version) {
    return isStandardUniversal ? 50 : isStandardArchitecture ? 40 : 0;
  }

  if (version.major >= 12) {
    return isStandardUniversal ? 50 : isStandardArchitecture ? 40 : 0;
  }

  if (version.major === 11) {
    return isMacOs11Compatibility ? 50 : 0;
  }

  if (version.major === 10 && version.minor >= 15 && platform.arch.toLowerCase() === 'x64') {
    return isMacOs1015Compatibility ? 50 : 0;
  }

  return 0;
}

export function getUpdateAssetPriority(assetName: string, platform: AppUpdateAssetPlatform) {
  const normalizedName = assetName.trim().toLowerCase();
  const normalizedArch = platform.arch.toLowerCase();

  if (platform.os === 'android') {
    if (!normalizedName.endsWith('.apk') || normalizedName.includes('-unsigned')) {
      return 0;
    }

    return normalizedName.includes('android-release') ? 20 : 10;
  }

  if (platform.os === 'linux' && normalizedName.endsWith('.appimage')) {
    return matchesArchitecture(normalizedName, normalizedArch) ? 30 : 0;
  }

  if (platform.os === 'macos' && normalizedName.endsWith('.dmg')) {
    return getMacOsAssetPriority(normalizedName, platform);
  }

  if (platform.os === 'windows' && normalizedName.endsWith('.exe')) {
    return matchesArchitecture(normalizedName, normalizedArch) ? 30 : 0;
  }

  return 0;
}

export function selectCompatibleUpdateAsset<T extends NamedAsset>(assets: readonly T[], platform: AppUpdateAssetPlatform) {
  const candidates = assets
    .map((asset, index) => ({
      asset,
      index,
      priority: getUpdateAssetPriority(asset.name, platform),
    }))
    .filter((candidate) => candidate.priority > 0)
    .sort((first, second) => second.priority - first.priority || first.index - second.index);

  return candidates[0]?.asset ?? null;
}
