import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CoreJarInstallCleanupError,
  runCoreJarInstallTransaction,
} from './core-jar-install-transaction.js';
import {
  coreJarTargetStatesMatch,
  readCoreJarTargetState,
  type CoreJarTargetState,
} from './core-jar-target-state.js';
import { CoreOperationLockReleaseError, withCoreOperationLock } from './core-operation-lock.js';
import { getCoreDirectJarArguments, QORTAL_CORE_DESCRIPTOR } from './core-network-descriptor.js';
import { compareCoreVersions } from './core-version.js';
import {
  inspectRecordedQortalAdoptedInstall,
  readQortalAdoptedInstallRecord,
  type QortalAdoptedInstallRecordV1,
  type QortalInstallCandidate,
} from './qortal-install-source.js';
import {
  prepareManagedLongLivedCommand,
  sanitizeManagedChildEnvironment,
  type ManagedChildCommand,
} from './managed-child-process.js';
import {
  parseQortalManagedInstallRecord,
  prepareQortalManagedInstall,
  validateQortalManagedInstallDirectories,
  type QortalManagedInstallPaths,
  type QortalManagedInstallRecordV1,
} from './qortal-managed-install.js';
import { stageVerifiedQortalJarCandidate } from './qortal-jar-candidate.js';
import { selectQortalJarRelease, type QortalJarRelease } from './qortal-release-policy.js';
import {
  detectQortalUpdateOwnershipFromLiveResponse,
  detectQortalUpdateOwnershipFromSettings,
  type QortalUpdateOwnershipDecision,
} from './qortal-settings-policy.js';

const LISTENER_PORT = 12391 as const;
const SETTINGS_ARGUMENT = 'settings.json' as const;

export type QortalInstallObservation =
  | { kind: 'missing' }
  | { kind: 'home-managed'; record: QortalManagedInstallRecordV1 }
  | { candidate: QortalInstallCandidate; kind: 'adopted'; record: QortalAdoptedInstallRecordV1 }
  | { kind: 'unknown'; reason: string };

export type QortalRuntimeAuthority = {
  canonicalCwd: string;
  canonicalJarPath: string;
  listenerPort: typeof LISTENER_PORT;
  owner: 'external' | 'home-managed' | 'unknown';
  pid: number;
  rawSettingsArgument: string;
  readiness: 'not-ready' | 'ready' | 'unknown';
  startIdentity: string;
};

/** `stopped` must prove no selected JAR process, listener, or Qortal updater/restart helper. */
export type QortalRuntimeObservation =
  | { state: 'stopped' }
  | { authority: QortalRuntimeAuthority; state: 'running' }
  | { reason: string; state: 'unknown' };

export type QortalLaunchReceipt = { pid: number; startIdentity: string };
export type QortalJavaSelection = { command: string; source: 'managed' | 'system' };
export type QortalSpawnOptions = {
  cwd: string;
  detached: true;
  env: NodeJS.ProcessEnv;
  shell: false;
  stdio: 'ignore';
  windowsHide: true;
};
export type QortalSpawnedProcess = QortalLaunchReceipt & { unref(): void };
export type QortalCandidatePaths = { candidateJarPath: string; partialPath: string };

export type QortalManagerBlockCode =
  | 'adopted-unsupported' | 'api-key-unavailable' | 'candidate-changed'
  | 'install-not-home-managed' | 'install-not-missing' | 'invalid-release'
  | 'java-unavailable' | 'launch-authority-invalid' | 'process-active'
  | 'process-ownership-unproven' | 'process-state-unknown' | 'release-not-newer'
  | 'target-changed' | 'update-node-native' | 'update-ownership-unknown';
