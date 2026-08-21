import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { lstat as nodeLstat } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';

export const CORE_NATIVE_OBSERVER_SCHEMA = 'qortium-core-observer' as const;
export const CORE_NATIVE_OBSERVER_SCHEMA_VERSION = 1 as const;
export const CORE_NATIVE_OBSERVER_TIMEOUT_MS = 2_000;
export const CORE_NATIVE_OBSERVER_STDOUT_LIMIT_BYTES = 1024 * 1024;
export const CORE_NATIVE_OBSERVER_STDERR_LIMIT_BYTES = 16 * 1024;

const MAX_ARGUMENTS = 4_096;
const MAX_ARGUMENT_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_ARGUMENT_BYTES = 2 * 1024 * 1024;
const MAX_PATH_BYTES = 32 * 1024;
const MAX_SIGNED_64_BIT = 9_223_372_036_854_775_807n;
const MAX_UNSIGNED_64_BIT = 18_446_744_073_709_551_615n;
const BOOT_SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const DARWIN_SOCKET_ID = /^([0-9a-f]{16}):(0|[1-9][0-9]*)$/;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export type CoreNativeObserverPlatform = 'darwin' | 'win32';
export type CoreNativeObserverArch = 'arm64' | 'x64';

export type CoreNativeDarwinProcessStartIdentity = {
  kind: 'darwin';
  microseconds: string;
  seconds: string;
};
export type CoreNativeWindowsProcessStartIdentity = { fileTime: string; kind: 'windows' };
export type CoreNativeProcessStartIdentity =
  | CoreNativeDarwinProcessStartIdentity
  | CoreNativeWindowsProcessStartIdentity;

export type CoreNativeProcessSnapshot<
  StartIdentity extends CoreNativeProcessStartIdentity = CoreNativeProcessStartIdentity,
> = {
  argv: readonly string[];
  canonicalCwd: string;
  executablePath: string;
  pid: number;
  startIdentity: StartIdentity;
};

export type CoreNativeDarwinListenerHolder = {
  pid: number;
  socketIds: readonly string[];
  startIdentity: CoreNativeDarwinProcessStartIdentity;
};

type CoreNativeEnvelopeBase = {
  arch: CoreNativeObserverArch;
  bootSessionId: string;
  effectiveUid: number;
  platform: 'darwin';
  schema: typeof CORE_NATIVE_OBSERVER_SCHEMA;
  schemaVersion: typeof CORE_NATIVE_OBSERVER_SCHEMA_VERSION;
};

export type CoreNativeDarwinProcessesEnvelope = CoreNativeEnvelopeBase & {
  mode: 'processes';
  processes: readonly CoreNativeProcessSnapshot<CoreNativeDarwinProcessStartIdentity>[];
  status: 'ok';
};

export type CoreNativeDarwinListenerEnvelope = CoreNativeEnvelopeBase & {
  mode: 'listener';
  port: number;
} & (
  | { holders: readonly CoreNativeDarwinListenerHolder[]; pids: readonly number[]; status: 'owners' }
  | { status: 'absent' }
);

// The macOS v1 wire protocol is implemented now. These aliases leave the API
// discriminated by target so a future Windows schema can be added without
// weakening validation of the existing helper.
export type CoreNativeProcessesEnvelope = CoreNativeDarwinProcessesEnvelope;
export type CoreNativeListenerEnvelope = CoreNativeDarwinListenerEnvelope;
export type CoreNativeObserverEnvelope = CoreNativeProcessesEnvelope | CoreNativeListenerEnvelope;

export type CoreNativeObserverRequest =
  | { mode: 'processes' }
  | { mode: 'listener'; port: number };

export type CoreNativeObserverFailureCode =
  | 'abnormal-exit'
  | 'helper-stderr'
  | 'helper-unknown'
  | 'invalid-configuration'
  | 'invalid-envelope'
  | 'malformed-json'
  | 'nonzero-exit'
  | 'spawn-failed'
  | 'stderr-overflow'
  | 'stdout-overflow'
  | 'timeout';

export type CoreNativeObserverFailure = {
  code: CoreNativeObserverFailureCode;
  kind: 'failure';
  message: string;
};

