import { randomUUID } from 'node:crypto'
import type { IpcMainInvokeEvent } from 'electron'
import type { CoreManagerEntry } from './core-manager.js'
import { homeV2CoreOperationCoordinator, type HomeV2CoreOperationLease } from './home-v2-core-operation-coordinator.js'
import type { HomeV2QortalMaintenanceStatus } from './home-v2-qortal-maintenance-contract.js'
import {
  homeV2QortalAdoptionDiscovery,
  type HomeV2QortalAdoptionDiscovery,
} from './home-v2-qortal-adoption-discovery.js'
import type {
  QortalInstallCandidate,
  QortalInstallCandidateOrigin,
} from './qortal-install-source.js'

const TOKEN_TTL_MS = 10 * 60_000
const MAX_TOKENS = 64
const MAX_SENDER_SNAPSHOTS = 32
const MAX_CANDIDATES = 16
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type PublicOrigin = Exclude<QortalInstallCandidateOrigin, 'home-managed'>

export type HomeV2QortalAdoptionCandidate = Readonly<{
  candidateId: string
  hubHint: boolean
  origins: readonly PublicOrigin[]
  runningProcessMatch: boolean
  version: string | null
}>

export type HomeV2QortalAdoptionList = Readonly<{
  canBrowse: boolean
  canSelect: boolean
  candidates: readonly HomeV2QortalAdoptionCandidate[]
  code: 'discovery-incomplete' | 'manager-unavailable' | 'status-unavailable' |
    'unsupported-platform' | null
  network: 'qortal'
  revision: 1
  schema: 'home-v2-qortal-adoption-list'
  state: 'complete' | 'incomplete' | 'not-applicable' | 'unsupported'
}>

export type HomeV2QortalAdoptionBrowseResult = Readonly<{
  canceled: boolean
  list: HomeV2QortalAdoptionList
  network: 'qortal'
  revision: 1
  schema: 'home-v2-qortal-adoption-browse'
}>

export type HomeV2QortalAdoptionSelectionResult = Readonly<{
  code: 'candidate-changed' | 'candidate-expired' | 'operation-in-progress' |
    'persistence-unknown' | 'unsupported-platform' | null
  network: 'qortal'
  outcome: 'blocked' | 'completed' | 'failed'
  revision: 1
  schema: 'home-v2-qortal-adoption-selection'
  status: HomeV2QortalMaintenanceStatus
}>

type TokenEntry = {
  candidate: QortalInstallCandidate
  createdAt: number
  detectedBy: PublicOrigin
  generation: number
  senderId: number
}

export type HomeV2QortalAdoptionDependencies = Readonly<{
  chooseDirectory(event: IpcMainInvokeEvent): Promise<string | null>
  discover(manager: Extract<CoreManagerEntry, { networkId: 'qortal' }>, userSelectedDirectory?: string):
    Promise<HomeV2QortalAdoptionDiscovery>
  getMaintenanceStatus(): Promise<HomeV2QortalMaintenanceStatus>
  now(): number
  platform: NodeJS.Platform
  resolveManager(): CoreManagerEntry
  tryBeginInteractive(): HomeV2CoreOperationLease | null
  uuid(): string
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort()
  const sorted = [...expected].sort()
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index])
}

function normalizeEmptyRequest(value: unknown, schema: string) {
  if (!isRecord(value) || !exactKeys(value, ['network', 'revision', 'schema']) ||
    value.schema !== schema || value.revision !== 1 || value.network !== 'qortal') {
    throw new Error('An exact Qortal adoption request is required.')
  }
}

function normalizeSelectionRequest(value: unknown) {
  if (!isRecord(value) || !exactKeys(value, ['candidateId', 'network', 'revision', 'schema']) ||
    value.schema !== 'home-v2-qortal-adoption-selection-request' || value.revision !== 1 ||
    value.network !== 'qortal' || typeof value.candidateId !== 'string' || !UUID_V4.test(value.candidateId)) {
    throw new Error('An exact Qortal adoption selection request is required.')
  }
  return value.candidateId
}

function boundedVersion(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value) ? value : null
}

function unavailableMaintenanceStatus(): HomeV2QortalMaintenanceStatus {
  return {
    capabilities: { canCheckRelease: false, canInitialInstall: false, canUpdate: false },
    discovery: 'unknown',
    install: 'unknown',
    installedVersion: null,
    issue: 'status-unavailable',
    network: 'qortal',
    revision: 1,
    runtime: 'unknown',
    schema: 'home-v2-qortal-maintenance',
    updateAuthority: 'observe-only',
  }
}

function emptyList(
  state: HomeV2QortalAdoptionList['state'],
  code: HomeV2QortalAdoptionList['code'],
  canBrowse = false,
): HomeV2QortalAdoptionList {
  return {
    canBrowse,
    canSelect: false,
    candidates: [],
    code,
    network: 'qortal',
    revision: 1,
    schema: 'home-v2-qortal-adoption-list',
    state,
  }
}

