const QORTAL_JAR_NAME = 'qortal.jar' as const;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_RELEASE_TAG = /^v[a-z0-9._-]+$/i;

type QortalJarAsset = {
  digest: string;
  downloadUrl: string;
  name: typeof QORTAL_JAR_NAME;
  size: number;
};

export type QortalJarRelease = {
  asset: QortalJarAsset;
  tagName: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeDigest(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  const digest = value.trim().toLowerCase();

  return SHA256_DIGEST.test(digest) ? digest : '';
}

export function selectQortalJarRelease(value: unknown): QortalJarRelease | null {
  if (!isObject(value) || value.draft !== false || value.prerelease !== false) {
    return null;
  }

  const tagName = typeof value.tag_name === 'string' ? value.tag_name.trim() : '';

  if (!SAFE_RELEASE_TAG.test(tagName) || !Array.isArray(value.assets)) {
    return null;
  }

  const matchingAssets = value.assets.filter(
    (asset): asset is Record<string, unknown> =>
      isObject(asset) && asset.name === QORTAL_JAR_NAME,
  );

  if (matchingAssets.length !== 1) {
    return null;
  }

  const asset = matchingAssets[0];
  const digest = normalizeDigest(asset.digest);
  const size = asset.size;
  const downloadUrl =
    typeof asset.browser_download_url === 'string' ? asset.browser_download_url.trim() : '';
  const expectedUrl = `https://github.com/Qortal/qortal/releases/download/${tagName}/${QORTAL_JAR_NAME}`;

  if (
    !digest ||
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    downloadUrl !== expectedUrl
  ) {
    return null;
  }

  return {
    asset: {
      digest,
      downloadUrl,
      name: QORTAL_JAR_NAME,
      size,
    },
    tagName,
  };
}