export type CoreNativeObserverResult =
  | { envelope: CoreNativeObserverEnvelope; kind: 'success' }
  | CoreNativeObserverFailure;

export type CoreNativeObserverChild = Pick<ChildProcess, 'kill' | 'once' | 'stderr' | 'stdout'>;

export type CoreNativeObserverFileStat = {
  isFile(): boolean;
  isSymbolicLink(): boolean;
  mode: number;
  uid: number;
};

export type CoreNativeObserverOperations = {
  getEffectiveUid(): number | null;
  lstat(targetPath: string): Promise<CoreNativeObserverFileStat>;
  spawn(command: string, args: readonly string[], options: SpawnOptions): CoreNativeObserverChild;
};

export type CoreNativeObserverRunnerOptions = {
  arch: CoreNativeObserverArch;
  environmentSource?: NodeJS.ProcessEnv;
  helperPath: string;
  operations?: Partial<CoreNativeObserverOperations>;
  platform: CoreNativeObserverPlatform;
  stderrLimitBytes?: number;
  stdoutLimitBytes?: number;
  timeoutMs?: number;
};

type DarwinProcessesUnknownReason =
  | 'boot-session-unavailable'
  | 'candidate-argv-unavailable'
  | 'candidate-cwd-canonicalization-failed'
  | 'candidate-cwd-unavailable'
  | 'candidate-executable-canonicalization-failed'
  | 'candidate-executable-unavailable'
  | 'candidate-identity-changed'
  | 'candidate-identity-revalidation-failed'
  | 'output-limit-exceeded'
  | 'process-effective-uid-changed'
  | 'process-enumeration-failed'
  | 'process-identity-unavailable';

type DarwinListenerUnknownReason =
  | 'boot-session-unavailable'
  | 'listener-bind-probe-failed'
  | 'listener-occupied-without-visible-owner'
  | 'listener-owner-identity-changed'
  | 'listener-owner-identity-revalidation-failed'
  | 'listener-process-effective-uid-changed'
  | 'listener-process-fds-unavailable'
  | 'listener-process-identity-unavailable'
  | 'listener-socket-evidence-unavailable'
  | 'matching-socket-limit-exceeded'
  | 'output-limit-exceeded'
  | 'process-enumeration-failed';

const PROCESS_UNKNOWN_REASONS = new Set<DarwinProcessesUnknownReason>([
  'boot-session-unavailable',
  'candidate-argv-unavailable',
  'candidate-cwd-canonicalization-failed',
  'candidate-cwd-unavailable',
  'candidate-executable-canonicalization-failed',
  'candidate-executable-unavailable',
  'candidate-identity-changed',
  'candidate-identity-revalidation-failed',
  'output-limit-exceeded',
  'process-effective-uid-changed',
  'process-enumeration-failed',
  'process-identity-unavailable',
]);

const LISTENER_UNKNOWN_REASONS = new Set<DarwinListenerUnknownReason>([
  'boot-session-unavailable',
  'listener-bind-probe-failed',
  'listener-occupied-without-visible-owner',
  'listener-owner-identity-changed',
  'listener-owner-identity-revalidation-failed',
  'listener-process-effective-uid-changed',
  'listener-process-fds-unavailable',
  'listener-process-identity-unavailable',
  'listener-socket-evidence-unavailable',
  'matching-socket-limit-exceeded',
  'output-limit-exceeded',
  'process-enumeration-failed',
]);

const DEFAULT_OPERATIONS: CoreNativeObserverOperations = {
  getEffectiveUid: () => process.geteuid?.() ?? null,
  lstat: async (targetPath) => await nodeLstat(targetPath),
  spawn: (command, args, options) => nodeSpawn(command, [...args], options),
};

const FAILURE_MESSAGES: Record<CoreNativeObserverFailureCode, string> = {
  'abnormal-exit': 'The native observer exited without a successful status.',
  'helper-stderr': 'The native observer produced unexpected diagnostic output.',
  'helper-unknown': 'The native observer could not produce complete authority evidence.',
  'invalid-configuration': 'The native observer runner configuration is invalid.',
  'invalid-envelope': 'The native observer returned an invalid evidence envelope.',
  'malformed-json': 'The native observer returned malformed JSON.',
  'nonzero-exit': 'The native observer reported a failure status.',
  'spawn-failed': 'The native observer could not be started.',
  'stderr-overflow': 'The native observer diagnostic output exceeded its byte limit.',
  'stdout-overflow': 'The native observer evidence exceeded its byte limit.',
  timeout: 'The native observer timed out.',
};