export type QortalManagerBlockedResult = {
  code: QortalManagerBlockCode;
  kind: 'blocked';
  reason: string;
};
export type QortalManagerAction = 'initial-install' | 'start' | 'stop' | 'update';
export type QortalManagerFailureFor<A extends QortalManagerAction> = {
  action: A;
  cause: unknown;
  kind: 'failed';
};
export type QortalManagerFailureResult = {
  [A in QortalManagerAction]: QortalManagerFailureFor<A>
}[QortalManagerAction];
export type QortalInstalledResult = { kind: 'installed'; record: QortalManagedInstallRecordV1 };
export type QortalUpdatedResult = { kind: 'updated'; record: QortalManagedInstallRecordV1 };
export type QortalStartedResult = {
  authority: QortalRuntimeAuthority;
  javaSource: QortalJavaSelection['source'];
  kind: 'started';
};
export type QortalStartUnconfirmedResult = {
  kind: 'start-unconfirmed';
  receipt: QortalLaunchReceipt | null;
  runtime: QortalRuntimeObservation;
};
export type QortalStoppedResult = { kind: 'stopped' };
export type QortalStopUnconfirmedResult = {
  kind: 'stop-unconfirmed';
  runtime: QortalRuntimeObservation;
};
type QortalManagerOutcomeByAction = {
  'initial-install': QortalManagerBlockedResult | QortalInstalledResult;
  start: QortalManagerBlockedResult | QortalStartedResult | QortalStartUnconfirmedResult;
  stop: QortalManagerBlockedResult | QortalStoppedResult | QortalStopUnconfirmedResult;
  update: QortalManagerBlockedResult | QortalUpdatedResult;
};
export type QortalManagerCompletedWithWarningFor<A extends QortalManagerAction> = {
  action: A;
  cause: unknown;
  kind: 'completed-with-warning';
  outcome: QortalManagerOutcomeByAction[A];
};
export type QortalManagerCompletedWithWarningResult = {
  [A in QortalManagerAction]: QortalManagerCompletedWithWarningFor<A>
}[QortalManagerAction];
export type QortalInstallResult = QortalManagerBlockedResult |
  QortalManagerFailureFor<'initial-install'> |
  QortalManagerCompletedWithWarningFor<'initial-install'> | QortalInstalledResult;
export type QortalUpdateResult = QortalManagerBlockedResult |
  QortalManagerFailureFor<'update'> |
  QortalManagerCompletedWithWarningFor<'update'> | QortalUpdatedResult;
export type QortalStartResult = QortalManagerBlockedResult |
  QortalManagerFailureFor<'start'> | QortalManagerCompletedWithWarningFor<'start'> |
  QortalStartedResult | QortalStartUnconfirmedResult;
export type QortalStopResult = QortalManagerBlockedResult |
  QortalManagerFailureFor<'stop'> | QortalManagerCompletedWithWarningFor<'stop'> |
  QortalStoppedResult | QortalStopUnconfirmedResult;

export type QortalCoreManagerStatus = {
  capabilities: { canInitialInstall: boolean; canStart: boolean; canStop: boolean; canUpdate: boolean };
  install: QortalInstallObservation;
  runtime: QortalRuntimeObservation;
  updateOwnership: QortalUpdateOwnershipDecision;
};
export type QortalCoreManagerConfig = {
  adoptedRecordPath: string;
  lockRoot: string;
  paths: QortalManagedInstallPaths;
  readAdoptedRecord?(recordPath: string, maxBytes: number): Promise<Buffer>;
  userAgent: string;
};
export type QortalCoreManagerOperations = {
  createCandidatePaths(paths: QortalManagedInstallPaths): QortalCandidatePaths;
  detectLiveOwnership: typeof detectQortalUpdateOwnershipFromLiveResponse;
  detectStoppedOwnership: typeof detectQortalUpdateOwnershipFromSettings;
  ensureDirectory(targetPath: string): Promise<void>;
  inspectInstall(paths: QortalManagedInstallPaths): Promise<QortalInstallObservation>;
  inspectRuntime(paths: QortalManagedInstallPaths): Promise<QortalRuntimeObservation>;
  prepareCommand(command: string, args: readonly string[], platform?: NodeJS.Platform, appDir?: string): ManagedChildCommand;
  prepareInstall: typeof prepareQortalManagedInstall;
  readApiKey(
    paths: QortalManagedInstallPaths,
    expectedAuthority: QortalRuntimeAuthority,
  ): Promise<string | null>;
  readLiveAutoUpdate(paths: QortalManagedInstallPaths): Promise<unknown>;
  readTargetState: typeof readCoreJarTargetState;
  resolveJava(paths: QortalManagedInstallPaths): Promise<QortalJavaSelection | null>;
  runInstallTransaction: typeof runCoreJarInstallTransaction;
  selectRelease: typeof selectQortalJarRelease;
  spawnProcess(command: string, args: readonly string[], options: QortalSpawnOptions): Promise<QortalSpawnedProcess>;
  stageCandidate: typeof stageVerifiedQortalJarCandidate;
  statesMatch: typeof coreJarTargetStatesMatch;
  stopWithApiKey(input: { apiKey: string; expectedAuthority: QortalRuntimeAuthority; url: string }): Promise<void>;
  validateDirectories: typeof validateQortalManagedInstallDirectories;
  waitForReadiness(paths: QortalManagedInstallPaths, receipt: QortalLaunchReceipt): Promise<QortalRuntimeObservation>;
  waitForStopped(paths: QortalManagedInstallPaths, authority: QortalRuntimeAuthority): Promise<QortalRuntimeObservation>;
  withOperationLock: typeof withCoreOperationLock;
};

