import { t, type TranslationKey } from './i18n';

const HOME_REPOSITORY = 'QortiumDev/qortium-home';
const GITHUB_API_BASE_URL = `https://api.github.com/repos/${HOME_REPOSITORY}`;
const GITHUB_ACCEPT_HEADER = 'application/vnd.github+json';

export const UPDATE_CHANNEL_LABEL_KEYS: Record<QortiumAppUpdateChannel, TranslationKey> = {
  prerelease: 'updates.channelPrerelease',
  stable: 'updates.channelStable',
};

type GithubAsset = {
  browser_download_url?: unknown;
  digest?: unknown;
  name?: unknown;
  size?: unknown;
};

type GithubRelease = {
  assets?: unknown;
  draft?: unknown;
  html_url?: unknown;
  name?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  tag_name?: unknown;
};

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<number | string>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : false;
}

async function fetchGithubJson<T>(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: GITHUB_ACCEPT_HEADER,
    },
  });
  const text = await response.text();

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(text || t('updates.githubRequestFailed', { status: response.status }));
  }

  return text ? (JSON.parse(text) as T) : null;
}

function normalizeGithubRelease(value: unknown): GithubRelease | null {
  return isObject(value) ? value : null;
}

function releaseToSummary(channel: QortiumAppUpdateChannel, release: GithubRelease): QortiumAppUpdateRelease | null {
  if (release.draft === true) {
    return null;
  }

  const tagName = getString(release.tag_name);
  const htmlUrl = getString(release.html_url);

  if (!tagName || !htmlUrl) {
    return null;
  }

  return {
    channel,
    tagName,
    htmlUrl,
    name: getString(release.name) || tagName,
    prerelease: getBoolean(release.prerelease),
    publishedAt: getString(release.published_at),
  };
}

function normalizeAsset(value: GithubAsset): QortiumAppUpdateAsset | null {
  const name = getString(value.name);
  const downloadUrl = getString(value.browser_download_url);

  if (!name || !downloadUrl) {
    return null;
  }

  return {
    name,
    downloadUrl,
    digest: getString(value.digest) || null,
    size: getNumber(value.size),
  };
}

function getAssetPriority(assetName: string, platform: QortiumAppUpdatePlatform) {
  const normalizedName = assetName.toLowerCase();
  const normalizedArch = platform.arch.toLowerCase();

  if (platform.os === 'android') {
    if (!normalizedName.endsWith('.apk') || normalizedName.includes('-unsigned')) {
      return 0;
    }

    return normalizedName.includes('android-release') ? 20 : 10;
  }

  if (platform.os === 'linux' && normalizedName.endsWith('.appimage')) {
    if (normalizedArch === 'x64' && /(?:x64|x86_64|amd64)/.test(normalizedName)) {
      return 30;
    }

    if (normalizedArch === 'arm64' && /(?:arm64|aarch64)/.test(normalizedName)) {
      return 30;
    }
  }

  if (platform.os === 'macos' && normalizedName.endsWith('.dmg')) {
    if (normalizedName.includes('universal')) {
      return 20;
    }

    if (normalizedArch === 'x64' && /(?:x64|x86_64|amd64)/.test(normalizedName)) {
      return 30;
    }

    if (normalizedArch === 'arm64' && /(?:arm64|aarch64)/.test(normalizedName)) {
      return 30;
    }
  }

  if (platform.os === 'windows' && normalizedName.endsWith('.exe')) {
    if (normalizedArch === 'x64' && /(?:x64|x86_64|amd64)/.test(normalizedName)) {
      return 30;
    }
  }

  return 0;
}

function selectCompatibleAsset(
  release: GithubRelease,
  platform: QortiumAppUpdatePlatform,
): QortiumAppUpdateAsset | null {
  if (!Array.isArray(release.assets)) {
    return null;
  }

  const candidates = release.assets
    .filter(isObject)
    .map((asset) => ({
      asset: normalizeAsset(asset as GithubAsset),
      priority: getAssetPriority(getString((asset as GithubAsset).name), platform),
    }))
    .filter((candidate): candidate is { asset: QortiumAppUpdateAsset; priority: number } =>
      !!candidate.asset && candidate.priority > 0,
    )
    .sort((first, second) => second.priority - first.priority);

  return candidates[0]?.asset ?? null;
}

function parseVersion(value: string): ParsedVersion | null {
  const normalizedValue = value.trim().replace(/^v/i, '').split('+')[0];
  const versionMatch = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(normalizedValue);

  if (!versionMatch) {
    return null;
  }

  return {
    major: Number.parseInt(versionMatch[1], 10),
    minor: Number.parseInt(versionMatch[2], 10),
    patch: Number.parseInt(versionMatch[3], 10),
    prerelease: versionMatch[4]
      ? versionMatch[4].split('.').map((part) => (/^\d+$/.test(part) ? Number.parseInt(part, 10) : part))
      : [],
  };
}

