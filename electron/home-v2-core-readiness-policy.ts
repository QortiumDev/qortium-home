import { existsSync } from 'node:fs'
import path from 'node:path'

export type HomeV2CoreNetwork = 'qortal' | 'qortium'
export type HomeV2LocalCoreInstallState =
  | 'installed'
  | 'not-detected'
  | 'unsupported'

export interface HomeV2CorePathContext {
  appDataPath: string
  homePath: string
  platform: NodeJS.Platform
  programFilesPath?: string
  qortalHubDirectory?: string | null
}

export function parseQortalHubDirectory(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const directory = (value as { qortalDirectory?: unknown }).qortalDirectory
  return typeof directory === 'string' && directory.trim()
    ? directory.trim()
    : null
}

function uniquePaths(candidates: readonly string[]) {
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))]
}

export function getHomeV2CoreJarCandidates(
  network: HomeV2CoreNetwork,
  context: HomeV2CorePathContext,
) {
  if (network === 'qortium') {
    return uniquePaths([
      path.join(context.appDataPath, 'qortium-core', 'install', 'qortium.jar'),
    ])
  }
  const candidates = [
    path.join(context.appDataPath, 'qortal-core', 'install', 'qortal.jar'),
    path.join(context.appDataPath, 'qortal-core', 'qortal.jar'),
    path.join(context.homePath, 'qortal', 'qortal.jar'),
    path.join(context.homePath, 'Qortal', 'qortal.jar'),
  ]
  if (context.qortalHubDirectory) {
    candidates.push(path.join(context.qortalHubDirectory, 'qortal.jar'))
  }
  if (context.platform === 'win32' && context.programFilesPath) {
    candidates.push(path.join(context.programFilesPath, 'Qortal', 'qortal.jar'))
  }
  return uniquePaths(candidates)
}

export function detectHomeV2CoreInstall(
  network: HomeV2CoreNetwork,
  context: HomeV2CorePathContext,
  fileExists: (candidate: string) => boolean = existsSync,
): HomeV2LocalCoreInstallState {
  if (
    context.platform !== 'linux' &&
    context.platform !== 'darwin' &&
    context.platform !== 'win32'
  ) {
    return 'unsupported'
  }
  return getHomeV2CoreJarCandidates(network, context).some(fileExists)
    ? 'installed'
    : 'not-detected'
}