function errorCode(error: unknown) {
  return error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
}
async function pathKind(targetPath: string) {
  try {
    return (await lstat(targetPath)).isFile() ? 'file' : 'other';
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 'missing';
    throw error;
  }
}
async function inspectManagedInstall(paths: QortalManagedInstallPaths): Promise<QortalInstallObservation> {
  const [jarKind, metadataKind] = await Promise.all([pathKind(paths.jarPath), pathKind(paths.currentMetadataPath)]);
  if (jarKind === 'missing' && metadataKind === 'missing') return { kind: 'missing' };
  if (jarKind !== 'file' || metadataKind !== 'file') {
    return { kind: 'unknown', reason: 'The managed JAR and metadata are incomplete.' };
  }
  try {
    const record = parseQortalManagedInstallRecord(
      JSON.parse(await readFile(paths.currentMetadataPath, 'utf8')) as unknown,
      paths,
    );
    return record ? { kind: 'home-managed', record } :
      { kind: 'unknown', reason: 'The managed-install metadata is invalid.' };
  } catch {
    return { kind: 'unknown', reason: 'The managed-install metadata could not be read.' };
  }
}

export async function inspectQortalInstallSource(
  paths: QortalManagedInstallPaths,
  adoptedRecordPath: string,
  options: Parameters<typeof readQortalAdoptedInstallRecord>[1] = {},
): Promise<QortalInstallObservation> {
  const managed = await inspectManagedInstall(paths);
  if (managed.kind !== 'missing') return managed;
  const selected = await readQortalAdoptedInstallRecord(adoptedRecordPath, options);
  if (selected.kind === 'missing') return managed;
  if (selected.kind === 'unknown') return selected;
  const inspected = await inspectRecordedQortalAdoptedInstall(selected.record, paths, options);
  if (inspected.kind === 'candidate') {
    return { candidate: inspected.candidate, kind: 'adopted', record: selected.record };
  }
  return inspected.kind === 'unknown' ? inspected : {
    kind: 'unknown',
    reason: 'The recorded adopted Qortal install is no longer present.',
  };
}

const DEFAULT_OPERATIONS: Omit<QortalCoreManagerOperations,
  'inspectRuntime' | 'readApiKey' | 'readLiveAutoUpdate' | 'resolveJava' | 'spawnProcess' |
  'stopWithApiKey' | 'waitForReadiness' | 'waitForStopped'> = {
  createCandidatePaths: (paths) => {
    const token = randomBytes(12).toString('hex');
    const candidateJarPath = path.join(paths.installPath, `.qortium-home-qortal-candidate-${token}.jar`);
    return { candidateJarPath, partialPath: `${candidateJarPath}.partial` };
  },
  detectLiveOwnership: detectQortalUpdateOwnershipFromLiveResponse,
  detectStoppedOwnership: detectQortalUpdateOwnershipFromSettings,
  ensureDirectory: async (targetPath) => { await mkdir(targetPath, { mode: 0o700, recursive: true }); },
  inspectInstall: inspectManagedInstall,
  prepareCommand: prepareManagedLongLivedCommand,
  prepareInstall: prepareQortalManagedInstall,
  readTargetState: readCoreJarTargetState,
  runInstallTransaction: runCoreJarInstallTransaction,
  selectRelease: selectQortalJarRelease,
  stageCandidate: stageVerifiedQortalJarCandidate,
  statesMatch: coreJarTargetStatesMatch,
  validateDirectories: validateQortalManagedInstallDirectories,
  withOperationLock: withCoreOperationLock,
};