function failure(code: CoreNativeObserverFailureCode): CoreNativeObserverFailure {
  return { code, kind: 'failure', message: FAILURE_MESSAGES[code] };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSupportedArch(value: unknown): value is CoreNativeObserverArch {
  return value === 'arm64' || value === 'x64';
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isPid(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 0x7fff_ffff;
}

function isPort(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 65_535;
}

function isEffectiveUid(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 0xffff_ffff;
}

function isDecimalString(value: unknown, allowZero: boolean, maximum = MAX_UNSIGNED_64_BIT): value is string {
  if (typeof value !== 'string' || value.length > 20) return false;
  const valid = allowZero ? /^(?:0|[1-9][0-9]*)$/.test(value) : /^[1-9][0-9]*$/.test(value);
  return valid && BigInt(value) <= maximum;
}

function parseDarwinStart(seconds: unknown, microseconds: unknown): CoreNativeDarwinProcessStartIdentity | null {
  if (!isDecimalString(seconds, false, MAX_SIGNED_64_BIT) ||
    !isDecimalString(microseconds, true, 999_999n)) return null;
  return { kind: 'darwin', microseconds, seconds };
}

function decodeBase64Utf8(value: unknown, maximumBytes: number): string | null {
  if (typeof value !== 'string' || value.length > Math.ceil(maximumBytes / 3) * 4 ||
    value.length % 4 !== 0 || !CANONICAL_BASE64.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength > maximumBytes || bytes.toString('base64') !== value) return null;
  try {
    const decoded = UTF8_DECODER.decode(bytes);
    return decoded.includes('\0') ? null : decoded;
  } catch {
    return null;
  }
}

function isCanonicalAbsolutePath(value: string, platform: 'darwin' | 'win32'): boolean {
  if (value.length === 0 || Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES) return false;
  const pathApi = platform === 'darwin' ? path.posix : path.win32;
  return pathApi.isAbsolute(value) && pathApi.normalize(value) === value;
}

function parseDarwinProcess(value: unknown): CoreNativeProcessSnapshot<CoreNativeDarwinProcessStartIdentity> | null {
  if (!isObject(value) || !hasExactKeys(value, [
    'argvBase64', 'canonicalCwdBase64', 'executablePathBase64', 'pid', 'startMicroseconds', 'startSeconds',
  ]) || !isPid(value.pid) || !Array.isArray(value.argvBase64) ||
    value.argvBase64.length < 1 || value.argvBase64.length > MAX_ARGUMENTS) return null;

  const executablePath = decodeBase64Utf8(value.executablePathBase64, MAX_PATH_BYTES);
  const canonicalCwd = decodeBase64Utf8(value.canonicalCwdBase64, MAX_PATH_BYTES);
  const startIdentity = parseDarwinStart(value.startSeconds, value.startMicroseconds);
  if (!executablePath || !canonicalCwd || !startIdentity ||
    !isCanonicalAbsolutePath(executablePath, 'darwin') || !isCanonicalAbsolutePath(canonicalCwd, 'darwin')) return null;

  let totalBytes = 0;
  const argv: string[] = [];
  for (const encodedArgument of value.argvBase64) {
    const argument = decodeBase64Utf8(encodedArgument, MAX_ARGUMENT_BYTES);
    if (argument === null) return null;
    totalBytes += Buffer.byteLength(argument, 'utf8');
    if (totalBytes > MAX_TOTAL_ARGUMENT_BYTES) return null;
    argv.push(argument);
  }
  if (argv[0].length === 0) return null;
  return { argv, canonicalCwd, executablePath, pid: value.pid, startIdentity };
}

function parsePidList(value: unknown, allowEmpty: boolean): readonly number[] | null {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return null;
  const pids: number[] = [];
  let previous = 0;
  for (const pid of value) {
    if (!isPid(pid) || pid <= previous) return null;
    pids.push(pid);
    previous = pid;
  }
  return pids;
}

function compareSocketIds(left: string, right: string): number {
  const leftMatch = DARWIN_SOCKET_ID.exec(left)!;
  const rightMatch = DARWIN_SOCKET_ID.exec(right)!;
  const leftHandle = BigInt(`0x${leftMatch[1]}`);
  const rightHandle = BigInt(`0x${rightMatch[1]}`);
  if (leftHandle !== rightHandle) return leftHandle < rightHandle ? -1 : 1;
  const leftGeneration = BigInt(leftMatch[2]);
  const rightGeneration = BigInt(rightMatch[2]);
  return leftGeneration === rightGeneration ? 0 : leftGeneration < rightGeneration ? -1 : 1;
}

function parseSocketIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1_024) return null;
  const socketIds: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string') return null;
    const match = DARWIN_SOCKET_ID.exec(candidate);
    if (!match || BigInt(`0x${match[1]}`) === 0n || BigInt(match[2]) > MAX_UNSIGNED_64_BIT ||
      (socketIds.length > 0 && compareSocketIds(socketIds[socketIds.length - 1], candidate) >= 0)) return null;
    socketIds.push(candidate);
  }
  return socketIds;
}