function preferredOrigin(candidate: QortalInstallCandidate): PublicOrigin | null {
  for (const origin of ['user-selected', 'qortal-hub', 'running-process', 'default-location'] as const) {
    if (candidate.origins.includes(origin)) return origin
  }
  return null
}

const DEFAULT_DEPENDENCIES: Omit<HomeV2QortalAdoptionDependencies,
  'getMaintenanceStatus' | 'resolveManager'> = {
  chooseDirectory: async (event) => {
    const { BrowserWindow, dialog } = await import('electron')
    const hostWindow = BrowserWindow.fromWebContents(event.sender)
    if (!hostWindow || hostWindow.isDestroyed()) throw new Error('The Qortal directory chooser has no active Home window.')
    const result = await dialog.showOpenDialog(hostWindow, {
      buttonLabel: 'Select',
      properties: ['openDirectory'],
      title: 'Select Qortal Core folder',
    })
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
  },
  discover: async (manager, userSelectedDirectory) =>
    await homeV2QortalAdoptionDiscovery.discover(manager, userSelectedDirectory),
  now: Date.now,
  platform: process.platform,
  tryBeginInteractive: () => homeV2CoreOperationCoordinator.tryBeginInteractive(['qortal']),
  uuid: randomUUID,
}

export class HomeV2QortalAdoptionService {
  readonly #dependencies: HomeV2QortalAdoptionDependencies
  readonly #generations = new Map<number, number>()
  readonly #tokens = new Map<string, TokenEntry>()

  constructor(dependencies: Pick<HomeV2QortalAdoptionDependencies, 'getMaintenanceStatus' | 'resolveManager'> &
    Partial<HomeV2QortalAdoptionDependencies>) {
    this.#dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies }
  }

  #nextGeneration(senderId: number) {
    const generation = (this.#generations.get(senderId) ?? 0) + 1
    this.#generations.delete(senderId)
    while (this.#generations.size >= MAX_SENDER_SNAPSHOTS) {
      const oldestSender = this.#generations.keys().next().value as number | undefined
      if (oldestSender === undefined) break
      this.#generations.delete(oldestSender)
      for (const [token, entry] of this.#tokens) {
        if (entry.senderId === oldestSender) this.#tokens.delete(token)
      }
    }
    this.#generations.set(senderId, generation)
    for (const [token, entry] of this.#tokens) {
      if (entry.senderId === senderId) this.#tokens.delete(token)
    }
    return generation
  }

