// Picks the Adoptium binary Home installs as its managed Java runtime, and the
// checksum that binary must match.
//
// The managed runtime becomes the interpreter that runs Core, so an unverified
// archive is as good as arbitrary code execution. Adoptium publishes a sha256
// for every package, but only alongside the package's own download link - so
// the link and the checksum are taken from the same API record here. A
// checksum read from one record and applied to a download from another is not
// verification at all.

export type ManagedJavaBinary = {
  // Pre-formatted as `sha256:<hex>` so it can be handed straight to the shared
  // download routine, which compares against digests in that form.
  checksum: string;
  downloadUrl: string;
  packageName: string;
  size: number;
  version: string;
};

export type ManagedJavaBinaryCriteria = {
  apiArch: string;
  apiOs: string;
  archiveExtension: string;
};

const SHA256_HEX = /^[0-9a-f]{64}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeChecksum(value: unknown) {
  const checksum = getString(value).toLowerCase();

  return SHA256_HEX.test(checksum) ? `sha256:${checksum}` : '';
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

// Optional fields are only rejected when Adoptium states a value we did not ask
// for; a missing field means the API stopped reporting it, which is not a
// reason to refuse an otherwise matching package.
function matchesExpectedValue(value: unknown, expected: string) {
  const actual = getString(value);

  return !actual || actual === expected;
}

export function selectManagedJavaBinary(
  releases: unknown,
  criteria: ManagedJavaBinaryCriteria,
): ManagedJavaBinary | null {
  if (!Array.isArray(releases)) {
    return null;
  }

  for (const release of releases) {
    if (!isObject(release)) {
      continue;
    }

    const binary = (release as { binary?: unknown }).binary;
    const version = (release as { version?: unknown }).version;

    if (!isObject(binary) || !isObject(version)) {
      continue;
    }

    if (
      getString(binary.architecture) !== criteria.apiArch ||
      getString(binary.os) !== criteria.apiOs ||
      getString(binary.image_type) !== 'jre' ||
      !matchesExpectedValue(binary.heap_size, 'normal') ||
      !matchesExpectedValue(binary.jvm_impl, 'hotspot') ||
      !matchesExpectedValue(binary.project, 'jdk')
    ) {
      continue;
    }

    const binaryPackage = (binary as { package?: unknown }).package;

    if (!isObject(binaryPackage)) {
      continue;
    }

    const checksum = normalizeChecksum(binaryPackage.checksum);
    const downloadUrl = getString(binaryPackage.link);
    const packageName = getString(binaryPackage.name);
    const openjdkVersion = getString((version as { openjdk_version?: unknown }).openjdk_version);

    // The extension decides how the archive is unpacked, so a package that does
    // not carry the expected one is the wrong asset even if everything else
    // lines up.
    if (
      !checksum ||
      !openjdkVersion ||
      !isHttpsUrl(downloadUrl) ||
      !packageName.endsWith(`.${criteria.archiveExtension}`)
    ) {
      continue;
    }

    return {
      checksum,
      downloadUrl,
      packageName,
      size: getNumber(binaryPackage.size),
      version: openjdkVersion,
    };
  }

  return null;
}