function parseDarwinListenerHolders(
  value: unknown,
  pids: readonly number[],
): readonly CoreNativeDarwinListenerHolder[] | null {
  if (!Array.isArray(value) || value.length !== pids.length) return null;
  const holders: CoreNativeDarwinListenerHolder[] = [];
  for (let index = 0; index < value.length; ++index) {
    const candidate = value[index];
    if (!isObject(candidate) || !hasExactKeys(candidate, [
      'pid', 'socketIds', 'startMicroseconds', 'startSeconds',
    ]) || candidate.pid !== pids[index]) return null;
    const startIdentity = parseDarwinStart(candidate.startSeconds, candidate.startMicroseconds);
    const socketIds = parseSocketIds(candidate.socketIds);
    if (!startIdentity || !socketIds) return null;
    holders.push({ pid: pids[index], socketIds, startIdentity });
  }
  return holders;
}

function commonDarwinEnvelopeMatches(value: Record<string, unknown>, request: CoreNativeObserverRequest) {
  return value.schema === CORE_NATIVE_OBSERVER_SCHEMA &&
    value.schemaVersion === CORE_NATIVE_OBSERVER_SCHEMA_VERSION && value.platform === 'darwin' &&
    value.mode === request.mode &&
    isEffectiveUid(value.effectiveUid) && typeof value.bootSessionId === 'string';
}

function parseDarwinUnknownEnvelope(
  value: Record<string, unknown>,
  request: CoreNativeObserverRequest,
  arch: CoreNativeObserverArch,
) {
  const keys = request.mode === 'listener'
    ? ['arch', 'bootSessionId', 'effectiveUid', 'mode', 'platform', 'port', 'reason', 'schema', 'schemaVersion', 'status']
    : ['arch', 'bootSessionId', 'effectiveUid', 'mode', 'platform', 'reason', 'schema', 'schemaVersion', 'status'];
  if (!hasExactKeys(value, keys) || !commonDarwinEnvelopeMatches(value, request) || value.status !== 'unknown' ||
    value.arch !== arch || typeof value.reason !== 'string') return false;
  const knownReason = request.mode === 'listener'
    ? LISTENER_UNKNOWN_REASONS.has(value.reason as DarwinListenerUnknownReason)
    : PROCESS_UNKNOWN_REASONS.has(value.reason as DarwinProcessesUnknownReason);
  if (!knownReason || (request.mode === 'listener' && value.port !== request.port)) return false;
  return value.reason === 'boot-session-unavailable'
    ? value.bootSessionId === 'unavailable'
    : typeof value.bootSessionId === 'string' && BOOT_SESSION_UUID.test(value.bootSessionId);
}

