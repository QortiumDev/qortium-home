import { open, realpath } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_SETTINGS_BYTES = 1024 * 1024;
const DEFAULT_MAX_USER_PATH_DEPTH = 8;
const QORTAL_AUTO_UPDATE_DEFAULT = true as const;

export type QortalUpdateOwnership = 'node-native' | 'home-github' | 'observe-only';

export type QortalAutoUpdateSource = 'default' | 'live-api' | 'settings-file' | 'unknown';

export type QortalAutoUpdateDetection = {
  checkedAt: string;
  defaultEnabled: typeof QORTAL_AUTO_UPDATE_DEFAULT;
  enabled: boolean | null;
  reason?: string;
  settingsPath?: string;
  source: QortalAutoUpdateSource;
  usedDefault: boolean;
};

export type QortalUpdateOwnershipDecision = {
  detection: QortalAutoUpdateDetection;
  ownership: QortalUpdateOwnership;
};

export type QortalSettingsPolicyOperations = {
  readFile: (settingsPath: string, maxBytes: number) => Promise<string>;
  realpath: (settingsPath: string) => Promise<string>;
};

export type QortalSettingsPolicyOptions = {
  checkedAt?: string;
  cwd?: string;
  maxBytes?: number;
  maxUserPathDepth?: number;
  operations?: Partial<QortalSettingsPolicyOperations>;
  platform?: NodeJS.Platform;
};

export type QortalEffectiveSettingsResult =
  | {
      kind: 'resolved';
      settings: Record<string, unknown>;
      settingsPath: string;
    }
  | {
      kind: 'unknown';
      reason: string;
      settingsPath?: string;
    };