function unknownOwnership(reason: string): QortalUpdateOwnershipDecision {
  return { detection: { checkedAt: new Date().toISOString(), defaultEnabled: true, enabled: null,
    reason, source: 'unknown', usedDefault: false }, ownership: 'observe-only' };
}
function blocked(code: QortalManagerBlockCode, reason: string): QortalManagerBlockedResult {
  return { code, kind: 'blocked', reason };
}
function installBlock(install: QortalInstallObservation, expected: 'home-managed' | 'missing') {
  if (install.kind === expected) return null;
  if (install.kind === 'adopted') return blocked('adopted-unsupported', 'Adopted Qortal installs are observation-only in this manager.');
  return blocked(expected === 'missing' ? 'install-not-missing' : 'install-not-home-managed',
    install.kind === 'unknown' ? install.reason : `The Qortal install must be ${expected}.`);
}
function stoppedBlock(runtime: QortalRuntimeObservation) {
  if (runtime.state === 'stopped') return null;
  return runtime.state === 'unknown' ? blocked('process-state-unknown', runtime.reason) :
    blocked('process-active', 'Qortal must be proven stopped before this operation.');
}
function policyBlock(decision: QortalUpdateOwnershipDecision) {
  if (decision.ownership === 'home-github') return null;
  return decision.ownership === 'node-native' ?
    blocked('update-node-native', 'Qortal native auto-update owns JAR updates.') :
    blocked('update-ownership-unknown', 'Qortal update ownership could not be proven.');
}
function candidateMatches(state: CoreJarTargetState, candidate: Awaited<ReturnType<typeof stageVerifiedQortalJarCandidate>>) {
  return state.kind === 'file' && path.resolve(state.canonicalPath) === path.resolve(candidate.candidateJarPath) &&
    state.size === candidate.size && state.sha256 === candidate.digest &&
    JSON.stringify(state.identity) === JSON.stringify(candidate.identity);
}
function targetMatches(state: CoreJarTargetState, record: QortalManagedInstallRecordV1) {
  return state.kind === 'file' && path.resolve(state.canonicalPath) === path.resolve(record.jarPath) &&
    state.size === record.release.asset.size && state.sha256 === record.release.asset.digest &&
    JSON.stringify(state.identity) === JSON.stringify(record.jarIdentity);
}
function validReceipt(value: QortalLaunchReceipt) {
  return Number.isSafeInteger(value.pid) && value.pid > 0 && value.startIdentity.trim().length > 0;
}
function sameRuntimeIdentity(a: QortalRuntimeAuthority, b: Pick<QortalRuntimeAuthority, 'pid' | 'startIdentity'>) {
  return a.pid === b.pid && a.startIdentity === b.startIdentity;
}
function expectedRuntime(authority: QortalRuntimeAuthority, paths: QortalManagedInstallPaths, receipt?: QortalLaunchReceipt) {
  return authority.owner === 'home-managed' && authority.readiness === 'ready' &&
    authority.listenerPort === LISTENER_PORT && authority.rawSettingsArgument === SETTINGS_ARGUMENT &&
    path.resolve(authority.canonicalCwd) === path.resolve(paths.installPath) &&
    path.resolve(authority.canonicalJarPath) === path.resolve(paths.jarPath) && validReceipt(authority) &&
    (!receipt || sameRuntimeIdentity(authority, receipt));
}
function sameAuthority(a: QortalRuntimeAuthority, b: QortalRuntimeAuthority) {
  return sameRuntimeIdentity(a, b) && a.owner === b.owner && a.readiness === b.readiness &&
    a.listenerPort === b.listenerPort && a.rawSettingsArgument === b.rawSettingsArgument &&
    path.resolve(a.canonicalCwd) === path.resolve(b.canonicalCwd) &&
    path.resolve(a.canonicalJarPath) === path.resolve(b.canonicalJarPath);
}
function safeCandidatePaths(paths: QortalManagedInstallPaths, value: QortalCandidatePaths) {
  const candidateJarPath = path.resolve(value.candidateJarPath);
  const partialPath = path.resolve(value.partialPath);
  const names = new Set([candidateJarPath, partialPath, path.resolve(paths.jarPath), path.resolve(paths.backupJarPath)]);
  if (names.size !== 4 || path.dirname(candidateJarPath) !== path.resolve(paths.installPath) ||
      path.dirname(partialPath) !== path.resolve(paths.installPath)) {
    throw new Error('Qortal candidate paths must be distinct direct siblings of the managed JAR.');
  }
  return { candidateJarPath, partialPath };
}
function includesCommittedCleanup(error: unknown): boolean {
  return error instanceof CoreJarInstallCleanupError ||
    (error instanceof AggregateError && [...error.errors].some(includesCommittedCleanup));
}
function completedWarning<A extends QortalManagerAction>(
  action: A,
  outcome: QortalManagerOutcomeByAction[A],
  cause: unknown,
): QortalManagerCompletedWithWarningFor<A> {
  return { action, cause, kind: 'completed-with-warning', outcome };
}

type Staged = {
  candidate: Awaited<ReturnType<typeof stageVerifiedQortalJarCandidate>>;
  paths: QortalCandidatePaths;
  receipt: CoreJarTargetState;
};