export function parseCoreNativeObserverEnvelope(
  value: unknown,
  request: CoreNativeObserverRequest,
  options: Pick<CoreNativeObserverRunnerOptions, 'arch' | 'platform'>,
): CoreNativeObserverResult {
  if (options.platform !== 'darwin' || !isSupportedArch(options.arch) || !isObject(value)) {
    return failure('invalid-envelope');
  }
  if (value.status === 'unknown') {
    return parseDarwinUnknownEnvelope(value, request, options.arch)
      ? failure('helper-unknown')
      : failure('invalid-envelope');
  }
  if (!commonDarwinEnvelopeMatches(value, request) || value.arch !== options.arch ||
    typeof value.bootSessionId !== 'string' || !isEffectiveUid(value.effectiveUid) ||
    !BOOT_SESSION_UUID.test(value.bootSessionId)) {
    return failure('invalid-envelope');
  }

  const base = {
    arch: options.arch,
    bootSessionId: value.bootSessionId,
    effectiveUid: value.effectiveUid,
    platform: 'darwin' as const,
    schema: CORE_NATIVE_OBSERVER_SCHEMA,
    schemaVersion: CORE_NATIVE_OBSERVER_SCHEMA_VERSION,
  };
  if (request.mode === 'processes') {
    if (!hasExactKeys(value, [
      'arch', 'bootSessionId', 'effectiveUid', 'mode', 'platform', 'processes', 'schema', 'schemaVersion', 'status',
    ]) || value.status !== 'ok' || !Array.isArray(value.processes)) return failure('invalid-envelope');
    const processes: CoreNativeProcessSnapshot<CoreNativeDarwinProcessStartIdentity>[] = [];
    let previousPid = 0;
    for (const candidate of value.processes) {
      const process = parseDarwinProcess(candidate);
      if (!process || process.pid <= previousPid) return failure('invalid-envelope');
      processes.push(process);
      previousPid = process.pid;
    }
    return { envelope: { ...base, mode: 'processes', processes, status: 'ok' }, kind: 'success' };
  }

  if (value.port !== request.port || !isPort(value.port)) return failure('invalid-envelope');
  if (value.status === 'absent') {
    if (!hasExactKeys(value, [
      'arch', 'bootSessionId', 'effectiveUid', 'mode', 'platform', 'port', 'schema', 'schemaVersion', 'status',
    ])) return failure('invalid-envelope');
    return { envelope: { ...base, mode: 'listener', port: request.port, status: 'absent' }, kind: 'success' };
  }
  if (value.status !== 'owners' || !hasExactKeys(value, [
    'arch', 'bootSessionId', 'effectiveUid', 'holders', 'mode', 'pids', 'platform', 'port', 'schema',
    'schemaVersion', 'status',
  ])) return failure('invalid-envelope');
  const pids = parsePidList(value.pids, false);
  const holders = pids ? parseDarwinListenerHolders(value.holders, pids) : null;
  return pids && holders
    ? { envelope: { ...base, holders, mode: 'listener', pids, port: request.port, status: 'owners' }, kind: 'success' }
    : failure('invalid-envelope');
}

export function buildCoreNativeObserverEnvironment(
  platform: CoreNativeObserverPlatform,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (platform === 'darwin') {
    return { LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };
  }
  const systemRoot = source.SystemRoot?.trim() || source.WINDIR?.trim() || 'C:\\Windows';
  return {
    LANG: 'C',
    LC_ALL: 'C',
    PATH: path.win32.join(systemRoot, 'System32'),
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
  };
}

