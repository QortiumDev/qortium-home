import path from 'node:path'

/** Exact lexical authority for the one managed Qortium runtime settings path. */
export function isApprovedQortiumTransportRuntimePath(
  candidate: unknown,
  expected: string,
  platform: NodeJS.Platform,
) {
  if (typeof candidate !== 'string' || typeof expected !== 'string' ||
    candidate.includes('\0') || expected.includes('\0')) return false
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  if (!pathApi.isAbsolute(candidate) || !pathApi.isAbsolute(expected) ||
    pathApi.normalize(candidate) !== candidate || pathApi.normalize(expected) !== expected) {
    return false
  }
  return platform === 'win32'
    ? candidate.toLowerCase() === expected.toLowerCase()
    : candidate === expected
}

export type QortiumTransportManagedTargetPaths = Readonly<{
  installPath: string
  jarPath: string
  previewPath: string
  runtimePath: string
}>

export function isApprovedQortiumTransportManagedTarget(
  candidate: QortiumTransportManagedTargetPaths,
  expected: QortiumTransportManagedTargetPaths,
  platform: NodeJS.Platform,
) {
  return isApprovedQortiumTransportRuntimePath(candidate.installPath, expected.installPath, platform) &&
    isApprovedQortiumTransportRuntimePath(candidate.jarPath, expected.jarPath, platform) &&
    isApprovedQortiumTransportRuntimePath(candidate.previewPath, expected.previewPath, platform) &&
    isApprovedQortiumTransportRuntimePath(candidate.runtimePath, expected.runtimePath, platform)
}