export class QortalCoreManager {
  readonly descriptor = QORTAL_CORE_DESCRIPTOR;
  readonly networkId = 'qortal' as const;
  private readonly operations: QortalCoreManagerOperations;

  constructor(readonly config: QortalCoreManagerConfig,
    lifecycle: Pick<QortalCoreManagerOperations, 'inspectRuntime' | 'readLiveAutoUpdate' |
      'readApiKey' | 'resolveJava' | 'spawnProcess' | 'stopWithApiKey' | 'waitForReadiness' | 'waitForStopped'> &
      Partial<QortalCoreManagerOperations>) {
    this.operations = {
      ...DEFAULT_OPERATIONS,
      inspectInstall: async (paths) => await inspectQortalInstallSource(paths, config.adoptedRecordPath, {
        operations: config.readAdoptedRecord ? { readSecureRecord: config.readAdoptedRecord } : {},
      }),
      ...lifecycle,
    };
  }

  private async ownership(
    runtime: QortalRuntimeObservation,
    install: Extract<QortalInstallObservation, { kind: 'adopted' | 'home-managed' }>,
  ) {
    if (runtime.state === 'stopped') {
      const cwd = install.kind === 'adopted'
        ? install.candidate.canonicalInstallPath
        : this.config.paths.installPath;
      return await this.operations.detectStoppedOwnership(SETTINGS_ARGUMENT, { cwd });
    }
    if (install.kind !== 'home-managed' || runtime.state !== 'running' ||
        !expectedRuntime(runtime.authority, this.config.paths)) {
      return unknownOwnership('Qortal runtime authority/readiness is uncertain.');
    }
    try { return this.operations.detectLiveOwnership(await this.operations.readLiveAutoUpdate(this.config.paths)); }
    catch { return unknownOwnership('The live Qortal auto-update setting could not be read.'); }
  }

  async getStatus(): Promise<QortalCoreManagerStatus> {
    const [install, runtime] = await Promise.all([
      this.operations.inspectInstall(this.config.paths), this.operations.inspectRuntime(this.config.paths),
    ]);
    const updateOwnership = install.kind === 'home-managed' || install.kind === 'adopted'
      ? await this.ownership(runtime, install) :
      unknownOwnership(install.kind === 'missing' ? 'Qortal is not installed.' :
        'Qortal install evidence is uncertain.');
    const targetOk = install.kind === 'home-managed' && targetMatches(
      await this.operations.readTargetState(this.config.paths.jarPath), install.record);
    const runningOwned = runtime.state === 'running' && expectedRuntime(runtime.authority, this.config.paths);
    return { capabilities: {
      canInitialInstall: install.kind === 'missing' && runtime.state === 'stopped',
      canStart: targetOk && runtime.state === 'stopped',
      canStop: targetOk && runningOwned,
      canUpdate: targetOk && runtime.state === 'stopped' && updateOwnership.ownership === 'home-github',
    }, install, runtime, updateOwnership };
  }

  private release(value: unknown) {
    return this.operations.selectRelease(value) ?? blocked('invalid-release', 'The Qortal release metadata was rejected.');
  }
  private async ensureDirectories() {
    await this.operations.ensureDirectory(this.config.paths.basePath);
    await this.operations.ensureDirectory(this.config.paths.installPath);
    await this.operations.ensureDirectory(this.config.lockRoot);
    await this.operations.validateDirectories(this.config.paths);
  }
  private async stage(release: QortalJarRelease): Promise<Staged> {
    const paths = safeCandidatePaths(this.config.paths, this.operations.createCandidatePaths(this.config.paths));
    const candidate = await this.operations.stageCandidate({ ...paths, release, userAgent: this.config.userAgent });
    const receipt = await this.operations.readTargetState(paths.candidateJarPath);
    if (!candidateMatches(receipt, candidate)) throw new Error('The Qortal candidate changed before its staging receipt was captured.');
    return { candidate, paths, receipt };
  }
  private async installBarrier(expected: 'home-managed' | 'missing', targetBefore: CoreJarTargetState, staged: Staged) {
    await this.operations.validateDirectories(this.config.paths);
    const install = await this.operations.inspectInstall(this.config.paths);
    const guard = installBlock(install, expected);
    if (guard) return guard;
    const target = await this.operations.readTargetState(this.config.paths.jarPath);
    if (!this.operations.statesMatch(targetBefore, target) ||
        (install.kind === 'home-managed' && !targetMatches(target, install.record))) {
      return blocked('target-changed', 'The managed Qortal JAR changed before the transaction.');
    }
    const candidate = await this.operations.readTargetState(staged.paths.candidateJarPath);
    if (!this.operations.statesMatch(staged.receipt, candidate) || !candidateMatches(candidate, staged.candidate)) {
      return blocked('candidate-changed', 'The verified Qortal candidate changed before the transaction.');
    }
    return stoppedBlock(await this.operations.inspectRuntime(this.config.paths));
  }

