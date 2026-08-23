export const I2PD_PINNED_VERSION = '2.60.0-q2' as const

export type I2pdReleaseTarget =
  | 'linux-aarch64'
  | 'linux-x86_64'
  | 'macos-arm64'
  | 'macos-x86_64'
  | 'windows-x86_64'

export type I2pdPinnedRelease = Readonly<{
  archiveType: 'tar.gz' | 'zip'
  assetName: string
  binaryName: 'i2pd' | 'i2pd.exe'
  downloadUrl: string
  sha256: string
  size: number
  target: I2pdReleaseTarget
  version: typeof I2PD_PINNED_VERSION
}>

export type I2pdReleaseDecision =
  | Readonly<{
      action: 'install'
      reason: 'not-installed'
      release: I2pdPinnedRelease
    }>
  | Readonly<{
      action: 'update'
      reason: 'installed-older'
      release: I2pdPinnedRelease
    }>
  | Readonly<{
      action: 'none'
      reason: 'installed-current' | 'installed-newer'
      release: I2pdPinnedRelease
    }>
  | Readonly<{
      action: 'unavailable'
      reason: 'invalid-installed-version' | 'unsupported-target'
    }>

const RELEASE_BASE =
  `https://github.com/QortiumDev/qortium-i2pd/releases/download/${I2PD_PINNED_VERSION}`

function release(
  target: I2pdReleaseTarget,
  sha256: string,
  size: number,
): I2pdPinnedRelease {
  const archiveType = target.startsWith('windows-') ? 'zip' : 'tar.gz'
  const assetName = `i2pd-${I2PD_PINNED_VERSION}-${target}.${archiveType}`

  return Object.freeze({
    archiveType,
    assetName,
    binaryName: target.startsWith('windows-') ? 'i2pd.exe' : 'i2pd',
    downloadUrl: `${RELEASE_BASE}/${assetName}`,
    sha256,
    size,
    target,
    version: I2PD_PINNED_VERSION,
  })
}

/**
 * Immutable metadata read from the official 2.60.0-q2 GitHub release assets.
 * Runtime installation must verify both the exact byte count and SHA-256 digest.
 */
export const I2PD_PINNED_RELEASES: readonly I2pdPinnedRelease[] = Object.freeze([
  release(
    'linux-aarch64',
    '78b68022ce8d7d106f397a3d907f8c98c25468b4fd667f20153fdc854043383f',
    5_077_584,
  ),
  release(
    'linux-x86_64',
    '327b862c8b453fca7955b59cb4943fd8ad06c01f4fb30f597a3f253b77f02fd4',
    4_800_688,
  ),
  release(
    'macos-arm64',
    '28cf1ec157eb77f559801860dcaa1bc816e2c64bfa9794781ebc522df38b5ba1',
    5_269_766,
  ),
  release(
    'macos-x86_64',
    '740403378ffa577a576ef1fad9856c482316e623b9a4c222cbeaa94b50973270',
    5_068_995,
  ),
  release(
    'windows-x86_64',
    'b153952fd7c7f964e37ee4233ec8f805b20a20d6754e646e17d15e103323731e',
    5_041_541,
  ),
])

const RELEASE_BY_TARGET = new Map(
  I2PD_PINNED_RELEASES.map((candidate) => [candidate.target, candidate] as const),
)

export function resolveI2pdReleaseTarget(
  platform: string,
  arch: string,
): I2pdReleaseTarget | null {
  if (platform === 'linux' && arch === 'arm64') return 'linux-aarch64'
  if (platform === 'linux' && arch === 'x64') return 'linux-x86_64'
  if (platform === 'darwin' && arch === 'arm64') return 'macos-arm64'
  if (platform === 'darwin' && arch === 'x64') return 'macos-x86_64'
  if (platform === 'win32' && arch === 'x64') return 'windows-x86_64'
  return null
}

export function getPinnedI2pdRelease(
  platform: string,
  arch: string,
): I2pdPinnedRelease | null {
  const target = resolveI2pdReleaseTarget(platform, arch)
  return target ? RELEASE_BY_TARGET.get(target) ?? null : null
}

type VersionTuple = readonly [number, number, number, number]

function parseVersion(value: string): VersionTuple | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-q([1-9]\d*)$/.exec(value)
  if (!match) return null

  const tuple = match.slice(1).map(Number) as unknown as VersionTuple
  return tuple.every(Number.isSafeInteger) ? tuple : null
}

const PINNED_VERSION_TUPLE: VersionTuple = (() => {
  const parsed = parseVersion(I2PD_PINNED_VERSION)
  if (!parsed) throw new Error('The pinned i2pd version is invalid.')
  return parsed
})()

function compareVersions(left: VersionTuple, right: VersionTuple) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1
    if (left[index] > right[index]) return 1
  }
  return 0
}

/** Returns a finite, fail-closed decision and never authorizes a downgrade. */
export function classifyI2pdRelease(
  installedVersion: string | null | undefined,
  platform: string,
  arch: string,
): I2pdReleaseDecision {
  const candidate = getPinnedI2pdRelease(platform, arch)
  if (!candidate) {
    return { action: 'unavailable', reason: 'unsupported-target' }
  }

  if (installedVersion === null || installedVersion === undefined) {
    return { action: 'install', reason: 'not-installed', release: candidate }
  }

  const installed = parseVersion(installedVersion)
  if (!installed) {
    return { action: 'unavailable', reason: 'invalid-installed-version' }
  }

  const comparison = compareVersions(installed, PINNED_VERSION_TUPLE)
  if (comparison < 0) {
    return { action: 'update', reason: 'installed-older', release: candidate }
  }
  if (comparison === 0) {
    return { action: 'none', reason: 'installed-current', release: candidate }
  }
  return { action: 'none', reason: 'installed-newer', release: candidate }
}
