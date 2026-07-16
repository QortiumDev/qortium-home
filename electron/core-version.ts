export function getCoreSemver(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^qortium-/i, '').replace(/^v/i, '');

  if (!normalized) {
    return null;
  }

  const withoutCommit = normalized.replace(/-[0-9a-f]{6,40}$/i, '');
  const match = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(withoutCommit);

  return match?.[1] ?? null;
}

export function getCoreReleaseTag(value: string | null | undefined) {
  const semver = getCoreSemver(value);

  return semver ? `v${semver}` : '';
}

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<number | string>;
};

function parseVersion(value: string | null | undefined): ParsedVersion | null {
  const semver = getCoreSemver(value);

  if (!semver) {
    return null;
  }

  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(semver);

  if (!match) {
    return null;
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4]
      ? match[4].split('.').map((part) => (/^\d+$/.test(part) ? Number.parseInt(part, 10) : part))
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

export function compareCoreVersions(firstValue: string | null | undefined, secondValue: string | null | undefined) {
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

  if (first.prerelease.length === 0 || second.prerelease.length === 0) {
    return first.prerelease.length === second.prerelease.length
      ? 0
      : first.prerelease.length === 0
        ? 1
        : -1;
  }

  const identifierCount = Math.max(first.prerelease.length, second.prerelease.length);

  for (let index = 0; index < identifierCount; index += 1) {
    const firstIdentifier = first.prerelease[index];
    const secondIdentifier = second.prerelease[index];

    if (firstIdentifier === undefined || secondIdentifier === undefined) {
      return firstIdentifier === secondIdentifier ? 0 : firstIdentifier === undefined ? -1 : 1;
    }

    const comparison = compareIdentifiers(firstIdentifier, secondIdentifier);

    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

export function coreCommitsMatch(first: string | null | undefined, second: string | null | undefined) {
  const a = first?.trim().toLowerCase();
  const b = second?.trim().toLowerCase();

  if (!a || !b || !/^[0-9a-f]{6,40}$/.test(a) || !/^[0-9a-f]{6,40}$/.test(b)) {
    return false;
  }

  return a.startsWith(b) || b.startsWith(a);
}

export function getCoreTimestampMs(value: string | number | null | undefined) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  if (/^\d{14}$/.test(normalized)) {
    const year = Number(normalized.slice(0, 4));
    const month = Number(normalized.slice(4, 6));
    const day = Number(normalized.slice(6, 8));
    const hour = Number(normalized.slice(8, 10));
    const minute = Number(normalized.slice(10, 12));
    const second = Number(normalized.slice(12, 14));
    const timestamp = Date.UTC(year, month - 1, day, hour, minute, second);

    return Number.isFinite(timestamp) ? timestamp : null;
  }

  const numeric = Number(normalized);

  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  const parsed = Date.parse(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}