  async install(value: unknown): Promise<QortalInstallResult> {
    const release = this.release(value);
    if ('kind' in release) return release;
    let completed: QortalManagerOutcomeByAction['initial-install'] | null = null;
    let staged: Staged | null = null;
    let record: QortalManagedInstallRecordV1 | null = null;
    try {
      const installGuard = installBlock(await this.operations.inspectInstall(this.config.paths), 'missing');
      if (installGuard) return installGuard;
      const runtimeGuard = stoppedBlock(await this.operations.inspectRuntime(this.config.paths));
      if (runtimeGuard) return runtimeGuard;
      await this.ensureDirectories();
      const targetBefore = await this.operations.readTargetState(this.config.paths.jarPath);
      if (targetBefore.kind !== 'missing') return blocked('target-changed', 'The initial Qortal JAR target is not missing.');
      staged = await this.stage(release);
      const result = await this.operations.withOperationLock({ lockRoot: this.config.lockRoot, networkId: 'qortal',
        op: 'initial-install', targetPath: this.config.paths.jarPath }, async () => {
        let guard = await this.installBarrier('missing', targetBefore, staged!);
        if (guard) return (completed = guard);
        const callbacks = await this.operations.prepareInstall({ identity: staged!.candidate.identity,
          kind: 'initial-install', paths: this.config.paths, release });
        record = callbacks.record;
        guard = await this.installBarrier('missing', targetBefore, staged!);
        if (guard) return (completed = guard);
        try {
          await this.operations.runInstallTransaction({ ...callbacks, backupJarPath: this.config.paths.backupJarPath,
            candidateJarPath: staged!.paths.candidateJarPath, targetJarPath: this.config.paths.jarPath });
        } catch (error) {
          if (error instanceof CoreJarInstallCleanupError) completed = { kind: 'installed', record: callbacks.record };
          throw error;
        }
        return (completed = { kind: 'installed', record: callbacks.record });
      });
      // A verified candidate that was not consumed is retained. Node has no
      // conditional unlink-by-inode primitive, so pathname cleanup could delete
      // replacement bytes that are not represented by our receipt.
      return result;
    } catch (cause) {
      if (includesCommittedCleanup(cause) && record) return completedWarning('initial-install', { kind: 'installed', record }, cause);
      if (cause instanceof CoreOperationLockReleaseError && completed) return completedWarning('initial-install', completed, cause);
      return { action: 'initial-install', cause, kind: 'failed' };
    }
  }