const DEFAULT_OPERATIONS: QortalSettingsPolicyOperations = {
  readFile: async (settingsPath, maxBytes) => {
    const handle = await open(settingsPath, 'r');

    try {
      const buffer = Buffer.alloc(maxBytes + 1);
      let bytesRead = 0;

      while (bytesRead < buffer.length) {
        const read = await handle.read(
          buffer,
          bytesRead,
          buffer.length - bytesRead,
          bytesRead,
        );

        if (read.bytesRead === 0) {
          break;
        }

        bytesRead += read.bytesRead;
      }

      if (bytesRead > maxBytes) {
        throw new QortalSettingsSizeError();
      }

      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  },
  realpath: async (settingsPath) => await realpath(settingsPath),
};

class QortalSettingsSizeError extends Error {}

function ownershipFor(enabled: boolean | null): QortalUpdateOwnership {
  return enabled === true
    ? 'node-native'
    : enabled === false
      ? 'home-github'
      : 'observe-only';
}

function decision(
  enabled: boolean | null,
  source: QortalAutoUpdateSource,
  options: {
    checkedAt: string;
    reason?: string;
    settingsPath?: string;
    usedDefault?: boolean;
  },
): QortalUpdateOwnershipDecision {
  return {
    detection: {
      checkedAt: options.checkedAt,
      defaultEnabled: QORTAL_AUTO_UPDATE_DEFAULT,
      enabled,
      ...(options.reason ? { reason: options.reason } : {}),
      ...(options.settingsPath ? { settingsPath: options.settingsPath } : {}),
      source,
      usedDefault: options.usedDefault === true,
    },
    ownership: ownershipFor(enabled),
  };
}

function unknown(checkedAt: string, reason: string, settingsPath?: string) {
  return decision(null, 'unknown', { checkedAt, reason, settingsPath });
}

function checkedAt(value?: string) {
  return value ?? new Date().toISOString();
}

function requireBoundedInteger(value: number, label: string, minimum: number) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${label} must be a safe integer greater than or equal to ${minimum}.`);
  }

  return value;
}

function normalizeCanonicalPath(value: string, platform: NodeJS.Platform) {
  return platform === 'win32' ? value.toLowerCase() : value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Mirrors Qortal v6.1.9 Settings.fileInstance preprocessing: only whole lines
 * whose trimmed form starts with # are comments, then commas immediately before
 * a closing object or array delimiter are removed.
 */
export function parseQortalSettingsText(value: string): Record<string, unknown> | null {
  const withoutCommentLines = value
    .split(/\r\n?|\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  const withoutTrailingCommas = withoutCommentLines.replace(/,(?=\s*[}\]])/g, '');

  try {
    const parsed: unknown = JSON.parse(withoutTrailingCommas);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function detectQortalUpdateOwnershipFromLiveResponse(
  value: unknown,
  options: { checkedAt?: string } = {},
): QortalUpdateOwnershipDecision {
  const detectedAt = checkedAt(options.checkedAt);

  if (value !== true && value !== false) {
    return unknown(detectedAt, 'The live auto-update setting was not an exact boolean.');
  }

  return decision(value, 'live-api', { checkedAt: detectedAt });
}

/**
 * A response from the running node is authoritative. Invalid live data does not
 * fall back to a potentially stale stopped-file decision; it fails closed.
 */
export function resolveQortalUpdateOwnershipWithLiveResponse(
  liveResponse: unknown,
  _stoppedDecision: QortalUpdateOwnershipDecision,
  options: { checkedAt?: string } = {},
) {
  return detectQortalUpdateOwnershipFromLiveResponse(liveResponse, options);
}

function resolveJvmSettingsPath(
  cwd: string,
  originalSettingsFilename: string,
  userPath: string | null,
) {
  // java.nio.file.Paths.get(userPath, originalFilename) retains the original
  // filename on every userPath pass. Node's path.join has the same segment
  // semantics, including when originalFilename begins with a root separator.
  const candidate = userPath === null
    ? originalSettingsFilename
    : path.join(userPath, originalSettingsFilename);

  return path.resolve(cwd, candidate);
}

/**
 * Resolves the exact settings object Qortal reaches after repeatedly applying
 * `userPath`. This is shared by stopped update-policy and API-key authority so
 * the two security decisions cannot drift onto different configuration files.
 */
export async function resolveEffectiveQortalSettings(
  originalSettingsFilename: string,
  options: QortalSettingsPolicyOptions = {},
): Promise<QortalEffectiveSettingsResult> {
  const maxBytes = requireBoundedInteger(
    options.maxBytes ?? DEFAULT_MAX_SETTINGS_BYTES,
    'maxBytes',
    1,
  );
  const maxUserPathDepth = requireBoundedInteger(
    options.maxUserPathDepth ?? DEFAULT_MAX_USER_PATH_DEPTH,
    'maxUserPathDepth',
    0,
  );
  const operations: QortalSettingsPolicyOperations = {
    ...DEFAULT_OPERATIONS,
    ...options.operations,
  };
  const platform = options.platform ?? process.platform;
  const cwd = path.resolve(options.cwd ?? process.cwd());

  if (
    !originalSettingsFilename ||
    !originalSettingsFilename.trim() ||
    originalSettingsFilename.includes('\0')
  ) {
    return { kind: 'unknown', reason: 'The original settings filename was empty or invalid.' };
  }

  const visited = new Set<string>();
  let userPath: string | null = null;
  let userPathDepth = 0;

  while (true) {
    let canonicalSettingsPath: string;

    try {
      const candidatePath = resolveJvmSettingsPath(cwd, originalSettingsFilename, userPath);
      canonicalSettingsPath = await operations.realpath(candidatePath);
    } catch {
      return { kind: 'unknown', reason: 'The effective settings path could not be resolved.' };
    }

    const canonicalIdentity = normalizeCanonicalPath(canonicalSettingsPath, platform);

    if (visited.has(canonicalIdentity)) {
      return {
        kind: 'unknown',
        reason: 'The settings userPath chain contains a cycle.',
        settingsPath: canonicalSettingsPath,
      };
    }
    visited.add(canonicalIdentity);

    let rawSettings: string;
    try {
      rawSettings = await operations.readFile(canonicalSettingsPath, maxBytes);
    } catch (error) {
      return {
        kind: 'unknown',
        reason: error instanceof QortalSettingsSizeError
          ? 'The effective settings file exceeded the byte limit.'
          : 'The effective settings file could not be read.',
        settingsPath: canonicalSettingsPath,
      };
    }

    if (Buffer.byteLength(rawSettings, 'utf8') > maxBytes) {
      return {
        kind: 'unknown',
        reason: 'The effective settings file exceeded the byte limit.',
        settingsPath: canonicalSettingsPath,
      };
    }

    const settings = parseQortalSettingsText(rawSettings);
    if (!settings) {
      return {
        kind: 'unknown',
        reason: 'The effective settings file was malformed.',
        settingsPath: canonicalSettingsPath,
      };
    }

    if (Object.prototype.hasOwnProperty.call(settings, 'userPath') && settings.userPath !== null) {
      if (
        typeof settings.userPath !== 'string' ||
        !settings.userPath.trim() ||
        settings.userPath.includes('\0')
      ) {
        return {
          kind: 'unknown',
          reason: 'The settings userPath was empty or invalid.',
          settingsPath: canonicalSettingsPath,
        };
      }
      if (userPathDepth >= maxUserPathDepth) {
        return {
          kind: 'unknown',
          reason: 'The settings userPath chain exceeded the depth limit.',
          settingsPath: canonicalSettingsPath,
        };
      }
      userPath = settings.userPath;
      userPathDepth += 1;
      continue;
    }

    return { kind: 'resolved', settings, settingsPath: canonicalSettingsPath };
  }
}

/**
 * Extracts update ownership from the effective stopped-node settings chain.
 * This mirrors Qortal's file preprocessing and userPath resolution, but does
 * not duplicate validation of unrelated Settings fields. A manager must still
 * establish process/readiness safety before starting or mutating the node.
 */
export async function detectQortalUpdateOwnershipFromSettings(
  originalSettingsFilename: string,
  options: QortalSettingsPolicyOptions = {},
): Promise<QortalUpdateOwnershipDecision> {
  const detectedAt = checkedAt(options.checkedAt);
  const effective = await resolveEffectiveQortalSettings(originalSettingsFilename, options);

  if (effective.kind === 'unknown') {
    return unknown(detectedAt, effective.reason, effective.settingsPath);
  }

  if (!Object.prototype.hasOwnProperty.call(effective.settings, 'autoUpdateEnabled')) {
    return decision(QORTAL_AUTO_UPDATE_DEFAULT, 'default', {
      checkedAt: detectedAt,
      settingsPath: effective.settingsPath,
      usedDefault: true,
    });
  }

  if (
    effective.settings.autoUpdateEnabled !== true &&
    effective.settings.autoUpdateEnabled !== false
  ) {
    return unknown(
      detectedAt,
      'The settings autoUpdateEnabled value was not an exact boolean.',
      effective.settingsPath,
    );
  }

  return decision(effective.settings.autoUpdateEnabled, 'settings-file', {
    checkedAt: detectedAt,
    settingsPath: effective.settingsPath,
  });
}
