// beta.13 is the final release with unpatched legacy macOS packages.
const suffixes = [
  ['-x86_64.AppImage', 'linux-x64'],
  ['-arm64.AppImage', 'linux-arm64'],
  ['-x64.exe', 'windows-x64'],
  ['-macos11-universal.dmg', 'macos11-universal'],
  ['-macos1015-x64.dmg', 'macos1015-x64'],
  ['-universal.dmg', 'macos-universal'],
  ['-android-release.apk', 'android'],
];
export function homeReleasePlatform(name) {
  return suffixes.find(([suffix]) => name.endsWith(suffix))?.[1] ?? null;
}
export function homeReleaseSupportsLegacyMac(tag) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(tag);
  if (!match) throw new Error('Invalid Home release version.');
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  if (major !== 2) return major < 2;
  if (minor !== 1) return minor < 1;
  if (patch !== 0) return false;
  const beta = /^beta\.(\d+)$/.exec(match[4] ?? '');
  return beta !== null && Number(beta[1]) <= 13;
}
export function assertHomeReleasePlatforms(tag, assets) {
  const platforms = assets.map(({ name }) => homeReleasePlatform(name));
  const expected = suffixes.map(([, platform]) => platform).filter((platform) =>
    homeReleaseSupportsLegacyMac(tag) || !platform.startsWith('macos1'));
  if (platforms.length !== expected.length || new Set(platforms).size !== platforms.length ||
      expected.some((platform) => !platforms.includes(platform))) {
    throw new Error(`Home ${tag} requires exactly these package platforms: ${expected.join(', ')}.`);
  }
}