  async update(value: unknown): Promise<QortalUpdateResult> {
    const release = this.release(value);
    if ('kind' in release) return release;
    let completed: QortalManagerOutcomeByAction['update'] | null = null;
    let staged: Staged | null = null;
    let record: QortalManagedInstallRecordV1 | null = null;
    try {
      const initialInstall = await this.operations.inspectInstall(this.config.paths);
      const installGuard = installBlock(initialInstall, 'home-managed');
      if (installGuard) return installGuard;
      if (initialInstall.kind !== 'home-managed') {
        return blocked('install-not-home-managed', 'The Qortal install must be Home-managed.');
      }
      const initialRuntime = await this.operations.inspectRuntime(this.config.paths);
      const runtimeGuard = stoppedBlock(initialRuntime);
      if (runtimeGuard) return runtimeGuard;
      const initialPolicyGuard = policyBlock(await this.ownership(initialRuntime, initialInstall));
      if (initialPolicyGuard) return initialPolicyGuard;
      await this.ensureDirectories();
      const targetBefore = await this.operations.readTargetState(this.config.paths.jarPath);
      if (initialInstall.kind !== 'home-managed' || !targetMatches(targetBefore, initialInstall.record)) {
        return blocked('target-changed', 'The managed Qortal JAR does not match its install record.');
      }
      const comparison = compareCoreVersions(release.tagName, initialInstall.record.jarIdentity.semver);
      if (comparison === null || comparison <= 0) return blocked('release-not-newer', 'A Home-managed update must be strictly newer.');
      staged = await this.stage(release);
      const result = await this.operations.withOperationLock({ lockRoot: this.config.lockRoot, networkId: 'qortal',
        op: 'github-update', targetPath: this.config.paths.jarPath }, async () => {
        let guard = await this.installBarrier('home-managed', targetBefore, staged!);
        if (guard) return (completed = guard);
        guard = policyBlock(await this.ownership({ state: 'stopped' }, initialInstall));
        if (guard) return (completed = guard);
        const callbacks = await this.operations.prepareInstall({ identity: staged!.candidate.identity,
          kind: 'update', paths: this.config.paths, release });
        record = callbacks.record;
        guard = await this.installBarrier('home-managed', targetBefore, staged!);
        if (guard) return (completed = guard);
        const finalTarget = await this.operations.readTargetState(this.config.paths.jarPath);
        if (!this.operations.statesMatch(targetBefore, finalTarget)) return (completed = blocked('target-changed', 'The JAR changed at the transaction boundary.'));
        const finalCandidate = await this.operations.readTargetState(staged!.paths.candidateJarPath);
        if (!this.operations.statesMatch(staged!.receipt, finalCandidate) || !candidateMatches(finalCandidate, staged!.candidate)) {
          return (completed = blocked('candidate-changed', 'The candidate changed at the transaction boundary.'));
        }
        guard = policyBlock(await this.ownership({ state: 'stopped' }, initialInstall));
        if (guard) return (completed = guard);
        // Hub does not honor Home's lease. This strong absence proof must be
        // the final operation before the filesystem transaction begins.
        guard = stoppedBlock(await this.operations.inspectRuntime(this.config.paths));
        if (guard) return (completed = guard);
        try {
          await this.operations.runInstallTransaction({ ...callbacks, backupJarPath: this.config.paths.backupJarPath,
            candidateJarPath: staged!.paths.candidateJarPath, targetJarPath: this.config.paths.jarPath });
        } catch (error) {
          if (error instanceof CoreJarInstallCleanupError) completed = { kind: 'updated', record: callbacks.record };
          throw error;
        }
        return (completed = { kind: 'updated', record: callbacks.record });
      });
      return result;
    } catch (cause) {
      if (includesCommittedCleanup(cause) && record) return completedWarning('update', { kind: 'updated', record }, cause);
      if (cause instanceof CoreOperationLockReleaseError && completed) return completedWarning('update', completed, cause);
      return { action: 'update', cause, kind: 'failed' };
    }
  }

  async start(): Promise<QortalStartResult> {
    let completed: QortalManagerOutcomeByAction['start'] | null = null;
    try {
      const firstGuard = installBlock(await this.operations.inspectInstall(this.config.paths), 'home-managed');
      if (firstGuard) return firstGuard;
      await this.ensureDirectories();
      return await this.operations.withOperationLock({ lockRoot: this.config.lockRoot, networkId: 'qortal', op: 'start',
        targetPath: this.config.paths.jarPath }, async () => {
        await this.operations.validateDirectories(this.config.paths);
        const install = await this.operations.inspectInstall(this.config.paths);
        let guard = installBlock(install, 'home-managed');
        if (guard) return (completed = guard);
        guard = stoppedBlock(await this.operations.inspectRuntime(this.config.paths));
        if (guard) return (completed = guard);
        const target = await this.operations.readTargetState(this.config.paths.jarPath);
        if (install.kind !== 'home-managed' || !targetMatches(target, install.record)) return (completed = blocked('target-changed', 'The managed JAR does not match its record.'));
        const java = await this.operations.resolveJava(this.config.paths);
        if (!java?.command.trim()) return (completed = blocked('java-unavailable', 'No Java runtime is available.'));
        const args = getCoreDirectJarArguments(QORTAL_CORE_DESCRIPTOR, path.resolve(this.config.paths.jarPath), SETTINGS_ARGUMENT);
        const command = this.operations.prepareCommand(java.command, args, process.platform, process.env.APPDIR);
        await this.operations.validateDirectories(this.config.paths);
        const finalInstall = await this.operations.inspectInstall(this.config.paths);
        const finalTarget = await this.operations.readTargetState(this.config.paths.jarPath);
        if (finalInstall.kind !== 'home-managed' || !this.operations.statesMatch(target, finalTarget) || !targetMatches(finalTarget, finalInstall.record)) {
          return (completed = blocked('target-changed', 'The managed JAR changed at the launch boundary.'));
        }
        guard = stoppedBlock(await this.operations.inspectRuntime(this.config.paths));
        if (guard) return (completed = guard);
        const child = await this.operations.spawnProcess(command.command, command.args, { cwd: path.resolve(this.config.paths.installPath),
          detached: true, env: sanitizeManagedChildEnvironment(), shell: false, stdio: 'ignore', windowsHide: true });
        child.unref();
        if (!validReceipt(child)) return (completed = {
          kind: 'start-unconfirmed',
          receipt: null,
          runtime: { reason: 'The spawned process has no stable PID/start identity.', state: 'unknown' },
        });
        const receipt = { pid: child.pid, startIdentity: child.startIdentity };
        let runtime: QortalRuntimeObservation;
        try {
          runtime = await this.operations.waitForReadiness(this.config.paths, receipt);
        } catch (error) {
          runtime = {
            reason: `Qortal readiness could not be confirmed after launch: ${error instanceof Error ? error.message : String(error)}`,
            state: 'unknown',
          };
        }
        if (runtime.state !== 'running' || !expectedRuntime(runtime.authority, this.config.paths, receipt)) {
          return (completed = { kind: 'start-unconfirmed', receipt, runtime });
        }
        return (completed = { authority: runtime.authority, javaSource: java.source, kind: 'started' });
      });
    } catch (cause) {
      if (cause instanceof CoreOperationLockReleaseError && completed) return completedWarning('start', completed, cause);
      return { action: 'start', cause, kind: 'failed' };
    }
  }

