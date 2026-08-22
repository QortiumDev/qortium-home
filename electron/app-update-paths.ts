import path from 'node:path'

export function sanitizeAppUpdatePathSegment(value: string, fallback: string) {
  return value.replace(/[^a-z0-9._-]/gi, '_') || fallback
}

export function resolvePrivateHomeV2AppUpdateTarget(
  updatesDirectory: string,
  assetName: string,
  releaseTag: string,
) {
  const fileName = sanitizeAppUpdatePathSegment(assetName, 'update')
  return {
    fileName,
    finalPath: path.join(
      updatesDirectory,
      sanitizeAppUpdatePathSegment(releaseTag, 'release'),
      fileName,
    ),
  }
}
