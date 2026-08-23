export type HomeAppUpdateChannel = 'prerelease' | 'stable'
export type HomeAppUpdatePlatformOs =
  | 'android'
  | 'linux'
  | 'macos'
  | 'unsupported'
  | 'windows'

export type HomeAppUpdatePlatform = {
  readonly arch: string
  readonly label: string
  readonly os: HomeAppUpdatePlatformOs
  readonly osVersion?: string
  readonly supported: boolean
}

export type TrustedHomeReleaseAsset = {
  readonly digest: `sha256:${string}`
  readonly downloadUrl: string
  readonly name: string
  readonly size: number
}

export type TrustedHomeRelease = {
  readonly assets: readonly TrustedHomeReleaseAsset[]
  readonly channel: HomeAppUpdateChannel
  readonly htmlUrl: string
  readonly name: string
  readonly publishedAt: string | null
  readonly tagName: string
}

function matchesArchitecture(assetName: string, architecture: string) {
  const arch = architecture.toLowerCase()
  if (arch === 'x64') return /(?:x64|x86_64|amd64)/.test(assetName)
  if (arch === 'arm64') return /(?:arm64|aarch64)/.test(assetName)
  return false
}

function macAssetPriority(assetName: string, platform: HomeAppUpdatePlatform) {
  const match = /^(\d+)(?:\.(\d+))?/.exec(platform.osVersion?.trim() ?? '')
  const major = match ? Number.parseInt(match[1], 10) : null
  const minor = match ? Number.parseInt(match[2] ?? '0', 10) : null
  const mac11 = assetName.includes('macos11') && assetName.includes('universal')
  const mac1015 = assetName.includes('macos1015') && matchesArchitecture(assetName, 'x64')
  const compatibility = mac11 || mac1015
  const universal = assetName.includes('universal') && !compatibility
  const architecture = !compatibility && matchesArchitecture(assetName, platform.arch)
  if (major === null) return universal ? 50 : architecture ? 40 : 0
  if (major >= 12) return universal ? 50 : architecture ? 40 : 0
  if (major === 11) return mac11 ? 50 : 0
  if (major === 10 && (minor ?? 0) >= 15 && platform.arch === 'x64') return mac1015 ? 50 : 0
  return 0
}

function assetPriority(assetName: string, platform: HomeAppUpdatePlatform) {
  const name = assetName.trim().toLowerCase()
  if (platform.os === 'linux' && name.endsWith('.appimage')) {
    return matchesArchitecture(name, platform.arch) ? 30 : 0
  }
  if (platform.os === 'macos' && name.endsWith('.dmg')) return macAssetPriority(name, platform)
  if (platform.os === 'windows' && name.endsWith('.exe')) {
    return matchesArchitecture(name, platform.arch) ? 30 : 0
  }
  return 0
}

type ParsedVersion = {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly (number | string)[]
}

function parseVersion(value: string): ParsedVersion | null {
  const normalized = value.trim().replace(/^v/i, '').split('+')[0]
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(normalized)
  if (!match) return null
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4]
      ? match[4].split('.').map((part) =>
          /^\d+$/.test(part) ? Number.parseInt(part, 10) : part,
        )
      : [],
  }
}

function compareIdentifiers(first: number | string, second: number | string) {
  if (typeof first === 'number' && typeof second === 'number') {
    return Math.sign(first - second)
  }
  if (typeof first === 'number') return -1
  if (typeof second === 'number') return 1
  return Math.sign(first.localeCompare(second))
}

export function compareHomeAppVersions(firstValue: string, secondValue: string) {
  const first = parseVersion(firstValue)
  const second = parseVersion(secondValue)
  if (!first || !second) return null

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (first[key] !== second[key]) return Math.sign(first[key] - second[key])
  }
  if (first.prerelease.length === 0 && second.prerelease.length === 0) return 0
  if (first.prerelease.length === 0) return 1
  if (second.prerelease.length === 0) return -1

  const count = Math.max(first.prerelease.length, second.prerelease.length)
  for (let index = 0; index < count; index += 1) {
    const firstPart = first.prerelease[index]
    const secondPart = second.prerelease[index]
    if (firstPart === undefined) return -1
    if (secondPart === undefined) return 1
    const comparison = compareIdentifiers(firstPart, secondPart)
    if (comparison !== 0) return comparison
  }
  return 0
}

export function selectTrustedHomeReleaseAsset(
  release: TrustedHomeRelease,
  platform: HomeAppUpdatePlatform,
) {
  return release.assets
    .map((asset, index) => ({ asset, index, priority: assetPriority(asset.name, platform) }))
    .filter((candidate) => candidate.priority > 0)
    .sort((first, second) => second.priority - first.priority || first.index - second.index)[0]?.asset ?? null
}