  async stop(): Promise<QortalStopResult> {
    let completed: QortalManagerOutcomeByAction['stop'] | null = null;
    try {
      const firstGuard = installBlock(await this.operations.inspectInstall(this.config.paths), 'home-managed');
      if (firstGuard) return firstGuard;
      await this.ensureDirectories();
      return await this.operations.withOperationLock({ lockRoot: this.config.lockRoot, networkId: 'qortal', op: 'stop',
        targetPath: this.config.paths.jarPath }, async () => {
        await this.operations.validateDirectories(this.config.paths);
        const install = await this.operations.inspectInstall(this.config.paths);
        const installGuard = installBlock(install, 'home-managed');
        if (installGuard) return (completed = installGuard);
        const runtime = await this.operations.inspectRuntime(this.config.paths);
        if (runtime.state !== 'running' || !expectedRuntime(runtime.authority, this.config.paths)) {
          return (completed = blocked('process-ownership-unproven', 'Only a ready, positively Home-owned process can be stopped.'));
        }
        const target = await this.operations.readTargetState(this.config.paths.jarPath);
        if (install.kind !== 'home-managed' || !targetMatches(target, install.record)) return (completed = blocked('target-changed', 'The managed JAR does not match its record.'));
        const apiKey = await this.operations.readApiKey(this.config.paths, runtime.authority);
        if (!apiKey) return (completed = blocked('api-key-unavailable', 'The managed API key is unavailable.'));
        await this.operations.validateDirectories(this.config.paths);
        const finalInstall = await this.operations.inspectInstall(this.config.paths);
        const finalTarget = await this.operations.readTargetState(this.config.paths.jarPath);
        const finalRuntime = await this.operations.inspectRuntime(this.config.paths);
        if (finalInstall.kind !== 'home-managed' || !this.operations.statesMatch(target, finalTarget) || !targetMatches(finalTarget, finalInstall.record)) {
          return (completed = blocked('target-changed', 'The managed JAR changed at the stop boundary.'));
        }
        if (finalRuntime.state !== 'running' || !sameAuthority(runtime.authority, finalRuntime.authority) || !expectedRuntime(finalRuntime.authority, this.config.paths)) {
          return (completed = blocked('process-ownership-unproven', 'Runtime authority changed before stop.'));
        }
        await this.operations.stopWithApiKey({ apiKey, expectedAuthority: finalRuntime.authority,
          url: `${QORTAL_CORE_DESCRIPTOR.localApi.url}${QORTAL_CORE_DESCRIPTOR.localApi.stopPath}` });
        let observed: QortalRuntimeObservation;
        try {
          observed = await this.operations.waitForStopped(this.config.paths, finalRuntime.authority);
        } catch (error) {
          observed = {
            reason: `Qortal stop could not be confirmed after the request was accepted: ${error instanceof Error ? error.message : String(error)}`,
            state: 'unknown',
          };
        }
        return (completed = observed.state === 'stopped' ? { kind: 'stopped' } : { kind: 'stop-unconfirmed', runtime: observed });
      });
    } catch (cause) {
      if (cause instanceof CoreOperationLockReleaseError && completed) return completedWarning('stop', completed, cause);
      return { action: 'stop', cause, kind: 'failed' };
    }
  }
}