function compareIdentifiers(first: number | string, second: number | string) {
  if (typeof first === 'number' && typeof second === 'number') {
    return Math.sign(first - second);
  }

  if (typeof first === 'number') {
    return -1;
  }

  if (typeof second === 'number') {
    return 1;
  }

  return Math.sign(first.localeCompare(second));
}

export function compareAppVersions(firstValue: string, secondValue: string) {
  const first = parseVersion(firstValue);
  const second = parseVersion(secondValue);

  if (!first || !second) {
    return null;
  }

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (first[key] !== second[key]) {
      return Math.sign(first[key] - second[key]);
    }
  }

  if (first.prerelease.length === 0 && second.prerelease.length === 0) {
    return 0;
  }

  if (first.prerelease.length === 0) {
    return 1;
  }

  if (second.prerelease.length === 0) {
    return -1;
  }

  const identifierCount = Math.max(first.prerelease.length, second.prerelease.length);

  for (let index = 0; index < identifierCount; index += 1) {
    const firstIdentifier = first.prerelease[index];
    const secondIdentifier = second.prerelease[index];

    if (firstIdentifier === undefined) {
      return -1;
    }

    if (secondIdentifier === undefined) {
      return 1;
    }

    const comparison = compareIdentifiers(firstIdentifier, secondIdentifier);

    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

async function getRelease(channel: QortiumAppUpdateChannel) {
  if (channel === 'stable') {
    return normalizeGithubRelease(await fetchGithubJson<unknown>(`${GITHUB_API_BASE_URL}/releases/latest`));
  }

  const releases = await fetchGithubJson<unknown[]>(`${GITHUB_API_BASE_URL}/releases?per_page=30`);

  if (!Array.isArray(releases)) {
    return null;
  }

  return (
    releases
      .map(normalizeGithubRelease)
      .find((release): release is GithubRelease => !!release && release.draft !== true && release.prerelease === true) ??
    null
  );
}

function buildBaseResult(
  environment: QortiumAppUpdateEnvironment,
  channel: QortiumAppUpdateChannel,
): Pick<QortiumAppUpdateCheckResult, 'channel' | 'checkedAt' | 'currentVersion' | 'platform'> {
  return {
    channel,
    checkedAt: new Date().toISOString(),
    currentVersion: environment.currentVersion,
    platform: environment.platform,
  };
}

export async function checkAppUpdates(
  environment: QortiumAppUpdateEnvironment,
  channel: QortiumAppUpdateChannel,
): Promise<QortiumAppUpdateCheckResult> {
  const baseResult = buildBaseResult(environment, channel);

  if (!environment.platform.supported) {
    return {
      ...baseResult,
      status: 'unsupported',
      message: t('updates.unsupportedPlatform', { platform: environment.platform.label }),
    };
  }

  try {
    const release = await getRelease(channel);
    const releaseSummary = release ? releaseToSummary(channel, release) : null;

    if (!release || !releaseSummary) {
      return {
        ...baseResult,
        status: 'not-found',
        message: t('updates.releaseNotFound', { channel: t(UPDATE_CHANNEL_LABEL_KEYS[channel]) }),
      };
    }

    const comparison = compareAppVersions(releaseSummary.tagName, environment.currentVersion);

    if (comparison === null) {
      return {
        ...baseResult,
        release: releaseSummary,
        status: 'error',
        message: t('updates.versionCompareFailed', {
          tag: releaseSummary.tagName,
          version: environment.currentVersion,
        }),
      };
    }

    const asset = selectCompatibleAsset(release, environment.platform);

    if (comparison <= 0) {
      return {
        ...baseResult,
        ...(asset ? { asset } : {}),
        comparison,
        release: releaseSummary,
        status: 'up-to-date',
        message: t('updates.upToDateOnChannel', { channel: t(UPDATE_CHANNEL_LABEL_KEYS[channel]) }),
      };
    }

    if (!asset) {
      return {
        ...baseResult,
        comparison,
        release: releaseSummary,
        status: 'no-compatible-asset',
        message: t('updates.noCompatibleAsset', {
          platform: environment.platform.label,
          tag: releaseSummary.tagName,
        }),
      };
    }

    return {
      ...baseResult,
      asset,
      comparison,
      release: releaseSummary,
      status: 'available',
      message: t('updates.available', {
        platform: environment.platform.label,
        tag: releaseSummary.tagName,
      }),
    };
  } catch (error) {
    return {
      ...baseResult,
      status: 'error',
      message: error instanceof Error ? error.message : t('updates.checkReleasesFailed'),
    };
  }
}