  #prune(now = this.#dependencies.now()) {
    for (const [token, entry] of this.#tokens) {
      if (now - entry.createdAt >= TOKEN_TTL_MS) this.#tokens.delete(token)
    }
  }

  #issue(senderId: number, generation: number, candidate: QortalInstallCandidate, detectedBy: PublicOrigin) {
    this.#prune()
    while (this.#tokens.size >= MAX_TOKENS) {
      const oldest = this.#tokens.keys().next().value as string | undefined
      if (!oldest) break
      this.#tokens.delete(oldest)
    }
    const candidateId = this.#dependencies.uuid()
    if (!UUID_V4.test(candidateId) || this.#tokens.has(candidateId)) return null
    this.#tokens.set(candidateId, {
      candidate,
      createdAt: this.#dependencies.now(),
      detectedBy,
      generation,
      senderId,
    })
    return candidateId
  }

  #resolveAndConsume(senderId: number, candidateId: string) {
    this.#prune()
    const entry = this.#tokens.get(candidateId)
    if (!entry || entry.senderId !== senderId || entry.generation !== this.#generations.get(senderId)) return null
    this.#tokens.delete(candidateId)
    return entry
  }

  async #status() {
    return await this.#dependencies.getMaintenanceStatus().catch(() => unavailableMaintenanceStatus())
  }

  #manager() {
    try {
      const manager = this.#dependencies.resolveManager()
      return manager.networkId === 'qortal' ? manager : null
    } catch {
      return null
    }
  }

  async #list(senderId: number, userSelectedDirectory?: string) {
    const generation = this.#nextGeneration(senderId)
    const manager = this.#manager()
    if (!manager) return emptyList('incomplete', 'manager-unavailable')
    let status
    try { status = await manager.getStatus() } catch {
      return emptyList('incomplete', 'status-unavailable')
    }
    const supported = this.#dependencies.platform === 'linux' || this.#dependencies.platform === 'darwin'
    if (status.install.kind !== 'missing') {
      return status.install.kind === 'unknown'
        ? emptyList('incomplete', 'status-unavailable')
        : emptyList('not-applicable', null)
    }
    const discovery = await this.#dependencies.discover(manager, userSelectedDirectory).catch(() => null)
    if (!discovery || discovery.kind !== 'complete' || discovery.candidates.length > MAX_CANDIDATES) {
      return emptyList('incomplete', 'discovery-incomplete')
    }
    const foreign = discovery.candidates.filter((candidate) => !candidate.origins.includes('home-managed'))
    const candidates: HomeV2QortalAdoptionCandidate[] = []
    for (const candidate of foreign) {
      const detectedBy = preferredOrigin(candidate)
      if (!detectedBy) {
        this.#nextGeneration(senderId)
        return emptyList('incomplete', 'discovery-incomplete')
      }
      const candidateId = this.#issue(senderId, generation, candidate, detectedBy)
      if (!candidateId) {
        this.#nextGeneration(senderId)
        return emptyList('incomplete', 'discovery-incomplete')
      }
      candidates.push({
        candidateId,
        hubHint: candidate.hubHint,
        origins: candidate.origins.filter((origin): origin is PublicOrigin => origin !== 'home-managed'),
        runningProcessMatch: candidate.runningProcessMatch,
        version: boundedVersion(candidate.jarState.identity?.semver),
      })
    }
    return {
      canBrowse: supported,
      canSelect: supported && candidates.length > 0,
      candidates,
      code: supported ? null : 'unsupported-platform',
      network: 'qortal',
      revision: 1,
      schema: 'home-v2-qortal-adoption-list',
      state: supported ? 'complete' : 'unsupported',
    } satisfies HomeV2QortalAdoptionList
  }

  async list(senderId: number, value: unknown) {
    normalizeEmptyRequest(value, 'home-v2-qortal-adoption-list-request')
    return await this.#list(senderId)
  }

  async browse(senderId: number, event: IpcMainInvokeEvent, value: unknown): Promise<HomeV2QortalAdoptionBrowseResult> {
    normalizeEmptyRequest(value, 'home-v2-qortal-adoption-browse-request')
    this.#nextGeneration(senderId)
    if (this.#dependencies.platform !== 'linux' && this.#dependencies.platform !== 'darwin') {
      return {
        canceled: true,
        list: emptyList('unsupported', 'unsupported-platform'),
        network: 'qortal',
        revision: 1,
        schema: 'home-v2-qortal-adoption-browse',
      }
    }
    let selected: string | null
    try { selected = await this.#dependencies.chooseDirectory(event) } catch { selected = null }
    return {
      canceled: selected === null,
      list: await this.#list(senderId, selected ?? undefined),
      network: 'qortal',
      revision: 1,
      schema: 'home-v2-qortal-adoption-browse',
    }
  }

  async select(senderId: number, value: unknown): Promise<HomeV2QortalAdoptionSelectionResult> {
    const candidateId = normalizeSelectionRequest(value)
    if (this.#dependencies.platform !== 'linux' && this.#dependencies.platform !== 'darwin') {
      return this.#selection('blocked', 'unsupported-platform', await this.#status())
    }
    const lease = this.#dependencies.tryBeginInteractive()
    if (!lease) return this.#selection('blocked', 'operation-in-progress', await this.#status())
    try {
      const entry = this.#resolveAndConsume(senderId, candidateId)
      if (!entry) return this.#selection('blocked', 'candidate-expired', await this.#status())
      const manager = this.#manager()
      if (!manager) return this.#selection('failed', 'persistence-unknown', await this.#status())
      const persisted = await manager.persistAdoptedSelection(entry.candidate, entry.detectedBy)
      if (persisted.kind === 'persisted' || persisted.kind === 'unchanged') {
        this.#tokens.clear()
        return this.#selection('completed', null, await this.#status())
      }
      return persisted.kind === 'blocked'
        ? this.#selection('blocked', 'candidate-changed', await this.#status())
        : this.#selection('failed', 'persistence-unknown', await this.#status())
    } catch {
      return this.#selection('failed', 'persistence-unknown', await this.#status())
    } finally {
      lease.release()
    }
  }

  #selection(
    outcome: HomeV2QortalAdoptionSelectionResult['outcome'],
    code: HomeV2QortalAdoptionSelectionResult['code'],
    status: HomeV2QortalMaintenanceStatus,
  ): HomeV2QortalAdoptionSelectionResult {
    return {
      code,
      network: 'qortal',
      outcome,
      revision: 1,
      schema: 'home-v2-qortal-adoption-selection',
      status,
    }
  }
}

export function createAuthorizedHomeV2QortalAdoptionHandlers(
  assertAuthorized: (event: IpcMainInvokeEvent) => void,
  service: HomeV2QortalAdoptionService,
) {
  return {
    list(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.list(event.sender.id, value)
    },
    browse(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.browse(event.sender.id, event, value)
    },
    select(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.select(event.sender.id, value)
    },
  }
}
