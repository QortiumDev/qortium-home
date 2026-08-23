import path from 'node:path'
import type { CoreProcessObservation } from './core-process-observation.js'
import { observeCurrentUserQortalProcesses } from './core-process-observation.js'
import { resolveCoreNativeObserverPath } from './core-native-observer-path.js'
import { observeMacosQortalProcesses } from './macos-core-observation.js'
import type { QortalCoreManager } from './qortal-core-manager.js'
import {
  discoverQortalInstallCandidates,
  type QortalInstallCandidate,
  type QortalInstallCandidateHint,
} from './qortal-install-source.js'
import {
  collectQortalExternalInstallHints,
  type QortalExternalInstallHintCollection,
} from './home-v2-qortal-maintenance-discovery-policy.js'
import { observeWindowsQortalProcesses } from './windows-core-observation.js'

const MAX_DISCOVERY_HINTS = 32

export type HomeV2QortalAdoptionDiscovery = Readonly<{
  candidates: readonly QortalInstallCandidate[]
  kind: 'complete' | 'incomplete'
}>

export type HomeV2QortalAdoptionDiscoveryOperations = Readonly<{
  collectExternalHints(manager: QortalCoreManager): Promise<QortalExternalInstallHintCollection>
  discoverCandidates(
    hints: readonly QortalInstallCandidateHint[],
    manager: QortalCoreManager,
  ): ReturnType<typeof discoverQortalInstallCandidates>
  inspectProcesses(manager: QortalCoreManager): Promise<CoreProcessObservation>
}>

function samePath(left: string, right: string, platform: NodeJS.Platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const normalized = (value: string) => {
    const resolved = pathApi.resolve(value)
    return platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  return normalized(left) === normalized(right)
}

function compatibleProcessHints(
  observation: CoreProcessObservation,
  platform: NodeJS.Platform,
) {
  if (observation.kind !== 'observed') return { hints: [] as QortalInstallCandidateHint[], complete: false }
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const hints = observation.processes.flatMap((process): QortalInstallCandidateHint[] => {
    const classification = process.classification
    if (classification.kind !== 'qortal-direct-jar' ||
      classification.rawSettingsArgument !== 'settings.json' ||
      !samePath(pathApi.dirname(classification.canonicalJarPath), process.canonicalCwd, platform)) return []
    return [{
      installPath: pathApi.dirname(classification.canonicalJarPath),
      origin: 'running-process',
      runningProcessMatch: true,
    }]
  })
  return { hints, complete: true }
}

async function inspectProductionQortalProcesses(
  manager: QortalCoreManager,
): Promise<CoreProcessObservation> {
  if (process.platform === 'linux') {
    return await observeCurrentUserQortalProcesses({ selectedJarPath: manager.config.paths.jarPath })
  }
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return { kind: 'unknown', processes: [], reason: 'Unsupported platform.' }
  }
  const { app } = await import('electron')
  const resolution = resolveCoreNativeObserverPath({
    appPath: app.getAppPath(),
    arch: process.arch,
    isPackaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
  })
  if (resolution.kind !== 'resolved') {
    return { kind: 'unknown', processes: [], reason: 'Native process observation is unavailable.' }
  }
  if (process.platform === 'win32') {
    if (process.arch !== 'x64') return { kind: 'unknown', processes: [], reason: 'Unsupported architecture.' }
    return await observeWindowsQortalProcesses({
      helperPath: resolution.executablePath,
      selectedJarPath: manager.config.paths.jarPath,
    })
  }
  if (process.arch !== 'x64' && process.arch !== 'arm64') {
    return { kind: 'unknown', processes: [], reason: 'Unsupported architecture.' }
  }
  return await observeMacosQortalProcesses({
    arch: process.arch,
    helperPath: resolution.executablePath,
    selectedJarPath: manager.config.paths.jarPath,
  })
}

const DEFAULT_OPERATIONS: HomeV2QortalAdoptionDiscoveryOperations = {
  collectExternalHints: async (manager) => {
    const { app } = await import('electron')
    return await collectQortalExternalInstallHints(manager.config.paths, {
      appDataPath: app.getPath('appData'),
      homePath: app.getPath('home'),
      platform: process.platform,
      programFilesPath: process.env.ProgramFiles,
    })
  },
  discoverCandidates: async (hints, manager) =>
    await discoverQortalInstallCandidates(hints, manager.config.paths),
  inspectProcesses: inspectProductionQortalProcesses,
}

export class HomeV2QortalAdoptionDiscoveryService {
  #listInFlight: Promise<HomeV2QortalAdoptionDiscovery> | null = null

  constructor(
    private readonly operations: HomeV2QortalAdoptionDiscoveryOperations = DEFAULT_OPERATIONS,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  discover(manager: QortalCoreManager, userSelectedDirectory?: string) {
    if (userSelectedDirectory === undefined) {
      if (!this.#listInFlight) {
        this.#listInFlight = this.#discover(manager).finally(() => { this.#listInFlight = null })
      }
      return this.#listInFlight
    }
    return this.#discover(manager, userSelectedDirectory)
  }

  async #discover(
    manager: QortalCoreManager,
    userSelectedDirectory?: string,
  ): Promise<HomeV2QortalAdoptionDiscovery> {
    const [external, processes] = await Promise.all([
      this.operations.collectExternalHints(manager).catch(() => ({ hints: [], kind: 'unknown' as const })),
      this.operations.inspectProcesses(manager).catch(() => ({
        kind: 'unknown' as const,
        processes: [],
        reason: 'Process observation failed.',
      })),
    ])
    const processHints = compatibleProcessHints(processes, this.platform)
    const hints = [
      ...external.hints,
      ...processHints.hints,
      ...(userSelectedDirectory === undefined ? [] : [{
        installPath: userSelectedDirectory,
        origin: 'user-selected' as const,
      }]),
    ]
    if (external.kind !== 'observed' || !processHints.complete || hints.length > MAX_DISCOVERY_HINTS) {
      return { candidates: [], kind: 'incomplete' }
    }
    const discovered = await this.operations.discoverCandidates(hints, manager).catch(() => null)
    if (discovered?.kind !== 'observed' || (userSelectedDirectory !== undefined &&
      !discovered.candidates.some((candidate) => candidate.origins.includes('user-selected')))) {
      return { candidates: [], kind: 'incomplete' }
    }
    return { candidates: discovered.candidates, kind: 'complete' }
  }
}

export const homeV2QortalAdoptionDiscovery = new HomeV2QortalAdoptionDiscoveryService()