function validBound(value: number, maximum: number) {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function trustedHelperStat(stat: CoreNativeObserverFileStat, effectiveUid: number) {
  if (!isEffectiveUid(effectiveUid) || !isEffectiveUid(stat.uid) ||
    !Number.isSafeInteger(stat.mode) || stat.mode < 0 ||
    !stat.isFile() || stat.isSymbolicLink() ||
    (stat.mode & 0o7_000) !== 0 || (stat.mode & 0o022) !== 0 ||
    (stat.uid !== 0 && stat.uid !== effectiveUid)) return false;
  // A current-user-owned helper must be owner-executable. A root-owned helper
  // must be executable by others unless the current process itself is root.
  return stat.uid === effectiveUid
    ? (stat.mode & 0o100) !== 0
    : (stat.mode & 0o001) !== 0;
}

function helperArguments(request: CoreNativeObserverRequest) {
  return request.mode === 'processes'
    ? ['processes']
    : ['listener', '--port', String(request.port)];
}

export async function runCoreNativeObserver(
  request: CoreNativeObserverRequest,
  options: CoreNativeObserverRunnerOptions,
): Promise<CoreNativeObserverResult> {
  const timeoutMs = options.timeoutMs ?? CORE_NATIVE_OBSERVER_TIMEOUT_MS;
  const stdoutLimit = options.stdoutLimitBytes ?? CORE_NATIVE_OBSERVER_STDOUT_LIMIT_BYTES;
  const stderrLimit = options.stderrLimitBytes ?? CORE_NATIVE_OBSERVER_STDERR_LIMIT_BYTES;
  if (options.platform !== 'darwin' || !isSupportedArch(options.arch) ||
    typeof options.helperPath !== 'string' || options.helperPath.includes('\0') ||
    !isCanonicalAbsolutePath(options.helperPath, 'darwin') ||
    (request.mode === 'listener' && !isPort(request.port)) ||
    !validBound(timeoutMs, CORE_NATIVE_OBSERVER_TIMEOUT_MS + 500) ||
    !validBound(stdoutLimit, CORE_NATIVE_OBSERVER_STDOUT_LIMIT_BYTES) ||
    !validBound(stderrLimit, CORE_NATIVE_OBSERVER_STDERR_LIMIT_BYTES)) {
    return failure('invalid-configuration');
  }

  const operations = { ...DEFAULT_OPERATIONS, ...options.operations };
  try {
    const effectiveUid = operations.getEffectiveUid();
    const helperStat = await operations.lstat(options.helperPath);
    if (effectiveUid === null || !trustedHelperStat(helperStat, effectiveUid)) {
      return failure('invalid-configuration');
    }
  } catch {
    return failure('invalid-configuration');
  }
  let child: CoreNativeObserverChild;
  try {
    child = operations.spawn(options.helperPath, helperArguments(request), {
      env: buildCoreNativeObserverEnvironment(options.platform, options.environmentSource),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch {
    return failure('spawn-failed');
  }
  if (!child.stdout || !child.stderr) {
    try { child.kill('SIGKILL'); } catch { /* Best-effort termination. */ }
    return failure('spawn-failed');
  }

  return await new Promise<CoreNativeObserverResult>((resolve) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const finish = (result: CoreNativeObserverResult, terminate = false) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (terminate) {
        try { child.kill('SIGKILL'); } catch { /* The helper may already be gone. */ }
      }
      resolve(result);
    };
    const collect = (target: Buffer[], stream: 'stderr' | 'stdout', chunk: unknown) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (stream === 'stdout') stdoutBytes += bytes.byteLength;
      else stderrBytes += bytes.byteLength;
      const limit = stream === 'stdout' ? stdoutLimit : stderrLimit;
      const size = stream === 'stdout' ? stdoutBytes : stderrBytes;
      if (size > limit) {
        finish(failure(stream === 'stdout' ? 'stdout-overflow' : 'stderr-overflow'), true);
        return;
      }
      target.push(bytes);
    };

    child.stdout!.on('data', (chunk) => collect(stdout, 'stdout', chunk));
    child.stderr!.on('data', (chunk) => collect(stderr, 'stderr', chunk));
    child.once('error', () => finish(failure('spawn-failed'), true));
    child.once('close', (code, signal) => {
      if (settled) return;
      if (signal) return finish(failure('abnormal-exit'));
      if (code !== 0) return finish(failure(code === null ? 'abnormal-exit' : 'nonzero-exit'));
      if (stderrBytes > 0) return finish(failure('helper-stderr'));
      let text: string;
      try {
        text = UTF8_DECODER.decode(Buffer.concat(stdout));
      } catch {
        return finish(failure('malformed-json'));
      }
      let parsed: unknown;
      try { parsed = JSON.parse(text) as unknown; }
      catch { return finish(failure('malformed-json')); }
      finish(parseCoreNativeObserverEnvelope(parsed, request, options));
    });
    timer = setTimeout(() => finish(failure('timeout'), true), timeoutMs);
  });
}
