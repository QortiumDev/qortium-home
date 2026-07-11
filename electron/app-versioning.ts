type PlatformVersion = {
  major: number;
  minor: number;
};

function parsePlatformVersion(value: string): PlatformVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(value.trim());

  if (!match) {
    return null;
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
  };
}

export function getPlatformVersion(hostVersion: string) {
  const version = parsePlatformVersion(hostVersion);

  return version ? `${version.major}.${version.minor}` : null;
}

export function compareAppPlatformVersions(appVersion: string, hostVersion: string) {
  const app = parsePlatformVersion(appVersion);
  const host = parsePlatformVersion(hostVersion);

  if (!app || !host) {
    return null;
  }

  if (app.major !== host.major) {
    return Math.sign(app.major - host.major);
  }

  return Math.sign(app.minor - host.minor);
}
